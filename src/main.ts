import './styles/tools.css';
import './styles/app.css';
import { CATEGORIES, toolBySlug, toolsByCategory, type Category } from './data/tools';
import { icon } from './app/icons';
import { esc, toolHref, catHref } from './app/util';
import { home, directory, toolShell, bootTool, notFound, privacy } from './app/views';
import { SITE } from './data/site';
import { initPalette } from './app/palette';
import { getTheme, setTheme, subscribe, getFavorites } from './app/store';

const CATS: Category[] = ['pdf', 'image', 'video', 'calculator'];
const app = document.getElementById('app')!;

app.innerHTML = `
<div class="shell">
  <aside class="sidebar-nav" id="sidebar" aria-label="Main">
    <a class="brand" href="#/"><img src="/favicon.svg" width="36" height="36" alt="" /><span>ToolHaven<small>Studio</small></span></a>
    <button class="search-btn" data-open-palette>${icon('search', 17)}<span>Search tools</span><kbd>Ctrl K</kbd></button>
    <nav id="nav"></nav>
    <div class="side-foot">
      <a class="privacy-card" href="#/privacy">${icon('shield', 18)}<div><strong>100% private</strong><span>Files never leave your device.</span></div></a>
      <button class="theme-btn" id="theme-btn"></button>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="main-col">
    <header class="topbar">
      <button class="icon-btn" id="menu-btn" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
      <a class="brand brand-sm" href="#/"><img src="/favicon.svg" width="30" height="30" alt="" /><span>ToolHaven</span></a>
      <button class="icon-btn" data-open-palette aria-label="Search tools">${icon('search', 20)}</button>
    </header>
    <main id="view" tabindex="-1"></main>
    <footer class="app-foot">© ${new Date().getFullYear()} ${SITE.name} · Built for privacy: processed locally, never uploaded. · <a href="#/privacy">Privacy</a></footer>
  </div>
</div>`;

const view = document.getElementById('view')!;
const nav = document.getElementById('nav')!;
const sidebar = document.getElementById('sidebar')!;
const menuBtn = document.getElementById('menu-btn')!;
const themeBtn = document.getElementById('theme-btn')!;

function renderNav(hash: string) {
  const link = (href: string, label: string, ic: string, extra = '') =>
    `<a class="nav-link ${extra}" href="${href}" ${hash === href ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span>${esc(label)}</span></a>`;
  const favCount = getFavorites().length;
  nav.innerHTML = `
    <div class="nav-group">${link('#/', 'Dashboard', 'home')}${link('#/tools', 'All tools', 'grid')}
      <a class="nav-link" href="#/favorites" ${hash === '#/favorites' ? 'aria-current="page"' : ''}>${icon('star', 18)}<span>Favorites</span>${favCount ? `<em class="count">${favCount}</em>` : ''}</a></div>
    ${CATS.map((c) => `<div class="nav-group cat-${c}"><h2 class="nav-title"><a href="${catHref(c)}">${CATEGORIES[c].name}</a></h2>
      ${toolsByCategory(c).map((t) => `<a class="nav-link tool-link" href="${toolHref(t)}" ${hash === toolHref(t) ? 'aria-current="page"' : ''}><span class="nav-dot">${icon(t.icon, 16)}</span><span>${esc(t.name)}</span></a>`).join('')}</div>`).join('')}`;
  themeBtn.innerHTML = getTheme() === 'dark' ? `${icon('sun', 17)}<span>Light mode</span>` : `${icon('moon', 17)}<span>Dark mode</span>`;
}

function setMenu(open: boolean) {
  document.body.classList.toggle('menu-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
}

function route() {
  const hash = location.hash || '#/';
  const [path, qs = ''] = hash.split('?');
  const q = new URLSearchParams(qs).get('q') ?? '';
  let title = 'ToolHaven Studio: PDF, video, image and calculator tools';
  setMenu(false);
  const seg = path.replace(/^#\/?/, '');
  if (seg === '') view.innerHTML = home();
  else if (seg === 'tools') { view.innerHTML = directory('all', q); title = 'All tools · ToolHaven'; }
  else if (seg === 'privacy') { view.innerHTML = privacy(); title = `Privacy · ${SITE.name}`; }
  else if (seg === 'favorites') { view.innerHTML = directory('favorites', q); title = 'Favorites · ToolHaven'; }
  else if ((CATS as string[]).includes(seg)) { view.innerHTML = directory(seg as Category, q); title = `${CATEGORIES[seg as Category].name} · ToolHaven`; }
  else if (seg.startsWith('tool/') && toolBySlug(seg.slice(5))) {
    const slug = seg.slice(5); view.innerHTML = toolShell(slug)!; title = `${toolBySlug(slug)!.name} · ToolHaven`; void bootTool(slug, view);
  } else { view.innerHTML = notFound(); title = 'Not found · ToolHaven'; }
  document.title = title;
  renderNav(path);
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

// Live directory filter (re-renders only the grid so the input keeps focus).
view.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id !== 'dir-q') return;
  const [path] = (location.hash || '#/').split('?');
  history.replaceState(null, '', el.value ? `${path}?q=${encodeURIComponent(el.value)}` : path);
  const seg = path.replace(/^#\/?/, '');
  const cat = seg === 'tools' ? 'all' : seg === 'favorites' ? 'favorites' : (seg as Category);
  const tmp = document.createElement('div'); tmp.innerHTML = directory(cat, el.value);
  view.querySelector('#dir-grid')!.innerHTML = tmp.querySelector('#dir-grid')!.innerHTML;
});

menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
document.getElementById('scrim')!.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
themeBtn.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
subscribe(() => renderNav((location.hash || '#/').split('?')[0]));
window.addEventListener('hashchange', route);
initPalette();
route();
