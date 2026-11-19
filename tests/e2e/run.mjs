// End-to-end tests: drives the built site in real Chromium, exercising every tool with real files.
// Run after `npm run build`:  npm run test:e2e
import { chromium } from 'playwright-core';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, '.tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
if (!existsSync(resolve(here, '../../dist/index.html'))) { console.error('Run `npm run build` first.'); process.exit(1); }

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });

/* ---------- helpers ---------- */
let problems = [];
async function newPage() {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
}
async function openTool(slug) {
  const page = await newPage();
  const res = await page.goto(`${base}/#/tool/${slug}`);
  assert.equal(res.status(), 200);
  await page.waitForSelector('#tool-root input[type=file], #tool-root form', { state: 'attached', timeout: 15000 });
  return page;
}
async function download(page, clickFn) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), clickFn()]);
  const path = join(tmp, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}-${dl.suggestedFilename()}`);
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), buf: readFileSync(path) };
}
const btn = (page, name) => page.getByRole('button', { name, exact: false }).first();
const fileInput = (page) => page.locator('#tool-root input[type=file]');
const root = (page) => page.locator('#tool-root');

async function makeImage(page, { w = 400, h = 300, type = 'image/png', q = 0.9, noise = false, alpha = false }) {
  const b64 = await page.evaluate(async ({ w, h, type, q, noise, alpha }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!alpha) { ctx.fillStyle = '#2a6fdb'; ctx.fillRect(0, 0, w, h); }
    ctx.fillStyle = '#f5a623'; ctx.fillRect(w * 0.1, h * 0.1, w * 0.4, h * 0.4);
    if (noise) { const d = ctx.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; } ctx.putImageData(d, 0, 0); }
    const blob = await new Promise((r) => c.toBlob(r, type, q));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, type, q, noise, alpha });
  return Buffer.from(b64, 'base64');
}
const dimsOf = (page, buf) => page.evaluate(async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u])); return [bmp.width, bmp.height]; }, buf.toString('base64'));

async function makePdf(pages, size = [200, 200], label = 'Page') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) { const p = doc.addPage(size); p.drawText(`${label} ${i + 1}`, { x: 30, y: size[1] - 60, size: 24, font, color: rgb(0, 0, 0) }); }
  return Buffer.from(await doc.save());
}
const buf = (name, data) => ({ name, mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', buffer: data });
const isPdf = (b) => b.subarray(0, 5).toString() === '%PDF-';

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
/* ---------- App shell tests ---------- */
const ALL_TOOLS = ['organize-pdf', 'scan-to-pdf', 'pdf-reader', 'merge-pdf', 'sign-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-image', 'image-to-pdf', 'image-compressor', 'image-resizer', 'image-cropper', 'image-converter', 'image-to-base64', 'video-compressor', 'bmi-calculator', 'percentage-calculator', 'age-calculator', 'discount-calculator'];
const axeSrc = readFileSync(resolve(here, '../../node_modules/axe-core/axe.min.js'), 'utf8');

test('app: every route mounts with one h1, no console errors, and all form controls are labelled', async () => {
  const page = await newPage();
  for (const r of ['', 'tools', 'pdf', 'image', 'video', 'calculator', 'favorites']) {
    await page.goto(`${base}/#/${r}`);
    await page.locator('#view h1').first().waitFor();
    assert.equal(await page.locator('#view h1').count(), 1, `#/${r} h1`);
  }
  for (const t of ALL_TOOLS) {
    await page.goto(`${base}/#/tool/${t}`);
    await page.locator('#tool-root input, #tool-root select').first().waitFor({ state: 'attached', timeout: 15000 });
    assert.equal(await page.locator('#view h1').count(), 1, `${t} h1`);
    assert.equal(await page.locator('#tool-root[aria-busy]').count(), 0, `${t} still busy`);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('#tool-root input, #tool-root select, #tool-root textarea')].filter((e) => !(e.labels?.length || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby')) && e.type !== 'file').map((e) => e.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, [], `${t} unlabeled controls`);
  }
  await page.close();
});

test('app: dashboard lists all 19 tools; sidebar links every tool and marks the current one', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/`);
  await page.locator('.hero h1').waitFor();
  assert.equal(await page.locator('.block-blurb + .tgrid .tcard').count(), 19); // category sections only (favorites/recents may add more)
  assert.equal(await page.locator('#nav .tool-link').count(), 19);
  await page.goto(`${base}/#/tool/image-resizer`);
  await page.locator('#view h1').waitFor();
  assert.equal(await page.locator('#nav [aria-current="page"]').innerText().then((s) => s.trim()), 'Image Resizer');
  assert.match(await page.title(), /Image Resizer/);
  await page.close();
});

test('app: command palette opens with Ctrl+K and /, searches, navigates with arrows and Enter, closes with Escape', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor();
  await page.keyboard.press('Control+k');
  await page.locator('.palette-box').waitFor();
  assert.equal(await page.locator('#pal-list li').count(), 19);
  await page.keyboard.type('pdf');
  const n = await page.locator('#pal-list li[data-i]').count();
  assert.ok(n >= 6, `pdf matches ${n}`);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#pal-list li[data-i="1"]').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('.palette').isHidden());
  await page.keyboard.press('/');
  await page.locator('.palette-box').waitFor();
  await page.keyboard.type('percent');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#/tool/percentage-calculator');
  await page.keyboard.press('Control+k'); await page.keyboard.type('zzzz');
  await page.getByText(/No tools match/).waitFor();
  await page.close();
});

test('app: directory tabs and live filter work, and the filter is kept in the URL', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/tools`); await page.locator('#dir-q').waitFor();
  assert.equal(await page.locator('#dir-grid .tcard').count(), 19);
  await page.goto(`${base}/#/pdf`); assert.equal(await page.locator('#dir-grid .tcard').count(), 9);
  await page.goto(`${base}/#/image`); assert.equal(await page.locator('#dir-grid .tcard').count(), 5);
  await page.goto(`${base}/#/video`); assert.equal(await page.locator('#dir-grid .tcard').count(), 1);
  await page.goto(`${base}/#/calculator`); assert.equal(await page.locator('#dir-grid .tcard').count(), 4);
  await page.goto(`${base}/#/tools`); await page.locator('#dir-q').fill('base64');
  await page.waitForFunction(() => document.querySelectorAll('#dir-grid .tcard').length === 1);
  assert.match(page.url(), /q=base64/);
  await page.locator('#dir-q').fill('qqqq'); await page.getByText('No tools match').waitFor();
  await page.close();
});

test('app: favorites and recently used persist across reloads; theme toggle persists', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/favorites`);
  await page.getByText('No favorites yet').waitFor();
  await page.goto(`${base}/#/tool/bmi-calculator`);
  await page.locator('#fav-btn').click();
  assert.equal(await page.locator('#fav-btn').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#nav a[href="#/favorites"] .count').innerText(), '1');
  await page.reload(); await page.locator('#fav-btn').waitFor();
  assert.equal(await page.locator('#fav-btn').getAttribute('aria-pressed'), 'true');
  await page.goto(`${base}/#/favorites`); assert.equal(await page.locator('#dir-grid .tcard').count(), 1);
  await page.goto(`${base}/#/`); await page.getByRole('heading', { name: 'Recently used' }).waitFor();
  await page.goto(`${base}/#/tool/bmi-calculator`); await page.locator('#fav-btn').click(); // un-favorite
  assert.equal(await page.locator('#fav-btn').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? 'light'), 'light');
  await page.locator('#theme-btn').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.reload(); await page.locator('#view h1').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await ctx.close();
});

test('app: tool tabs switch between tool, guide and FAQ without losing the tool state', async () => {
  const page = await openTool('age-calculator');
  const dob = root(page).locator('input[type=date]').first();
  await dob.fill('1990-05-17');
  await page.getByRole('tab', { name: /How to use/ }).click();
  assert.ok(await page.locator('[data-panel=guide]').isVisible());
  assert.ok(await page.locator('[data-panel=tool]').isHidden());
  assert.ok((await page.locator('.steps li').count()) >= 3);
  await page.getByRole('tab', { name: /FAQ/ }).click();
  assert.ok((await page.locator('.faq details').count()) >= 3);
  await page.getByRole('tab', { name: /^Tool/ }).click();
  assert.equal(await dob.inputValue(), '1990-05-17');
  await page.close();
});

test('security: CSP and hardening headers ship, and the CSP blocks inline scripts and foreign requests', async () => {
  const dist = readFileSync(resolve(here, '../../dist/_headers'), 'utf8');
  for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']) assert.ok(dist.includes(h), `${h} missing from dist/_headers`);
  const csp = /Content-Security-Policy: (.+)/.exec(dist)[1];
  assert.match(csp, /script-src 'self'(;|$)/); assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(csp, /connect-src 'self' blob: data:/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/);
  assert.equal((readFileSync(resolve(here, '../../dist/index.html'), 'utf8').match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []).length, 0, 'inline <script> in index.html');
  const page = await newPage();
  const res = await page.goto(`${base}/`);
  assert.equal(res.headers()['content-security-policy'], csp); assert.equal(res.headers()['x-frame-options'], 'DENY');
  const r = await page.evaluate(async () => {
    const out = {};
    try { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.head.append(s); } catch { /* ignore */ }
    out.inline = !!window.__pwned;
    try { await fetch('https://example.com/', { mode: 'no-cors' }); out.fetch = 'allowed'; } catch { out.fetch = 'blocked'; }
    return out;
  });
  assert.deepEqual(r, { inline: false, fetch: 'blocked' });
  problems = []; // the CSP violations above are the point of this test
  await page.close();
});

test('privacy page: reachable from the sidebar and footer, and its claims match what the app really does', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor();
  await page.locator('#sidebar a.privacy-card').click();
  await page.waitForFunction(() => location.hash === '#/privacy');
  await page.getByRole('heading', { name: 'Privacy', level: 1 }).waitFor();
  const text = await page.locator('#view article').innerText();
  for (const claim of [/never uploaded/i, /no cookies/i, /no analytics/i, /Last updated: \d{1,2} \w+ \d{4}/, /Saved signatures/, /Favorites and recently used/]) assert.match(text, claim);
  assert.ok(await page.locator('.app-foot a[href="#/privacy"]').isVisible());
  assert.match(await page.title(), /Privacy/);
  // Claim check: nothing but the declared keys is written to storage by normal use, and no cookies are set.
  await page.goto(`${base}/#/tool/bmi-calculator`); await page.locator('#fav-btn').click();
  const stored = await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), cookies: document.cookie, session: Object.keys(sessionStorage) }));
  assert.ok(stored.keys.every((k) => ['th:favs', 'th:recent', 'th:theme', 'th-signatures'].includes(k)), `unexpected storage keys: ${stored.keys}`);
  assert.equal(stored.cookies, ''); assert.deepEqual(stored.session, []);
  await page.close();
});

test('metadata: social preview tags and a real 1200x630 preview image ship in the build', async () => {
  const html = readFileSync(resolve(here, '../../dist/index.html'), 'utf8');
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:image', 'description', 'theme-color']) assert.ok(html.includes(`"${tag}"`), `${tag} missing`);
  assert.match(html, /<title>[^<]{10,70}<\/title>/);
  const png = readFileSync(resolve(here, '../../dist/og-image.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 1_000_000, 'preview image should stay under 1 MB');
  const res = await context.request.get(`${base}/og-image.png`); assert.equal(res.status(), 200); assert.equal(res.headers()['content-type'], 'image/png');
  assert.ok(readFileSync(resolve(here, '../../dist/robots.txt'), 'utf8').includes('User-agent'));
});

test('app: unknown routes show a not-found view', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/tool/does-not-exist`);
  await page.getByText('Page not found').waitFor();
  await page.close();
});

test('app: mobile layout has no horizontal overflow and the menu drawer opens and closes', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  for (const r of ['', 'tools', 'tool/sign-pdf', 'tool/image-cropper', 'tool/percentage-calculator']) {
    await page.goto(`${base}/#/${r}`); await page.locator('#view h1').waitFor({ timeout: 15000 }); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow on #/${r}`);
  }
  await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor();
  assert.equal(await page.locator('#menu-btn').getAttribute('aria-expanded'), 'false');
  await page.locator('#menu-btn').click();
  assert.equal(await page.locator('#menu-btn').getAttribute('aria-expanded'), 'true');
  await page.locator('#nav .tool-link', { hasText: 'PDF Merger' }).click();
  await page.waitForFunction(() => location.hash === '#/tool/merge-pdf');
  await page.waitForFunction(() => document.querySelector('#menu-btn').getAttribute('aria-expanded') === 'false'); // the route handler closes the drawer on the hashchange event, just after the URL changes
  assert.equal(await page.locator('#menu-btn').getAttribute('aria-expanded'), 'false');
  await ctx.close();
});

test('app: no network request ever leaves the origin while using tools (privacy claim)', async () => {
  const page = await newPage(); const foreign = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) foreign.push(r.url()); });
  await page.goto(`${base}/#/tool/image-to-base64`);
  await fileInput(page).waitFor({ state: 'attached' });
  await fileInput(page).setInputFiles([buf('x.png', await makeImage(page, {}))]);
  await page.waitForTimeout(800);
  await page.goto(`${base}/#/tool/merge-pdf`); await fileInput(page).waitFor({ state: 'attached' });
  await fileInput(page).setInputFiles([buf('a.pdf', await makePdf(1)), buf('b.pdf', await makePdf(1))]);
  await page.waitForTimeout(800);
  assert.deepEqual(foreign, []);
  await page.close();
});

