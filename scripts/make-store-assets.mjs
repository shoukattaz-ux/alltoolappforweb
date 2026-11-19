// Generates the Google Play graphics into store/: 512px icon, 1024x500 feature graphic and phone screenshots (1080x1920).
// The screenshots are taken from the real, built app (run `npm run build` first). Run: npm run store:assets
import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tests/e2e/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'store');
const shots = resolve(out, 'screenshots');
rmSync(shots, { recursive: true, force: true }); // regenerate the whole set, so renamed or removed screenshots never linger
mkdirSync(shots, { recursive: true });
if (!existsSync(resolve(root, 'dist/index.html'))) { console.error('Run `npm run build` first.'); process.exit(1); }
const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const name = process.env.SITE_NAME || 'ToolHaven';

const BARS = '<path d="M10 12.5h16M10 18h10M10 23.5h16" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="26" cy="18" r="2.8" fill="#2dd4bf"/>';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

/* ---- icon: 512x512 full-bleed (Google Play applies its own rounded mask) ---- */
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5dfc"/><stop offset="1" stop-color="#3b2fd0"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><g transform="translate(256 256) scale(14) translate(-19.4 -18)">${BARS}</g></svg></body>`);
  writeFileSync(resolve(out, 'icon-512.png'), await page.screenshot({ omitBackground: false }));
  await page.close();
}

/* ---- feature graphic: 1024x500 ---- */
{
  const chip = (t, c) => `<span style="display:inline-block;padding:8px 18px;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);font-size:22px;font-weight:650;color:${c}">${t}</span>`;
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(`<html><body style="margin:0;width:1024px;height:500px;background:radial-gradient(700px 400px at 90% -10%,rgba(45,212,191,.38),transparent 65%),radial-gradient(600px 420px at 0% 110%,rgba(124,58,237,.55),transparent 65%),linear-gradient(135deg,#1e1b4b,#3730a3 58%,#4f46e5);font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 72px;box-sizing:border-box;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.13) 2px,transparent 2px);background-size:30px 30px;mask-image:linear-gradient(120deg,transparent 35%,#000)"></div>
    <div style="position:relative;display:flex;align-items:center;gap:18px"><svg width="68" height="68" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#fff" fill-opacity=".16"/>${BARS}</svg><div style="font-size:52px;font-weight:800;letter-spacing:-1.2px">${name}</div></div>
    <div style="position:relative;font-size:56px;font-weight:800;line-height:1.08;letter-spacing:-1.6px;margin-top:30px">Every tool you need.<br><span style="background:linear-gradient(100deg,#a5f3fc,#c4b5fd 60%,#fbcfe8);-webkit-background-clip:text;color:transparent">Private by design.</span></div>
    <div style="position:relative;display:flex;gap:12px;margin-top:30px">${chip('PDF', '#fecdd3')}${chip('Video', '#ddd6fe')}${chip('Image', '#99f6e4')}${chip('Calculators', '#fde68a')}</div></body></html>`);
  writeFileSync(resolve(out, 'feature-graphic-1024x500.png'), await page.screenshot());
  await page.close();
}

