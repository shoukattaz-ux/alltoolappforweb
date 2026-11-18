# ToolHaven Studio

One polished web app that brings every tool from the `alltools` site, plus a new video compressor, into a single, app-style workspace. All 16 tools run **entirely in the browser**: files are never uploaded.

| Category | Tools |
| --- | --- |
| PDF | Merge, Sign, Split, Compress, PDF to image, Image to PDF |
| Image | Compress, Resize, Crop, Convert format, Image to Base64 |
| Video | Compress (quality preset or target size, resize, trim, MP4/WebM) |
| Calculators | BMI, Percentage, Age, Discount |

## App features

- Sidebar workspace with every tool grouped by category, and a responsive mobile drawer
- Dashboard with hero, quick actions, **favorites** and **recently used** tools
- Command palette (`Ctrl/⌘ K`, or `/`) with instant search and keyboard navigation
- Directory with category tabs and live filtering (`#/tools`, `#/pdf`, `#/image`, `#/calculator`, `#/favorites`)
- Per-tool view with **Tool / How to use / FAQ** tabs, related tools and a Save (favorite) button
- Light and dark themes (follows the system, remembered per browser)
- Each tool is its own code-split chunk, loaded only when opened

## Security

`public/_headers` ships a strict Content-Security-Policy (`script-src 'self'`, `connect-src 'self' blob: data:`, no framing, no plugins), HSTS, `nosniff`, a locked-down Permissions-Policy and COOP. The e2e server enforces the same headers, so every test runs under the real policy, and a test confirms inline scripts and off-origin requests are blocked. If you add analytics or ads, extend the policy deliberately.

## Commands

```bash
npm install
npm run dev        # copies pdf.js font data, then starts Vite
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
npm test           # 67 unit tests (calculators, page ranges, file validation, signature placement)
npm run test:e2e   # 35 real-browser tests (build first): every tool with real files, app shell, privacy, axe a11y
npm run ci         # unit tests, build, then e2e
```

Node 20+. The e2e tests use the Chromium at `/opt/pw-browsers/chromium` (or set `CHROMIUM_PATH`). Deploy `dist/` to any static host (hash routing, so no rewrite rules are needed).

## Structure

```
src/main.ts           shell, hash router, theme
src/app/              views, command palette, icons, persisted store
src/data/tools.ts     tool content (copy, steps, FAQs)
src/scripts/tools/    one module per tool: mount(root)
src/lib/              pure, unit-tested logic
src/styles/           tools.css (design tokens + tool UI), app.css (app shell)
```

The Video Compressor uses the browser's WebCodecs engine through [Mediabunny](https://mediabunny.dev) (MPL-2.0): hardware-accelerated where available, no WebAssembly download, nothing uploaded. It needs Chrome/Edge, Safari 16.4+ or Firefox 130+ over HTTPS, and says so clearly when unsupported.

Tool logic and tool UI (other than the video tool) come from the `alltools` repo. The app shell is new.
