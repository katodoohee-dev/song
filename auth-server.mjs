import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.PORT || 10000);
const host = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const cookieName = 'song_note_session';
const sessionDays = 30;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: isProd ? { rejectUnauthorized: false } : undefined }) : null;

const send = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
};
const cors = (res) => {
  const origin = process.env.FRONTEND_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
};
const parseCookies = (value='') => Object.fromEntries(value.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('='); return [v.slice(0,i), decodeURIComponent(v.slice(i+1))]}));
const passwordHash = async (password, salt=crypto.randomBytes(16).toString('hex')) => new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve(`${salt}:${key.toString('hex')}`)));
const passwordMatches = async (password, stored) => { const [salt,hex]=String(stored).split(':'); if(!salt||!hex)return false; const candidate=await passwordHash(password,salt); return crypto.timingSafeEqual(Buffer.from(candidate.split(':')[1],'hex'),Buffer.from(hex,'hex')); };
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const cleanUser = row => ({ id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url || null, createdAt: row.created_at });
const requireDb = () => { if(!pool) { const e=new Error('DATABASE_URL is not configured'); e.status=503; throw e; } };
const init = async () => { requireDb(); await pool.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,display_name TEXT NOT NULL,avatar_url TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id); CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);`); };
const createSession = async userId => { const id=crypto.randomBytes(32).toString('hex'); const expires=new Date(Date.now()+sessionDays*86400000); await pool.query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)',[id,userId,expires]); return {id,expires}; };
const sessionCookie = (id, expires) => `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=None; Secure; Expires=${expires.toUTCString()}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
const body = req => new Promise((resolve,reject)=>{let raw=''; req.on('data',c=>{raw+=c;if(raw.length>100_000)req.destroy()});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(Object.assign(new Error('Invalid JSON'),{status:400}))}});req.on('error',reject)});
const currentUser = async req => { requireDb(); const sid=parseCookies(req.headers.cookie)[cookieName]; if(!sid)return null; const r=await pool.query('SELECT u.id,u.email,u.display_name,u.avatar_url,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>NOW()',[sid]); return r.rows[0]?cleanUser(r.rows[0]):null; };

const server=http.createServer(async(req,res)=>{
  cors(res);
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname==='/health'){ return send(res,200,{ok:true,service:'song-note-auth',database:Boolean(pool)}); }
    if(url.pathname==='/api/auth/register'&&req.method==='POST'){
      requireDb(); const b=await body(req); const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||''); const displayName=String(b.displayName||email.split('@')[0]||'User').trim().slice(0,80);
      if(!validEmail(email))return send(res,400,{error:'Please enter a valid email.'}); if(password.length<8)return send(res,400,{error:'Password must be at least 8 characters.'});
      const exists=await pool.query('SELECT 1 FROM users WHERE email=$1',[email]); if(exists.rowCount)return send(res,409,{error:'An account with this email already exists.'});
      const id=crypto.randomUUID(); const hash=await passwordHash(password); const r=await pool.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,avatar_url,created_at',[id,email,hash,displayName]); const s=await createSession(id); return send(res,201,{user:cleanUser(r.rows[0])},{'Set-Cookie':sessionCookie(s.id,s.expires)});
    }
    if(url.pathname==='/api/auth/login'&&req.method==='POST'){
      requireDb(); const b=await body(req); const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||''); const r=await pool.query('SELECT id,email,password_hash,display_name,avatar_url,created_at FROM users WHERE email=$1',[email]);
      if(!r.rows[0]||!(await passwordMatches(password,r.rows[0].password_hash)))return send(res,401,{error:'Email or password is incorrect.'}); const s=await createSession(r.rows[0].id); return send(res,200,{user:cleanUser(r.rows[0])},{'Set-Cookie':sessionCookie(s.id,s.expires)});
    }
    if(url.pathname==='/api/auth/me'&&req.method==='GET'){const user=await currentUser(req);return send(res,200,{user});}
    if(url.pathname==='/api/auth/logout'&&req.method==='POST'){requireDb(); const sid=parseCookies(req.headers.cookie)[cookieName]; if(sid)await pool.query('DELETE FROM sessions WHERE id=$1',[sid]); return send(res,200,{ok:true},{'Set-Cookie':clearCookie});}
    if(url.pathname==='/api/auth/profile'&&req.method==='PUT'){
      const user=await currentUser(req); if(!user)return send(res,401,{error:'Not authenticated.'}); const b=await body(req); const displayName=String(b.displayName||'').trim().slice(0,80); if(displayName.length<1)return send(res,400,{error:'Display name is required.'}); const r=await pool.query('UPDATE users SET display_name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,email,display_name,avatar_url,created_at',[displayName,user.id]); return send(res,200,{user:cleanUser(r.rows[0])});
    }
    return send(res,404,{error:'Not found'});
  }catch(e){ console.error(e); return send(res,e.status||500,{error:e.status===503?'Authentication database is not configured yet.':'Server error.'}); }
});

if(pool) init().then(()=>server.listen(port,host,()=>console.log(`Song Note auth listening on ${host}:${port}`))).catch(e=>{console.error('Database initialization failed',e);process.exit(1)}); else server.listen(port,host,()=>console.log(`Song Note auth listening on ${host}:${port} (DATABASE_URL missing)`));
