import crypto from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 50 * 1024 * 1024;
const allowedMime = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/webm',
  'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'application/pdf'
]);

const driver = process.env.STORAGE_DRIVER || 'local';
const root = process.env.STORAGE_DIR || join(fileURLToPath(new URL('.', import.meta.url)), 'storage-data');

const safeName = (name = 'file') => {
  const base = String(name).normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return base || `file${extname(String(name)) || ''}`;
};

const assertAllowed = (mime, size) => {
  if (size > MAX_BYTES) {
    const e = new Error('File is too large. Maximum size is 50 MB.');
    e.status = 413;
    throw e;
  }
  if (!allowedMime.has(mime) && !mime.startsWith('audio/')) {
    const e = new Error('Unsupported file type.');
    e.status = 415;
    throw e;
  }
};

export const storageConfig = () => ({
  driver,
  maxBytes: MAX_BYTES,
  localRoot: driver === 'local' ? root : null,
  configured: driver === 'local' || Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY),
});

export const makeObjectKey = (userId, originalName) => `users/${userId}/${crypto.randomUUID()}-${safeName(originalName)}`;

export const saveLocal = async (objectKey, buffer) => {
  const target = join(root, objectKey);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, buffer, { mode: 0o600 });
  return target;
};

export const loadLocal = async objectKey => readFile(join(root, objectKey));
export const removeLocal = async objectKey => {
  try { await unlink(join(root, objectKey)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
};

export const saveObject = async (objectKey, buffer) => {
  if (driver !== 'local') throw new Error('S3-compatible storage is not enabled in this deployment.');
  assertAllowed('application/octet-stream', buffer.byteLength);
  await saveLocal(objectKey, buffer);
};

export { MAX_BYTES, allowedMime };
