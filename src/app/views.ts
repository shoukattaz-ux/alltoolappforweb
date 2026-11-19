import { TOOLS, CATEGORIES, toolBySlug, toolsByCategory, type Category } from '../data/tools';
import { icon } from './icons';
import { esc, toolHref, catHref, catLabel, searchTools, toolCard } from './util';
import { SITE } from '../data/site';
import { privacyHtml, PRIVACY_LEAD } from '../data/privacy';
import { launcherMarkup } from './launcher';
import { toast } from '../scripts/ui';
import { getFavorites, getRecents, isFavorite, toggleFavorite, pushRecent } from './store';

const CATS: Category[] = ['pdf', 'image', 'video', 'calculator'];
const pill = '<span class="privacy-pill">' + icon('shield', 16) + 'Runs in your browser. Nothing is uploaded.</span>';

/* ------------------------------ Dashboard ------------------------------ */
export function home(): string {
  const favs = getFavorites().map(toolBySlug).filter(Boolean);
  const recents = getRecents().map(toolBySlug).filter(Boolean);
  const section = (title: string, ic: string, body: string, more = '') =>
    `<section class="block"><header class="block-head"><h2>${icon(ic, 18)}${title}</h2>${more}</header>${body}</section>`;
  return `
  <section class="hero">
    <div class="hero-text">
      <span class="eyebrow">${icon('sparkles', 15)} ${TOOLS.length} tools · zero uploads</span>
      <h1>Every tool you need.<br><span class="grad-text">Private by design.</span></h1>
      <p class="lead">Read, merge, sign and compress PDFs, compress videos, resize and convert images, and run everyday calculators. It all happens on your device, so your files stay yours.</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-large" data-open-palette>${icon('search', 18)} Find a tool <kbd>Ctrl K</kbd></button>
        <a class="btn btn-outline-light btn-large" href="#/tools">Browse all tools</a>
      </div>
    </div>
    <ul class="hero-stats" aria-label="Highlights">
      <li><strong>${TOOLS.length}</strong><span>tools in one app</span></li>
      <li><strong>0 KB</strong><span>sent to any server</span></li>
      <li><strong>Free</strong><span>no sign-up, no limits</span></li>
    </ul>
  </section>
  ${launcherMarkup()}
  <section class="block tasks-block" aria-labelledby="tasks-h">
    <header class="block-head"><h2 id="tasks-h">${icon('zap', 18)}What do you want to do?</h2></header>
    <ul class="tasks">
      ${[['pdf-reader', 'Read a PDF'], ['merge-pdf', 'Combine PDFs'], ['sign-pdf', 'Sign a document'], ['compress-pdf', 'Make a PDF smaller'], ['video-compressor', 'Shrink a video'], ['image-compressor', 'Make photos smaller'], ['image-resizer', 'Resize a photo'], ['percentage-calculator', 'Work out a percentage']]
        .map(([s, l]) => { const t = toolBySlug(s)!; return `<li><a class="task cat-${t.category}" href="${toolHref(t)}"><span class="task-icon">${icon(t.icon, 22)}</span><span>${l}</span></a></li>`; }).join('')}
    </ul>
  </section>
  ${favs.length ? section('Favorites', 'star', `<div class="tgrid">${favs.map((t) => toolCard(t!)).join('')}</div>`) : ''}
  ${recents.length ? section('Recently used', 'history', `<div class="tgrid">${recents.slice(0, 3).map((t) => toolCard(t!)).join('')}</div>`) : ''}
  ${CATS.map((c) => section(CATEGORIES[c].name, c === 'pdf' ? 'pdf' : c === 'image' ? 'image' : c === 'video' ? 'video' : 'calculator',
      `<p class="muted block-blurb">${esc(CATEGORIES[c].blurb)}</p><div class="tgrid">${toolsByCategory(c).map((t) => toolCard(t, { fav: isFavorite(t.slug) })).join('')}</div>`,
      `<a class="more" href="${catHref(c)}">View all ${icon('arrow', 15)}</a>`)).join('')}
  <section class="trust">
    ${[['lock', 'Private by design', 'Files are read and processed inside your browser tab. There is no upload, and nothing to leak.'],
       ['zap', 'Fast, with no waiting', 'No upload queue and no server round-trip. Results appear as quickly as your device can produce them.'],
       ['check', 'Honest results', 'Every tool states its limits and shows real before and after numbers, never inflated claims.']]
      .map(([i, t, b]) => `<div class="trust-item"><span class="trust-icon">${icon(i, 22)}</span><h3>${t}</h3><p>${b}</p></div>`).join('')}
  </section>`;
}

