// Builds the tiny static site that Google Play links to (privacy policy + landing page) into site/.
// Run: npm run site     Needs Node 22.18+ (it imports the TypeScript data files directly).
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/data/site.ts';
import { privacyHtml, PRIVACY_LEAD } from '../src/data/privacy.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'site');
mkdirSync(out, { recursive: true });
copyFileSync(resolve(root, 'public/favicon.svg'), resolve(out, 'favicon.svg'));

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = `:root{color-scheme:light dark;--bg:#f6f8fc;--card:#fff;--ink:#0f172a;--ink2:#44546a;--line:#e3e9f3;--brand:#4338ca}
@media(prefers-color-scheme:dark){:root{--bg:#0a1020;--card:#111a30;--ink:#eef2fb;--ink2:#b4c0d6;--line:#1f2c4a;--brand:#9aa0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}header{display:flex;align-items:center;gap:12px;margin-bottom:8px}header img{width:40px;height:40px}
header a{color:var(--ink);font-weight:800;font-size:1.2rem;text-decoration:none}h1{font-size:2rem;line-height:1.2;margin:.6em 0 .3em}h2{font-size:1.25rem;margin:1.8em 0 .5em}
.lead{color:var(--ink2);font-size:1.1rem}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:8px 26px 18px;margin-top:20px}
.muted{color:var(--ink2)}a{color:var(--brand)}ul{padding-left:1.2em}li{margin:.35em 0}footer{margin-top:32px;color:var(--ink2);font-size:.9rem}`;
const page = (title, desc, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>${css}</style></head><body><main>
<header><img src="favicon.svg" alt=""><a href="./">${esc(SITE.name)}</a></header>
${body}
<footer>© ${new Date().getFullYear()} ${esc(SITE.name)} · <a href="privacy.html">Privacy policy</a>${SITE.contactEmail ? ` · <a href="mailto:${esc(SITE.contactEmail)}">${esc(SITE.contactEmail)}</a>` : ''}</footer>
</main></body></html>
`;

writeFileSync(resolve(out, 'privacy.html'), page(`Privacy Policy · ${SITE.name}`, `How ${SITE.name} handles your data: your files never leave your device, and the app collects nothing.`,
  `<h1>Privacy Policy</h1><p class="lead">${esc(PRIVACY_LEAD(SITE.name))}</p><div class="card">${privacyHtml(SITE)}</div>`));
writeFileSync(resolve(out, 'index.html'), page(`${SITE.name}: PDF, video, image and calculator tools`, 'Every PDF, video, image and calculator tool in one private app. Everything runs on your device.',
  `<h1>${esc(SITE.name)}</h1><p class="lead">PDF, video, image and calculator tools in one private app. Read, merge and sign PDFs, compress video and photos, resize images and run everyday calculators. Everything happens on your device, and nothing is uploaded.</p>
<div class="card"><h2>Your privacy</h2><p>The app has no accounts, no ads and no analytics, and the Android app asks for no permissions at all, not even internet access. Read the full <a href="privacy.html">privacy policy</a>.</p></div>`));
console.log(`site/ written (privacy.html, index.html) for ${SITE.name}`);
