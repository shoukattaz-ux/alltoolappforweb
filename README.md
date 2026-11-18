# ToolHaven Studio

One polished web app that brings every tool from the `alltools` site into a single, app-style workspace. All 15 tools run **entirely in the browser**: files are never uploaded.

| Category | Tools |
| --- | --- |
| PDF | Merge, Sign, Split, Compress, PDF to image, Image to PDF |
| Image | Compress, Resize, Crop, Convert format, Image to Base64 |
| Calculators | BMI, Percentage, Age, Discount |

## App features

- Sidebar workspace with every tool grouped by category, and a responsive mobile drawer
- Dashboard with hero, quick actions, **favorites** and **recently used** tools
- Command palette (`Ctrl/⌘ K`, or `/`) with instant search and keyboard navigation
- Directory with category tabs and live filtering (`#/tools`, `#/pdf`, `#/image`, `#/calculator`, `#/favorites`)
- Per-tool view with **Tool / How to use / FAQ** tabs, related tools and a Save (favorite) button
- Light and dark themes (follows the system, remembered per browser)
- Each tool is its own code-split chunk, loaded only when opened

## Commands

```bash
npm install
npm run dev        # copies pdf.js font data, then starts Vite
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
npm test           # 52 unit tests (calculators, page ranges, file validation, signature placement)
```

Node 20+. Deploy `dist/` to any static host (hash routing, so no rewrite rules are needed).

## Structure

```
src/main.ts           shell, hash router, theme
src/app/              views, command palette, icons, persisted store
src/data/tools.ts     tool content (copy, steps, FAQs)
src/scripts/tools/    one module per tool: mount(root)
src/lib/              pure, unit-tested logic
src/styles/           tools.css (design tokens + tool UI), app.css (app shell)
```

Tool logic and tool UI come from the `alltools` repo. The app shell is new.