test('accessibility: axe-core finds no violations on every view and tool (light theme) and key views (dark theme)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const bad = [];
  const scan = async (label) => {
    await page.evaluate(axeSrc);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
    for (const v of res.violations) bad.push(`${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  for (const r of ['', 'tools', 'pdf', 'video', 'privacy', 'favorites']) { await page.goto(`${base}/#/${r}`); await page.locator('#view h1').waitFor(); await page.waitForTimeout(450); await scan(`#/${r}`); }
  for (const t of ALL_TOOLS) { await page.goto(`${base}/#/tool/${t}`); await page.locator('#tool-root input, #tool-root select').first().waitFor({ state: 'attached' }); await page.waitForTimeout(450); await scan(`light ${t}`); }
  await page.keyboard.press('Control+k'); await page.locator('.palette-box').waitFor(); await page.waitForTimeout(450); await scan('palette'); await page.keyboard.press('Escape');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  for (const r of ['', 'tools', 'tool/merge-pdf', 'tool/bmi-calculator', 'tool/image-compressor']) { await page.goto(`${base}/#/${r}`); await page.locator('#view h1').waitFor(); await page.waitForTimeout(450); await scan(`dark #/${r}`); }
  await ctx.close();
  assert.deepEqual(bad, []);
});
test('PDF Merger: merges in the chosen order, rejects fake PDFs', async () => {
  const page = await openTool('merge-pdf');
  const a = await makePdf(3, [200, 200], 'A'), b = await makePdf(5, [300, 400], 'B');
  await fileInput(page).setInputFiles([buf('a.pdf', a), buf('b.pdf', b)]);
  await root(page).getByText('2 files · 8 pages in total').waitFor();
  assert.ok(await btn(page, 'Merge PDFs').isEnabled());
  await page.getByRole('button', { name: 'Move b.pdf up' }).click();
  const { name, buf: out } = await download(page, () => btn(page, 'Merge PDFs').click());
  assert.equal(name, 'merged.pdf');
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 8);
  assert.deepEqual([Math.round(doc.getPage(0).getWidth()), Math.round(doc.getPage(0).getHeight())], [300, 400]);
  assert.deepEqual([Math.round(doc.getPage(7).getWidth()), Math.round(doc.getPage(7).getHeight())], [200, 200]);
  await root(page).getByText(/8 pages/).first().waitFor();
  // invalid file renamed to .pdf
  await btn(page, 'Clear all').click();
  await fileInput(page).setInputFiles([buf('fake.pdf', Buffer.from('this is not a pdf at all'))]);
  await root(page).getByText(/not a supported file/).waitFor();
  assert.ok(await btn(page, 'Merge PDFs').isDisabled());
  // damaged PDF with a valid header
  await fileInput(page).setInputFiles([buf('broken.pdf', Buffer.from('%PDF-1.7\nnonsense nonsense'))]);
  await root(page).getByText(/damaged|could not be processed/i).first().waitFor();
});

test('PDF Splitter: single output, separate ZIP output, invalid ranges', async () => {
  const page = await openTool('split-pdf');
  await fileInput(page).setInputFiles([buf('doc.pdf', await makePdf(5, [200, 200]))]);
  await root(page).getByText(/5 pages/).waitFor();
  await page.getByLabel('Pages to extract').fill('2-3, 5');
  let r = await download(page, () => btn(page, 'Extract pages').click());
  assert.equal(r.name, 'doc-extracted.pdf');
  assert.equal((await PDFDocument.load(r.buf)).getPageCount(), 3);
  await page.getByLabel('Pages to extract').fill('1, 4-');
  await page.getByLabel('Output').selectOption('separate');
  r = await download(page, () => btn(page, 'Extract pages').click());
  const zip = await JSZip.loadAsync(r.buf);
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ['doc-pages-1.pdf', 'doc-pages-4-5.pdf']);
  assert.equal((await PDFDocument.load(await zip.files['doc-pages-4-5.pdf'].async('nodebuffer'))).getPageCount(), 2);
  await page.getByLabel('Pages to extract').fill('9');
  await btn(page, 'Extract pages').click();
  await root(page).getByText(/out of range/).waitFor();
  await page.getByLabel('Pages to extract').fill('');
  await btn(page, 'Extract pages').click();
  await root(page).getByText(/Enter at least one page/).waitFor();
});

test('PDF Compressor: lossless and image-based modes produce valid PDFs and report real sizes', async () => {
  const helper = await newPage(); await helper.goto(base + '/');
  const noisy = await makeImage(helper, { w: 1000, h: 1000, type: 'image/jpeg', q: 0.95, noise: true });
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) { const img = await doc.embedJpg(noisy); const p = doc.addPage([400, 400]); p.drawImage(img, { x: 0, y: 0, width: 400, height: 400 }); }
  const src = Buffer.from(await doc.save());
  const page = await openTool('compress-pdf');
  await fileInput(page).setInputFiles([buf('scan.pdf', src)]);
  await root(page).getByText(/2 pages/).waitFor();
  await page.getByLabel('Compression mode').selectOption('lossless');
  let r = await download(page, async () => { await btn(page, 'Compress PDF').click(); await root(page).getByRole('button', { name: /Download/ }).waitFor({ timeout: 60000 }); await root(page).getByRole('button', { name: /Download/ }).click(); });
  assert.ok(isPdf(r.buf)); assert.equal((await PDFDocument.load(r.buf)).getPageCount(), 2);
  await page.getByLabel('Compression mode').selectOption('balanced');
  await btn(page, 'Compress PDF').click();
  const msg = root(page).locator('.notice').first();
  await msg.waitFor({ timeout: 60000 });
  const text = await msg.innerText();
  assert.match(text, /smaller|saved/i, text);
  r = await download(page, () => root(page).getByRole('button', { name: /Download compressed PDF/ }).click());
  assert.ok(isPdf(r.buf));
  assert.ok(r.buf.length < src.length, `balanced ${r.buf.length} should be < original ${src.length}`);
  const out = await PDFDocument.load(r.buf);
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual([Math.round(out.getPage(0).getWidth()), Math.round(out.getPage(0).getHeight())], [400, 400]);
  // honesty: a text-only PDF must not be presented as an improvement when it grows
  await fileInput(page).setInputFiles([buf('text.pdf', await makePdf(1))]);
  await page.getByLabel('Compression mode').selectOption('high');
  await btn(page, 'Compress PDF').click();
  await root(page).locator('.notice-warn, .notice-success').first().waitFor({ timeout: 60000 });
});

test('PDF to Image: renders selected pages at the chosen DPI, ZIP download', async () => {
  const page = await openTool('pdf-to-image');
  await fileInput(page).setInputFiles([buf('deck.pdf', await makePdf(5, [612, 792], 'Slide'))]);
  await root(page).getByText(/5 pages/).waitFor();
  await page.getByPlaceholder(/Leave empty/).fill('1-2');
  await btn(page, 'Convert to images').click();
  await root(page).locator('.out-card').nth(1).waitFor({ timeout: 60000 });
  assert.equal(await root(page).locator('.out-card').count(), 2);
  assert.ok(await root(page).getByText('1275 × 1650 px').first().isVisible());
  const one = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.equal(one.buf.subarray(1, 4).toString(), 'PNG');
  assert.equal(one.buf.readUInt32BE(16), 1275);
  const z = await download(page, () => btn(page, 'Download all as ZIP').click());
  const zip = await JSZip.loadAsync(z.buf);
  assert.deepEqual(Object.keys(zip.files).sort(), ['deck-page-1.png', 'deck-page-2.png']);
  // pixels are not blank: the page text must have rendered
  const png = await zip.files['deck-page-1.png'].async('nodebuffer');
  const nonWhite = await page.evaluate(async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u])); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; }, png.toString('base64'));
  assert.ok(nonWhite > 200, `rendered page looks blank (${nonWhite} dark pixels)`);
  // JPG
  await page.getByLabel('Format').selectOption('jpeg');
  await page.getByLabel('Resolution').selectOption('72');
  await page.getByPlaceholder(/Leave empty/).fill('3');
  await btn(page, 'Convert to images').click();
  await root(page).locator('.out-card').first().waitFor({ timeout: 60000 });
  const jpg = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.equal(jpg.buf[0], 0xff); assert.equal(jpg.name, 'deck-page-3.jpg');
  // too many pages
  await page.getByPlaceholder(/Leave empty/).fill('1-5, 1-5');
  await btn(page, 'Convert to images').click();
  await root(page).locator('.out-card').first().waitFor();
});

test('Image to PDF: mixed JPG/PNG/WebP, reorder, A4 page size', async () => {
  const page = await openTool('image-to-pdf');
  const png = await makeImage(page, { w: 300, h: 200, type: 'image/png', alpha: true });
  const jpg = await makeImage(page, { w: 200, h: 400, type: 'image/jpeg' });
  const webp = await makeImage(page, { w: 320, h: 240, type: 'image/webp' });
  await fileInput(page).setInputFiles([buf('one.png', png), buf('two.jpg', jpg), buf('three.webp', webp)]);
  await root(page).locator('.file-item').nth(2).waitFor();
  await page.getByRole('button', { name: 'Move three.webp up' }).click();
  const r = await download(page, () => btn(page, 'Create PDF').click());
  const doc = await PDFDocument.load(r.buf);
  assert.equal(doc.getPageCount(), 3);
  const sz = (i) => [Math.round(doc.getPage(i).getWidth()), Math.round(doc.getPage(i).getHeight())];
  // order after the move: one.png (300x200), three.webp (320x240), two.jpg (200x400); A4, orientation "auto"
  assert.deepEqual(sz(0), [842, 595]);
  assert.deepEqual(sz(1), [842, 595]);
  assert.deepEqual(sz(2), [595, 842]);
  // the images were actually drawn: every page embeds exactly one image XObject
  for (let i = 0; i < 3; i++) assert.equal(doc.getPage(i).node.Resources().lookup(doc.context.obj('XObject')).entries().length, 1);
  // fit-to-image page size
  await page.getByLabel('Page size').selectOption('fit');
  await page.getByLabel('Margin').selectOption('0');
  const r2 = await download(page, () => btn(page, 'Create PDF').click());
  const d2 = await PDFDocument.load(r2.buf);
  assert.deepEqual([Math.round(d2.getPage(2).getWidth()), Math.round(d2.getPage(2).getHeight())], [150, 300]);
});

test('Image Compressor: reduces size, shows savings, flags larger results, ZIP', async () => {
  const page = await openTool('image-compressor');
  const big = await makeImage(page, { w: 1200, h: 900, type: 'image/jpeg', q: 0.98, noise: true });
  const png = await makeImage(page, { w: 300, h: 200, type: 'image/png' });
  await fileInput(page).setInputFiles([buf('photo.jpg', big), buf('flat.png', png)]);
  await root(page).locator('.file-item').nth(1).waitFor();
  await page.locator('input[type=range]').fill('40');
  await btn(page, 'Compress images').click();
  await root(page).locator('tbody tr').nth(1).waitFor({ timeout: 60000 });
  const rowText = await root(page).locator('tbody tr').first().innerText();
  assert.match(rowText, /photo-compressed\.jpg/); assert.match(rowText, /−\d/);
  const r = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.ok(r.buf.length < big.length / 2, `${r.buf.length} vs ${big.length}`);
  assert.equal(r.buf[0], 0xff);
  const z = await download(page, () => btn(page, 'Download all as ZIP').click());
  assert.equal(Object.keys((await JSZip.loadAsync(z.buf)).files).length, 2);
  // max dimension
  await page.getByLabel('Longest side (px, optional)').fill('300');
  await btn(page, 'Compress images').click();
  await root(page).locator('tbody tr').nth(1).waitFor({ timeout: 60000 });
  const r2 = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.deepEqual(await dimsOf(page, r2.buf), [300, 225]);
  await page.getByLabel('Longest side (px, optional)').fill('5');
  await btn(page, 'Compress images').click();
  await root(page).getByText(/between 16 and 20,000/).waitFor();
});

test('Image Resizer: aspect ratio lock, percentage, exact output dimensions', async () => {
  const page = await openTool('image-resizer');
  await fileInput(page).setInputFiles([buf('pic.png', await makeImage(page, { w: 400, h: 200, type: 'image/png' }))]);
  await root(page).getByText(/400 × 200 px/).first().waitFor();
  await page.getByLabel('Width (px)').fill('100');
  assert.equal(await page.getByLabel('Height (px)').inputValue(), '50');
  const r = await download(page, () => btn(page, 'Resize image').click());
  assert.equal(r.name, 'pic-100x50.png');
  assert.deepEqual(await dimsOf(page, r.buf), [100, 50]);
  await page.getByLabel('or scale (%)').fill('25');
  assert.equal(await page.getByLabel('Width (px)').inputValue(), '100');
  await page.getByLabel('Keep aspect ratio').uncheck();
  await page.getByLabel('Width (px)').fill('30');
  await page.getByLabel('Height (px)').fill('90');
  await page.getByLabel('Output format').selectOption('jpeg');
  const r2 = await download(page, () => btn(page, 'Resize image').click());
  assert.equal(r2.buf[0], 0xff); assert.deepEqual(await dimsOf(page, r2.buf), [30, 90]);
  await page.getByLabel('Width (px)').fill('0');
  await btn(page, 'Resize image').click();
  await root(page).getByText(/whole-number pixel values/).waitFor();
  await page.getByLabel('Width (px)').fill('20000');
  await page.getByLabel('Height (px)').fill('20000');
  await btn(page, 'Resize image').click();
  await root(page).getByText(/megapixels/).waitFor();
});

