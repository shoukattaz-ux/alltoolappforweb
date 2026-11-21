// Minimal static server for dist/ (the app uses hash routing, so no rewrites are needed).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
function globalHeaders() {
  const text = readFileSync(join(dist, '_headers'), 'utf8');
  const block = text.split(/\n(?=\S)/).find((b) => b.startsWith('/*')) ?? '';
  const out = {};
  for (const line of block.split('\n').slice(1)) { const m = /^\s+([\w-]+):\s*(.+)$/.exec(line); if (m) out[m[1]] = m[2]; }
  return out;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

export function startServer(port = 0) {
  const hdr = globalHeaders(); // enforce the real CSP and security headers during tests
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.includes('..')) { res.writeHead(400); return res.end(); }
    let file = join(dist, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    delete hdr['Strict-Transport-Security']; // plain http on localhost
    res.writeHead(200, { ...hdr, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port })));
}
