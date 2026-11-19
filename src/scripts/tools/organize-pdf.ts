import { h, dropzone, statusArea, progressBar, withBusy, downloadBlob } from '../ui';
import { LIMITS } from '../../lib/files';
import { formatBytes, safeBaseName } from '../../lib/format';
import { setHandoff } from '../handoff';
import { openPdfJs, loadPdfLib, pdfErrorMessage, PDFDocument, type PdfJsDocument } from '../pdf';
import { degrees } from 'pdf-lib';
import { icon } from '../../app/icons';
import { dropIndex, finalRotation, fitRotated, normalizeTurns, outputName, reorder, summarize, type PageItem } from '../../lib/organize';

const THUMB_W = 150, THUMB_H = 190;
const MAX_PAGES = 1000;

export function mount(root: HTMLElement) {
  const status = statusArea(); const progress = progressBar();
  let file: File | null = null; let pdf: PdfJsDocument | null = null; let srcCount = 0;
  let items: PageItem[] = []; let seq = 0; const selected = new Set<number>();
  const thumbs = new Map<number, string>(); const sizes = new Map<number, { w: number; h: number }>();
  let blankSize = { w: 612, h: 792 }; let lastPdf: File | null = null; let destroyed = false;

  /* ---- opening a PDF ---- */
  const dz = dropzone({
    kinds: ['pdf'], multiple: false, maxBytes: LIMITS.pdfBytes, title: 'Drop a PDF to organize',
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', ['The file was not opened:', ...e]); },
    onFiles: (files) => load(files[0].file),
  });
  const sampleBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Try a sample document');
  sampleBtn.addEventListener('click', () => withBusy(sampleBtn, 'Preparing…', async () => { const { createSampleAgreement } = await import('../samplePdf'); await load(await createSampleAgreement()); }));
  const openRow = h('div', { class: 'og-open' }, dz.el, h('p', { class: 'hint', style: 'margin:10px 0 0' }, 'No PDF handy? ', sampleBtn));

  async function load(f: File) {
    status.clear(); lastPdf = null; result.hidden = true;
    try {
      const doc = await openPdfJs(f);
      if (doc.numPages > MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} pages. This tool handles up to ${MAX_PAGES}.`);
      void pdf?.destroy(); pdf = doc; file = f; srcCount = doc.numPages; thumbs.clear(); sizes.clear(); selected.clear(); seq = 0;
      const first = await doc.getPage(1); const v = first.getViewport({ scale: 1 }); blankSize = { w: v.width, h: v.height };
      items = Array.from({ length: srcCount }, (_, i) => ({ id: ++seq, src: i, turns: 0, deleted: false }));
      nameInput.value = outputName(f.name);
      openRow.hidden = true; work.hidden = false; render();
    } catch (e) { status.set('error', pdfErrorMessage(e, `"${f.name.slice(0, 50)}"`)); }
  }

  /* ---- toolbar ---- */
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const announce = (t: string) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };
  const btn = (label: string, ic: string, fn: () => void, cls = 'btn btn-secondary btn-small') => { const b = h('button', { type: 'button', class: cls, onclick: fn }); b.innerHTML = `${icon(ic, 16)}<span>${label}</span>`; return b; };
  const selCount = h('span', { class: 'og-count', 'aria-live': 'polite' });
  const tools = {
    all: btn('Select all', 'check', () => { items.forEach((i) => selected.add(i.id)); render(); }),
    none: btn('Select none', 'close', () => { selected.clear(); render(); }),
    rotL: btn('Rotate left', 'rotate', () => turnSelected(-1)), rotR: btn('Rotate right', 'rotate', () => turnSelected(1)),
    del: btn('Delete', 'trash', () => deleteSelected()), dup: btn('Duplicate', 'copy', () => duplicateSelected()),
    blank: btn('Add blank page', 'plus', () => addBlank()), rev: btn('Reverse order', 'down', () => { items = [...items].reverse(); announce('Order reversed.'); render(); }),
    reset: btn('Undo all changes', 'history', () => { items = Array.from({ length: srcCount }, (_, i) => ({ id: ++seq, src: i, turns: 0, deleted: false })); selected.clear(); announce('All changes undone.'); render(); }, 'btn btn-ghost btn-small'),
  };
  tools.rotL.querySelector('svg')!.style.transform = 'scaleX(-1)';
  const toolbar = h('div', { class: 'og-bar', role: 'toolbar', 'aria-label': 'Page actions' },
    h('div', { class: 'og-group' }, tools.all, tools.none, selCount),
    h('div', { class: 'og-group' }, tools.rotL, tools.rotR, tools.del, tools.dup, tools.blank),
    h('div', { class: 'og-group' }, tools.rev, tools.reset));

  const selectedItems = () => items.filter((i) => selected.has(i.id));
  function turnSelected(d: number) { for (const i of selectedItems()) i.turns = normalizeTurns(i.turns + d); render(); }
  function deleteSelected() { const s = selectedItems(); const restore = s.every((i) => i.deleted); for (const i of s) i.deleted = !restore; announce(restore ? 'Pages restored.' : 'Pages deleted. They can be restored.'); render(); }
  function duplicateSelected() { const ids = new Set(selected); const out: PageItem[] = []; for (const i of items) { out.push(i); if (ids.has(i.id)) out.push({ ...i, id: ++seq, deleted: false }); } items = out; announce('Pages duplicated.'); render(); }
  function addBlank() {
    const s = selectedItems(); const last = s.length ? items.indexOf(s[s.length - 1]) : items.length - 1;
    const b: PageItem = { id: ++seq, src: -1, turns: 0, deleted: false, blank: { ...blankSize } }; items = [...items.slice(0, last + 1), b, ...items.slice(last + 1)];
    selected.clear(); selected.add(b.id); announce('Blank page added.'); render();
  }

  /* ---- the page grid ---- */
  const grid = h('ul', { class: 'og-grid', role: 'list', 'aria-label': 'Pages' });
  const dropBar = h('div', { class: 'og-dropbar', hidden: true, 'aria-hidden': 'true' });
  let io: IntersectionObserver | null = null; const queue: number[] = []; let drawing = false;

  const layoutThumb = (el: HTMLElement, it: PageItem) => {
    const sz = it.src < 0 ? it.blank! : sizes.get(it.src) ?? { w: 612, h: 792 }; const f = fitRotated(sz.w, sz.h, it.turns, THUMB_W, THUMB_H);
    el.style.width = `${f.w}px`; el.style.height = `${f.h}px`; el.style.transform = `translate(-50%, -50%) rotate(${normalizeTurns(it.turns) * 90}deg)`;
  };
  async function drawNext() {
    if (drawing || destroyed) return; drawing = true;
    try {
      while (queue.length && pdf) {
        const src = queue.shift()!; if (thumbs.has(src)) continue;
        try {
          const page = await pdf.getPage(src + 1); const v1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 260 / v1.width });
          const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); const ctx = c.getContext('2d', { alpha: false });
          if (!ctx) continue; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
          thumbs.set(src, c.toDataURL('image/jpeg', 0.72)); sizes.set(src, { w: v1.width, h: v1.height }); c.width = c.height = 0; page.cleanup();
          for (const img of grid.querySelectorAll<HTMLImageElement>(`img[data-src="${src}"]`)) { img.src = thumbs.get(src)!; const it = items.find((x) => x.id === Number(img.dataset.id)); if (it) layoutThumb(img, it); }
        } catch { /* a page without a thumbnail still works */ }
        await new Promise((r) => setTimeout(r));
      }
    } finally { drawing = false; }
  }
  const want = (src: number) => { if (!thumbs.has(src) && !queue.includes(src)) { queue.push(src); void drawNext(); } };

  function render() {
    io?.disconnect(); io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { want(Number((e.target as HTMLElement).dataset.src)); io?.unobserve(e.target); } }, { rootMargin: '300px 0px' });
    let pos = 0;
    grid.replaceChildren(...items.map((it, idx) => {
      if (!it.deleted) pos++;
      const label = it.src < 0 ? 'Blank page' : `Page ${it.src + 1} of the original`;
      const img = it.src < 0 ? h('div', { class: 'og-img og-blank', 'aria-hidden': 'true' }) : h('img', { class: 'og-img', alt: '', 'data-src': it.src, 'data-id': it.id, draggable: 'false' });
      if (img instanceof HTMLImageElement && thumbs.has(it.src)) img.src = thumbs.get(it.src)!;
      layoutThumb(img, it);
      const thumb = h('div', { class: 'og-thumb', 'data-src': it.src < 0 ? null : it.src }, img);
      if (it.src >= 0 && !thumbs.has(it.src)) io!.observe(thumb);
      const check = h('input', { type: 'checkbox', class: 'og-check', 'aria-label': `Select ${it.deleted ? 'deleted ' : ''}${label.toLowerCase()}, position ${it.deleted ? 'none' : pos}`, checked: selected.has(it.id) ? true : null });
      check.addEventListener('change', () => { if (check.checked) selected.add(it.id); else selected.delete(it.id); card.classList.toggle('selected', check.checked); updateBar(); });
      const small = (title: string, ic: string, fn: () => void, flip = false) => { const b = h('button', { type: 'button', class: 'og-mini', 'aria-label': `${title}: ${label.toLowerCase()}`, title, onclick: fn }); b.innerHTML = icon(ic, 16); if (flip) b.querySelector('svg')!.style.transform = 'scaleX(-1)'; return b; };
      const grab = h('button', { type: 'button', class: 'og-grab', 'aria-label': `Move ${label.toLowerCase()}. Drag, or press the arrow keys.`, title: 'Drag to reorder' }); grab.innerHTML = icon('grip', 16);
      const card = h('li', { class: `og-card${it.deleted ? ' deleted' : ''}${selected.has(it.id) ? ' selected' : ''}`, 'data-id': it.id },
        check, h('span', { class: 'og-num', text: it.deleted ? '–' : String(pos) }), thumb, it.deleted ? h('span', { class: 'og-badge', text: 'Deleted' }) : it.src < 0 ? h('span', { class: 'og-badge og-badge-blank', text: 'Blank' }) : null,
        h('div', { class: 'og-actions' },
          small('Rotate left', 'rotate', () => { it.turns = normalizeTurns(it.turns - 1); render(); }, true), small('Rotate right', 'rotate', () => { it.turns = normalizeTurns(it.turns + 1); render(); }),
          small('Duplicate', 'copy', () => { items.splice(idx + 1, 0, { ...it, id: ++seq, deleted: false }); announce('Page duplicated.'); render(); }),
          small(it.deleted ? 'Restore' : 'Delete', it.deleted ? 'history' : 'trash', () => { it.deleted = !it.deleted; announce(it.deleted ? 'Page deleted.' : 'Page restored.'); render(); }), grab));
      thumb.addEventListener('click', () => { check.checked = !check.checked; check.dispatchEvent(new Event('change')); });
      grab.addEventListener('pointerdown', (e) => startDrag(e, card, grab));
      grab.addEventListener('keydown', (e) => keyMove(e, it));
      return card;
    }));
    updateBar();
  }

  function updateBar() {
    const n = selected.size; selCount.textContent = n ? `${n} selected` : 'Tap pages to select them';
    for (const k of ['rotL', 'rotR', 'del', 'dup'] as const) tools[k].disabled = n === 0;
    tools.none.disabled = n === 0; tools.all.disabled = n === items.length;
    const s = summarize(items, srcCount);
    summary.textContent = `${s.kept} page${s.kept === 1 ? '' : 's'} will be saved` + [s.deleted ? `${s.deleted} deleted` : '', s.rotated ? `${s.rotated} rotated` : '', s.blanks ? `${s.blanks} blank added` : '', s.duplicates ? `${s.duplicates} duplicated` : '', s.reordered ? 'reordered' : ''].filter(Boolean).map((t, i) => (i ? ', ' : ' (') + t).join('') + (s.changed ? ').' : '.');
    saveBtn.disabled = s.kept === 0;
  }

  /* ---- reordering: drag (mouse, finger, pen) or keyboard ---- */
  function keyMove(e: KeyboardEvent, it: PageItem) {
    const from = items.indexOf(it); let to = from;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = from - 1; else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = from + 1; else if (e.key === 'Home') to = 0; else if (e.key === 'End') to = items.length - 1; else return;
    e.preventDefault(); to = Math.max(0, Math.min(items.length - 1, to)); if (to === from) return;
    items = reorder(items, from, to); announce(`Moved to position ${to + 1} of ${items.length}.`); render();
    grid.querySelector<HTMLElement>(`[data-id="${it.id}"] .og-grab`)?.focus();
  }
  function startDrag(e: PointerEvent, card: HTMLElement, handle: HTMLElement) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const cards = () => [...grid.children] as HTMLElement[]; const from = cards().indexOf(card); let to = from; let raf = 0; let y = e.clientY;
    const box = card.getBoundingClientRect(); const ghost = card.cloneNode(true) as HTMLElement; ghost.classList.add('og-ghost'); ghost.removeAttribute('data-id'); ghost.style.width = `${box.width}px`; document.body.append(ghost);
    const place = (cx: number, cy: number) => { ghost.style.left = `${cx - box.width / 2}px`; ghost.style.top = `${cy - 30}px`; };
    card.classList.add('og-dragging'); place(e.clientX, e.clientY); dropBar.hidden = true; if (!dropBar.isConnected) document.body.append(dropBar);
    const move = (ev: PointerEvent) => {
      y = ev.clientY; place(ev.clientX, ev.clientY);
      const rects = cards().map((c) => c.getBoundingClientRect()); to = dropIndex(rects, ev.clientX, ev.clientY, from);
      if (to === from) dropBar.hidden = true;
      else { const r = rects[to]; dropBar.hidden = false; dropBar.style.top = `${r.top}px`; dropBar.style.height = `${r.height}px`; dropBar.style.left = `${(to > from ? r.right : r.left) - 2}px`; }
    };
    const scroll = () => { if (y < 90) window.scrollBy(0, -16); else if (y > window.innerHeight - 90) window.scrollBy(0, 16); raf = requestAnimationFrame(scroll); };
    raf = requestAnimationFrame(scroll);
    const end = (ev: PointerEvent, commit: boolean) => {
      cancelAnimationFrame(raf); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel);
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      ghost.remove(); dropBar.hidden = true; card.classList.remove('og-dragging');
      if (commit && to !== from) { const moved = items[from]; items = reorder(items, from, to); announce(`Moved to position ${to + 1} of ${items.length}.`); render(); grid.querySelector<HTMLElement>(`[data-id="${moved.id}"] .og-grab`)?.focus({ preventScroll: true }); }
    };
    const up = (ev: PointerEvent) => end(ev, true), cancel = (ev: PointerEvent) => end(ev, false);
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel);
  }

  /* ---- saving ---- */
  const nameInput = h('input', { type: 'text', maxlength: 100, autocomplete: 'off', 'aria-label': 'File name' });
  const summary = h('p', { class: 'og-summary', 'aria-live': 'polite' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' }, 'Save PDF');
  const result = h('div', { class: 'og-result', hidden: true });
  const openAnother = h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { work.hidden = true; openRow.hidden = false; result.hidden = true; status.clear(); void pdf?.destroy(); pdf = null; items = []; file = null; } }, 'Open another PDF');

  saveBtn.addEventListener('click', () => withBusy(saveBtn, 'Saving…', async () => {
    if (!file) return; status.clear(); result.hidden = true;
    try {
      const kept = items.filter((i) => !i.deleted); if (!kept.length) throw new Error('Keep at least one page.');
      const src = await loadPdfLib(file); const out = await PDFDocument.create();
      const srcIdx = kept.filter((i) => i.src >= 0).map((i) => i.src);
      progress.set(0, 1, 'Copying pages…'); await new Promise((r) => setTimeout(r));
      const copied = srcIdx.length ? await out.copyPages(src, srcIdx) : []; let k = 0;
      for (const it of kept) {
        if (it.src < 0) { const p = out.addPage([it.blank!.w, it.blank!.h]); p.setRotation(degrees(finalRotation(0, it.turns))); continue; }
        const p = copied[k++]; p.setRotation(degrees(finalRotation(p.getRotation().angle, it.turns))); out.addPage(p);
      }
      try { const t = src.getTitle(); if (t) out.setTitle(t); } catch { /* no title */ }
      const bytes = await out.save(); const name = `${safeBaseName(nameInput.value.trim() || outputName(file.name), 'document')}.pdf`;
      lastPdf = new File([bytes as BlobPart], name, { type: 'application/pdf' }); showResult(kept.length);
    } catch (e) { status.show('error', ['The PDF could not be saved.', pdfErrorMessage(e, 'This PDF')]); }
    finally { progress.hide(); }
  }));
  function showResult(n: number) {
    if (!lastPdf) return; const f = lastPdf;
    result.replaceChildren(h('div', { class: 'notice notice-success', role: 'status' }, h('span', { text: `Saved ${n} page${n === 1 ? '' : 's'} (${formatBytes(f.size)}).` })),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => downloadBlob(f, f.name) }, 'Download PDF'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { setHandoff([f]); location.hash = '#/tool/pdf-reader'; } }, 'Open in PDF Reader'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { setHandoff([f]); location.hash = '#/tool/sign-pdf'; } }, 'Sign it')));
    result.hidden = false;
  }

  const work = h('div', { class: 'og-work', hidden: true },
    h('p', { class: 'og-info' }, openAnother), toolbar,
    h('p', { class: 'hint', text: 'Tap a page to select it. Drag the grip to reorder, or focus it and use the arrow keys. Deleted pages stay visible until you save, so you can restore them.' }),
    grid, live,
    h('div', { class: 'og-save' }, summary, h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'og-name', text: 'File name' }), nameInput)), h('div', { class: 'actions' }, saveBtn)));
  nameInput.id = 'og-name';
  root.closest('.tool-panel')?.classList.add('rd-panel'); root.closest('.tool-layout')?.classList.add('rd-wide');
  root.append(openRow, status.el, progress.el, work, result);

  // Tools have no unmount hook: release the document when this screen is removed.
  const watchdog = window.setInterval(() => { if (!root.isConnected) { destroyed = true; clearInterval(watchdog); io?.disconnect(); dropBar.remove(); void pdf?.destroy(); } }, 1500);
}