/* ---- phone screenshots from the real app: 360x640 CSS px at 3x = 1080x1920 ---- */
const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}/`;
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light' });
const page = await ctx.newPage();
const snap = async (file) => { await page.waitForTimeout(700); writeFileSync(resolve(shots, file), await page.screenshot()); console.log('  ', file); };

const mkPdf = async () => {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) { const p = d.addPage([612, 792]); p.drawText(`Page ${i}`, { x: 60, y: 700, size: 28, font: f, color: rgb(0.1, 0.2, 0.5) }); }
  return Buffer.from(await d.save());
};


// A realistic photo for the scanner screenshot: a tilted, unevenly lit text page on a dark desk (generated, nothing real).
const makeScanPhoto = (pg) => pg.evaluate(async () => {
  const W = 1600, H = 1200, Q = [[430, 110], [1130, 160], [1090, 1130], [380, 1070]];
  const solve = (A, b) => { const n = b.length; const m = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]]; for (let r = c + 1; r < n; r++) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; } } const x = Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = m[r][n]; for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k]; x[r] = s / m[r][r]; } return x; };
  const hom = (from, to) => { const A = [], b = []; for (let i = 0; i < 4; i++) { const [u, v] = from[i], [x, y] = to[i]; A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.push(x); A.push([0, 0, 0, u, v, 1, -y * u, -y * v]); b.push(y); } return [...solve(A, b), 1]; };
  const Hinv = hom(Q, [[0, 0], [1, 0], [1, 1], [0, 1]]); const pw = 850, ph = 1100; const pc = document.createElement('canvas'); pc.width = pw; pc.height = ph; const p = pc.getContext('2d');
  p.fillStyle = '#f4f1e8'; p.fillRect(0, 0, pw, ph); p.fillStyle = '#1a2a6c'; p.font = 'bold 54px Georgia'; p.fillText('Quarterly Invoice', 70, 120); p.fillStyle = '#222'; p.font = '26px Georgia';
  for (let i = 0; i < 26; i++) p.fillText(`${String(i + 1).padStart(2, '0')}  Consulting services rendered, item ${i + 1}`, 70, 200 + i * 34);
  const pd = p.getImageData(0, 0, pw, ph).data; const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d'); const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Hinv[6] * x + Hinv[7] * y + 1; const u = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / d, v = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / d; const i = (y * W + x) * 4; const light = 0.55 + 0.45 * (x / W) * (1 - 0.25 * (y / H)); let r, g, bl;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { const j = (Math.min(ph - 1, Math.floor(v * ph)) * pw + Math.min(pw - 1, Math.floor(u * pw))) * 4; r = pd[j] * light; g = pd[j + 1] * light; bl = pd[j + 2] * light; } else { const wood = 38 + 14 * Math.sin(y / 9 + Math.sin(x / 130) * 3); r = wood * 1.1 * light; g = wood * 0.8 * light; bl = wood * 0.55 * light; }
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0); const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.9)); const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s);
});

// 1. Dashboard
await page.goto(base); await page.locator('.hero h1').waitFor(); await snap('phone-1-dashboard.png');

// 2. "Start with a file" suggestions
await page.locator('#launcher-input').setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: await mkPdf() });
await page.locator('#launcher-result .act').first().waitFor();
await page.evaluate(() => { document.querySelector('.launcher').scrollIntoView({ block: 'start' }); window.scrollBy(0, -76); });
await snap('phone-2-start-with-a-file.png');

// 3. PDF reader with the sample document and a search
await page.goto(`${base}#/tool/pdf-reader`); await page.locator('input[type=file]').waitFor({ state: 'attached' });
await page.getByRole('button', { name: 'Try a sample document' }).click(); await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 });
await page.locator('.rd-search').fill('agreement'); await page.waitForFunction(() => /\d+ of \d+/.test(document.querySelector('.rd-count')?.textContent ?? ''), null, { timeout: 15000 });
await page.evaluate(() => { document.querySelector('.rd').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('phone-3-pdf-reader.png');

// 4. Scan to PDF: a tilted photo, straightened and cleaned
await page.goto(`${base}#/tool/scan-to-pdf`); await page.locator('input[type=file]').first().waitFor({ state: 'attached' });
await page.locator('#tool-root input[type=file]').first().setInputFiles({ name: 'desk.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await makeScanPhoto(page), 'base64') });
await page.locator('.sc-preview').waitFor({ state: 'visible', timeout: 30000 }); await page.waitForFunction(() => document.querySelector('.sc-preview')?.width > 0);
await page.waitForTimeout(900); await page.evaluate(() => { const t = document.querySelector('.sc-preview-box').getBoundingClientRect().top + window.scrollY - 150; window.scrollTo(0, Math.max(0, t)); }); await snap('phone-4-scan-to-pdf.png');

// 5. Extract text (OCR): a clean picture of text, recognised on the device
await page.goto(`${base}#/tool/extract-text`); await page.locator('input[type=file]').first().waitFor({ state: 'attached' });
const textPng = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 420; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 420); x.fillStyle = '#111'; x.font = '54px Arial'; x.fillText('Meeting notes: Friday', 40, 110); x.fillText('Send the invoice by noon.', 40, 200); x.font = '36px Georgia'; x.fillText('Total due on Friday: 480 dollars', 40, 300); const blob = await new Promise((r) => c.toBlob(r)); const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); });
await page.locator('#tool-root input[type=file]').first().setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from(textPng, 'base64') });
await page.getByRole('button', { name: 'Recognize text' }).click(); await page.locator('.ocr-text').first().waitFor({ timeout: 120000 });
await page.waitForTimeout(600); await page.evaluate(() => { const t = document.querySelector('.ocr-out').getBoundingClientRect().top + window.scrollY - 150; window.scrollTo(0, Math.max(0, t)); }); await snap('phone-5-extract-text.png');

