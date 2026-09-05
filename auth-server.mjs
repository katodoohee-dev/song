import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { mkdir, readFile as readStorageFile, unlink, writeFile as writeStorageFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const port = Number(process.env.PORT || 10000);
const host = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const cookieName = 'song_note_session';
const sessionDays = 30;
const connectionString = process.env.DATABASE_URL || '';
const pool = connectionString ? new Pool({ connectionString, max: 5, ssl: isProd ? { rejectUnauthorized: false } : undefined }) : null;
const storageRoot = process.env.STORAGE_DIR || join(fileURLToPath(new URL('.', import.meta.url)), 'storage-data');
const maxUploadBytes = 50 * 1024 * 1024;

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

const parseCookies = (value = '') => Object.fromEntries(
  value.split(';').map((v) => v.trim()).filter(Boolean).map((v) => {
    const i = v.indexOf('=');
    return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
  }),
);

const passwordHash = async (password, salt = crypto.randomBytes(16).toString('hex')) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`${salt}:${key.toString('hex')}`));
});

const passwordMatches = async (password, stored) => {
  const [salt, hex] = String(stored).split(':');
  if (!salt || !hex) return false;
  const candidate = await passwordHash(password, salt);
  const a = Buffer.from(candidate.split(':')[1], 'hex');
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const cleanUser = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  avatarUrl: row.avatar_url || null,
  role: row.role || 'USER',
  createdAt: row.created_at,
});

const requireDb = () => {
  if (!pool) {
    const error = new Error('DATABASE_URL is not configured');
    error.status = 503;
    throw error;
  }
};

