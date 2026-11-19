// Regenerates public/og-image.png (1200x630, the link-preview image). Run: npm run og
// Set SITE_NAME to rebrand, e.g. SITE_NAME=Acme npm run og
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const name = process.env.SITE_NAME || 'ToolHaven';
const chip = (t, c) => `<span style="display:inline-block;padding:10px 22px;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);font-size:26px;font-weight:650;color:${c}">${t}</span>`;
const html = `<html><body style="margin:0;width:1200px;height:630px;background:radial-gradient(900px 500px at 88% -5%,rgba(45,212,191,.38),transparent 65%),radial-gradient(800px 520px at 0% 105%,rgba(124,58,237,.55),transparent 65%),linear-gradient(135deg,#1e1b4b 0%,#3730a3 58%,#4f46e5 100%);font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 88px;box-sizing:border-box;position:relative;overflow:hidden">
<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.13) 2px,transparent 2px);background-size:34px 34px;mask-image:linear-gradient(120deg,transparent 35%,#000)"></div>
<div style="position:relative;display:flex;align-items:center;gap:22px"><svg width="84" height="84" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#fff" fill-opacity=".16"/><path d="M10 12.5h16M10 18h10M10 23.5h16" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="26" cy="18" r="2.8" fill="#2dd4bf"/></svg><div style="font-size:62px;font-weight:800;letter-spacing:-1.5px">${name}<span style="font-size:26px;font-weight:700;letter-spacing:5px;color:#a5b4fc;margin-left:16px;vertical-align:middle">STUDIO</span></div></div>
<div style="position:relative;font-size:72px;font-weight:800;line-height:1.08;letter-spacing:-2px;margin-top:40px;max-width:1000px">Every tool you need.<br><span style="background:linear-gradient(100deg,#a5f3fc,#c4b5fd 60%,#fbcfe8);-webkit-background-clip:text;color:transparent">Private by design.</span></div>
<div style="position:relative;display:flex;gap:14px;margin-top:40px">${chip('PDF', '#fecdd3')}${chip('Video', '#ddd6fe')}${chip('Image', '#99f6e4')}${chip('Calculators', '#fde68a')}<span style="font-size:26px;color:#c7d2fe;align-self:center;margin-left:10px">19 free tools · no uploads</span></div></body></html>`;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: new URL('../public/og-image.png', import.meta.url).pathname });
await browser.close();
console.log('og-image.png written');
