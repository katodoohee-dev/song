import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.PORT || 10000);
const host = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const cookieName = 'song_note_session';
const sessionDays = 30;
const dataFile = join(fileURLToPath(new URL('.', import.meta.url)), 'auth-data.json');
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: isProd ? { rejectUnauthorized: false } : undefined }) : null;
let localData = { users: [], sessions: [] };
let localWrite = Promise.resolve();

const send = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
};
const cors = (res) => {
  const origin = process.env.FRONTEND_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
};
const parseCookies = (value = '') => Object.fromEntries(value.split(';').map(v => v.trim()).filter(Boolean).map(v => {
  const i = v.indexOf('=');
  return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
}));
const passwordHash = async (password, salt = crypto.randomBytes(16).toString('hex')) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`${salt}:${key.toString('hex')}`)));
const passwordMatches = async (password, stored) => {
  const [salt, hex] = String(stored).split(':');
  if (!salt || !hex) return false;
  const candidate = await passwordHash(password, salt);
  const a = Buffer.from(candidate.split(':')[1], 'hex');
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const cleanUser = row => ({ id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url || null, createdAt: row.created_at });
const cleanLocalUser = row => ({ id: row.id, email: row.email, displayName: row.displayName, avatarUrl: row.avatarUrl || null, createdAt: row.createdAt });
const sessionCookie = (id, expires) => `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=None; Secure; Expires=${expires.toUTCString()}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
const body = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 100_000) {
      const error = Object.assign(new Error('Request body too large'), { status: 413 });
      req.destroy(error);
    }
  });
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
  });
  req.on('error', reject);
});

const loadLocalData = async () => {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    localData = { users: Array.isArray(parsed.users) ? parsed.users : [], sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Start with an empty in-memory store. The first write creates the file lazily.
    localData = { users: [], sessions: [] };
  }
};
const persistLocalData = async () => {
  localWrite = localWrite.then(async () => {
    const tempFile = `${dataFile}.${process.pid}.tmp`;
    await writeFile(tempFile, JSON.stringify(localData), { mode: 0o600 });
    await rename(tempFile, dataFile);
  });
  return localWrite;
};
const cleanupLocalSessions = () => {
  const now = Date.now();
  const before = localData.sessions.length;
  localData.sessions = localData.sessions.filter(session => new Date(session.expiresAt).getTime() > now);
  return localData.sessions.length !== before;
};

const ensureDb = async () => {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
  `);
};
const createSession = async userId => {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + sessionDays * 86400000);
  if (pool) {
    await pool.query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [id, userId, expires]);
  } else {
    cleanupLocalSessions();
    localData.sessions.push({ id, userId, expiresAt: expires.toISOString() });
    await persistLocalData();
  }
  return { id, expires };
};
const getCurrentUser = async req => {
  const sid = parseCookies(req.headers.cookie)[cookieName];
  if (!sid) return null;
  if (pool) {
    const result = await pool.query('SELECT u.id,u.email,u.display_name,u.avatar_url,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()', [sid]);
    return result.rows[0] ? cleanUser(result.rows[0]) : null;
  }
  if (cleanupLocalSessions()) await persistLocalData();
  const session = localData.sessions.find(item => item.id === sid);
  if (!session) return null;
  const user = localData.users.find(item => item.id === session.userId);
  return user ? cleanLocalUser(user) : null;
};

const register = async (email, password, displayName) => {
  if (pool) {
    const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (exists.rowCount) return { error: 'An account with this email already exists.' };
    const id = crypto.randomUUID();
    const hash = await passwordHash(password);
    const result = await pool.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,avatar_url,created_at', [id, email, hash, displayName]);
    const session = await createSession(id);
    return { user: cleanUser(result.rows[0]), session };
  }
  const duplicate = localData.users.some(user => user.email === email);
  if (duplicate) return { error: 'An account with this email already exists.' };
  const user = { id: crypto.randomUUID(), email, passwordHash: await passwordHash(password), displayName, avatarUrl: null, createdAt: new Date().toISOString() };
  localData.users.push(user);
  const session = await createSession(user.id);
  await persistLocalData();
  return { user: cleanLocalUser(user), session };
};

const login = async (email, password) => {
  if (pool) {
    const result = await pool.query('SELECT id,email,password_hash,display_name,avatar_url,created_at FROM users WHERE email=$1', [email]);
    if (!result.rows[0] || !(await passwordMatches(password, result.rows[0].password_hash))) return { error: 'Email or password is incorrect.' };
    const session = await createSession(result.rows[0].id);
    return { user: cleanUser(result.rows[0]), session };
  }
  const user = localData.users.find(item => item.email === email);
  if (!user || !(await passwordMatches(password, user.passwordHash))) return { error: 'Email or password is incorrect.' };
  const session = await createSession(user.id);
  return { user: cleanLocalUser(user), session };
};

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'song-note-auth', database: Boolean(pool), storage: pool ? 'postgres' : 'local-file' });

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const data = await body(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const displayName = String(data.displayName || email.split('@')[0] || 'User').trim().slice(0, 80);
      if (!validEmail(email)) return send(res, 400, { error: 'Please enter a valid email.' });
      if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      if (!displayName) return send(res, 400, { error: 'Display name is required.' });
      const result = await register(email, password, displayName);
      if (result.error) return send(res, 409, { error: result.error });
      return send(res, 201, { user: result.user }, { 'Set-Cookie': sessionCookie(result.session.id, result.session.expires) });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const data = await body(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      if (!validEmail(email) || !password) return send(res, 401, { error: 'Email or password is incorrect.' });
      const result = await login(email, password);
      if (result.error) return send(res, 401, { error: result.error });
      return send(res, 200, { user: result.user }, { 'Set-Cookie': sessionCookie(result.session.id, result.session.expires) });
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      return send(res, 200, { user: await getCurrentUser(req) });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const sid = parseCookies(req.headers.cookie)[cookieName];
      if (sid) {
        if (pool) await pool.query('DELETE FROM sessions WHERE id=$1', [sid]);
        else {
          localData.sessions = localData.sessions.filter(session => session.id !== sid);
          await persistLocalData();
        }
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
    }

    if (url.pathname === '/api/auth/profile' && req.method === 'PUT') {
      const user = await getCurrentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const data = await body(req);
      const displayName = String(data.displayName || '').trim().slice(0, 80);
      if (!displayName) return send(res, 400, { error: 'Display name is required.' });
      if (pool) {
        const result = await pool.query('UPDATE users SET display_name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,email,display_name,avatar_url,created_at', [displayName, user.id]);
        return send(res, 200, { user: cleanUser(result.rows[0]) });
      }
      const localUser = localData.users.find(item => item.id === user.id);
      if (!localUser) return send(res, 404, { error: 'User not found.' });
      localUser.displayName = displayName;
      await persistLocalData();
      return send(res, 200, { user: cleanLocalUser(localUser) });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, error.status || 500, { error: 'Server error.' });
  }
});

const start = async () => {
  if (pool) await ensureDb();
  else await loadLocalData();
  server.listen(port, host, () => console.log(`Song Note auth listening on ${host}:${port} (${pool ? 'Postgres' : 'local-file'} storage)`));
};
start().catch(error => { console.error('Auth startup failed', error); process.exit(1); });