test('Image Cropper: presets, numeric fields, drag and handles, output size', async () => {
  const page = await openTool('image-cropper');
  await fileInput(page).setInputFiles([buf('big.jpg', await makeImage(page, { w: 800, h: 600, type: 'image/jpeg' }))]);
  await root(page).locator('.crop-box').waitFor();
  const val = async (l) => Number(await page.getByLabel(l).inputValue());
  // default 80% selection
  assert.equal(await val('Width (px)'), 640); assert.equal(await val('Height (px)'), 480);
  await page.getByLabel('Aspect ratio').selectOption('1:1');
  assert.equal(await val('Width (px)'), await val('Height (px)'));
  // drag the box
  await page.locator('.crop-box').scrollIntoViewIfNeeded();
  const box = await page.locator('.crop-box').boundingBox();
  const x0 = await val('X (px)');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  assert.ok(await val('X (px)') > x0, 'box did not move');
  // resize with the SE handle while the ratio is locked: stays square and in bounds
  await page.locator('.crop-handle[data-h="se"]').scrollIntoViewIfNeeded();
  const hb = await page.locator('.crop-handle[data-h="se"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down(); await page.mouse.move(hb.x - 60, hb.y - 60, { steps: 5 }); await page.mouse.up();
  const w = await val('Width (px)'), hh = await val('Height (px)');
  assert.ok(Math.abs(w - hh) <= 1, `ratio drifted ${w}x${hh}`);
  assert.ok((await val('X (px)')) + w <= 800 && (await val('Y (px)')) + hh <= 600);
  // numeric entry
  await page.getByLabel('Aspect ratio').selectOption('free');
  await page.getByLabel('X (px)').fill('10'); await page.getByLabel('X (px)').press('Tab');
  await page.getByLabel('Y (px)').fill('20'); await page.getByLabel('Y (px)').press('Tab');
  await page.getByLabel('Width (px)').fill('300'); await page.getByLabel('Width (px)').press('Tab');
  await page.getByLabel('Height (px)').fill('150'); await page.getByLabel('Height (px)').press('Tab');
  const r = await download(page, () => btn(page, 'Crop and download').click());
  assert.equal(r.name, 'big-cropped-300x150.jpg');
  assert.deepEqual(await dimsOf(page, r.buf), [300, 150]);
  // out-of-range numeric values are clamped inside the image
  await page.getByLabel('Width (px)').fill('5000'); await page.getByLabel('Width (px)').press('Tab');
  assert.equal(await val('Width (px)'), 800);
  // 16:9 preset
  await page.getByLabel('Aspect ratio').selectOption('16:9');
  const rr = (await val('Width (px)')) / (await val('Height (px)'));
  assert.ok(Math.abs(rr - 16 / 9) < 0.02, `ratio ${rr}`);
});

test('Image Converter: PNG→JPG (transparency flattened), WebP→PNG, ZIP', async () => {
  const page = await openTool('image-converter');
  const png = await makeImage(page, { w: 120, h: 80, type: 'image/png', alpha: true });
  const webp = await makeImage(page, { w: 100, h: 100, type: 'image/webp' });
  await fileInput(page).setInputFiles([buf('logo.png', png), buf('shot.webp', webp)]);
  await root(page).locator('.file-item').nth(1).waitFor();
  await page.getByLabel('Convert to').selectOption('jpeg');
  await btn(page, 'Convert').first().click();
  await root(page).locator('tbody tr').nth(1).waitFor({ timeout: 30000 });
  const r = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.equal(r.name, 'logo.jpg'); assert.equal(r.buf[0], 0xff); assert.equal(r.buf[1], 0xd8);
  // transparent corner pixel became white
  const px = await page.evaluate(async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u])); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return [...x.getImageData(115, 75, 1, 1).data]; }, r.buf.toString('base64'));
  assert.ok(px[0] > 240 && px[1] > 240 && px[2] > 240, `corner ${px}`);
  await page.getByLabel('Convert to').selectOption('png');
  await btn(page, 'Convert').first().click();
  await root(page).locator('tbody tr').nth(1).waitFor({ timeout: 30000 });
  const z = await download(page, () => btn(page, 'Download all as ZIP').click());
  const zip = await JSZip.loadAsync(z.buf);
  assert.deepEqual(Object.keys(zip.files).sort(), ['logo.png', 'shot.png']);
  assert.equal((await zip.files['shot.png'].async('nodebuffer')).subarray(1, 4).toString(), 'PNG');
  await page.getByLabel('Convert to').selectOption('webp');
  await btn(page, 'Convert').first().click();
  await root(page).locator('tbody tr').nth(1).waitFor({ timeout: 30000 });
  const w = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.equal(w.buf.subarray(8, 12).toString(), 'WEBP');
});

test('Image to Base64: all output styles decode back to the original bytes, copy works', async () => {
  const page = await openTool('image-to-base64');
  const png = await makeImage(page, { w: 64, h: 64, type: 'image/png' });
  await fileInput(page).setInputFiles([buf('icon.png', png)]);
  const out = page.getByLabel('Result');
  await out.waitFor();
  const uri = await out.inputValue();
  assert.ok(uri.startsWith('data:image/png;base64,'));
  assert.ok(Buffer.from(uri.split(',')[1], 'base64').equals(png));
  await page.getByLabel('Output format').selectOption('raw');
  assert.ok(Buffer.from(await out.inputValue(), 'base64').equals(png));
  await page.getByLabel('Output format').selectOption('img');
  assert.match(await out.inputValue(), /^<img src="data:image\/png;base64,.+" alt="icon\.png" \/>$/);
  await page.getByLabel('Output format').selectOption('css');
  assert.match(await out.inputValue(), /^background-image: url\("data:image\/png;base64,/);
  await btn(page, 'Copy to clipboard').click();
  await root(page).getByText('Copied to the clipboard.').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await out.inputValue());
  const t = await download(page, () => btn(page, 'Download as .txt').click());
  assert.equal(t.name, 'icon-base64.txt');
  // wrong content rejected even with an image extension
  await fileInput(page).setInputFiles([buf('evil.png', Buffer.from('<script>alert(1)</script>'))]);
  await root(page).getByText(/not a supported file/).waitFor();
});

test('Large and empty files are rejected with clear messages', async () => {
  const page = await openTool('image-compressor');
  const huge = Buffer.alloc(31 * 1024 * 1024, 0); huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff;
  await fileInput(page).setInputFiles([buf('huge.jpg', huge)]);
  await root(page).getByText(/larger than the 30 MB limit/).waitFor();
  await fileInput(page).setInputFiles([buf('empty.png', Buffer.alloc(0))]);
  await root(page).getByText(/is empty/).waitFor();
  assert.ok(await btn(page, 'Compress images').isDisabled());
  // fake image with a valid PNG header but corrupt body
  const bad = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage garbage')]);
  await fileInput(page).setInputFiles([buf('bad.png', bad)]);
  await btn(page, 'Compress images').click();
  await root(page).getByText(/could not be compressed/).waitFor({ timeout: 15000 });
});

test('BMI calculator', async () => {
  const page = await openTool('bmi-calculator');
  await btn(page, 'Calculate BMI').click();
  await root(page).getByText(/Enter both your weight and height/).waitFor();
  await page.getByLabel('Weight (kg)').fill('70'); await page.getByLabel('Height (cm)').fill('175');
  await btn(page, 'Calculate BMI').click();
  const t = await root(page).innerText();
  assert.match(t, /22\.9/); assert.match(t, /Normal weight/); assert.match(t, /56\.7 kg – 76\.3 kg/); assert.match(t, /Health disclaimer/);
  await btn(page, 'Imperial').click();
  await page.getByLabel('Weight (lb)').fill('200'); await page.getByLabel('Height (ft)').fill('5'); await page.getByLabel('Height (in)').fill('9');
  await btn(page, 'Calculate BMI').click();
  assert.match(await root(page).innerText(), /29\.5[\s\S]*Overweight/);
  await page.getByLabel('Height (in)').fill('12');
  await btn(page, 'Calculate BMI').click();
  await root(page).getByText(/Inches must be between/).waitFor();
});

test('Percentage calculator', async () => {
  const page = await openTool('percentage-calculator');
  const cards = root(page).locator('form.pcard');
  assert.equal(await cards.count(), 5);
  assert.match(await cards.nth(0).innerText(), /30/);          // 15% of 200
  assert.match(await cards.nth(1).innerText(), /25%/);          // 30 of 120
  assert.match(await cards.nth(2).innerText(), /25%[\s\S]*increase|increase[\s\S]*25%/i);
  assert.match(await cards.nth(3).innerText(), /22\.2222%/);
  assert.match(await cards.nth(4).innerText(), /64\.8/);
  await cards.nth(2).getByLabel('From (old value)').fill('0');
  await cards.nth(2).getByRole('button', { name: 'Calculate' }).click();
  await cards.nth(2).getByText(/cannot be zero/).waitFor();
  await cards.nth(4).getByLabel('Operation').selectOption('decrease');
  assert.match(await cards.nth(4).innerText(), /55\.2/);
});

test('Age calculator', async () => {
  const page = await openTool('age-calculator');
  await btn(page, 'Calculate age').click();
  await root(page).getByText('Enter a date of birth.').waitFor();
  await page.getByLabel('Date of birth').fill('1990-05-15');
  await page.getByLabel(/Age on/).fill('2024-08-20');
  await btn(page, 'Calculate age').click();
  const t = await root(page).innerText();
  assert.match(t, /34 years/); assert.match(t, /3 months, 5 days/); assert.match(t, /15 May 2025/); assert.match(t, /Thursday/); assert.match(t, /268/);
  await page.getByLabel(/Age on/).fill('1980-01-01');
  await btn(page, 'Calculate age').click();
  await root(page).getByText(/must not be after/).waitFor();
});

test('Discount calculator', async () => {
  const page = await openTool('discount-calculator');
  assert.match(await root(page).innerText(), /\$80\.00/);
  await page.getByLabel('Additional discount (%, optional)').fill('10');
  await page.getByLabel(/Sales tax/).fill('8');
  const t = await root(page).innerText();
  assert.match(t, /\$77\.76/); assert.match(t, /\$28\.00/); assert.match(t, /28(\.00)?% off/);
  await page.getByLabel('Discount (%)').fill('150');
  await btn(page, 'Calculate').click();
  await root(page).getByText(/between 0% and 100%/).waitFor();
});
/* ---- PDF Signer helpers ---- */
async function drawSignature(page, colorName = 'Red') {
  await page.getByRole('button', { name: 'Draw or type signature' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByRole('button', { name: colorName, exact: true }).click();
  const pad = dlg.locator('canvas.pad');
  const b = await pad.boundingBox();
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.3, { steps: 6 });
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7, { steps: 6 });
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Insert signature' }).click();
  await page.locator('.ov.selected').waitFor();
}
/** Renders page N of a PDF through the site's own PDF-to-image tool and returns the bounding box of red pixels (0..1 of the image) */
async function redBox(pdf, pageNo = 1) {
  const page = await openTool('pdf-to-image');
  await fileInput(page).setInputFiles([buf('out.pdf', pdf)]);
  await root(page).getByText(/pages? ·/).waitFor();
  await page.getByPlaceholder(/Leave empty/).fill(String(pageNo));
  await page.getByLabel('Resolution').selectOption('72');
  await btn(page, 'Convert to images').click();
  await root(page).locator('.out-card').first().waitFor({ timeout: 60000 });
  const png = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  const r = await page.evaluate(async (b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u])); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) { const i = (y * c.width + xx) * 4; if (d[i] > 170 && d[i + 1] < 100 && d[i + 2] < 100) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
    return { w: c.width, h: c.height, minX, minY, maxX, maxY };
  }, png.buf.toString('base64'));
  await page.close();
  return r.maxX < 0 ? null : { w: r.w, h: r.h, cx: (r.minX + r.maxX) / 2 / r.w, cy: (r.minY + r.maxY) / 2 / r.h, bw: (r.maxX - r.minX) / r.w };
}

test('PDF Signer: draw a signature, move it, export, and it lands where it was placed (page rotation 0/90/180/270)', async () => {
  for (const rot of [0, 90, 180, 270]) {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) { const p = doc.addPage([612, 792]); p.drawText(`Sign here ${i + 1}`, { x: 60, y: 700, size: 24, font }); if (i === 0 && rot) p.setRotation(degrees(rot)); }
    const src = Buffer.from(await doc.save());
    const page = await openTool('sign-pdf');
    assert.ok(await page.getByRole('button', { name: 'Sign and download PDF' }).count() === 0 || await page.getByRole('button', { name: 'Sign and download PDF' }).isHidden());
    await fileInput(page).setInputFiles([buf('contract.pdf', src)]);
    await page.locator('.sign-stage canvas').waitFor({ timeout: 30000 });
    assert.ok(await page.getByRole('button', { name: 'Sign and download PDF' }).isDisabled(), 'export disabled until something is added');
    await drawSignature(page);
    // drag the signature to a different spot
    await page.locator('.ov').scrollIntoViewIfNeeded();
    const ob = await page.locator('.ov').boundingBox();
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
    await page.mouse.down(); await page.mouse.move(ob.x + ob.width / 2 + 120, ob.y + ob.height / 2 - 90, { steps: 6 }); await page.mouse.up();
    const sb = await page.locator('.sign-stage').boundingBox(); const nb = await page.locator('.ov').boundingBox();
    const want = { cx: (nb.x + nb.width / 2 - sb.x) / sb.width, cy: (nb.y + nb.height / 2 - sb.y) / sb.height };
    assert.ok(want.cx > 0.5 + 0.05, `overlay did not move right (${want.cx})`);
    const r = await download(page, () => page.getByRole('button', { name: 'Sign and download PDF' }).click());
    assert.equal(r.name, 'contract-signed.pdf');
    const out = await PDFDocument.load(r.buf);
    assert.equal(out.getPageCount(), 2);
    const xo = (i) => { const res = out.getPage(i).node.Resources(); const x = res?.lookup(out.context.obj('XObject')); return x ? x.entries().length : 0; };
    assert.equal(xo(0), 1, 'page 1 has the signature image'); assert.equal(xo(1), 0, 'page 2 untouched');
    const box = await redBox(r.buf, 1);
    assert.ok(box, `no red pixels found on the rendered page (rotation ${rot})`);
    assert.ok(Math.abs(box.cx - want.cx) < 0.03 && Math.abs(box.cy - want.cy) < 0.03, `rotation ${rot}: expected centre ~(${want.cx.toFixed(3)}, ${want.cy.toFixed(3)}) but found (${box.cx.toFixed(3)}, ${box.cy.toFixed(3)})`);
    // original text must still be real text (not rasterised): the output keeps the font resource
    assert.ok(out.getPage(1).node.Resources().lookup(out.context.obj('Font')), 'text/fonts preserved');
    await page.close();
  }
});

test('PDF Signer: rotating the item rotates it in the output; resize handle changes size', async () => {
  const page = await openTool('sign-pdf');
  await fileInput(page).setInputFiles([buf('a.pdf', await makePdf(1, [612, 792]))]);
  await page.locator('.sign-stage canvas').waitFor({ timeout: 30000 });
  await drawSignature(page);
  const w0 = (await page.locator('.ov').boundingBox()).width;
  await page.locator('.ov').scrollIntoViewIfNeeded();
  const h = await page.locator('.ov-handle.se').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 120, h.y + 60, { steps: 6 }); await page.mouse.up();
  const w1 = (await page.locator('.ov').boundingBox()).width;
  assert.ok(w1 > w0 * 1.15, `resize handle did not enlarge (${w0} -> ${w1})`);
  await page.getByRole('button', { name: 'Rotate +15°' }).click();
  await page.getByRole('button', { name: 'Rotate +15°' }).click();
  assert.match(await page.locator('.ov').getAttribute('style'), /rotate\(30deg\)/);
  const r = await download(page, () => page.getByRole('button', { name: 'Sign and download PDF' }).click());
  const box = await redBox(r.buf, 1);
  assert.ok(box && box.bw > 0.1);
  await page.getByRole('button', { name: 'Reset rotation' }).click();
  assert.match(await page.locator('.ov').getAttribute('style'), /rotate\(0deg\)/);
});