// 6. Video compressor with a clip loaded
await page.goto(`${base}#/tool/video-compressor`); await page.locator('input[type=file]').waitFor({ state: 'attached' });
const clip = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); const s = c.captureStream(30);
  const r = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 4_000_000 }); const ch = []; r.ondataavailable = (e) => ch.push(e.data); const done = new Promise((z) => (r.onstop = z)); r.start(200);
  const t0 = performance.now(); await new Promise((res) => { const f = () => { const t = (performance.now() - t0) / 1000; const g = x.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, `hsl(${(t * 60) % 360} 70% 50%)`); g.addColorStop(1, `hsl(${(t * 60 + 120) % 360} 70% 40%)`); x.fillStyle = g; x.fillRect(0, 0, 1280, 720); for (let i = 0; i < 25; i++) { x.fillStyle = `hsla(${i * 14} 90% 70% / .7)`; x.beginPath(); x.arc((i * 131 + t * 220) % 1280, 360 + Math.sin(t * 2 + i) * 240, 40 + (i % 5) * 12, 0, 7); x.fill(); } t < 3 ? requestAnimationFrame(f) : res(); }; f(); });
  r.stop(); await done; const u = new Uint8Array(await new Blob(ch).arrayBuffer()); let q = ''; for (let i = 0; i < u.length; i += 0x8000) q += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(q);
});
await page.locator('input[type=file]').setInputFiles({ name: 'holiday.webm', mimeType: 'video/webm', buffer: Buffer.from(clip, 'base64') });
await page.locator('.video-info').waitFor({ timeout: 30000 }); await page.evaluate(() => { document.querySelector('.video-info').scrollIntoView({ block: 'start' }); window.scrollBy(0, -84); }); await snap('phone-6-video-compressor.png');

// 7. Image compressor result
await page.goto(`${base}#/tool/image-compressor`); await page.locator('input[type=file]').waitFor({ state: 'attached' });
const photo = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 2000; c.height = 1400; const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 1400); sky.addColorStop(0, '#1e3a8a'); sky.addColorStop(.55, '#f59e0b'); sky.addColorStop(1, '#7c2d12'); x.fillStyle = sky; x.fillRect(0, 0, 2000, 1400);
  x.fillStyle = '#0b1020'; x.beginPath(); x.moveTo(0, 1400); for (let i = 0; i <= 20; i++) x.lineTo(i * 100, 900 + Math.sin(i * 1.3) * 120 + (i % 3) * 40); x.lineTo(2000, 1400); x.fill();
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * .15})`; x.fillRect(Math.random() * 2000, Math.random() * 900, 2, 2); }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const u = new Uint8Array(await blob.arrayBuffer()); let q = ''; for (let i = 0; i < u.length; i += 0x8000) q += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(q);
});
await page.locator('input[type=file]').setInputFiles({ name: 'sunset.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
await page.locator('#tool-root select').first().selectOption('jpeg');
await page.getByRole('button', { name: 'Compress images' }).click(); await page.locator('#tool-root table').waitFor({ timeout: 20000 });
await page.evaluate(() => { document.querySelector('#tool-root .notice').scrollIntoView({ block: 'center' }); }); await snap('phone-7-image-compressor.png');

// 8. All tools
await page.goto(`${base}#/tools`); await page.locator('#dir-grid .tcard').first().waitFor(); await snap('phone-8-all-tools.png');

await ctx.close(); await browser.close(); server.close();
console.log('Play Store graphics written to store/');
