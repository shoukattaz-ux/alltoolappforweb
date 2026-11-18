import { icon } from './icons';
import { esc, searchTools, toolHref, catLabel } from './util';
import { TOOLS } from '../data/tools';

/** Ctrl/Cmd+K command palette with keyboard navigation. */
export function initPalette() {
  const dlg = document.createElement('div');
  dlg.className = 'palette'; dlg.hidden = true;
  dlg.innerHTML = `<div class="palette-backdrop" data-close></div>
    <div class="palette-box" role="dialog" aria-modal="true" aria-label="Find a tool">
      <div class="palette-input">${icon('search', 20)}<input type="text" id="pal-q" placeholder="Search ${TOOLS.length} tools: merge, resize, percent…" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="pal-list" /><kbd>Esc</kbd></div>
      <ul id="pal-list" role="listbox"></ul>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span></div>
    </div>`;
  document.body.append(dlg);
  const input = dlg.querySelector<HTMLInputElement>('#pal-q')!;
  const list = dlg.querySelector<HTMLUListElement>('#pal-list')!;
  let results = TOOLS; let active = 0; let opener: HTMLElement | null = null;

  const render = () => {
    results = searchTools(input.value);
    active = Math.min(active, Math.max(0, results.length - 1));
    list.innerHTML = results.length ? results.map((t, i) => `<li role="option" id="pal-${i}" aria-selected="${i === active}" data-i="${i}">
      <span class="mini-icon cat-${t.category}">${icon(t.icon, 18)}</span><span class="pal-text"><strong>${esc(t.name)}</strong><span>${esc(t.short)}</span></span><span class="chip">${catLabel[t.category]}</span></li>`).join('')
      : `<li class="pal-empty">No tools match “${esc(input.value)}”.</li>`;
    input.setAttribute('aria-activedescendant', results.length ? `pal-${active}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const open = () => { opener = document.activeElement as HTMLElement; dlg.hidden = false; document.body.classList.add('no-scroll'); input.value = ''; active = 0; render(); input.focus(); };
  const close = () => { dlg.hidden = true; document.body.classList.remove('no-scroll'); opener?.focus?.(); };
  const go = (i: number) => { const t = results[i]; if (!t) return; close(); location.hash = toolHref(t); };

  input.addEventListener('input', () => { active = 0; render(); });
  list.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); if (li) go(+li.dataset.i!); });
  list.addEventListener('mousemove', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); if (li && +li.dataset.i! !== active) { active = +li.dataset.i!; render(); } });
  dlg.addEventListener('click', (e) => { if ((e.target as HTMLElement).hasAttribute('data-close')) close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, results.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + results.length) % Math.max(1, results.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(active); }
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
    if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); dlg.hidden ? open() : close(); }
  });
  document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-open-palette]')) open(); });
}