/* ----------------------------- Directory ----------------------------- */
export function directory(cat: Category | 'all' | 'favorites', query = ''): string {
  const title = cat === 'all' ? 'All tools' : cat === 'favorites' ? 'Favorites' : CATEGORIES[cat].name;
  const intro = cat === 'all' ? 'Every tool, one place. Filter by category or search by what you want to do.'
    : cat === 'favorites' ? 'Your starred tools, one click away.' : CATEGORIES[cat].blurb;
  const tabs: [string, string, string][] = [['all', 'All', '#/tools'], ['pdf', 'PDF', '#/pdf'], ['image', 'Image', '#/image'], ['video', 'Video', '#/video'], ['calculator', 'Calculators', '#/calculator'], ['favorites', 'Favorites', '#/favorites']];
  let list = cat === 'all' ? TOOLS : cat === 'favorites' ? TOOLS.filter((t) => isFavorite(t.slug)) : toolsByCategory(cat);
  if (query) list = searchTools(query).filter((t) => list.includes(t));
  return `
  <header class="page-head">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a>${icon('chevron', 14)}<span>${title}</span></nav>
    <h1>${title}</h1><p class="lead">${esc(intro)}</p>
  </header>
  <div class="filter-bar">
    <div class="tabs" role="tablist" aria-label="Category">${tabs.map(([k, l, h]) => `<a role="tab" class="tab" aria-selected="${k === cat}" href="${h}">${l}</a>`).join('')}</div>
    <label class="filter-search">${icon('search', 17)}<span class="sr-only">Filter tools</span><input id="dir-q" type="search" placeholder="Filter tools…" value="${esc(query)}" autocomplete="off" /></label>
  </div>
  <div class="tgrid" id="dir-grid">${list.length ? list.map((t) => toolCard(t, { fav: isFavorite(t.slug) })).join('')
    : `<div class="empty">${icon('search', 28)}<strong>${cat === 'favorites' && !query ? 'No favorites yet' : 'No tools match'}</strong><span>${cat === 'favorites' && !query ? 'Open a tool and tap the star to pin it here.' : 'Try a different word, such as “merge”, “resize” or “percent”.'}</span></div>`}</div>`;
}