test('PDF Signer: typed signature, stamps, image with background removal, saved signatures, copy to all pages, delete', async () => {
  const page = await openTool('sign-pdf');
  await fileInput(page).setInputFiles([buf('b.pdf', await makePdf(3, [612, 792]))]);
  await page.locator('.sign-stage canvas').waitFor({ timeout: 30000 });
  // typed signature, saved for reuse
  await page.getByRole('button', { name: 'Draw or type signature' }).click();
  let dlg = page.locator('dialog[open]');
  await dlg.getByRole('button', { name: 'Insert signature' }).click();
  await dlg.getByText('Please draw your signature first.').waitFor();
  await dlg.getByRole('button', { name: 'Type', exact: true }).click();
  await dlg.getByRole('button', { name: 'Insert signature' }).click();
  await dlg.getByText('Please type your name first.').waitFor();
  await dlg.getByPlaceholder('Type your name').fill('Alex Morgan');
  await dlg.getByLabel('Save this signature in this browser for reuse').check();
  await dlg.getByLabel('Name for the saved signature').fill('Work');
  await dlg.getByRole('button', { name: 'Insert signature' }).click();
  await page.locator('.ov.selected').waitFor();
  assert.equal(await page.locator('.ov').count(), 1);
  assert.match(await page.getByRole('button', { name: /Saved signatures/ }).innerText(), /\(1\)/);
  // copy to all pages
  await page.getByRole('button', { name: 'Copy to all pages' }).click();
  await page.getByText('Copied to 2 other pages.').waitFor();
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.locator('.ov').waitFor();
  assert.equal(await page.locator('.ov').count(), 1);
  await page.getByLabel('Go to page').selectOption('2');
  await page.locator('.ov').waitFor();
  // date stamp
  await page.getByRole('button', { name: 'Add date or text' }).click();
  dlg = page.locator('dialog[open]');
  await dlg.getByLabel('Date', { exact: true }).fill('2026-03-09');
  await dlg.getByLabel('Format').selectOption('1');
  await dlg.locator('.checker canvas').waitFor();
  await dlg.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.locator('.ov').nth(1).waitFor();
  assert.equal(await page.locator('.ov').count(), 2);
  // text stamp
  await page.getByRole('button', { name: 'Add date or text' }).click();
  dlg = page.locator('dialog[open]');
  await dlg.getByRole('button', { name: 'Text stamp' }).click();
  await dlg.getByRole('button', { name: 'CONFIDENTIAL' }).click();
  assert.equal(await dlg.getByLabel('Stamp text').inputValue(), 'CONFIDENTIAL');
  await dlg.getByLabel('Stamp text').fill('');
  await dlg.getByRole('button', { name: 'Insert', exact: true }).click();
  await dlg.getByText('Type some text first.').waitFor();
  await dlg.getByLabel('Stamp text').fill('APPROVED');
  await dlg.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ov').length === 3);
  // keyboard: Delete removes the selected item
  await page.locator('.ov.selected').focus();
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.ov').count(), 2);
  // image with background removal: black ink on white paper
  const paper = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#f8f8f4'; x.fillRect(0, 0, 300, 120); x.strokeStyle = '#102a80'; x.lineWidth = 6; x.beginPath(); x.moveTo(60, 80); x.bezierCurveTo(100, 10, 140, 110, 240, 40); x.stroke(); const b = await new Promise((r) => c.toBlob(r)); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const v of u) s += String.fromCharCode(v); return btoa(s); });
  await page.getByRole('button', { name: 'Add image' }).click();
  dlg = page.locator('dialog[open]');
  await dlg.locator('input[type=file]').setInputFiles([buf('sig.png', Buffer.from(paper, 'base64'))]);
  await dlg.locator('.checker img').waitFor();
  const dims = await dlg.locator('.checker img').evaluate((i) => [i.naturalWidth, i.naturalHeight]);
  assert.ok(dims[0] < 250 && dims[0] > 150 && dims[1] < 110, `background removed + trimmed, got ${dims}`);
  await dlg.getByLabel('Remove background').uncheck();
  await page.waitForFunction(() => { const i = document.querySelector('dialog[open] .checker img'); return i && i.naturalWidth === 300 - 0 || (i && i.naturalWidth >= 290); });
  await dlg.getByLabel('Remove background').check();
  await dlg.getByRole('button', { name: 'Insert image' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ov').length === 3);
  // invalid file rejected in the image dialog
  await page.getByRole('button', { name: 'Add image' }).click();
  dlg = page.locator('dialog[open]');
  await dlg.locator('input[type=file]').setInputFiles([buf('x.png', Buffer.from('not an image'))]);
  await dlg.getByText(/not a supported file/).waitFor();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  // saved signatures survive a reload and can be reused / deleted
  await page.reload();
  await page.locator('#tool-root input[type=file]').waitFor({ state: 'attached' });
  await fileInput(page).setInputFiles([buf('b.pdf', await makePdf(1, [612, 792]))]);
  await page.locator('.sign-stage canvas').waitFor();
  assert.match(await page.getByRole('button', { name: /Saved signatures/ }).innerText(), /\(1\)/);
  await page.getByRole('button', { name: /Saved signatures/ }).click();
  dlg = page.locator('dialog[open]');
  await dlg.getByText('Work', { exact: true }).waitFor();
  await dlg.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.locator('.ov').waitFor();
  await page.getByRole('button', { name: /Saved signatures/ }).click();
  dlg = page.locator('dialog[open]');
  await dlg.getByRole('button', { name: 'Delete saved signature Work' }).click();
  await dlg.getByText(/no saved signatures yet/).waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  assert.match(await page.getByRole('button', { name: /Saved signatures/ }).innerText(), /\(0\)/);
  // tampered local storage is ignored, not executed
  await page.evaluate(() => localStorage.setItem('th-signatures', JSON.stringify([{ id: 'x', name: '<img src=x onerror=alert(1)>', png: 'javascript:alert(1)' }])));
  await page.reload();
  await fileInput(page).setInputFiles([buf('b.pdf', await makePdf(1, [612, 792]))]);
  await page.locator('.sign-stage canvas').waitFor();
  assert.match(await page.getByRole('button', { name: /Saved signatures/ }).innerText(), /\(0\)/);
});

test('PDF Signer: sample agreement loads, can be signed, and the Share button hands the signed PDF to the native share sheet', async () => {
  const page = await newPage();
  // Simulate a phone browser that supports sharing files (desktop Chromium usually does not).
  await page.addInitScript(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!d && Array.isArray(d.files) && d.files.length > 0;
    navigator.share = async (d) => { const f = d.files[0]; window.__shared = { name: f.name, type: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()).slice(0, 5).join(',') }; };
  });
  await page.goto(`${base}/#/tool/sign-pdf`);
  await page.getByRole('button', { name: 'Try a sample agreement' }).click();
  await page.locator('.sign-stage canvas').waitFor({ timeout: 30000 });
  assert.match(await page.locator('#tool-root').innerText(), /Sample Agreement\.pdf · 2 pages/);
  await page.getByLabel('Go to page').selectOption('1');
  await page.getByRole('button', { name: 'Add date or text' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Insert', exact: true }).click();
  await page.locator('.ov').waitFor();
  const r = await download(page, () => page.getByRole('button', { name: 'Sign and download PDF' }).click());
  assert.equal(r.name, 'Sample Agreement-signed.pdf');
  const out = await PDFDocument.load(r.buf);
  assert.equal(out.getPageCount(), 2);
  await page.getByRole('button', { name: 'Share…' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.equal(shared.name, 'Sample Agreement-signed.pdf'); assert.equal(shared.type, 'application/pdf');
  assert.equal(shared.bytes, '37,80,68,70,45'); // "%PDF-"
  assert.ok(Math.abs(shared.size - r.buf.length) < 64, 'shared the same file that was downloaded');
  // Without share support, the button is not offered
  const p2 = await newPage();
  await p2.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await p2.goto(`${base}/#/tool/sign-pdf`);
  await p2.getByRole('button', { name: 'Try a sample agreement' }).click();
  await p2.locator('.sign-stage canvas').waitFor({ timeout: 30000 });
  await drawSignature(p2);
  await download(p2, () => p2.getByRole('button', { name: 'Sign and download PDF' }).click());
  assert.equal(await p2.getByRole('button', { name: 'Share…' }).count(), 0);
  assert.ok(await p2.getByRole('button', { name: 'Download again' }).isVisible());
});

test('PDF Signer: rejects fake and encrypted-style files with clear messages', async () => {
  const page = await openTool('sign-pdf');
  await fileInput(page).setInputFiles([buf('fake.pdf', Buffer.from('hello'))]);
  await root(page).getByText(/not a supported file/).waitFor();
  await fileInput(page).setInputFiles([buf('broken.pdf', Buffer.from('%PDF-1.7\ngarbage'))]);
  await root(page).getByText(/damaged|could not be processed/i).first().waitFor();
  assert.equal(await page.locator('.sign-stage').count(), 1);
  assert.ok(await page.locator('.sign-stage').isHidden());
});

test('accessibility: PDF Signer with a document loaded and each dialog open', async () => {
  const page = await openTool('sign-pdf');
  await fileInput(page).setInputFiles([buf('a.pdf', await makePdf(2, [612, 792]))]);
  await page.locator('.sign-stage canvas').waitFor({ timeout: 30000 });
  const bad = [];
  const scan = async (label) => {
    await page.evaluate(axeSrc);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
    for (const v of res.violations) bad.push(`${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  await scan('loaded');
  for (const name of ['Draw or type signature', 'Add image', 'Add date or text', 'Saved signatures']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await scan(name);
    await page.keyboard.press('Escape');
  }
  await drawSignature(page, 'Navy');
  await scan('with item selected');
  assert.deepEqual(bad, []);
});


/* ---------- Video Compressor ---------- */
/** Records a short animated clip (with an audio tone) in the browser and returns it as a WebM buffer. */
async function makeVideo(page, { w = 1280, h = 720, seconds = 2, audio = true } = {}) {
  const b64 = await page.evaluate(async ({ w, h, seconds, audio }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    const stream = c.captureStream(30); let ac = null;
    if (audio) { ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start(); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); }
    const rec = new MediaRecorder(stream, { mimeType: audio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9', videoBitsPerSecond: 6_000_000 });
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; }); rec.start(200);
    const t0 = performance.now(); let n = 0;
    await new Promise((resolve) => { const draw = () => {
      const t = (performance.now() - t0) / 1000; n++;
      ctx.fillStyle = `hsl(${(t * 90) % 360} 70% 45%)`; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { ctx.fillStyle = `hsl(${(i * 37 + n * 5) % 360} 80% 60%)`; ctx.fillRect((i * 97 + n * 13) % w, (i * 53 + n * 7) % h, 120, 80); }
      ctx.fillStyle = '#fff'; ctx.font = '64px sans-serif'; ctx.fillText(`frame ${n}`, 60, 120);
      t < seconds ? requestAnimationFrame(draw) : resolve(); }; draw(); });
    rec.stop(); await done; ac?.close();
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, seconds, audio });
  return Buffer.from(b64, 'base64');
}
/** Loads a video buffer in a <video> element and reports its real, decoded dimensions and duration. */
const probeVideo = (page, data, mime) => page.evaluate(async ({ b64, mime }) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(new Blob([u], { type: mime }));
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('output video is not playable')); setTimeout(() => rej(new Error('probe timeout')), 15000); });
  if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise((r) => { v.ontimeupdate = r; setTimeout(r, 3000); }); }
  return { w: v.videoWidth, h: v.videoHeight, d: v.duration };
}, { b64: data.toString('base64'), mime });
const hasText = (buffer, text) => buffer.includes(Buffer.from(text));

async function compressVideo(page, { setup } = {}) {
  if (setup) await setup();
  const out = await download(page, async () => {
    await page.getByRole('button', { name: 'Compress video', exact: true }).click();
    await root(page).getByRole('button', { name: /^Download/ }).waitFor({ timeout: 120000 });
    await root(page).getByRole('button', { name: /^Download/ }).click();
  });
  return out;
}

test('Video Compressor: reads the clip, resizes to 480p, outputs a playable WebM that is smaller and keeps its audio', async () => {
  const page = await openTool('video-compressor');
  const src = await makeVideo(page);
  await fileInput(page).setInputFiles([buf('clip.webm', src)]);
  await root(page).getByText('1280×720').first().waitFor({ timeout: 30000 });
  assert.match(await root(page).locator('.video-info').innerText(), /Audio\s*Yes/i);
  await page.getByLabel('Resolution').selectOption('480');
  await page.getByLabel('Output format').selectOption('webm-vp9');
  await page.getByLabel('Quality').selectOption('small');
  assert.match(await root(page).locator('.video-estimate').innerText(), /Estimated result: about .* at 852×480/);
  const out = await compressVideo(page);
  assert.equal(out.name, 'clip-compressed.webm');
  assert.ok(out.buf.length < src.length, `output ${out.buf.length} not smaller than input ${src.length}`);
  assert.ok(hasText(out.buf, 'V_VP9'), 'VP9 video track'); assert.ok(hasText(out.buf, 'A_OPUS'), 'audio track kept');
  const p = await probeVideo(page, out.buf, 'video/webm');
  assert.equal(p.h, 480); assert.equal(p.w, 852); assert.ok(p.d > 1.4 && p.d < 3.2, `duration ${p.d}`);
  await root(page).getByText(/Done in .*→.*% smaller|saved/i).first().waitFor();
  assert.ok(await root(page).locator('video.video-preview').isVisible());
  await page.close();
});

test('Video Compressor: remove audio, trim, and MP4 (H.264) output', async () => {
  const page = await openTool('video-compressor');
  const src = await makeVideo(page, { seconds: 3 });
  await fileInput(page).setInputFiles([buf('long.webm', src)]);
  await root(page).getByText('1280×720').first().waitFor({ timeout: 30000 });
  await page.getByLabel('Resolution').selectOption('360');
  await page.getByLabel('Output format').selectOption('webm-vp9');
  await page.getByLabel('Audio').selectOption('remove');
  await page.getByLabel('Trim: start (optional)').fill('0:00.5');
  await page.getByLabel('Trim: end (optional)').fill('2');
  const webm = await compressVideo(page);
  assert.ok(!hasText(webm.buf, 'A_OPUS'), 'audio should be removed');
  const pw = await probeVideo(page, webm.buf, 'video/webm');
  assert.equal(pw.h, 360); assert.ok(pw.d > 1.0 && pw.d < 2.0, `trimmed duration ${pw.d} (expected ~1.5)`);
  // MP4 / H.264 (only when this browser build can encode H.264; stock open-source Chromium may not)
  if (await page.getByLabel('Output format').locator('option[value="mp4-avc"]').count() === 0) {
    console.log('        (skipping the MP4/H.264 part: this browser has no H.264 encoder, so the tool correctly does not offer it)');
    await page.close(); return;
  }
  await page.getByLabel('Trim: start (optional)').fill(''); await page.getByLabel('Trim: end (optional)').fill('');
  await page.getByLabel('Output format').selectOption('mp4-avc');
  const mp4 = await compressVideo(page);
  assert.equal(mp4.name, 'long-compressed.mp4');
  assert.ok(hasText(mp4.buf.subarray(0, 64), 'ftyp'), 'MP4 container'); assert.ok(hasText(mp4.buf, 'avc1'), 'H.264 track');
  const pm = await probeVideo(page, mp4.buf, 'video/mp4');
  assert.equal(pm.h, 360); assert.ok(pm.d > 2.4 && pm.d < 3.8, `mp4 duration ${pm.d}`);
  await page.close();
});

test('Video Compressor: target file size lands near the target', async () => {
  const page = await openTool('video-compressor');
  const src = await makeVideo(page, { seconds: 3, audio: false });
  await fileInput(page).setInputFiles([buf('t.webm', src)]);
  await root(page).getByText('1280×720').first().waitFor({ timeout: 30000 });
  await page.getByLabel('Output format').selectOption('webm-vp9');
  await page.getByRole('button', { name: 'Target file size' }).click();
  await page.getByLabel(/Target size/).fill('0.4');
  const out = await compressVideo(page);
  assert.ok(out.buf.length < src.length, 'smaller than input');
  assert.ok(out.buf.length < 0.4 * 1024 * 1024 * 1.5, `size ${out.buf.length} too far above the 0.4 MB target`);
  await page.close();
});

test('Video Compressor: rejects fake, damaged and invalid-trim input with clear messages; Clear resets', async () => {
  const page = await openTool('video-compressor');
  await fileInput(page).setInputFiles([buf('fake.mp4', Buffer.from('this is definitely not a video file at all'))]);
  await root(page).getByText(/not a supported file/).waitFor();
  const header = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(200, 7)]);
  await fileInput(page).setInputFiles([buf('broken.mp4', header)]);
  await root(page).getByText(/could not be read|No video track|cannot decode|damaged|unsupported/i).first().waitFor({ timeout: 20000 });
  assert.ok(await root(page).getByRole('button', { name: 'Compress video', exact: true }).isDisabled());
  const src = await makeVideo(page, { seconds: 1, audio: false });
  await fileInput(page).setInputFiles([buf('ok.webm', src)]);
  await root(page).getByText('1280×720').first().waitFor({ timeout: 30000 });
  await page.getByLabel('Trim: start (optional)').fill('abc');
  await root(page).getByRole('button', { name: 'Compress video', exact: true }).click();
  await root(page).getByText(/Start time must look like/).waitFor();
  await page.getByLabel('Trim: start (optional)').fill('99');
  await root(page).getByRole('button', { name: 'Compress video', exact: true }).click();
  await root(page).getByText(/before the end of the video/).waitFor();
  await root(page).getByRole('button', { name: 'Clear', exact: true }).click();
  assert.ok(await root(page).locator('.video-info').isHidden());
  await page.close();
});

test('accessibility: Video Compressor with a video loaded', async () => {
  const page = await openTool('video-compressor');
  await fileInput(page).setInputFiles([buf('a.webm', await makeVideo(page, { seconds: 1 }))]);
  await root(page).getByText('1280×720').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
  assert.deepEqual(res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), []);
  await page.close();
});


/* ---------- Android (Capacitor) native save path, driven through a fake native bridge ---------- */
async function nativeContext(mode = 'ok') {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((mode) => {
    window.androidBridge = {};                       // makes Capacitor report platform "android"
    window.__native = []; window.__mode = mode;
    const promise = (name) => ({ name, rtype: 'promise' });
    window.Capacitor = {
      isNativePlatform: () => true,                  // the real Android bridge injects this before any page script runs
      getPlatform: () => 'android',
      PluginHeaders: [
        { name: 'Filesystem', methods: ['rmdir', 'writeFile', 'appendFile', 'getUri'].map(promise) },
        { name: 'Share', methods: [promise('share'), promise('canShare')] },
      ],
      nativePromise: async (plugin, method, options) => {
        window.__native.push({ plugin, method, options: { ...options } });
        if (plugin === 'Filesystem' && method === 'getUri') return { uri: 'file:///data/cache/' + options.path };
        if (plugin === 'Filesystem' && method === 'writeFile' && window.__mode === 'write-fails') throw new Error('No space left on device');
        if (plugin === 'Share' && method === 'share' && window.__mode === 'canceled') throw new Error('Share canceled');
        return {};
      },
    };
  }, mode);
  return ctx;
}

test('android: downloads go through the native save sheet in chunks (never <a download>), with the right file', async () => {
  const ctx = await nativeContext('ok');
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  let webDownload = false; page.on('download', () => { webDownload = true; });
  await page.goto(`${base}/#/tool/image-compressor`);
  await fileInput(page).waitFor({ state: 'attached' });
  const noisy = await makeImage(page, { w: 1100, h: 1100, noise: true }); // random pixels: a PNG of several MB, so it needs 2+ chunks
  await fileInput(page).setInputFiles([buf('noise.png', noisy)]);
  await btn(page, 'Compress images').click();
  await root(page).getByRole('button', { name: 'Download', exact: true }).first().click();
  await page.waitForFunction(() => window.__native.some((c) => c.plugin === 'Share'), null, { timeout: 15000 });
  const calls = await page.evaluate(() => window.__native.map((c) => ({ p: c.plugin, m: c.method, path: c.options.path, dir: c.options.directory, len: typeof c.options.data === 'string' ? c.options.data.length : undefined, data: c.options.data, files: c.options.files, rec: c.options.recursive })));
  assert.equal(webDownload, false, 'a browser download must not be used inside the app');
  assert.deepEqual(calls.slice(0, 2).map((c) => `${c.p}.${c.m}`), ['Filesystem.rmdir', 'Filesystem.writeFile'], 'clears old exports, then writes');
  assert.equal(calls[0].path, 'exports'); assert.equal(calls[0].dir, 'CACHE');
  const writes = calls.filter((c) => c.m === 'writeFile' || c.m === 'appendFile');
  assert.equal(writes[0].m, 'writeFile'); assert.ok(writes.length >= 2 && writes.slice(1).every((c) => c.m === 'appendFile'), `expected writeFile then appendFile chunks, got ${writes.map((c) => c.m)}`);
  assert.ok(writes.every((c) => c.path === 'exports/noise-compressed.png' && c.dir === 'CACHE'));
  assert.ok(writes.slice(0, -1).every((c) => !c.data.includes('=')), 'only the last chunk may be padded');
  const bytes = Buffer.from(writes.map((c) => c.data).join(''), 'base64');
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.ok(bytes.length > 3 * 1024 * 1024, `file is ${bytes.length} bytes`);
  const share = calls.find((c) => c.p === 'Share');
  assert.deepEqual(share.files, ['file:///data/cache/exports/noise-compressed.png']);
  assert.equal(await page.locator('.toast').count(), 0, 'no error toast on success');
  await ctx.close();
});

test('android: dismissing the share sheet is silent; a storage failure shows a clear message', async () => {
  let ctx = await nativeContext('canceled'); let page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/tool/image-compressor`); await fileInput(page).waitFor({ state: 'attached' });
  await fileInput(page).setInputFiles([buf('a.png', await makeImage(page, {}))]);
  await btn(page, 'Compress images').click();
  await root(page).getByRole('button', { name: 'Download', exact: true }).first().click();
  await page.waitForFunction(() => window.__native.some((c) => c.plugin === 'Share'));
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.toast').count(), 0, 'canceling the share sheet is not an error');
  await ctx.close();

  ctx = await nativeContext('write-fails'); page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/tool/image-compressor`); await fileInput(page).waitFor({ state: 'attached' });
  await fileInput(page).setInputFiles([buf('a.png', await makeImage(page, {}))]);
  await btn(page, 'Compress images').click();
  await root(page).getByRole('button', { name: 'Download', exact: true }).first().click();
  await page.locator('.toast').waitFor({ timeout: 10000 });
  assert.match(await page.locator('.toast').innerText(), /Could not save the file: No space left on device/);
  assert.equal(await page.evaluate(() => window.__native.some((c) => c.plugin === 'Share')), false, 'must not offer to share a file that was not written');
  await ctx.close();
});

test('android: the web build still downloads normally (native path is not used in a browser)', async () => {
  const page = await openTool('image-compressor');
  await fileInput(page).setInputFiles([buf('a.png', await makeImage(page, {}))]);
  await btn(page, 'Compress images').click();
  const r = await download(page, () => root(page).getByRole('button', { name: 'Download', exact: true }).first().click());
  assert.equal(r.name, 'a-compressed.png'); assert.equal(r.buf.subarray(1, 4).toString(), 'PNG');
  await page.close();
});


/* ---------- PDF Reader ---------- */
async function readerOpen(page, data, name = 'doc.pdf') {
  await fileInput(page).setInputFiles([buf(name, data)]);
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 });
}
const pageBox = (page, n) => page.locator(`.rd-page[data-page="${n}"]`).evaluate((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));

test('PDF Reader: draws only the pages near you (low memory), jumps to any page, and exposes selectable text', async () => {
  const page = await openTool('pdf-reader');
  await readerOpen(page, await makePdf(30, [612, 792], 'Chapter'));
  assert.equal(await page.locator('.rd-total').innerText(), 'of 30');
  assert.ok(await page.locator('.rd-page').count() === 30);
  assert.ok(await page.locator('.rd-page canvas').count() <= 6, 'only pages near the viewport should be drawn');
  await page.locator('.rd-page-input').fill('20'); await page.keyboard.press('Enter');
  await page.locator('.rd-page[data-page="20"] canvas').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.rd-page[data-page="1"] canvas').length === 0, null, { timeout: 15000 });
  assert.ok(await page.locator('.rd-page canvas').count() <= 6, 'pages far away are released');
  assert.equal(await page.locator('.rd-page-input').inputValue(), '20');
  await page.waitForFunction(() => /Chapter 20/.test(document.querySelector('.rd-page[data-page="20"] .rd-text')?.textContent ?? ''), null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForFunction(() => document.querySelector('.rd-page-input').value === '19');
  await page.close();
});

test('PDF Reader: zoom (fit width, steps, menu), rotate and keyboard shortcuts', async () => {
  const page = await openTool('pdf-reader');
  await readerOpen(page, await makePdf(3, [612, 792], 'Page'));
  const avail = await page.locator('.rd-scroll').evaluate((e) => e.clientWidth - 32);
  assert.ok(Math.abs((await pageBox(page, 1)).w - avail) <= 2, 'fit width fills the viewer');
  await page.locator('.rd-zoom').selectOption('2');
  await page.waitForFunction(() => Math.abs(document.querySelector('.rd-page[data-page="1"]').getBoundingClientRect().width - 1632) <= 2);
  await page.getByRole('button', { name: 'Zoom out' }).click();           // 200% -> 175%
  await page.waitForFunction(() => Math.abs(document.querySelector('.rd-page[data-page="1"]').getBoundingClientRect().width - 1428) <= 2);
  await page.locator('.rd-zoom').selectOption('1');
  await page.waitForFunction(() => Math.abs(document.querySelector('.rd-page[data-page="1"]').getBoundingClientRect().width - 816) <= 2);
  assert.equal(Math.round((await pageBox(page, 1)).h), 1056);
  await page.getByRole('button', { name: 'Rotate view' }).click();      // 90deg: width and height swap
  await page.waitForFunction(() => Math.abs(document.querySelector('.rd-page[data-page="1"]').getBoundingClientRect().width - 1056) <= 2);
  assert.equal(Math.round((await pageBox(page, 1)).h), 816);
  await page.locator('.rd-page[data-page="1"] canvas').waitFor();
  await page.locator('.rd-scroll').focus(); await page.keyboard.press('0');   // 0 = back to fit width
  assert.equal(await page.locator('.rd-zoom').inputValue(), 'width');
  await page.keyboard.press('+'); assert.notEqual(await page.locator('.rd-zoom').inputValue(), 'width');
  // the zoom controls stop at their limits
  for (let i = 0; i < 20; i++) await page.keyboard.press('-');
  assert.ok(await page.getByRole('button', { name: 'Zoom out' }).isDisabled());
  await page.close();
});

test('PDF Reader: search highlights every match, steps through them across pages, and reports no matches', async () => {
  const page = await openTool('pdf-reader');
  await readerOpen(page, await makePdf(30, [612, 792], 'Chapter'));
  await page.locator('.rd-search').fill('chapter 1');           // Chapter 1 and Chapter 10..19 = 11 matches
  await page.getByText('1 of 11').waitFor({ timeout: 15000 });
  assert.ok(await page.locator('.rd-page[data-page="1"] .rd-hit-cur').count() === 1, 'the current match is highlighted');
  assert.equal((await page.locator('.rd-page[data-page="1"] .rd-hit').first().innerText()).toLowerCase(), 'chapter 1');
  await page.locator('.rd-search').press('Enter');
  await page.getByText('2 of 11').waitFor();
  await page.waitForFunction(() => document.querySelector('.rd-page-input').value === '10', null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.rd-page[data-page="10"] .rd-hit-cur').length === 1, null, { timeout: 15000 });
  await page.locator('.rd-search').press('Shift+Enter');
  await page.getByText('1 of 11').waitFor();
  await page.getByRole('button', { name: 'Next match' }).click();
  await page.getByText('2 of 11').waitFor();
  await page.locator('.rd-search').fill('zzzzqq'); await page.getByText('No matches').waitFor({ timeout: 15000 });
  assert.ok(await page.getByRole('button', { name: 'Next match' }).isDisabled());
  await page.locator('.rd-search').fill(''); await page.waitForFunction(() => document.querySelector('.rd-count').textContent === '');
  assert.equal(await page.locator('.rd-hit').count(), 0, 'highlights are cleared');
  await page.close();
});

test('PDF Reader: night mode, thumbnails and page jumps', async () => {
  const page = await openTool('pdf-reader');
  await readerOpen(page, await makePdf(15, [612, 792], 'Page'));
  const night = page.getByRole('button', { name: 'Night mode' });
  assert.equal(await night.getAttribute('aria-pressed'), 'false');
  await night.click(); assert.equal(await night.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('.rd.rd-night').count() === 1);
  await night.click(); assert.equal(await page.locator('.rd.rd-night').count(), 0);
  const thumbsBtn = page.locator('.rd-thumbs-btn');
  if (await thumbsBtn.getAttribute('aria-pressed') !== 'true') await thumbsBtn.click();
  await page.locator('.rd-thumbs').waitFor({ state: 'visible' });
  await page.locator('[data-thumb="1"] canvas').waitFor({ timeout: 15000 });   // thumbnails draw lazily
  await page.locator('[data-thumb="12"]').click();
  await page.waitForFunction(() => document.querySelector('.rd-page-input').value === '12');
  assert.equal(await page.locator('[data-thumb="12"]').getAttribute('aria-current'), 'page');
  await page.close();
});

test('PDF Reader: opens password-protected PDFs, rejects a wrong password, and then shows the text', async () => {
  const page = await openTool('pdf-reader');
  await fileInput(page).setInputFiles(resolve(here, '../fixtures/encrypted.pdf'));
  await page.locator('.rd-password').waitFor({ state: 'visible' });
  await page.getByLabel('This PDF is password protected').fill('wrong-password');
  await page.getByRole('button', { name: 'Open PDF' }).click();
  await page.getByText('That password is not correct').waitFor({ timeout: 15000 });
  await page.getByLabel('This PDF is password protected').fill('open-sesame');
  await page.getByRole('button', { name: 'Open PDF' }).click();
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => /Secret quarterly figures/.test(document.querySelector('.rd-text')?.textContent ?? ''), null, { timeout: 15000 });
  assert.ok(await page.locator('.rd-password').isHidden());
  await page.close();
});

test('PDF Reader: rejects fake and damaged files; "Open another PDF" returns to the picker; "Do more" hands the same file to another tool', async () => {
  const page = await openTool('pdf-reader');
  await fileInput(page).setInputFiles([buf('fake.pdf', Buffer.from('hello'))]);
  await root(page).getByText(/not a supported file/).waitFor();
  await fileInput(page).setInputFiles([buf('broken.pdf', Buffer.from('%PDF-1.7\ngarbage'))]);
  await root(page).getByText(/damaged|could not be processed/i).first().waitFor({ timeout: 15000 });
  await readerOpen(page, await makePdf(3, [612, 792], 'Page'), 'mine.pdf');
  await page.getByRole('button', { name: 'Open another PDF' }).click();
  await page.locator('.rd-stage').waitFor({ state: 'hidden' });
  await readerOpen(page, await makePdf(3, [612, 792], 'Page'), 'mine.pdf');
  await page.locator('.rd-more').selectOption('sign-pdf');
  await page.waitForFunction(() => location.hash === '#/tool/sign-pdf');
  await page.locator('.sign-stage canvas').waitFor({ timeout: 30000 });          // the signer opened the same PDF, no re-selecting
  await page.close();
});

test('PDF Reader: the sample document opens and is searchable', async () => {
  const page = await openTool('pdf-reader');
  await page.getByRole('button', { name: 'Try a sample document' }).click();
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 });
  await page.locator('.rd-search').fill('agreement');
  await page.waitForFunction(() => /\d+ of \d+/.test(document.querySelector('.rd-count').textContent), null, { timeout: 15000 });
  await page.close();
});

/* ---------- Easy to use: dashboard launcher, handoff, mobile bottom bar ---------- */
test('launcher: a dropped PDF offers the right tools, and the chosen tool opens with the file already loaded', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/`); await page.locator('#launcher-input').waitFor({ state: 'attached' });
  await page.locator('#launcher-input').setInputFiles([buf('three.pdf', await makePdf(3))]);
  const res = page.locator('#launcher-result');
  await res.getByText('1 PDF').waitFor();
  const labels = await res.locator('.act strong').allInnerTexts();
  assert.deepEqual(labels, ['Read it', 'Sign it', 'Reorder or rotate pages', 'Make it smaller', 'Pull out pages', 'Turn pages into images']);
  await res.getByRole('button', { name: /Make it smaller/ }).click();
  await page.waitForFunction(() => location.hash === '#/tool/compress-pdf');
  await page.locator('#tool-root').getByText(/3 pages/).waitFor({ timeout: 15000 });
  await page.goto(`${base}/#/tool/image-compressor`);       // the handoff must not leak into the next tool
  await fileInput(page).waitFor({ state: 'attached' }); await page.waitForTimeout(300);
  assert.equal(await page.locator('#tool-root .file-item').count(), 0);
  await page.close();
});

test('launcher: several PDFs lead with "Combine"; images, mixed and unsupported files are handled clearly', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/`); await page.locator('#launcher-input').waitFor({ state: 'attached' });
  const res = page.locator('#launcher-result');
  await page.locator('#launcher-input').setInputFiles([buf('a.pdf', await makePdf(1)), buf('b.pdf', await makePdf(2))]);
  await res.getByText('2 PDFs').waitFor();
  assert.equal((await res.locator('.act strong').first().innerText()), 'Combine PDFs');
  await res.getByRole('button', { name: /Combine PDFs/ }).click();
  await page.waitForFunction(() => location.hash === '#/tool/merge-pdf');
  await page.waitForFunction(() => document.querySelectorAll('#tool-root .file-item').length === 2, null, { timeout: 15000 });
  await page.goto(`${base}/#/`); await page.locator('#launcher-input').waitFor({ state: 'attached' });
  const png = await makeImage(page, {});
  await page.locator('#launcher-input').setInputFiles([buf('p.png', png), buf('notes.txt', Buffer.from('plain text'))]);
  await res.getByText('1 image').waitFor();
  assert.match(await res.innerText(), /1 unsupported file was ignored/);
  await res.getByRole('button', { name: /Resize/ }).click();
  await page.waitForFunction(() => location.hash === '#/tool/image-resizer');
  await page.locator('#tool-root').getByText(/400\s*×\s*300|p\.png/).first().waitFor({ timeout: 15000 });
  await page.goto(`${base}/#/`); await page.locator('#launcher-input').waitFor({ state: 'attached' });
  await page.locator('#launcher-input').setInputFiles([buf('a.pdf', await makePdf(1)), buf('p.png', png)]);
  await res.getByText('1 PDF').waitFor();
  assert.match(await res.innerText(), /1 file was left out/);
  await page.locator('#launcher-input').setInputFiles([buf('x.txt', Buffer.from('nope'))]);
  await res.getByText(/not supported/).waitFor();
  await page.close();
});

