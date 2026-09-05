import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getYouTubeMetadata } from './youtube.mjs';

const { Pool } = pg;
const port = Number(process.env.PORT || 10000);
const host = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const cookieName = 'song_note_session';
const sessionDays = 30;
const connectionString = process.env.DATABASE_URL || '';
const pool = connectionString ? new Pool({ connectionString, max: 5, ssl: isProd ? { rejectUnauthorized: false } : undefined }) : null;
const dataRoot = process.env.STORAGE_DIR || join(fileURLToPath(new URL('.', import.meta.url)), 'storage-data');
const authDataFile = join(dataRoot, '..', 'auth-data.json');
const storageIndexFile = join(dataRoot, '..', 'storage-index.json');
const maxUploadBytes = 50 * 1024 * 1024;
let localData = { users: [], sessions: [] };
let localStorageIndex = [];
let localWrite = Promise.resolve();

const send = (res, status, payload, headers = {}) => {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
};

const allowedOrigin = process.env.FRONTEND_ORIGIN || 'https://song-note-frontend.onrender.com';
const cors = res => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
};

const parseCookies = (value = '') => Object.fromEntries(value.split(';').map(v => v.trim()).filter(Boolean).map(v => {
  const i = v.indexOf('=');
  return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
}));

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

const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const cleanUser = row => ({ id: row.id, email: row.email, displayName: row.display_name ?? row.displayName, avatarUrl: row.avatar_url ?? row.avatarUrl ?? null, role: row.role || 'USER', createdAt: row.created_at ?? row.createdAt });
const sessionCookie = (id, expires) => `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=None; Secure; Expires=${expires.toUTCString()}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;

// ---------------------------------------------------------------------------
// Very small in-memory rate limiter for the login/register endpoints.
// Not a substitute for a real WAF/rate-limiting service, but it closes the
// "unlimited brute force / credential stuffing" gap for a single-instance
// deployment. Keyed by client IP; sliding window.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 20; // per IP per window, across login+register
const rateLimitHits = new Map(); // ip -> array of timestamps

const clientIp = req => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
};

const rateLimited = req => {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (rateLimitHits.get(ip) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  rateLimitHits.set(ip, hits);
  if (rateLimitHits.size > 5000) {
    // Basic memory guard: drop entries that have aged out entirely.
    for (const [key, value] of rateLimitHits) {
      if (!value.some(ts => now - ts < RATE_LIMIT_WINDOW_MS)) rateLimitHits.delete(key);
    }
  }
  return hits.length > RATE_LIMIT_MAX_ATTEMPTS;
};

const readJsonFile = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};

const persistLocalState = async () => {
  localWrite = localWrite.then(async () => {
    await mkdir(dirname(authDataFile), { recursive: true, mode: 0o700 });
    const authTmp = `${authDataFile}.${process.pid}.tmp`;
    await writeFile(authTmp, JSON.stringify(localData), { mode: 0o600 });
    await rename(authTmp, authDataFile);
    const storageTmp = `${storageIndexFile}.${process.pid}.tmp`;
    await writeFile(storageTmp, JSON.stringify(localStorageIndex), { mode: 0o600 });
    await rename(storageTmp, storageIndexFile);
  });
  return localWrite;
};

const initLocal = async () => {
  const auth = await readJsonFile(authDataFile, { users: [], sessions: [] });
  const storage = await readJsonFile(storageIndexFile, []);
  localData = { users: Array.isArray(auth.users) ? auth.users : [], sessions: Array.isArray(auth.sessions) ? auth.sessions : [] };
  localStorageIndex = Array.isArray(storage) ? storage : [];
};

const cleanupLocalSessions = () => {
  const before = localData.sessions.length;
  localData.sessions = localData.sessions.filter(session => new Date(session.expiresAt).getTime() > Date.now());
  return before !== localData.sessions.length;
};

const readBody = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 100_000) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); } });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  req.on('error', reject);
});

const readBinary = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  req.on('data', chunk => {
    total += chunk.length;
    if (total > limit) { reject(Object.assign(new Error('File is too large. Maximum size is 50 MB.'), { status: 413 })); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const currentUser = async req => {
  const sid = parseCookies(req.headers.cookie)[cookieName];
  if (!sid) return null;
  if (pool) {
    const result = await pool.query('SELECT u.id,u.email,u.display_name,u.avatar_url,u.role,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()', [sid]);
    if (!result.rows[0]) return null;
    await pool.query('UPDATE sessions SET last_seen_at=NOW() WHERE id=$1', [sid]);
    return cleanUser(result.rows[0]);
  }
  if (cleanupLocalSessions()) await persistLocalState();
  const session = localData.sessions.find(item => item.id === sid);
  const user = session && localData.users.find(item => item.id === session.userId);
  return user ? cleanUser(user) : null;
};

const createSession = async userId => {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + sessionDays * 86400000);
  if (pool) await pool.query('INSERT INTO sessions(id,user_id,expires_at,last_seen_at) VALUES($1,$2,$3,NOW())', [id, userId, expires]);
  else { cleanupLocalSessions(); localData.sessions.push({ id, userId, expiresAt: expires.toISOString() }); await persistLocalState(); }
  return { id, expires };
};

const registerUser = async (email, password, displayName) => {
  if (pool) {
    const id = crypto.randomUUID();
    const hash = await passwordHash(password);
    try {
      const result = await pool.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,avatar_url,role,created_at', [id, email, hash, displayName]);
      await pool.query('INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING', [id]);
      return { user: cleanUser(result.rows[0]), session: await createSession(id) };
    } catch (error) {
      // 23505 = unique_violation. Two concurrent registrations for the same
      // email race the earlier SELECT-then-INSERT check; let the database's
      // UNIQUE constraint be the single source of truth instead.
      if (error.code === '23505') return { error: 'An account with this email already exists.' };
      throw error;
    }
  }
  if (localData.users.some(user => user.email === email)) return { error: 'An account with this email already exists.' };
  const user = { id: crypto.randomUUID(), email, passwordHash: await passwordHash(password), displayName, avatarUrl: null, role: 'USER', createdAt: new Date().toISOString() };
  localData.users.push(user);
  await persistLocalState();
  return { user: cleanUser(user), session: await createSession(user.id) };
};

const loginUser = async (email, password) => {
  if (pool) {
    const result = await pool.query('SELECT id,email,password_hash,display_name,avatar_url,role,created_at FROM users WHERE email=$1', [email]);
    if (!result.rows[0] || !(await passwordMatches(password, result.rows[0].password_hash))) return { error: 'Email or password is incorrect.' };
    return { user: cleanUser(result.rows[0]), session: await createSession(result.rows[0].id) };
  }
  const user = localData.users.find(item => item.email === email);
  if (!user || !(await passwordMatches(password, user.passwordHash))) return { error: 'Email or password is incorrect.' };
  return { user: cleanUser(user), session: await createSession(user.id) };
};

const safeName = value => {
  const name = String(value || 'upload').normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return name || 'upload';
};
const storagePath = key => {
  const resolved = join(dataRoot, key);
  if (!resolved.startsWith(dataRoot)) throw Object.assign(new Error('Invalid storage key'), { status: 400 });
  return resolved;
};

const createStorageObject = async (user, req, url) => {
  const sizeHeader = Number(req.headers['content-length'] || 0);
  if (sizeHeader > maxUploadBytes) throw Object.assign(new Error('File is too large. Maximum size is 50 MB.'), { status: 413 });
  const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const originalName = safeName(url.searchParams.get('filename') || req.headers['x-file-name'] || 'upload');
  const kind = String(url.searchParams.get('kind') || (mimeType.startsWith('audio/') ? 'original' : 'artwork'));
  if (!mimeType.startsWith('audio/') && !['image/jpeg','image/png','image/webp','text/plain','application/pdf'].includes(mimeType)) throw Object.assign(new Error('Unsupported file type.'), { status: 415 });
  const id = crypto.randomUUID();
  const key = `users/${user.id}/${id}-${originalName}`;
  const data = await readBinary(req, maxUploadBytes);
  if (pool) {
    await pool.query('INSERT INTO storage_objects(id,user_id,object_key,original_name,mime_type,byte_size,storage_driver,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, user.id, key, originalName, mimeType, data.byteLength, 'postgres', data]);
  } else {
    const filePath = storagePath(key);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, data, { mode: 0o600 });
    localStorageIndex.push({ id, userId: user.id, objectKey: key, originalName, mimeType, byteSize: data.byteLength, kind, storageDriver: 'local', createdAt: new Date().toISOString() });
    await persistLocalState();
  }
  return { id, filename: originalName, mimeType, size: data.byteLength, kind, key, driver: pool ? 'postgres' : 'local', url: `/api/storage/object/${id}` };
};

const listStorage = async user => {
  if (pool) {
    const result = await pool.query('SELECT id,original_name,mime_type,byte_size,storage_driver,created_at FROM storage_objects WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [user.id]);
    return result.rows.map(row => ({ id: row.id, filename: row.original_name, mimeType: row.mime_type, size: Number(row.byte_size), driver: row.storage_driver, createdAt: row.created_at, url: `/api/storage/object/${row.id}` }));
  }
  return localStorageIndex.filter(row => row.userId === user.id).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0,100).map(row => ({ id: row.id, filename: row.originalName, mimeType: row.mimeType, size: row.byteSize, driver: row.storageDriver, createdAt: row.createdAt, url: `/api/storage/object/${row.id}` }));
};

const getStorageRow = async (userId, id) => {
  if (pool) {
    const result = await pool.query('SELECT id,object_key,original_name,mime_type,byte_size,storage_driver,data FROM storage_objects WHERE id=$1 AND user_id=$2', [id, userId]);
    return result.rows[0] ? { id: result.rows[0].id, objectKey: result.rows[0].object_key, originalName: result.rows[0].original_name, mimeType: result.rows[0].mime_type, byteSize: Number(result.rows[0].byte_size), storageDriver: result.rows[0].storage_driver, data: result.rows[0].data } : null;
  }
  return localStorageIndex.find(row => row.id === id && row.userId === userId) || null;
};

const removeStorageRow = async (userId, id) => {
  const row = await getStorageRow(userId, id);
  if (!row) return false;
  if (pool) await pool.query('DELETE FROM storage_objects WHERE id=$1 AND user_id=$2', [id, userId]);
  else { await unlink(storagePath(row.objectKey)).catch(error => { if (error.code !== 'ENOENT') throw error; }); localStorageIndex = localStorageIndex.filter(item => !(item.id === id && item.userId === userId)); await persistLocalState(); }
  return true;
};

const mapSongRow = row => ({
  id: row.id,
  title: row.title,
  note: row.note,
  durationMs: row.duration_ms,
  status: row.status,
  sourceType: row.source_type,
  sourceUrl: row.source_url,
  youtubeVideoId: row.youtube_video_id,
  artworkUrl: row.artwork_url,
  sourceMetadata: row.source_metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const listSongs = async user => {
  // Song storage requires PostgreSQL (songs/tracks/audio_files tables).
  // Throwing 503 here — instead of silently returning an empty list — lets
  // the frontend (src/songs.ts) correctly fall back to its local-only view
  // instead of showing a permanently empty library.
  if (!pool) throw Object.assign(new Error('Song database is not available in local fallback mode.'), { status: 503 });
  const result = await pool.query(`SELECT s.id,s.title,s.note,s.duration_ms,s.status,s.source_type,s.source_url,s.youtube_video_id,s.artwork_url,s.source_metadata,s.created_at,s.updated_at,t.source_url AS track_source_url FROM songs s LEFT JOIN tracks t ON t.song_id=s.id AND t.track_number=1 WHERE s.created_by=$1 ORDER BY s.created_at DESC LIMIT 200`, [user.id]);
  return result.rows.map(row => ({ ...mapSongRow(row), trackSourceUrl: row.track_source_url }));
};

const createYouTubeSong = async (user, input) => {
  if (!pool) throw Object.assign(new Error('Song database is not available in local fallback mode.'), { status: 503 });
  const metadata = await getYouTubeMetadata(input.url);
  const existing = await pool.query('SELECT id,title,note,duration_ms,status,source_type,source_url,youtube_video_id,artwork_url,source_metadata,created_at,updated_at FROM songs WHERE created_by=$1 AND youtube_video_id=$2', [user.id, metadata.videoId]);
  if (existing.rows[0]) return { ...mapSongRow(existing.rows[0]), duplicate: true };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = crypto.randomUUID();
    const note = String(input.note || '').trim().slice(0, 5000) || null;
    const sourceMetadata = { authorName: metadata.authorName, authorUrl: metadata.authorUrl, artworkFallbackUrl: metadata.artworkFallbackUrl, fetchedAt: new Date().toISOString() };
    const songResult = await client.query(`INSERT INTO songs(id,title,note,status,created_by,source_type,source_url,youtube_video_id,artwork_url,source_metadata) VALUES($1,$2,$3,'ready',$4,'youtube',$5,$6,$7,$8) RETURNING id,title,note,duration_ms,status,source_type,source_url,youtube_video_id,artwork_url,source_metadata,created_at,updated_at`, [id, metadata.title, note, user.id, metadata.url, metadata.videoId, metadata.artworkUrl, sourceMetadata]);
    await client.query('INSERT INTO tracks(id,song_id,track_number,title,source_url,mime_type) VALUES($1,$2,1,$3,$4,$5)', [crypto.randomUUID(), id, metadata.title, metadata.url, 'video/youtube']);
    await client.query('COMMIT');
    return { ...mapSongRow(songResult.rows[0]), artworkFallbackUrl: metadata.artworkFallbackUrl, duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      const retry = await pool.query('SELECT id,title,note,duration_ms,status,source_type,source_url,youtube_video_id,artwork_url,source_metadata,created_at,updated_at FROM songs WHERE created_by=$1 AND youtube_video_id=$2', [user.id, metadata.videoId]);
      if (retry.rows[0]) return { ...mapSongRow(retry.rows[0]), duplicate: true };
    }
    throw error;
  } finally { client.release(); }
};

// Turn a previously-uploaded audio file (storage_objects) into a real
// library entry: a songs row, its tracks row, and an audio_files row that
// points at the same storage object. This is what makes "Upload music"
// actually show up in the Library instead of only existing as a bare file.
const createUploadSong = async (user, input) => {
  if (!pool) throw Object.assign(new Error('Song database is not available in local fallback mode.'), { status: 503 });
  const objectId = String(input.objectId || '').trim();
  if (!objectId) throw Object.assign(new Error('objectId is required.'), { status: 400 });

  const row = await getStorageRow(user.id, objectId);
  if (!row) throw Object.assign(new Error('Uploaded file not found.'), { status: 404 });
  if (!String(row.mimeType).startsWith('audio/')) throw Object.assign(new Error('Only audio files can be added as songs.'), { status: 415 });

  const title = String(input.title || row.originalName || 'Untitled').trim().slice(0, 200) || 'Untitled';
  const note = String(input.note || '').trim().slice(0, 5000) || null;
  const sourceUrl = `/api/storage/object/${row.id}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = crypto.randomUUID();
    const songResult = await client.query(
      `INSERT INTO songs(id,title,note,status,created_by,source_type,source_url) VALUES($1,$2,$3,'ready',$4,'upload',$5)
       RETURNING id,title,note,duration_ms,status,source_type,source_url,youtube_video_id,artwork_url,source_metadata,created_at,updated_at`,
      [id, title, note, user.id, sourceUrl],
    );
    await client.query(
      'INSERT INTO tracks(id,song_id,track_number,title,source_url,mime_type) VALUES($1,$2,1,$3,$4,$5)',
      [crypto.randomUUID(), id, title, sourceUrl, row.mimeType],
    );
    await client.query(
      "INSERT INTO audio_files(id,song_id,kind,storage_key,mime_type,byte_size,status) VALUES($1,$2,'original',$3,$4,$5,'ready')",
      [crypto.randomUUID(), id, row.objectKey, row.mimeType, row.byteSize],
    );
    await client.query('COMMIT');
    return { ...mapSongRow(songResult.rows[0]), duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      let database = false;
      if (pool) { await pool.query('SELECT 1'); database = true; }
      return send(res, 200, { ok: true, service: 'song-note-auth', database, storage: { driver: pool ? 'postgres' : 'local', maxBytes: maxUploadBytes, root: pool ? null : dataRoot, durable: Boolean(pool) || Boolean(process.env.RENDER_DISK_MOUNT_PATH) } });
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Please try again in a few minutes.' });
      const data = await readBody(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const displayName = String(data.displayName || email.split('@')[0] || 'User').trim().slice(0, 80);
      if (!validEmail(email)) return send(res, 400, { error: 'Please enter a valid email.' });
      if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      if (!displayName) return send(res, 400, { error: 'Display name is required.' });
      const result = await registerUser(email, password, displayName);
      if (result.error) return send(res, 409, { error: result.error });
      return send(res, 201, { user: result.user }, { 'Set-Cookie': sessionCookie(result.session.id, result.session.expires) });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Please try again in a few minutes.' });
      const data = await readBody(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      if (!validEmail(email) || !password) return send(res, 401, { error: 'Email or password is incorrect.' });
      const result = await loginUser(email, password);
      if (result.error) return send(res, 401, { error: result.error });
      return send(res, 200, { user: result.user }, { 'Set-Cookie': sessionCookie(result.session.id, result.session.expires) });
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') return send(res, 200, { user: await currentUser(req) });

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const sid = parseCookies(req.headers.cookie)[cookieName];
      if (sid) {
        if (pool) await pool.query('DELETE FROM sessions WHERE id=$1', [sid]);
        else { localData.sessions = localData.sessions.filter(session => session.id !== sid); await persistLocalState(); }
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
    }

    if (url.pathname === '/api/auth/profile' && req.method === 'PUT') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const data = await readBody(req);
      const displayName = String(data.displayName || '').trim().slice(0, 80);
      if (!displayName) return send(res, 400, { error: 'Display name is required.' });
      if (pool) {
        const result = await pool.query('UPDATE users SET display_name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,email,display_name,avatar_url,role,created_at', [displayName, user.id]);
        return send(res, 200, { user: cleanUser(result.rows[0]) });
      }
      const localUser = localData.users.find(item => item.id === user.id);
      if (!localUser) return send(res, 404, { error: 'User not found.' });
      localUser.displayName = displayName;
      await persistLocalState();
      return send(res, 200, { user: cleanUser(localUser) });
    }

    if (url.pathname === '/api/youtube/metadata' && req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const data = await readBody(req);
      if (!String(data.url || '').trim()) return send(res, 400, { error: 'YouTube URL is required.' });
      return send(res, 200, { metadata: await getYouTubeMetadata(data.url) });
    }

    if (url.pathname === '/api/songs/from-youtube' && req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const data = await readBody(req);
      if (!String(data.url || '').trim()) return send(res, 400, { error: 'YouTube URL is required.' });
      return send(res, 201, { song: await createYouTubeSong(user, data) });
    }

    if (url.pathname === '/api/songs/from-upload' && req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const data = await readBody(req);
      return send(res, 201, { song: await createUploadSong(user, data) });
    }

    if (url.pathname === '/api/songs' && req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      return send(res, 200, { songs: await listSongs(user) });
    }

    if (url.pathname === '/api/storage/upload' && req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      return send(res, 201, { object: await createStorageObject(user, req, url) });
    }

    if (url.pathname === '/api/storage' && req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      return send(res, 200, { objects: await listStorage(user) });
    }

    const objectMatch = url.pathname.match(/^\/api\/storage\/object\/([0-9a-fA-F-]{36})$/);
    if (objectMatch && req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      const row = await getStorageRow(user.id, objectMatch[1]);
      if (!row) return send(res, 404, { error: 'File not found.' });
      const data = row.storageDriver === 'postgres' ? row.data : await readFile(storagePath(row.objectKey));
      if (!data) return send(res, 410, { error: 'Stored file bytes are missing.' });
      res.writeHead(200, { 'Content-Type': row.mimeType, 'Content-Length': data.byteLength, 'Content-Disposition': `inline; filename="${row.originalName.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=3600', 'Accept-Ranges': 'bytes' });
      return res.end(data);
    }

    if (objectMatch && req.method === 'DELETE') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Not authenticated.' });
      if (!(await removeStorageRow(user.id, objectMatch[1]))) return send(res, 404, { error: 'File not found.' });
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, error.status || 500, { error: error.message || 'Server error.' });
  }
});

const start = async () => {
  if (pool) {
    await pool.query('SELECT 1');
    const schema = await readFile(new URL('./db/schema.sql', import.meta.url), 'utf8');
    await pool.query(schema);
    const storageSchema = await readFile(new URL('./db/storage.sql', import.meta.url), 'utf8');
    await pool.query(storageSchema);
    console.log('Song Note auth using PostgreSQL + durable database storage.');
  } else {
    await initLocal();
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    console.log('Song Note auth running with local fallback + local storage.');
  }
  server.listen(port, host, () => console.log(`Song Note auth listening on ${host}:${port}`));
};

start().catch(error => { console.error('Auth startup failed', error); process.exit(1); });
