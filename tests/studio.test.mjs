import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'song-test-'));
process.env.PROCESSING_DIR = directory;
const jobId = '11111111-1111-1111-1111-111111111111';
await mkdir(join(directory, jobId));
await writeFile(join(directory, jobId, 'job.json'), JSON.stringify({ id: jobId, userId: 'owner', title: 'Test', status: 'completed', lines: [{ start: 0, end: 1, text: 'test' }] }));
const { validateAudioUrl, studioRoute } = await import('../lib/studio.mjs');
test('direct links require exact configured HTTPS hosts without credentials', () => {
  assert.equal(validateAudioUrl('https://audio.example.com/song.mp3', 'audio.example.com').hostname, 'audio.example.com');
  for (const url of ['http://audio.example.com/a', 'https://audio.example.com.evil.test/a', 'https://user:pass@audio.example.com/a', 'https://audio.example.com:8080/a', 'https://127.0.0.1/a', 'file:///etc/passwd']) assert.throws(() => validateAudioUrl(url, 'audio.example.com'));
});
test('jobs are protected by authentication', async () => {
  let response;
  await studioRoute({ method: 'GET' }, {}, new URL('http://local/api/studio/jobs'), { currentUser: async () => null, send: (_, status, body) => response = {status, body} });
  assert.equal(response.status, 401);
});
test('disabled processing fails clearly instead of pretending to enqueue', async () => {
  process.env.PROCESSING_ENABLED = 'false'; let status;
  await studioRoute({ method: 'POST' }, {}, new URL('http://local/api/studio/jobs'), { currentUser: async () => ({ id: 'user' }), send: (_, code) => status = code });
  assert.equal(status, 503);
});
test('unrecognized jobs cannot be downloaded', async () => {
  let status;
  await studioRoute({ method: 'GET' }, {}, new URL('http://local/api/studio/jobs/00000000-0000-0000-0000-000000000000/vocals'), { currentUser: async () => ({ id: 'user' }), send: (_, code) => status = code });
  assert.equal(status, 404);
});
test('owners can inspect jobs but other accounts cannot', async () => {
  for (const [id, expected] of [['owner', 200], ['other', 404]]) {
    let response;
    await studioRoute({ method: 'GET' }, {}, new URL(`http://local/api/studio/jobs/${jobId}`), { currentUser: async () => ({ id }), send: (_, status, body) => response = { status, body } });
    assert.equal(response.status, expected);
    if (expected === 200) { assert.equal(response.body.job.userId, undefined); assert.equal(response.body.job.lines[0].text, 'test'); }
  }
});
process.on('exit', () => { void rm(directory, { recursive: true, force: true }); });
