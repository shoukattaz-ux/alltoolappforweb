// Regenerates the Android launcher icons and splash screens from the brand logo. Run: npm run android:assets
// Output sizes mirror whatever files already exist under android/app/src/main/res, so the project layout never changes.
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'android/app/src/main/res');
const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const name = process.env.SITE_NAME || 'ToolHaven';

const dims = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const BARS = (stroke) => `<path d="M10 12.5h16M10 18h10M10 23.5h16" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="26" cy="18" r="2.8" fill="#2dd4bf"/>`;
const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5dfc"/><stop offset="1" stop-color="#3b2fd0"/></linearGradient></defs>';
// Logo centred on (19.4, 18) in the 36-unit space.
const centered = (size, scale, stroke = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-19.4 -18)">${BARS(stroke)}</g></svg>`;

const jobs = []; // { path, w, h, html, transparent }
const page$ = (inner, bg = 'transparent') => `<html><body style="margin:0;background:${bg};width:100vw;height:100vh;overflow:hidden;display:grid;place-items:center">${inner}</body></html>`;

for (const d of readdirSync(res).filter((n) => n.startsWith('mipmap-') && !n.includes('anydpi'))) {
  const dir = join(res, d);
  const sq = dims(join(dir, 'ic_launcher.png'))[0];            // legacy square icon size (48..192)
  const fg = dims(join(dir, 'ic_launcher_foreground.png'))[0]; // adaptive foreground size (108dp)
  const tile = (radius) => page$(`<svg xmlns="http://www.w3.org/2000/svg" width="${sq}" height="${sq}" viewBox="0 0 ${sq} ${sq}">${GRAD}<rect width="${sq}" height="${sq}" rx="${radius}" fill="url(#g)"/><g transform="translate(${sq / 2} ${sq / 2}) scale(${sq / 36 * 0.62}) translate(-19.4 -18)">${BARS('#fff')}</g></svg>`);
  jobs.push({ path: join(dir, 'ic_launcher.png'), w: sq, h: sq, html: tile(sq * 0.22), transparent: true });
  jobs.push({ path: join(dir, 'ic_launcher_round.png'), w: sq, h: sq, html: tile(sq / 2), transparent: true });
  jobs.push({ path: join(dir, 'ic_launcher_foreground.png'), w: fg, h: fg, html: page$(centered(fg, fg / 108 * 2.3)), transparent: true });
}
for (const d of readdirSync(res).filter((n) => n.startsWith('drawable') && existsSync(join(res, n, 'splash.png')))) {
  const file = join(res, d, 'splash.png'); const [w, h] = dims(file); const m = Math.min(w, h);
  const icon = Math.round(m * 0.24);
  jobs.push({ path: file, w, h, transparent: false, html: page$(`<div style="display:grid;justify-items:center;gap:${Math.round(m * 0.04)}px;font-family:Inter,system-ui,Segoe UI,Arial,sans-serif">
    <svg xmlns="http://www.w3.org/2000/svg" width="${icon}" height="${icon}" viewBox="0 0 36 36">${GRAD}<rect width="36" height="36" rx="10" fill="url(#g)"/>${BARS('#fff')}</svg>
    <div style="color:#fff;font-weight:800;font-size:${Math.round(m * 0.065)}px;letter-spacing:-.02em">${name}</div></div>`, 'radial-gradient(60% 45% at 50% 40%,#1d3160,#0d1730 70%)') });
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
  await page.setContent(j.html);
  writeFileSync(j.path, await page.screenshot({ omitBackground: j.transparent }));
  await page.close();
}
await browser.close();
writeFileSync(join(res, 'values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#4F46E5</color>\n</resources>\n');
console.log(`Android assets written (${jobs.length} images).`);
