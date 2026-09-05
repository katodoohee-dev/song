import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 10000);
const host = '0.0.0.0';
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2' };

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
    const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '');
    let file = join(root, safe === '/' ? 'index.html' : safe);
    try { await readFile(file); } catch { file = join(root, 'index.html'); }
    const type = types[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Internal server error');
  }
});

server.listen(port, host, () => console.log(`Song Note frontend listening on ${host}:${port}`));