/* ------------------------------- Tool ------------------------------- */
export function toolShell(slug: string): string | null {
  const t = toolBySlug(slug); if (!t) return null;
  const cat = CATEGORIES[t.category];
  const related = t.related.map(toolBySlug).filter(Boolean);
  return `
  <header class="tool-head cat-${t.category}">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a>${icon('chevron', 14)}<a href="${catHref(t.category)}">${cat.name}</a>${icon('chevron', 14)}<span>${esc(t.name)}</span></nav>
    <div class="tool-title">
      <span class="tool-badge">${icon(t.icon, 30)}</span>
      <div class="tool-title-text"><h1>${esc(t.h1)}</h1><p>${esc(t.short)}</p></div>
      <button class="fav-btn" id="fav-btn" aria-pressed="${isFavorite(t.slug)}" title="Add to favorites">${icon('star', 20)}<span>${isFavorite(t.slug) ? 'Saved' : 'Save'}</span></button>
    </div>
    <p class="tool-privacy">${pill}</p>
  </header>
  <div class="tabs tool-tabs" role="tablist" aria-label="Tool sections">
    <button class="tab" role="tab" data-tab="tool" aria-selected="true">${icon('zap', 16)}Tool</button>
    <button class="tab" role="tab" data-tab="guide" aria-selected="false">${icon('book', 16)}How to use</button>
    <button class="tab" role="tab" data-tab="faq" aria-selected="false">${icon('help', 16)}FAQ</button>
  </div>
  <div class="tool-layout">
    <div class="tool-main">
      <section class="tool-panel" data-panel="tool"><div id="tool-root" aria-live="polite" aria-busy="true"><div class="tool-skeleton" aria-hidden="true"><div class="sk" style="height:110px"></div><div class="sk" style="height:46px;width:44%"></div></div></div></section>
      <section class="content-block" data-panel="guide" hidden>
        <h2>How to use the ${esc(t.name)}</h2><ol class="steps">${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <h2>Key features</h2><ul class="ticks">${t.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <h2>Practical examples</h2>${t.examples.map((e) => `<div class="example"><h3>${esc(e.title)}</h3><p>${esc(e.body)}</p></div>`).join('')}
        ${t.limits ? `<div class="note-box"><h2>Good to know</h2><ul>${t.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
      </section>
      <section class="content-block faq" data-panel="faq" hidden>
        <h2>Frequently asked questions</h2>${t.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
      </section>
    </div>
    <aside class="tool-aside" aria-label="Related tools">
      <div class="side-box"><h2>About this tool</h2><p class="aside-intro">${esc(t.intro)}</p></div>
      <div class="side-box"><h2>Related tools</h2><ul>${related.map((r) => `<li><a href="${toolHref(r!)}"><span class="mini-icon cat-${r!.category}">${icon(r!.icon, 18)}</span>${esc(r!.name)}</a></li>`).join('')}</ul></div>
    </aside>
  </div>`;
}

const loaders = import.meta.glob('../scripts/tools/*.ts') as Record<string, () => Promise<{ mount: (root: HTMLElement) => void | Promise<void> }>>;

export async function bootTool(slug: string, view: HTMLElement) {
  const t = toolBySlug(slug)!; pushRecent(slug);
  const root = view.querySelector<HTMLElement>('#tool-root')!;
  const fav = view.querySelector<HTMLButtonElement>('#fav-btn')!;
  fav.addEventListener('click', () => {
    toggleFavorite(slug); const on = isFavorite(slug);
    fav.setAttribute('aria-pressed', String(on)); fav.querySelector('span')!.textContent = on ? 'Saved' : 'Save';
    toast(on ? `${t.name} added to your favorites` : `${t.name} removed from your favorites`);
  });
  const tabs = view.querySelectorAll<HTMLButtonElement>('[data-tab]');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    view.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  }));
  try {
    const load = loaders[`../scripts/tools/${t.slug}.ts`]; if (!load) throw new Error('Tool module not found');
    const mod = await load();
    if (!root.isConnected) return; // navigated away while loading
    root.innerHTML = ''; root.removeAttribute('aria-busy'); await mod.mount(root);
  } catch (err) {
    console.error(err); root.removeAttribute('aria-busy');
    root.innerHTML = '<div class="notice notice-error" role="alert"><span>This tool could not be loaded. Check your connection, reload, and try a current version of Chrome, Edge, Firefox or Safari.</span></div>';
  }
}

export function privacy(): string {
  return `
  <header class="page-head">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a>${icon('chevron', 14)}<span>Privacy</span></nav>
    <h1>Privacy</h1><p class="lead">${esc(PRIVACY_LEAD(SITE.name))}</p>
  </header>
  <article class="prose legal">${privacyHtml(SITE)}</article>`;
}

export function notFound(): string {
  return `<div class="empty big">${icon('search', 32)}<strong>Page not found</strong><span>That tool or page does not exist.</span><a class="btn btn-primary" href="#/">Back to dashboard</a></div>`;
}
