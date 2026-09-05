import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const dataFile = join(fileURLToPath(new URL('.', import.meta.url)), 'auth-data.json');
const port = Number(process.env.PORT || 10000);
const host = '0.0.0.0';
const cookieName = 'song_note_session';
const sessionDays = 30;
const isProd = process.env.NODE_ENV === 'production';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: isProd ? { rejectUnauthorized: false } : undefined }) : null;
let localData = { users: [], sessions: [] };
let localWrite = Promise.resolve();
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2' };

const sendJson = (res, status, payload, headers = {}) => {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
};
const parseCookies = (value = '') => Object.fromEntries(value.split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))]; }));
const readBody = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 100_000) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); }
  });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  req.on('error', reject);
});
const passwordHash = (password, salt = crypto.randomBytes(16).toString('hex')) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`${salt}:${key.toString('hex')}`)));
const passwordMatches = async (password, stored) => { const [salt, hex] = String(stored).split(':'); if (!salt || !hex) return false; const candidate = await passwordHash(password, salt); const a = Buffer.from(candidate.split(':')[1], 'hex'); const b = Buffer.from(hex, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const cleanUser = row => ({ id: row.id, email: row.email, displayName: row.displayName ?? row.display_name, avatarUrl: row.avatarUrl ?? row.avatar_url ?? null, createdAt: row.createdAt ?? row.created_at });
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const sessionCookie = (id, expires) => `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${isProd ? '; Secure' : ''}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? '; Secure' : ''}`;

async function loadLocalData() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    localData = { users: Array.isArray(parsed.users) ? parsed.users : [], sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
async function persistLocalData() {
  localWrite = localWrite.then(async () => {
    const temp = `${dataFile}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(localData), { mode: 0o600 });
    await rename(temp, dataFile);
  });
  return localWrite;
}
function cleanupSessions() { localData.sessions = localData.sessions.filter(s => new Date(s.expiresAt).getTime() > Date.now()); }
async function ensureDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,display_name TEXT NOT NULL,avatar_url TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id); CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);`);
}
async function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + sessionDays * 86400000);
  if (pool) await pool.query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [id, userId, expires]);
  else { cleanupSessions(); localData.sessions.push({ id, userId, expiresAt: expires.toISOString() }); await persistLocalData(); }
  return { id, expires };
}
async function currentUser(req) {
  const sid = parseCookies(req.headers.cookie)[cookieName];
  if (!sid) return null;
  if (pool) {
    const r = await pool.query('SELECT u.id,u.email,u.display_name,u.avatar_url,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()', [sid]);
    return r.rows[0] ? cleanUser(r.rows[0]) : null;
  }
  cleanupSessions();
  const session = localData.sessions.find(s => s.id === sid);
  const user = session && localData.users.find(u => u.id === session.userId);
  return user ? cleanUser(user) : null;
}
async function authRoute(req, res, pathname) {
  if (pathname === '/api/auth/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, database: Boolean(pool), service: 'song-note-auth' });
  if (pathname === '/api/auth/me' && req.method === 'GET') return sendJson(res, 200, { user: await currentUser(req) });
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const sid = parseCookies(req.headers.cookie)[cookieName];
    if (sid) {
      if (pool) await pool.query('DELETE FROM sessions WHERE id=$1', [sid]);
      else { localData.sessions = localData.sessions.filter(s => s.id !== sid); await persistLocalData(); }
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  }
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || email.split('@')[0] || 'User').trim().slice(0, 80);
    if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email.' });
    if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
    if (!displayName) return sendJson(res, 400, { error: 'Display name is required.' });
    let user;
    if (pool) {
      const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
      if (exists.rowCount) return sendJson(res, 409, { error: 'An account with this email already exists.' });
      const id = crypto.randomUUID();
      const hash = await passwordHash(password);
      const r = await pool.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,avatar_url,created_at', [id, email, hash, displayName]);
      user = cleanUser(r.rows[0]);
    } else {
      if (localData.users.some(u => u.email === email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
      const stored = { id: crypto.randomUUID(), email, passwordHash: await passwordHash(password), displayName, avatarUrl: null, createdAt: new Date().toISOString() };
      localData.users.push(stored);
      user = cleanUser(stored);
    }
    const session = await createSession(user.id);
    return sendJson(res, 201, { user }, { 'Set-Cookie': sessionCookie(session.id, session.expires) });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    let user;
    if (pool) {
      const r = await pool.query('SELECT id,email,password_hash,display_name,avatar_url,created_at FROM users WHERE email=$1', [email]);
      if (!r.rows[0] || !(await passwordMatches(password, r.rows[0].password_hash))) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
      user = cleanUser(r.rows[0]);
    } else {
      const stored = localData.users.find(u => u.email === email);
      if (!stored || !(await passwordMatches(password, stored.passwordHash))) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
      user = cleanUser(stored);
    }
    const session = await createSession(user.id);
    return sendJson(res, 200, { user }, { 'Set-Cookie': sessionCookie(session.id, session.expires) });
  }
  if (pathname === '/api/auth/profile' && req.method === 'PUT') {
    const user = await currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Not authenticated.' });
    const body = await readBody(req);
    const displayName = String(body.displayName || '').trim().slice(0, 80);
    if (!displayName) return sendJson(res, 400, { error: 'Display name is required.' });
    if (pool) {
      const r = await pool.query('UPDATE users SET display_name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,email,display_name,avatar_url,created_at', [displayName, user.id]);
      return sendJson(res, 200, { user: cleanUser(r.rows[0]) });
    }
    const stored = localData.users.find(u => u.id === user.id);
    if (!stored) return sendJson(res, 404, { error: 'User not found.' });
    stored.displayName = displayName;
    await persistLocalData();
    return sendJson(res, 200, { user: cleanUser(stored) });
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
    if (pathname.startsWith('/api/auth/')) {
      const handled = await authRoute(req, res, pathname);
      if (handled !== false) return;
    }
    const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '');
    let file = join(root, safe === '/' ? 'index.html' : safe);
    try { await readFile(file); } catch { file = join(root, 'index.html'); }
    const type = types[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    createReadStream(file).on('error', error => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: 'Internal server error' });
    else res.destroy(error);
  }
});

async function start() {
  if (pool) await ensureDb(); else await loadLocalData();
  server.listen(port, host, () => console.log(`Song Note server listening on ${host}:${port} (${pool ? 'Postgres auth' : 'local auth'})`));
}
start().catch(error => { console.error('Server startup failed', error); process.exit(1); });