test('launcher: a file dropped anywhere on the dashboard shows the overlay and the same suggestions', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor();
  const pdf = (await makePdf(1)).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.pdf', { type: 'application/pdf' }));
    window.__dt = dt; window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  }, pdf);
  assert.ok(await page.locator('.drop-overlay').isVisible(), 'overlay appears while dragging a file over the page');
  await page.evaluate(() => window.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
  assert.ok(await page.locator('.drop-overlay').isHidden());
  await page.locator('#launcher-result').getByText('1 PDF').waitFor();
  // other screens are untouched: no overlay while dragging on a tool page
  await page.goto(`${base}/#/tool/merge-pdf`); await fileInput(page).waitFor({ state: 'attached' });
  await page.evaluate(() => window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: window.__dt ?? new DataTransfer(), bubbles: true })));
  assert.ok(await page.locator('.drop-overlay').isHidden());
  await page.close();
});

test('mobile: a thumb-friendly bottom bar replaces the sidebar, marks the current screen, and opens search', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor();
  const bar = page.locator('#bottom-nav');
  assert.ok(await bar.isVisible());
  assert.deepEqual(await bar.locator('.bn-item span').allInnerTexts(), ['Home', 'Tools', 'Search', 'Favorites']);
  assert.equal(await bar.locator('[aria-current="page"]').innerText(), 'Home');
  await bar.getByText('Tools').click();
  // wait for the bar itself to update: the URL changes first, and the app re-renders on the following hashchange event
  await page.waitForFunction(() => document.querySelector('#bottom-nav [aria-current="page"]')?.textContent.trim() === 'Tools');
  assert.equal(await bar.locator('[aria-current="page"]').innerText(), 'Tools');
  await bar.getByText('Search').click(); await page.locator('.palette-box').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await ctx.close();
  const wide = await newPage(); await wide.goto(`${base}/#/`); await wide.locator('.hero h1').waitFor();
  assert.ok(await wide.locator('#bottom-nav').isHidden(), 'no bottom bar on desktop');
  await wide.close();
});