const initDatabase = async () => {
  requireDb();
  const schema = await readFile(new URL('./db/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  const storageSchema = await readFile(new URL('./db/storage.sql', import.meta.url), 'utf8');
  await pool.query(storageSchema);
};

const createSession = async (userId) => {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + sessionDays * 86400000);
  await pool.query('INSERT INTO sessions(id,user_id,expires_at,last_seen_at) VALUES($1,$2,$3,NOW())', [id, userId, expires]);
  return { id, expires };
};

const sessionCookie = (id, expires) => `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=None; Secure; Expires=${expires.toUTCString()}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 100_000) req.destroy(Object.assign(new Error('Request body too large'), { status: 413 }));
  });
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
  });
  req.on('error', reject);
});

const readBinary = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > limit) {
      reject(Object.assign(new Error('File is too large. Maximum size is 50 MB.'), { status: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const currentUser = async (req) => {
  requireDb();
  const sid = parseCookies(req.headers.cookie)[cookieName];
  if (!sid) return null;
  const result = await pool.query(
    `SELECT u.id,u.email,u.display_name,u.avatar_url,u.role,u.created_at
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.id=$1 AND s.expires_at>NOW()`,
    [sid],
  );
  if (!result.rows[0]) return null;
  await pool.query('UPDATE sessions SET last_seen_at=NOW() WHERE id=$1', [sid]);
  return cleanUser(result.rows[0]);
};

const safeFileName = (value = 'file') => {
  const normalized = String(value).normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return normalized || 'file';
};

const storagePath = (key) => {
  const path = join(storageRoot, key);
  if (!path.startsWith(storageRoot)) throw Object.assign(new Error('Invalid storage key'), { status: 400 });
  return path;
};

const storageConfig = () => ({
  driver: 'local',
  maxBytes: maxUploadBytes,
  persistentPath: storageRoot,
  note: 'Attach a Render persistent disk or replace this provider with object storage for durable production media.'
});

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      requireDb();
      await pool.query('SELECT 1');
      const storage = storageConfig();
      return send(res, 200, { ok: true, service: 'song-note-auth', database: true, storage });
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      requireDb();
      const data = await readBody(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const displayName = String(data.displayName || email.split('@')[0] || 'User').trim().slice(0, 80);
      if (!validEmail(email)) return send(res, 400, { error: 'Please enter a valid email.' });
      if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      if (!displayName) return send(res, 400, { error: 'Display name is required.' });
      const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
      if (exists.rowCount) return send(res, 409, { error: 'An account with this email already exists.' });
      const id = crypto.randomUUID();
      const hash = await passwordHash(password);
      const result = await pool.query(
        'INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,avatar_url,role,created_at',
        [id, email, hash, displayName],
      );
      await pool.query('INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING', [id]);
      const session = await createSession(id);
      return send(res, 201, { user: cleanUser(result.rows[0]) }, { 'Set-Cookie': sessionCookie(session.id, session.expires) });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      requireDb();
      const data = await readBody(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      if (!validEmail(email) || !password) return send(res, 401, { error: 'Email or password is incorrect.' });
      const result = await pool.query(
        'SELECT id,email,password_hash,display_name,avatar_url,role,created_at FROM users WHERE email=$1',
        [email],
      );
      if (!result.rows[0] || !(await passwordMatches(password, result.rows[0].password_hash))) {
        return send(res, 401, { error: 'Email or password is incorrect.' });
      }
      const session = await createSession(result.rows[0].id);
      return send(res, 200, { user: cleanUser(result.rows[0]) }, { 'Set-Cookie': sessionCookie(session.id, session.expires) });
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      return send(res, 200, { user: await currentUser(req) });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      requireDb();
      const sid = parseCookies(req.headers.cookie)[cookieName];
      if (sid) await pool.query('DELETE FROM sessions WHERE id=$1', [sid]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
    }

    if (url.pathname === '/api/auth/profile' && req.method === 'PUT') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const data = await readBody(req);
      const displayName = String(data.displayName || '').trim().slice(0, 80);
      if (!displayName) return send(res, 400, { error: 'Display name is required.' });
      const result = await pool.query(
        'UPDATE users SET display_name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,email,display_name,avatar_url,role,created_at',
        [displayName, user.id],
      );
      return send(res, 200, { user: cleanUser(result.rows[0]) });
    }

    if (url.pathname === '/api/storage/upload' && req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const sizeHeader = Number(req.headers['content-length'] || 0);
      if (sizeHeader > maxUploadBytes) return send(res, 413, { error: 'File is too large. Maximum size is 50 MB.' });
      const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      const originalName = safeFileName(url.searchParams.get('filename') || req.headers['x-file-name'] || 'upload');
      const kind = String(url.searchParams.get('kind') || (mimeType.startsWith('audio/') ? 'original' : 'artwork'));
      const id = crypto.randomUUID();
      const key = `users/${user.id}/${id}-${originalName}`;
      const filePath = storagePath(key);
      const data = await readBinary(req, maxUploadBytes);
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await writeStorageFile(filePath, data, { mode: 0o600 });
      await pool.query(
        'INSERT INTO storage_objects(id,user_id,object_key,original_name,mime_type,byte_size,storage_driver) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, user.id, key, originalName, mimeType, data.byteLength, 'local'],
      );
      return send(res, 201, { object: { id, filename: originalName, mimeType, size: data.byteLength, kind, key, url: `/api/storage/object/${id}` } });
    }

    if (url.pathname === '/api/storage' && req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const result = await pool.query(
        'SELECT id,original_name,mime_type,byte_size,storage_driver,created_at FROM storage_objects WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
        [user.id],
      );
      return send(res, 200, { objects: result.rows.map(row => ({ id: row.id, filename: row.original_name, mimeType: row.mime_type, size: Number(row.byte_size), driver: row.storage_driver, createdAt: row.created_at, url: `/api/storage/object/${row.id}` })) });
    }

    const objectMatch = url.pathname.match(/^\/api\/storage\/object\/([0-9a-fA-F-]{36})$/);
    if (objectMatch && req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const result = await pool.query('SELECT * FROM storage_objects WHERE id=$1 AND user_id=$2', [objectMatch[1], user.id]);
      const row = result.rows[0];
      if (!row) return send(res, 404, { error: 'File not found.' });
      const data = await readStorageFile(storagePath(row.object_key));
      res.writeHead(200, { 'Content-Type': row.mime_type, 'Content-Length': data.byteLength, 'Content-Disposition': `inline; filename="${row.original_name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=3600' });
      return res.end(data);
    }

    if (objectMatch && req.method === 'DELETE') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const result = await pool.query('SELECT object_key FROM storage_objects WHERE id=$1 AND user_id=$2', [objectMatch[1], user.id]);
      const row = result.rows[0];
      if (!row) return send(res, 404, { error: 'File not found.' });
      await unlink(storagePath(row.object_key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await pool.query('DELETE FROM storage_objects WHERE id=$1 AND user_id=$2', [objectMatch[1], user.id]);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, error.status || 500, { error: error.status || 500 === 413 ? error.message : error.message || 'Server error.' });
  }
});

initDatabase()
  .then(() => server.listen(port, host, () => console.log(`Song Note auth listening on ${host}:${port} (Postgres + storage)`)))
  .catch((error) => { console.error('Database initialization failed', error); process.exit(1); });
