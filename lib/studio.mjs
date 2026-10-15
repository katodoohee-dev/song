import { extractYouTubeVideoId } from '../youtube.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { parseRange } from './storage-range.mjs';
import { spawn } from 'node:child_process';
const root = resolve(process.env.PROCESSING_DIR || 'processing-data');
const jobs = new Map();
let running = false;
const submissions = new Set();
const enabled = () => process.env.PROCESSING_ENABLED === 'true';
const publicJob = ({ userId, ...job }) => job;
const save = async job => { const path = join(root, job.id, 'job.json'); await writeFile(path + '.tmp', JSON.stringify(job), { mode: 0o600 }); await rename(path + '.tmp', path); };
export function validateAudioUrl(value, hosts = process.env.AUDIO_SOURCE_HOSTS || '') {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('กรุณาใส่ลิงก์ไฟล์เสียง HTTPS'), { status: 400 }); }
  const allowed = hosts.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed.includes(url.hostname)) throw Object.assign(new Error('ลิงก์นี้ยังไม่รองรับ กรุณาอัปโหลดไฟล์เสียง หรือใช้โดเมนที่ผู้ดูแลเปิดใช้งาน'), { status: 400 });
  return url;
}
async function fetchAudio(value) {
  const response = await fetch(validateAudioUrl(value), { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok || !/^(audio\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) throw Object.assign(new Error('ลิงก์ต้องเปิดเป็นไฟล์เสียงโดยตรง'), { status: 400 });
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 50 * 1024 * 1024) throw Object.assign(new Error('ไฟล์ต้องไม่เกิน 50 MB'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
await mkdir(root, { recursive: true });
for (const id of await readdir(root)) {
  if (!/^[\da-f-]{36}$/.test(id)) continue;
  try { const job = JSON.parse(await readFile(join(root, id, 'job.json'), 'utf8')); if (['queued', 'processing'].includes(job.status)) { job.status = 'failed'; job.error = 'เซิร์ฟเวอร์เริ่มใหม่ กรุณาส่งงานอีกครั้ง'; await save(job); } jobs.set(id, job); } catch { /* Ignore incomplete records. */ }
}
async function drain() {
  if (running) return;
  const job = [...jobs.values()].find(j => j.status === 'queued');
  if (!job) return;
  running = true;
  try {
    job.status = 'processing'; await save(job);
    await new Promise((done, reject) => {
      const child = spawn(process.env.PYTHON_BIN || 'python3', [resolve('processor/process.py'), join(root, job.id, 'source.audio'), join(root, job.id), job.youtubeVideoId || ''], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
      let log = '';
      child.stderr.on('data', chunk => { log = (log + chunk).slice(-2000); });
      const timeout = setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1800000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); code === 0 ? done() : reject(new Error(log || 'Processor stopped')); });
    });
    const lyrics = JSON.parse(await readFile(join(root, job.id, 'lyrics.json'), 'utf8'));
    job.lines = lyrics.lines; job.language = lyrics.language; job.status = 'completed';
  } catch (error) {
    console.error('Processing failed:', job.id, error.message);
    job.status = 'failed'; job.error = 'แยกเสียงไม่สำเร็จ กรุณาตรวจไฟล์และการติดตั้ง Demucs / Whisper แล้วลองใหม่';
  } finally { await save(job); running = false; void drain().catch(error => console.error('Queue persistence error', error)); }
}
export async function studioRoute(req, res, url, { currentUser, readBody, send, getAudio }) {
  if (!url.pathname.startsWith('/api/studio/')) return false;
  if (url.pathname === '/api/studio/capabilities') { send(res, 200, { enabled: enabled(), youtube: process.env.YOUTUBE_IMPORT_ENABLED === 'true' }); return true; }
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อนใช้งานสตูดิโอ' }); return true; }
  if (url.pathname === '/api/studio/jobs' && req.method === 'GET') { send(res, 200, { jobs: [...jobs.values()].filter(j => j.userId === user.id).map(publicJob).reverse() }); return true; }
  if (url.pathname === '/api/studio/jobs' && req.method === 'POST') {
    if (!enabled()) { send(res, 503, { error: 'ยังไม่ได้เปิดเครื่องประมวลผลเสียง กรุณาตั้งค่า PROCESSING_ENABLED และติดตั้งโมเดลก่อน' }); return true; }
    if ([...jobs.values()].filter(j => ['queued', 'processing'].includes(j.status)).length + submissions.size >= 10) { send(res, 429, { error: 'คิวเต็ม กรุณาลองใหม่ภายหลัง' }); return true; }
    if (submissions.has(user.id) || [...jobs.values()].some(j => j.userId === user.id && ['queued', 'processing'].includes(j.status))) { send(res, 409, { error: 'กรุณารอให้งานเดิมเสร็จก่อน' }); return true; }
    submissions.add(user.id);
    try {
    const body = await readBody(req);
    const youtubeVideoId = extractYouTubeVideoId(body.url);
    if (youtubeVideoId && process.env.YOUTUBE_IMPORT_ENABLED !== 'true') { send(res, 400, { error: 'ยังไม่เปิดนำเข้า YouTube กรุณาใช้ไฟล์เสียงต้นฉบับ' }); return true; }
    const bytes = youtubeVideoId ? null : body.objectId ? await getAudio(user.id, body.objectId) : await fetchAudio(body.url);
    const job = { id: randomUUID(), userId: user.id, title: String(body.title || 'Untitled track').slice(0, 150), status: 'queued', youtubeVideoId, createdAt: new Date().toISOString(), lines: [] };
    await mkdir(join(root, job.id), { recursive: true });
    if (bytes) await writeFile(join(root, job.id, 'source.audio'), bytes, { mode: 0o600 });
    jobs.set(job.id, job); await save(job); void drain().catch(error => console.error('Queue persistence error', error)); send(res, 202, { job: publicJob(job) }); return true;
    } finally { submissions.delete(user.id); }
  }
  const match = url.pathname.match(/^\/api\/studio\/jobs\/([\da-f-]{36})(?:\/(vocals|instrumental))?$/);
  const job = match && jobs.get(match[1]);
  if (!job || job.userId !== user.id) { send(res, 404, { error: 'ไม่พบงานนี้' }); return true; }
  if (req.method !== 'GET') { send(res, 405, { error: 'Method not allowed' }); return true; }
  if (!match[2]) { send(res, 200, { job: publicJob(job) }); return true; }
  if (job.status !== 'completed') { send(res, 409, { error: 'งานยังไม่เสร็จ' }); return true; }
  const path = join(root, job.id, `${match[2]}.wav`);
  const { size } = await stat(path);
  const range = parseRange(req.headers?.range, size);
  if (range?.invalid) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; }
  const headers = { 'Content-Type': 'audio/wav', 'Content-Length': range ? range.end - range.start + 1 : size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  const stream = createReadStream(path, range || undefined);
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return true;
}