test('mobile: the PDF reader fits a phone screen without sideways scrolling', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/tool/pdf-reader`); await fileInput(page).waitFor({ state: 'attached' });
  await fileInput(page).setInputFiles([buf('m.pdf', await makePdf(4))]);
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const w = await page.locator('.rd-page[data-page="1"]').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w <= 390, `page ${w}px wide on a 390px screen`);
  await ctx.close();
});

test('favorites: saving a tool shows a confirmation message', async () => {
  const page = await newPage();
  await page.goto(`${base}/#/tool/age-calculator`); await page.locator('#fav-btn').waitFor();
  await page.locator('#fav-btn').click();
  await page.getByText(/Age Calculator added to your favorites/).waitFor();
  await page.locator('#fav-btn').click(); // leave storage clean for later tests
  await page.close();
});

test('accessibility: dashboard launcher with suggestions, and the PDF Reader with a document and search', async () => {
  const page = await newPage();
  const bad = [];
  const scan = async (label) => {
    await page.evaluate(axeSrc);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
    for (const v of res.violations) bad.push(`${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  await page.goto(`${base}/#/`); await page.locator('#launcher-input').waitFor({ state: 'attached' });
  await page.locator('#launcher-input').setInputFiles([buf('a.pdf', await makePdf(2))]); await page.locator('#launcher-result .act').first().waitFor();
  await page.waitForTimeout(450); await scan('dashboard with suggestions');
  await page.goto(`${base}/#/tool/pdf-reader`); await fileInput(page).waitFor({ state: 'attached' });
  await readerOpen(page, await makePdf(5, [612, 792], 'Chapter'));
  await page.locator('.rd-search').fill('chapter'); await page.getByText(/\d+ of \d+/).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(450); await scan('reader');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(300); await scan('reader (dark theme)');
  await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor(); await page.waitForTimeout(450); await scan('dashboard (dark theme)');
  await page.close();
  assert.deepEqual(bad, []);
});


/* ---------- Scan to PDF ---------- */
/** A photo of a tilted, unevenly lit text page on a dark desk (perspective-skewed), as a JPEG buffer. */
async function makeScanPhoto(page, { land = false, quad = null, w = 1600, h = 1200 } = {}) {
  const b64 = await page.evaluate(async ({ land, quad, w, h }) => {
    const Q = quad ?? (land ? [[300, 230], [1300, 200], [1280, 975], [320, 1000]] : [[430, 110], [1130, 160], [1090, 1130], [380, 1070]]);
    const solve = (A, b) => { const n = b.length; const m = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]]; for (let r = c + 1; r < n; r++) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; } } const x = Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = m[r][n]; for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k]; x[r] = s / m[r][r]; } return x; };
    const hom = (from, to) => { const A = [], b = []; for (let i = 0; i < 4; i++) { const [u, v] = from[i], [x, y] = to[i]; A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.push(x); A.push([0, 0, 0, u, v, 1, -y * u, -y * v]); b.push(y); } return [...solve(A, b), 1]; };
    const Hinv = hom(Q, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const pw = land ? 1100 : 850, ph = land ? 850 : 1100; const pc = document.createElement('canvas'); pc.width = pw; pc.height = ph; const p = pc.getContext('2d');
    p.fillStyle = '#f4f1e8'; p.fillRect(0, 0, pw, ph); p.fillStyle = '#1a2a6c'; p.font = 'bold 54px Georgia'; p.fillText('Quarterly Invoice', 70, 120); p.fillStyle = '#222'; p.font = '26px Georgia';
    for (let i = 0; i < (land ? 18 : 26); i++) p.fillText(`${String(i + 1).padStart(2, '0')}  Consulting services rendered, item ${i + 1}`, 70, 200 + i * 34);
    const pd = p.getImageData(0, 0, pw, ph).data; const out = document.createElement('canvas'); out.width = w; out.height = h; const ctx = out.getContext('2d'); const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Hinv[6] * x + Hinv[7] * y + 1; const u = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / d, v = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / d; const i = (y * w + x) * 4; const light = 0.55 + 0.45 * (x / w) * (1 - 0.25 * (y / h)); let r, g, bl;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { const j = (Math.min(ph - 1, Math.floor(v * ph)) * pw + Math.min(pw - 1, Math.floor(u * pw))) * 4; r = pd[j] * light; g = pd[j + 1] * light; bl = pd[j + 2] * light; }
      else { const wood = 38 + 14 * Math.sin(y / 9 + Math.sin(x / 130) * 3); r = wood * 1.1 * light; g = wood * 0.8 * light; bl = wood * 0.55 * light; }
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.9)); const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s);
  }, { land, quad, w, h });
  return Buffer.from(b64, 'base64');
}
const scanReady = (page, n = 1) => page.waitForFunction((n) => document.querySelectorAll('.sc-strip .sc-thumb').length === n && document.querySelector('.sc-preview')?.width > 0, n, { timeout: 30000 });
/** Brightness statistics of a canvas: mean of its outer border strip, the share of dark pixels, and the set of distinct red values (cap 5). */
const canvasStats = (page, sel) => page.evaluate((sel) => {
  const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const w = c.width, h = c.height; let bsum = 0, bn = 0, dark = 0, n = 0; const reds = new Set(); let colour = 0;
  const bx = Math.max(2, Math.round(w * 0.015)), by = Math.max(2, Math.round(h * 0.015));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = d[i]; if (x < bx || x >= w - bx || y < by || y >= h - by) { bsum += v; bn++; } if (v < 90) dark++; n++; if (reds.size < 6) reds.add(v); if (Math.abs(d[i] - d[i + 2]) > 14) colour++; }
  return { w, h, border: bsum / bn, dark: dark / n, reds: [...reds], colour: colour / n };
}, sel);

