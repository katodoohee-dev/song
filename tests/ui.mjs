import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith('http://127.0.0.1:')) external.push(req.url()); });
  // API fixtures exercise the UI without changing real accounts or claiming ML coverage.
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('capabilities') ? { enabled: false, youtube: false } : route.request().url().includes('/jobs') ? { jobs: [] } : { user: null } }));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading', { name: 'เริ่มจากเพลงที่คุณรัก' }).waitFor();
  const fontCount = await page.evaluate(async () => (await document.fonts.load('400 16px "Noto Sans Thai"', 'ภาษาไทย')).length);
  assert.ok(fontCount > 0, 'Thai font must load from the application');
  await page.evaluate(() => document.fonts.ready);
  if (process.env.UI_SCREENSHOTS) { await mkdir(process.env.UI_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.UI_SCREENSHOTS}/desktop.png`, fullPage: true }); }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${width}px`);
  }
  await page.getByRole('button', { name: 'เนื้อร้อง', exact: true }).click();
  const lrc = Array.from({ length: 60 }, (_, i) => `[00:${String(i).padStart(2, '0')}.00]ทดสอบเนื้อร้องบรรทัดที่ ${i + 1}`).join('\n');
  await page.locator('input[type=file][accept*=".lrc"]').setInputFiles({ name: 'test.lrc', mimeType: 'text/plain', buffer: Buffer.from(lrc) });
  await page.getByText('หน้า 1 / 10', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'หน้าถัดไป' }).click();
  await page.getByText('หน้า 2 / 10', { exact: true }).waitFor();
  const boxes = await page.locator('.lyricLine').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  assert.equal(boxes.length, 6);
  boxes.slice(1).forEach((box, i) => assert.ok(box.top >= boxes[i].bottom, 'Lyric rows must not overlap'));
  if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.UI_SCREENSHOTS}/mobile-lyrics.png`, fullPage: true });
  await page.getByRole('button', { name: 'คลังเพลง', exact: true }).click();
  await page.getByRole('heading', { name: 'โปรเจกต์ทั้งหมด' }).waitFor();
  await page.getByRole('button', { name: 'วิธีใช้งาน', exact: true }).click();
  await page.getByRole('heading', { name: 'จากเพลงต้นฉบับ สู่พื้นที่ฝึกร้อง' }).waitFor();
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(external, [], 'No third-party font or asset requests');
  console.log('PASS: 4 viewport widths, bundled Thai fonts, 60 lines / 10 pages, non-overlapping lyric rows, navigation and no browser errors. API fixtures only; not an ML integration test.');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