test('Scan to PDF: finds the page in a tilted, shadowed photo, straightens and cleans it, and the PDF page is white with dark text', async () => {
  const page = await openTool('scan-to-pdf');
  await fileInput(page).first().setInputFiles([buf('desk.jpg', await makeScanPhoto(page))]);
  await scanReady(page);
  assert.match(await page.locator('.sc-note').innerText(), /Page edges found/);
  const ratio = await page.locator('.sc-preview').evaluate((c) => c.width / c.height);
  assert.ok(Math.abs(ratio - 850 / 1100) < 0.08, `the page was straightened to its real shape (width/height ${ratio.toFixed(3)} vs 0.773)`);
  const s = await canvasStats(page, '.sc-preview');
  assert.ok(s.border > 225, `no dark desk fringe along the page edges (border brightness ${s.border.toFixed(0)})`); assert.ok(s.dark > 0.01 && s.dark < 0.25, 'text is dark but the page is mostly white');
  const pdf = await download(page, async () => { await btn(page, 'Create PDF').click(); await root(page).getByRole('button', { name: 'Download PDF' }).click(); });
  assert.equal(pdf.name, 'scan.pdf'); assert.ok(isPdf(pdf.buf)); assert.ok(pdf.buf.length < 1_500_000);
  const doc = await PDFDocument.load(pdf.buf); assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize(); assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, `A4 portrait, got ${width}x${height}`);
  assert.equal(doc.getTitle(), 'scan');
  // open the finished PDF in the reader and look at the actual pixels
  await root(page).getByRole('button', { name: 'Open in PDF Reader' }).click();
  await page.waitForFunction(() => location.hash === '#/tool/pdf-reader');
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
  const r = await canvasStats(page, '.rd-page[data-page="1"] canvas'); assert.ok(r.border > 235, `PDF page edge is white (${r.border.toFixed(0)})`); assert.ok(r.dark > 0.005, 'PDF page has dark text');
  await page.close();
});

test('Scan to PDF: clean-up styles do what they say (black and white, grayscale, original, brightness)', async () => {
  const page = await openTool('scan-to-pdf');
  await fileInput(page).first().setInputFiles([buf('desk.jpg', await makeScanPhoto(page))]); await scanReady(page);
  const style = async (name) => { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(250); return canvasStats(page, '.sc-preview'); };
  const bw = await style('Black & white'); assert.deepEqual([...bw.reds].sort((a, b) => a - b), [0, 255]); assert.equal(await page.locator('[data-filter="bw"]').getAttribute('aria-pressed'), 'true');
  const gray = await style('Grayscale'); assert.ok(gray.colour < 0.001, 'grayscale has no colour');
  const orig = await style('Original'); assert.ok(orig.border < 200 || orig.dark > 0.3, 'the original keeps the unevenly lit photo');
  const clean = await style('Clean page'); assert.ok(clean.border > 225);
  const before = await canvasStats(page, '.sc-preview');
  await page.locator('#sc-brightness').fill('-60'); await page.waitForTimeout(300);
  const darker = await canvasStats(page, '.sc-preview'); assert.ok(darker.border < before.border - 20, `lower brightness darkens the page (${before.border.toFixed(0)} -> ${darker.border.toFixed(0)})`);
  await page.locator('#sc-brightness').fill('0'); await page.locator('#sc-contrast').fill('80'); await page.waitForTimeout(300);
  const sharper = await canvasStats(page, '.sc-preview'); assert.ok(sharper.dark >= before.dark, 'more contrast keeps the text at least as dark');
  assert.equal(await page.locator('#sc-contrast').inputValue(), '80');
  await page.close();
});

test('Scan to PDF: corner editor works by keyboard and by mouse, and "whole photo" / cancel behave', async () => {
  const page = await openTool('scan-to-pdf');
  await fileInput(page).first().setInputFiles([buf('desk.jpg', await makeScanPhoto(page))]); await scanReady(page);
  const w0 = await page.locator('.sc-preview').evaluate((c) => c.width);
  await btn(page, 'Adjust corners').click(); await page.locator('.sc-crop-dialog').waitFor();
  const handle = page.getByRole('button', { name: 'Top-left corner' });
  assert.equal(await page.locator('.sc-handle').count(), 4);
  const left0 = parseFloat(await handle.evaluate((e) => e.style.left));
  await handle.focus(); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  assert.ok(parseFloat(await handle.evaluate((e) => e.style.left)) > left0 + 3, 'arrow keys move the handle');
  const tr = page.getByRole('button', { name: 'Top-right corner' }); const box = await tr.boundingBox(); const l1 = parseFloat(await tr.evaluate((e) => e.style.left));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 40, { steps: 6 }); await page.mouse.up();
  assert.ok(parseFloat(await tr.evaluate((e) => e.style.left)) < l1 - 3, 'dragging with the mouse moves the handle');
  await page.getByRole('button', { name: 'Apply' }).click(); await page.locator('.sc-crop-dialog').waitFor({ state: 'detached' });
  assert.notEqual(await page.locator('.sc-preview').evaluate((c) => c.width), w0, 'the page was re-cut from the new corners');
  await btn(page, 'Adjust corners').click(); await page.getByRole('button', { name: 'Use whole photo' }).click(); await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(() => /whole photo/i.test(document.querySelector('.sc-note').textContent));
  await btn(page, 'Adjust corners').click(); await page.getByRole('button', { name: 'Find edges again' }).click(); await page.keyboard.press('Escape'); // Escape cancels
  await page.locator('.sc-crop-dialog').waitFor({ state: 'detached' });
  assert.match(await page.locator('.sc-note').innerText(), /whole photo/i, 'cancel changes nothing');
  await btn(page, 'Find edges').click(); await page.waitForFunction(() => /Page edges found/.test(document.querySelector('.sc-note').textContent));
  await page.close();
});

test('Scan to PDF: several pages can be reordered, rotated and deleted, and the PDF follows', async () => {
  const page = await openTool('scan-to-pdf');
  const pdfPages = async () => { const out = await download(page, async () => { await btn(page, 'Create PDF').click(); await root(page).getByRole('button', { name: 'Download PDF' }).click(); }); const d = await PDFDocument.load(out.buf); return d.getPages().map((p) => (p.getWidth() > p.getHeight() ? 'L' : 'P')).join(''); };
  await fileInput(page).first().setInputFiles([buf('p.jpg', await makeScanPhoto(page)), buf('l.jpg', await makeScanPhoto(page, { land: true }))]);
  await scanReady(page, 2);
  assert.equal(await page.locator('.sc-thumb[aria-pressed="true"]').getAttribute('aria-label'), 'Page 2 of 2');   // the newest page is selected
  assert.equal(await pdfPages(), 'PL');
  await btn(page, 'Move earlier').click(); assert.equal(await pdfPages(), 'LP');
  await page.locator('.sc-thumb').nth(1).click(); await btn(page, 'Rotate right').click(); assert.equal(await pdfPages(), 'LL');   // portrait page turned on its side
  await btn(page, 'Rotate left').click(); assert.equal(await pdfPages(), 'LP');  // turned back
  await btn(page, 'Delete page').click(); await scanReady(page, 1); assert.equal(await pdfPages(), 'L');
  await btn(page, 'Add more photos').waitFor(); await btn(page, 'Start over').click();
  await page.locator('.dropzone').waitFor({ state: 'visible' }); assert.equal(await page.locator('.sc-thumb').count(), 0);
  await page.close();
});

test('Scan to PDF: export options (page size, margins, quality, file name) and the page-images ZIP', async () => {
  const page = await openTool('scan-to-pdf');
  await fileInput(page).first().setInputFiles([buf('a.jpg', await makeScanPhoto(page)), buf('b.jpg', await makeScanPhoto(page, { land: true }))]); await scanReady(page, 2);
  const make = async () => download(page, async () => { await btn(page, 'Create PDF').click(); await root(page).getByRole('button', { name: 'Download PDF' }).click(); });
  const dims = async (r) => { const d = await PDFDocument.load(r.buf); return d.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]); };
  await page.getByLabel('Page size').selectOption('letter'); assert.deepEqual((await dims(await make()))[0], [612, 792]);
  await page.getByLabel('Page size').selectOption('fit'); const fit = (await dims(await make()))[0]; assert.ok(fit[0] < fit[1] && fit[0] > 150 && fit[0] < 700, `fit-to-scan page is portrait and sized from the pixels (${fit})`);
  await page.getByLabel('Margin').selectOption('36'); const m = (await dims(await make()))[0]; assert.ok(m[0] > fit[0] + 60, 'margins add to the page size');
  await page.getByLabel('Margin').selectOption('0'); await page.getByLabel('Page size').selectOption('a4');
  await page.getByLabel('Quality').selectOption('best'); const best = await make();
  await page.getByLabel('Quality').selectOption('small'); const small = await make(); assert.ok(small.buf.length < best.buf.length, `smaller-file quality (${small.buf.length}) < best (${best.buf.length})`);
  await page.getByLabel('File name').fill('My Receipts / May'); const named = await make(); assert.equal(named.name, 'My Receipts _ May.pdf');
  const zip = await download(page, () => root(page).getByRole('button', { name: 'Download pages as images' }).click());
  const files = Object.keys((await JSZip.loadAsync(zip.buf)).files); assert.equal(files.length, 2); assert.ok(files.every((f) => /^My Receipts _ May-page-0\d\.jpg$/.test(f)), files.join());
  await page.close();
});

test('Scan to PDF: rejects bad files, caps a document at 40 pages, and the dashboard offers "Scan as a document" for photos', async () => {
  const page = await openTool('scan-to-pdf');
  await fileInput(page).first().setInputFiles([buf('fake.jpg', Buffer.from('not an image at all'))]);
  await root(page).getByText(/not a supported file/).waitFor();
  const tiny = await makeImage(page, { w: 64, h: 64 });
  await fileInput(page).first().setInputFiles(Array.from({ length: 41 }, (_, i) => buf(`t${i}.png`, tiny)));
  await page.waitForFunction(() => document.querySelectorAll('.sc-strip .sc-thumb').length === 40, null, { timeout: 60000 });
  await root(page).getByText(/Only 40 files are allowed|up to 40 pages/).first().waitFor({ timeout: 15000 });
  await page.close();
  const home = await newPage(); await home.goto(`${base}/#/`); await home.locator('#launcher-input').waitFor({ state: 'attached' });
  await home.locator('#launcher-input').setInputFiles([buf('desk.jpg', await makeScanPhoto(home))]);
  await home.locator('#launcher-result').getByRole('button', { name: /Scan as a document/ }).click();
  await home.waitForFunction(() => location.hash === '#/tool/scan-to-pdf');
  await home.waitForFunction(() => document.querySelectorAll('.sc-strip .sc-thumb').length === 1 && document.querySelector('.sc-preview')?.width > 0, null, { timeout: 30000 });
  await home.close();
});

test('mobile: Scan to PDF offers a camera button that opens the camera app (no permission), and fits a phone screen', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/tool/scan-to-pdf`); await fileInput(page).first().waitFor({ state: 'attached' });
  assert.ok(await page.getByRole('button', { name: 'Take a photo' }).isVisible(), 'camera button on touch devices');
  assert.equal(await page.locator('input[type=file][capture="environment"]').count(), 1, 'uses the camera app via the file picker, so no camera permission is needed');
  await page.locator('input[type=file][capture]').setInputFiles([buf('cam.jpg', await makeScanPhoto(page))]); await scanReady(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await btn(page, 'Adjust corners').click(); await page.locator('.sc-crop-dialog').waitFor();
  const dlg = await page.locator('.sc-crop-dialog').boundingBox(); assert.ok(dlg.width <= 390 && dlg.x >= 0, `corner editor fits the screen (${Math.round(dlg.width)}px)`);
  const h0 = await page.locator('.sc-handle').first().boundingBox(); assert.ok(h0.width >= 44 && h0.height >= 44, 'handles are big enough to touch');
  await page.keyboard.press('Escape'); await ctx.close();
  const desktop = await newPage(); await desktop.goto(`${base}/#/tool/scan-to-pdf`); await fileInput(desktop).first().waitFor({ state: 'attached' });
  assert.equal(await desktop.getByRole('button', { name: 'Take a photo' }).count(), 0, 'no camera button on a mouse-and-keyboard computer'); await desktop.close();
});

test('accessibility: Scan to PDF with a page loaded and the corner editor open', async () => {
  const page = await openTool('scan-to-pdf'); const bad = [];
  const scan = async (label) => { await page.evaluate(axeSrc); const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })); for (const v of res.violations) bad.push(`${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`); };
  await fileInput(page).first().setInputFiles([buf('desk.jpg', await makeScanPhoto(page))]); await scanReady(page); await page.waitForTimeout(450); await scan('scanner');
  await btn(page, 'Adjust corners').click(); await page.locator('.sc-crop-dialog').waitFor(); await page.waitForTimeout(450); await scan('corner editor'); await page.keyboard.press('Escape');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(300); await scan('scanner (dark theme)');
  await page.close(); assert.deepEqual(bad, []);
});


/* ---------- PDF Page Organizer ---------- */
/** A PDF whose page i is (200 + 20*i) points wide, so the order of pages in a saved file can be read from page widths. */
async function widthsPdf(n = 6) { const d = await PDFDocument.create(); for (let i = 1; i <= n; i++) { const p = d.addPage([200 + 20 * i, 300]); p.drawText(`Page ${i}`, { x: 20, y: 150, size: 24 }); } return Buffer.from(await d.save()); }
const pagesOf = async (data) => (await PDFDocument.load(data)).getPages().map((p) => ({ w: Math.round(p.getWidth()), rot: p.getRotation().angle }));
const orgReady = async (page, n = 6) => { await page.locator('.og-card').nth(n - 1).waitFor({ timeout: 20000 }); await page.waitForFunction((n) => document.querySelectorAll('.og-img[src^="data:image"]').length >= n, n, { timeout: 20000 }); };
const orgOpen = async (page, n = 6) => { await fileInput(page).first().setInputFiles([buf('report.pdf', await widthsPdf(n))]); await orgReady(page, n); };
const orgSave = (page) => download(page, async () => { await btn(page, 'Save PDF').click(); await root(page).getByRole('button', { name: 'Download PDF' }).click(); });
const card = (page, i) => page.locator('.og-card').nth(i);

test('PDF Page Organizer: thumbnails for every page; select, rotate, delete, restore, duplicate and add blank pages; the saved PDF matches', async () => {
  const page = await openTool('organize-pdf'); await orgOpen(page);
  assert.equal(await page.locator('.og-card').count(), 6); assert.match(await page.locator('.og-summary').innerText(), /^6 pages will be saved\.$/);
  await card(page, 1).locator('button[aria-label^="Delete"]').click();
  assert.ok(await card(page, 1).locator('.og-badge').isVisible()); assert.match(await page.locator('.og-summary').innerText(), /5 pages will be saved \(1 deleted\)/);
  await card(page, 1).locator('button[aria-label^="Restore"]').click(); assert.match(await page.locator('.og-summary').innerText(), /^6 pages/); await card(page, 1).locator('button[aria-label^="Delete"]').click(); // delete again for the final check
  await card(page, 2).locator('button[aria-label^="Rotate right"]').click();
  assert.match(await card(page, 2).locator('.og-img').getAttribute('style'), /rotate\(90deg\)/);
  await card(page, 0).locator('button[aria-label^="Duplicate"]').click(); assert.equal(await page.locator('.og-card').count(), 7);
  // positions are numbered among the kept pages; the deleted one shows a dash
  assert.deepEqual(await page.locator('.og-num').allInnerTexts(), ['1', '2', '–', '3', '4', '5', '6']);
  await card(page, 4).locator('.og-check').check(); assert.equal(await page.locator('.og-count').innerText(), '1 selected');  // original page 4 (after the duplicate and the deleted page)
  await btn(page, 'Add blank page').click(); assert.equal(await page.locator('.og-card').count(), 8);
  assert.ok(await page.locator('.og-badge-blank').isVisible());
  const out = await orgSave(page); assert.equal(out.name, 'report-organized.pdf');
  assert.deepEqual(await pagesOf(out.buf), [{ w: 220, rot: 0 }, { w: 220, rot: 0 }, { w: 260, rot: 90 }, { w: 280, rot: 0 }, { w: 220, rot: 0 }, { w: 300, rot: 0 }, { w: 320, rot: 0 }]);
  await page.close();
});

test('PDF Page Organizer: drag a page with the mouse to a new position, and reorder with the keyboard', async () => {
  const page = await openTool('organize-pdf'); await orgOpen(page);
  const grip = card(page, 4).locator('.og-grab'); await grip.scrollIntoViewIfNeeded(); const gb = await grip.boundingBox(); const target = await card(page, 0).boundingBox();   // (both are in the first row, so both are on screen)
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 10 });
  assert.ok(await page.locator('.og-ghost').isVisible(), 'a ghost follows the pointer'); assert.ok(await page.locator('.og-dropbar').isVisible(), 'a bar shows where it will land');
  await page.mouse.up();
  assert.equal(await page.locator('.og-ghost').count(), 0); assert.match(await page.locator('.og-summary').innerText(), /reordered/);
  const out = await orgSave(page); assert.deepEqual((await pagesOf(out.buf)).map((p) => p.w), [300, 220, 240, 260, 280, 320]);
  // keyboard: focus the grip of the first card, move it right twice, then to the end and back to the start
  await card(page, 0).locator('.og-grab').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.og-card') === document.querySelectorAll('.og-card')[2]), true, 'focus follows the moved page');
  await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.closest('.og-card') === document.querySelectorAll('.og-card')[5]), true);
  await page.keyboard.press('Home'); assert.equal(await page.evaluate(() => document.activeElement.closest('.og-card') === document.querySelectorAll('.og-card')[0]), true);
  const out2 = await orgSave(page); assert.deepEqual((await pagesOf(out2.buf)).map((p) => p.w), [300, 220, 240, 260, 280, 320], 'after Home the keyboard-moved page is back where it began');
  await page.close();
});

test('PDF Page Organizer: select all / none, bulk rotate, reverse order, undo, and Save is disabled when no page is kept', async () => {
  const page = await openTool('organize-pdf'); await orgOpen(page);
  await btn(page, 'Select all').click(); assert.equal(await page.locator('.og-count').innerText(), '6 selected');
  await btn(page, 'Rotate left').click(); assert.deepEqual((await pagesOf((await orgSave(page)).buf)).map((p) => p.rot), [270, 270, 270, 270, 270, 270]);
  await btn(page, 'Select none').click(); assert.ok(await btn(page, 'Rotate right').isDisabled(), 'bulk actions need a selection');
  await btn(page, 'Reverse order').click(); assert.deepEqual((await pagesOf((await orgSave(page)).buf)).map((p) => p.w), [320, 300, 280, 260, 240, 220]);
  await btn(page, 'Undo all changes').click(); const back = await pagesOf((await orgSave(page)).buf); assert.deepEqual(back.map((p) => p.w), [220, 240, 260, 280, 300, 320]); assert.deepEqual(back.map((p) => p.rot), [0, 0, 0, 0, 0, 0]);
  await btn(page, 'Select all').click(); await btn(page, 'Delete').click(); assert.ok(await btn(page, 'Save PDF').isDisabled()); assert.match(await page.locator('.og-summary').innerText(), /0 pages will be saved/);
  await btn(page, 'Delete').click(); assert.ok(await btn(page, 'Save PDF').isEnabled(), 'the same button restores them all');
  await page.close();
});

test('PDF Page Organizer: keeps existing page rotation, rejects fake and password-protected PDFs, and hands the result to other tools', async () => {
  const page = await openTool('organize-pdf');
  await fileInput(page).first().setInputFiles([buf('fake.pdf', Buffer.from('hello'))]); await root(page).getByText(/not a supported file/).waitFor();
  await fileInput(page).first().setInputFiles(resolve(here, '../fixtures/encrypted.pdf')); await root(page).getByText(/password-protected/i).first().waitFor({ timeout: 20000 });
  const d = await PDFDocument.create(); d.addPage([300, 400]).setRotation(degrees(90)); d.addPage([300, 400]);
  await fileInput(page).first().setInputFiles([buf('rot.pdf', Buffer.from(await d.save()))]); await orgReady(page, 2);
  await card(page, 0).locator('button[aria-label^="Rotate right"]').click(); await card(page, 1).locator('button[aria-label^="Rotate left"]').click();
  const out = await orgSave(page); assert.deepEqual((await pagesOf(out.buf)).map((p) => p.rot), [180, 270], 'the page\'s own rotation (90) plus our turn (90) = 180');
  await root(page).getByRole('button', { name: 'Open in PDF Reader' }).click(); await page.waitForFunction(() => location.hash === '#/tool/pdf-reader');
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 }); assert.equal(await page.locator('.rd-total').innerText(), 'of 2');
  await page.goto(`${base}/#/tool/organize-pdf`); await fileInput(page).first().waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Try a sample document' }).click(); await orgReady(page, 2);
  await btn(page, 'Open another PDF').click(); await page.locator('.dropzone').waitFor({ state: 'visible' }); assert.ok(await root(page).locator('.og-work').isHidden());
  await page.close();
});

test('PDF Page Organizer: a dropped PDF is offered "Reorder or rotate pages", and the grid fits a phone screen', async () => {
  const home = await newPage(); await home.goto(`${base}/#/`); await home.locator('#launcher-input').waitFor({ state: 'attached' });
  await home.locator('#launcher-input').setInputFiles([buf('r.pdf', await widthsPdf(4))]);
  await home.locator('#launcher-result').getByRole('button', { name: /Reorder or rotate pages/ }).click();
  await home.waitForFunction(() => location.hash === '#/tool/organize-pdf'); await orgReady(home, 4); await home.close();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/tool/organize-pdf`); await fileInput(page).first().waitFor({ state: 'attached' });
  await fileInput(page).first().setInputFiles([buf('report.pdf', await widthsPdf(6))]); await page.locator('.og-card').nth(5).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.og-img[src^="data:image"]').length >= 2, null, { timeout: 20000 });   // thumbnails near the screen load first; the rest as you scroll
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const xs = await page.locator('.og-card').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]); assert.equal(xs.length, 2, 'two columns on a phone');
  await ctx.close();
});

test('accessibility: PDF Page Organizer with a document loaded, a selection and a deleted page', async () => {
  const page = await openTool('organize-pdf'); const bad = [];
  const scan = async (label) => { await page.evaluate(axeSrc); const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })); for (const v of res.violations) bad.push(`${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`); };
  await orgOpen(page, 4); await card(page, 1).locator('.og-check').check(); await card(page, 2).locator('button[aria-label^="Delete"]').click(); await btn(page, 'Add blank page').click();
  await page.waitForTimeout(450); await scan('organizer');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(300); await scan('organizer (dark theme)');
  await page.close(); assert.deepEqual(bad, []);
});


/* ---------- Android: files opened with / shared to the app (fake native bridge) ---------- */
/** A browser context that looks like the Android app, and can deliver "shared file" events the way the native plugin does. */
async function shareContext(queued = null) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((queued) => {
    window.androidBridge = {}; window.__listeners = []; window.__queued = queued;
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      convertFileSrc: (u) => u.replace('content://fake/', '/__shared/'),
      PluginHeaders: [{ name: 'SharedFiles', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] }],
      nativePromise: async () => ({}),
      // the real plugin keeps an event until a listener exists (retainUntilConsumed), then delivers it
      nativeCallback: (plugin, method, options, callback) => { if (plugin === 'SharedFiles' && method === 'addListener') { window.__listeners.push(callback); if (window.__queued) { const q = window.__queued; window.__queued = null; setTimeout(() => callback(q), 0); } } return `cb${window.__listeners.length}`; },
    };
    window.__fireShared = (payload) => window.__listeners.forEach((cb) => cb(payload));
  }, queued);
  return ctx;
}
const sharedFile = (n, name, mimeType, size = 100) => ({ uri: `content://fake/${n}`, name, mimeType, size });

test('Android share: a PDF that cold-starts the app is offered the right tools, and the chosen tool opens with that file', async () => {
  const pdf = await makePdf(3, [612, 792], 'Chapter');
  const ctx = await shareContext({ files: [sharedFile('doc1', 'contract.pdf', 'application/pdf', pdf.length)], skipped: 0 });
  await ctx.route('**/__shared/doc1', (r) => r.fulfill({ body: pdf, contentType: 'application/pdf' }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/tool/age-calculator`);                      // the app was opened somewhere else entirely when the file arrived
  await page.waitForFunction(() => location.hash === '#/' || location.hash === ''); 
  await page.locator('#launcher-result').getByText('1 PDF').waitFor({ timeout: 15000 });
  await page.getByText(/Received 1 file from another app/).waitFor();
  assert.deepEqual(await page.locator('#launcher-result .act strong').allInnerTexts(), ['Read it', 'Sign it', 'Reorder or rotate pages', 'Make it smaller', 'Pull out pages', 'Turn pages into images']);
  await page.locator('#launcher-result').getByRole('button', { name: /Read it/ }).click();
  await page.waitForFunction(() => location.hash === '#/tool/pdf-reader');
  await page.locator('.rd-page canvas').first().waitFor({ timeout: 20000 }); assert.equal(await page.locator('.rd-total').innerText(), 'of 3');
  assert.match(await page.locator('.rd-info').innerText(), /contract\.pdf/, 'the shared file keeps its name');
  await ctx.close();
});

test('Android share: several files at once (a warm start) keep their names, wrong-type files are reported, and a file that cannot be read gives a clear message', async () => {
  const a = await makePdf(1), b = await makePdf(2), png = await makeImage(await newPage(), {});
  const ctx = await shareContext();
  await ctx.route('**/__shared/a', (r) => r.fulfill({ body: a, contentType: 'application/pdf' }));
  await ctx.route('**/__shared/b', (r) => r.fulfill({ body: b, contentType: 'application/pdf' }));
  await ctx.route('**/__shared/p', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await ctx.route('**/__shared/gone', (r) => r.fulfill({ status: 404, body: 'no' }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#/`); await page.locator('#launcher-input').waitFor({ state: 'attached' });
  await page.evaluate((files) => window.__fireShared({ files, skipped: 0 }), [sharedFile('a', 'first.pdf', 'application/pdf'), sharedFile('b', 'second.pdf', 'application/pdf'), sharedFile('p', 'photo.png', 'image/png'), sharedFile('gone', 'missing.pdf', 'application/pdf')]);
  await page.locator('#launcher-result').getByText('2 PDFs').waitFor({ timeout: 15000 });
  assert.match(await page.locator('#launcher-result').innerText(), /1 file was left out/);
  assert.match(await page.locator('.toast').first().innerText(), /Received 3 files from another app\. 1 could not be used\./);
  await page.locator('#launcher-result').getByRole('button', { name: /Combine PDFs/ }).click();
  await page.waitForFunction(() => location.hash === '#/tool/merge-pdf');
  await page.waitForFunction(() => document.querySelectorAll('#tool-root .file-item').length === 2, null, { timeout: 15000 });
  assert.deepEqual(await page.locator('#tool-root .fname').allInnerTexts(), ['first.pdf', 'second.pdf']);
  // every file unreadable: a message, and nothing breaks
  await page.evaluate((files) => window.__fireShared({ files }), [sharedFile('gone', 'missing.pdf', 'application/pdf')]);
  await page.getByText(/shared file could not be opened/).waitFor({ timeout: 10000 });
  assert.match(page.url(), /merge-pdf/, 'a failed share does not move you away from what you were doing');
  await ctx.close();
});

test('Android share: the web build has no native bridge and shows nothing about shared files', async () => {
  const page = await newPage(); await page.goto(`${base}/#/`); await page.locator('.hero h1').waitFor();
  assert.equal(await page.evaluate(() => typeof window.Capacitor), 'undefined', 'no native bridge on the web');
  assert.equal(await page.locator('.toast').count(), 0); await page.close();
});

/* ---------- runner ---------- */
let failed = 0;
const only = process.argv[2];
for (const t of tests) {
  if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
  problems = [];
  const t0 = Date.now();
  try {
    await t.fn();
    if (problems.length) throw new Error(`browser problems:\n  ${[...new Set(problems)].join('\n  ')}`);
    console.log(`  PASS  ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${t.name}\n        ${String(e.stack ?? e).split("\n").slice(0, 60).join('\n        ')}`);
  }
}
await browser.close(); server.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} test(s) failed` : '\nAll end-to-end tests passed');
process.exit(failed ? 1 : 0);