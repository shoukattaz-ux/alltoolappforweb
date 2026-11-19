import { h, dropzone, statusArea, selectControl } from '../ui';
import { LIMITS } from '../../lib/files';
import { formatBytes } from '../../lib/format';
import { setHandoff } from '../handoff';
import { openPdfJsInteractive, pdfErrorMessage, TextLayer, type PdfJsDocument } from '../pdf';
import { clampZoom, effectiveZoom, findInText, nextZoomStep, pixelRatioFor, PDF_PX_PER_PT } from '../../lib/reader';
import { icon } from '../../app/icons';

type Page = Awaited<ReturnType<PdfJsDocument['getPage']>>;
type TextContent = Awaited<ReturnType<Page['getTextContent']>>;
type RenderTask = ReturnType<Page['render']>;
type ZoomMode = 'width' | 'page' | number;

interface PageView {
  n: number; el: HTMLDivElement;
  /** Page size in PDF points at 0° view rotation (includes the file's own rotation). */
  w0: number; h0: number; sized: boolean;
  state: 'idle' | 'rendering' | 'done'; token: number; task?: RenderTask; textLayer?: InstanceType<typeof TextLayer>;
  visible: boolean; renderedKey: string;
}
interface Match { page: number; k: number }

const GAP = 14;
const ZOOM_OPTIONS: [string, string][] = [['width', 'Fit width'], ['page', 'Fit page'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%']];

export function mount(root: HTMLElement) {
  const status = statusArea();

  const open = h('div', { class: 'rd-open' });
  const sampleBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Try a sample document');
  const dz = dropzone({
    kinds: ['pdf'], multiple: false, maxBytes: LIMITS.pdfBytes, title: 'Drop a PDF to read',
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', ['The file was not opened:', ...e]); },
    onFiles: (files) => load(files[0].file),
  });
  sampleBtn.addEventListener('click', async () => {
    sampleBtn.disabled = true;
    try { const { createSampleAgreement } = await import('../samplePdf'); await load(await createSampleAgreement()); }
    finally { sampleBtn.disabled = false; }
  });
  open.append(dz.el, h('p', { class: 'hint', style: 'margin:10px 0 0' }, 'No PDF handy? ', sampleBtn, ' It is a fictional two-page practice document.'));
  const stage = h('div', { class: 'rd-stage', hidden: true });
  const pwBox = h('div', { class: 'rd-password', hidden: true });
  root.append(open, status.el, pwBox, stage);

  let teardown: (() => void) | null = null;

  async function load(file: File) {
    teardown?.(); teardown = null; stage.hidden = true; stage.replaceChildren(); pwBox.hidden = true; status.clear();
    status.show('info', 'Opening…');
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const task = openPdfJsInteractive(data, (provide, wrong) => askPassword(provide, wrong, task));
      const pdf = await task.promise;
      status.clear(); pwBox.hidden = true;
      teardown = buildReader(pdf, file);
      open.hidden = true;
    } catch (e) {
      pwBox.hidden = true;
      status.set('error', (e as { name?: string })?.name === 'PasswordException' ? 'A password is needed to open this PDF.' : pdfErrorMessage(e, `"${file.name.slice(0, 50)}"`));
    }
  }

  function askPassword(provide: (pw: string) => void, wrong: boolean, task: { destroy: () => Promise<void> }) {
    status.clear();
    const input = h('input', { type: 'password', id: 'rd-pw', autocomplete: 'off', 'aria-describedby': 'rd-pw-msg' });
    const go = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Open PDF');
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
    const form = h('form', { class: 'rd-pw-form' },
      h('label', { for: 'rd-pw', class: 'label', text: 'This PDF is password protected' }), input,
      h('p', { id: 'rd-pw-msg', class: wrong ? 'hint rd-pw-err' : 'hint', role: wrong ? 'alert' : null, text: wrong ? 'That password is not correct. Try again.' : 'Enter the password to open it. It is only used on this device.' }),
      h('div', { class: 'actions', style: 'margin-top:12px' }, go, cancel));
    form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value) { pwBox.hidden = true; status.show('info', 'Opening…'); provide(input.value); } });
    cancel.addEventListener('click', () => { pwBox.hidden = true; status.clear(); void task.destroy(); });
    pwBox.replaceChildren(form); pwBox.hidden = false; input.focus();
  }

  /* ------------------------------------------------------------------ reader ------------------------------------------------------------------ */
  function buildReader(pdf: PdfJsDocument, file: File): () => void {
    const numPages = pdf.numPages;
    const pages: PageView[] = [];
    let zoom: ZoomMode = 'width';
    let rotation = 0;
    let night = false;
    let currentPage = 1;
    let query = '';
    let matches: Match[] = [];
    let cur = -1;
    let pendingFocus: Match | null = null;
    let searchToken = 0;
    let destroyed = false;
    const textCache = new Map<number, Promise<TextContent>>();
    const queue = new Set<PageView>();
    let pumping = false;

    /* ---- toolbar ---- */
    const btn = (label: string, ic: string, onclick: () => void, extra = '') => {
      const b = h('button', { type: 'button', class: `icon-btn rd-btn ${extra}`, 'aria-label': label, title: label, onclick });
      b.innerHTML = icon(ic, 18); return b;
    };
    const thumbsBtn = btn('Show page thumbnails', 'panel', () => toggleThumbs(), 'rd-thumbs-btn'); thumbsBtn.setAttribute('aria-pressed', 'false');
    const prevBtn = btn('Previous page', 'up', () => goToPage(currentPage - 1));
    const nextBtn = btn('Next page', 'down', () => goToPage(currentPage + 1));
    const pageInput = h('input', { type: 'number', min: 1, max: numPages, value: 1, inputmode: 'numeric', class: 'rd-page-input', 'aria-label': 'Page number' });
    const pageTotal = h('span', { class: 'rd-total', text: `of ${numPages}` });
    const zoomSel = selectControl(ZOOM_OPTIONS, 'width'); zoomSel.setAttribute('aria-label', 'Zoom'); zoomSel.className = 'rd-zoom';
    const zoomOut = btn('Zoom out', 'minus', () => stepZoom(-1));
    const zoomIn = btn('Zoom in', 'plus', () => stepZoom(1));
    const rotateBtn = btn('Rotate view', 'rotate', () => { rotation = (rotation + 90) % 360; relayout(true); });
    const nightBtn = btn('Night mode', 'moon', () => { night = !night; nightBtn.setAttribute('aria-pressed', String(night)); wrap.classList.toggle('rd-night', night); }); nightBtn.setAttribute('aria-pressed', 'false');
    const fsBtn = btn('Full screen', 'expand', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.requestFullscreen?.(); });
    if (!document.fullscreenEnabled) fsBtn.hidden = true;
    const searchInput = h('input', { type: 'search', class: 'rd-search', placeholder: 'Search in document', 'aria-label': 'Search in document', autocomplete: 'off' });
    const searchCount = h('span', { class: 'rd-count', 'aria-live': 'polite' });
    const hitPrev = btn('Previous match', 'up', () => stepMatch(-1)); const hitNext = btn('Next match', 'down', () => stepMatch(1));
    hitPrev.disabled = hitNext.disabled = true;
    const more = selectControl([['', 'Do more with this PDF…'], ['sign-pdf', 'Sign it'], ['split-pdf', 'Pull out pages'], ['compress-pdf', 'Make it smaller'], ['pdf-to-image', 'Turn pages into images'], ['merge-pdf', 'Combine with other PDFs']], '');
    more.setAttribute('aria-label', 'Do more with this PDF'); more.className = 'rd-more';
    more.addEventListener('change', () => { if (more.value) { setHandoff([file]); location.hash = `#/tool/${more.value}`; } });
    const closeBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Open another PDF');

    const bar = h('div', { class: 'rd-bar', role: 'toolbar', 'aria-label': 'PDF reader controls' },
      h('div', { class: 'rd-group' }, thumbsBtn, prevBtn, pageInput, pageTotal, nextBtn),
      h('div', { class: 'rd-group' }, zoomOut, zoomSel, zoomIn, rotateBtn, nightBtn, fsBtn),
      h('div', { class: 'rd-group rd-find' }, searchInput, hitPrev, hitNext, searchCount));

    /* ---- viewer ---- */
    const thumbs = h('div', { class: 'rd-thumbs', hidden: true, role: 'navigation', 'aria-label': 'Page thumbnails' });
    const pagesBox = h('div', { class: 'rd-pages' });
    const scroller = h('div', { class: 'rd-scroll', tabindex: 0, role: 'region', 'aria-label': `PDF pages: ${file.name}` }, pagesBox);
    const body = h('div', { class: 'rd-body' }, thumbs, scroller);
    const info = h('div', { class: 'rd-info' },
      h('span', { class: 'rd-info-text' }, h('strong', { text: file.name.length > 40 ? `${file.name.slice(0, 37)}…` : file.name, title: file.name }), ` · ${numPages} page${numPages === 1 ? '' : 's'} · ${formatBytes(file.size)}`),
      h('span', { class: 'rd-info-actions' }, closeBtn, more));
    const hint = h('p', { class: 'hint rd-hint', text: 'Tip: select text to copy it, use + and − to zoom, and Ctrl+F to search. Pinch to zoom on a touch screen.' });
    const wrap = h('div', { class: 'rd' }, bar, body, info, hint);
    stage.replaceChildren(wrap); stage.hidden = false;
    root.closest('.tool-panel')?.classList.add('rd-panel');
    root.closest('.tool-layout')?.classList.add('rd-wide'); // give the viewer the full width; the side notes move underneath

    for (let n = 1; n <= numPages; n++) {
      const el = h('div', { class: 'rd-page', 'data-page': n, role: 'group', 'aria-label': `Page ${n} of ${numPages}` });
      el.append(h('span', { class: 'rd-ph', 'aria-hidden': 'true', text: String(n) }));
      pages.push({ n, el, w0: 612, h0: 792, sized: false, state: 'idle', token: 0, visible: false, renderedKey: '' });
      pagesBox.append(el);
    }

    /* ---- layout ---- */
    const availW = () => Math.max(120, scroller.clientWidth - 32);
    const availH = () => Math.max(120, scroller.clientHeight - 28);
    const dims = (pv: PageView) => (rotation % 180 ? { w: pv.h0, h: pv.w0 } : { w: pv.w0, h: pv.h0 });
    const scaleOf = (pv: PageView) => {
      const d = dims(pv);
      return effectiveZoom(zoom, d.w, d.h, availW(), availH()) * PDF_PX_PER_PT;
    };
    const applySize = (pv: PageView) => {
      const s = scaleOf(pv), d = dims(pv);
      const w = Math.round(d.w * s), hh = Math.round(d.h * s);
      if (pv.el.style.width !== `${w}px` || pv.el.style.height !== `${hh}px`) { pv.el.style.width = `${w}px`; pv.el.style.height = `${hh}px`; }
    };
    const anchor = () => {
      const top = scroller.scrollTop; const pv = pages.find((p) => p.el.offsetTop + p.el.offsetHeight > top) ?? pages[0];
      return { pv, frac: pv.el.offsetHeight ? (top - pv.el.offsetTop) / pv.el.offsetHeight : 0 };
    };
    const restore = (a: { pv: PageView; frac: number }) => { scroller.scrollTop = a.pv.el.offsetTop + a.frac * a.pv.el.offsetHeight; };
    const updateZoomUi = () => {
      const z = effectiveZoom(zoom, dims(pages[currentPage - 1]).w, dims(pages[currentPage - 1]).h, availW(), availH());
      const key = typeof zoom === 'number' ? String(zoom) : zoom;
      let opt = [...zoomSel.options].find((o) => o.value === key);
      if (!opt) { opt = h('option', { value: key, text: `${Math.round(z * 100)}%` }); zoomSel.append(opt); }
      else if (typeof zoom !== 'number') opt.text = zoom === 'width' ? 'Fit width' : 'Fit page';
      zoomSel.value = key;
      zoomOut.disabled = z <= 0.25 + 1e-6; zoomIn.disabled = z >= 4 - 1e-6;
    };
    function relayout(rerender: boolean) {
      const a = anchor();
      pages.forEach(applySize);
      restore(a);
      if (rerender) for (const pv of pages) { if (pv.state !== 'idle') releasePage(pv); if (pv.visible) schedule(pv); }
      updateZoomUi();
    }
    function setZoom(z: ZoomMode) { zoom = typeof z === 'number' ? clampZoom(z) : z; relayout(true); }
    function stepZoom(dir: 1 | -1) {
      const pv = pages[currentPage - 1]; const d = dims(pv);
      setZoom(nextZoomStep(effectiveZoom(zoom, d.w, d.h, availW(), availH()), dir));
    }
    zoomSel.addEventListener('change', () => { const v = zoomSel.value; setZoom(v === 'width' || v === 'page' ? v : Number(v)); });

    /* ---- text (shared by search and the selectable text layer) ---- */
    const getText = (n: number): Promise<TextContent> => {
      let p = textCache.get(n);
      if (!p) { p = pdf.getPage(n).then((pg) => pg.getTextContent()); textCache.set(n, p); }
      return p;
    };

    /* ---- rendering (only pages near the viewport are drawn; the rest are released to save memory) ---- */
    function releasePage(pv: PageView) {
      pv.token++; try { pv.task?.cancel(); } catch { /* already done */ }
      pv.task = undefined; pv.textLayer = undefined; pv.state = 'idle'; pv.renderedKey = '';
      pv.el.querySelectorAll('canvas').forEach((c) => { c.width = c.height = 0; });
      pv.el.querySelectorAll('.rd-inner').forEach((n) => n.remove());
      queue.delete(pv);
    }
    function schedule(pv: PageView) { if (pv.state === 'idle' || pv.renderedKey !== renderKey(pv)) { queue.add(pv); void pump(); } }
    const renderKey = (pv: PageView) => `${scaleOf(pv).toFixed(4)}|${rotation}`;
    async function pump() {
      if (pumping) return; pumping = true;
      try {
        while (queue.size && !destroyed) {
          let best: PageView | null = null;
          for (const pv of queue) if (!best || Math.abs(pv.n - currentPage) < Math.abs(best.n - currentPage)) best = pv;
          queue.delete(best!);
          if (best!.visible) await renderPage(best!);
        }
      } finally { pumping = false; }
    }
    async function renderPage(pv: PageView) {
      const token = ++pv.token; pv.state = 'rendering';
      const stale = () => destroyed || token !== pv.token;
      try {
        const page = await pdf.getPage(pv.n); if (stale()) return;
        const base = page.getViewport({ scale: 1, rotation: page.rotate });
        if (!pv.sized || Math.abs(base.width - pv.w0) > 0.5 || Math.abs(base.height - pv.h0) > 0.5) { pv.w0 = base.width; pv.h0 = base.height; pv.sized = true; applySize(pv); }
        const sc = scaleOf(pv);
        const vp = page.getViewport({ scale: sc, rotation: (page.rotate + rotation) % 360 });
        const out = pixelRatioFor(vp.width, vp.height, window.devicePixelRatio || 1);
        const canvas = h('canvas', { 'aria-hidden': 'true' });
        canvas.width = Math.max(1, Math.floor(vp.width * out)); canvas.height = Math.max(1, Math.floor(vp.height * out));
        canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Your browser could not start its drawing surface.');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const task = page.render({ canvasContext: ctx, viewport: vp, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined, background: 'rgb(255,255,255)' });
        pv.task = task; await task.promise; if (stale()) return;
        const textDiv = h('div', { class: 'rd-text' }); textDiv.style.setProperty('--scale-factor', String(vp.scale));
        const inner = h('div', { class: 'rd-inner' }, canvas, textDiv);
        pv.el.append(inner);
        let layer: InstanceType<typeof TextLayer> | undefined;
        try { layer = new TextLayer({ textContentSource: await getText(pv.n), container: textDiv, viewport: vp }); await layer.render(); } catch { layer = undefined; } // a page without readable text still displays
        if (stale()) { inner.remove(); return; }
        pv.el.querySelectorAll('.rd-inner').forEach((n) => { if (n !== inner) n.remove(); });
        pv.el.querySelector('.rd-ph')?.setAttribute('hidden', '');
        pv.textLayer = layer; pv.state = 'done'; pv.renderedKey = renderKey(pv); pv.task = undefined;
        applyHighlights(pv);
        if (pendingFocus && pendingFocus.page === pv.n) { const m = pendingFocus; pendingFocus = null; focusHit(pv, m.k); }
      } catch (e) {
        if ((e as { name?: string })?.name === 'RenderingCancelledException' || stale()) return;
        pv.state = 'idle';
        pv.el.querySelector('.rd-ph')?.replaceWith(h('span', { class: 'rd-ph rd-ph-err', text: 'This page could not be displayed.' }));
      }
    }

    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const pv = pages[Number((en.target as HTMLElement).dataset.page) - 1];
        pv.visible = en.isIntersecting;
        if (en.isIntersecting) schedule(pv); else if (pv.state !== 'idle') releasePage(pv);
      }
    }, { root: scroller, rootMargin: '120% 0px' });
    pages.forEach((pv) => io.observe(pv.el));

    /* ---- current page tracking and navigation ---- */
    let raf = 0;
    const trackPage = () => {
      raf = 0;
      const mid = scroller.scrollTop + scroller.clientHeight * 0.35;
      let n = currentPage;
      for (const pv of pages) { if (pv.el.offsetTop <= mid && pv.el.offsetTop + pv.el.offsetHeight + GAP > mid) { n = pv.n; break; } }
      if (n !== currentPage) { currentPage = n; syncPageUi(); }
    };
    scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(trackPage); }, { passive: true });
    function syncPageUi() {
      if (document.activeElement !== pageInput) pageInput.value = String(currentPage);
      prevBtn.disabled = currentPage <= 1; nextBtn.disabled = currentPage >= numPages;
      thumbs.querySelectorAll('[aria-current]').forEach((n) => n.removeAttribute('aria-current'));
      const t = thumbs.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
      if (t) { t.setAttribute('aria-current', 'page'); if (!thumbs.hidden) t.scrollIntoView({ block: 'nearest' }); }
    }
    function goToPage(n: number) {
      const t = Math.min(numPages, Math.max(1, Math.round(n) || 1));
      scroller.scrollTo({ top: pages[t - 1].el.offsetTop - 8, behavior: 'auto' });
      currentPage = t; syncPageUi();
    }
    const commitPageInput = () => { goToPage(Number(pageInput.value)); };
    pageInput.addEventListener('change', commitPageInput);
    pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitPageInput(); scroller.focus(); } });

    /* ---- thumbnails ---- */
    let thumbIo: IntersectionObserver | null = null;
    function toggleThumbs() {
      thumbs.hidden = !thumbs.hidden; thumbsBtn.setAttribute('aria-pressed', String(!thumbs.hidden));
      wrap.classList.toggle('rd-with-thumbs', !thumbs.hidden);
      if (!thumbs.hidden && !thumbIo) initThumbs();
      if (!thumbs.hidden) syncPageUi();
      requestAnimationFrame(() => relayout(zoom === 'width' || zoom === 'page'));
    }
    function initThumbs() {
      const done = new Set<number>();
      thumbIo = new IntersectionObserver(async (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue; const el = en.target as HTMLElement; const n = Number(el.dataset.thumb);
          if (done.has(n)) continue; done.add(n); thumbIo?.unobserve(el);
          try {
            const page = await pdf.getPage(n); const base = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: 96 / base.width });
            const c = h('canvas', { 'aria-hidden': 'true' }); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            const ctx = c.getContext('2d', { alpha: false }); if (!ctx) continue;
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
            el.querySelector('.rd-thumb-ph')?.replaceWith(c);
          } catch { /* thumbnail is optional */ }
        }
      }, { root: thumbs, rootMargin: '200px 0px' });
      for (let n = 1; n <= numPages; n++) {
        const b = h('button', { type: 'button', class: 'rd-thumb', 'data-thumb': n, 'aria-label': `Go to page ${n}`, onclick: () => goToPage(n) }, h('span', { class: 'rd-thumb-ph', style: 'aspect-ratio:8.5/11' }), h('span', { class: 'rd-thumb-n', text: String(n) }));
        thumbs.append(b); thumbIo.observe(b);
      }
      syncPageUi();
    }

    /* ---- search ---- */
    function applyHighlights(pv: PageView) {
      const layer = pv.textLayer; if (!layer) return;
      const divs = layer.textDivs, strs = layer.textContentItemsStr; let k = 0;
      const curK = cur >= 0 && matches[cur]?.page === pv.n ? matches[cur].k : -1;
      for (let i = 0; i < divs.length; i++) {
        const s = strs[i]; const div = divs[i]; if (!s || !div) continue;
        const hits = query ? findInText(s, query) : [];
        if (!hits.length) { if (div.dataset.hl) { div.textContent = s; delete div.dataset.hl; } continue; }
        const frag = document.createDocumentFragment(); let pos = 0;
        for (const at of hits) {
          if (at > pos) frag.append(s.slice(pos, at));
          const m = h('mark', { class: k === curK ? 'rd-hit rd-hit-cur' : 'rd-hit', 'data-k': k }); m.textContent = s.slice(at, at + query.length); frag.append(m);
          pos = at + query.length; k++;
        }
        if (pos < s.length) frag.append(s.slice(pos));
        div.replaceChildren(frag); div.dataset.hl = '1';
      }
    }
    function focusHit(pv: PageView, k: number) {
      pv.el.querySelectorAll('.rd-hit-cur').forEach((n) => n.classList.remove('rd-hit-cur'));
      const el = pv.el.querySelector<HTMLElement>(`mark[data-k="${k}"]`);
      if (el) { el.classList.add('rd-hit-cur'); el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    }
    function showMatch(i: number) {
      cur = i; const m = matches[i];
      searchCount.textContent = `${i + 1} of ${matches.length}`;
      const pv = pages[m.page - 1];
      if (pv.state === 'done') { applyHighlights(pv); goToPage(m.page); focusHit(pv, m.k); }
      else { pendingFocus = m; goToPage(m.page); }
    }
    function stepMatch(dir: 1 | -1) { if (matches.length) showMatch((cur + dir + matches.length) % matches.length); }
    async function runSearch(raw: string) {
      const my = ++searchToken; const q = raw.trim().toLowerCase();
      query = q; matches = []; cur = -1; pendingFocus = null; hitPrev.disabled = hitNext.disabled = true;
      pages.forEach((pv) => { if (pv.state === 'done') applyHighlights(pv); });
      if (!q) { searchCount.textContent = ''; return; }
      searchCount.textContent = 'Searching…'; let anyText = false;
      try {
        for (let n = 1; n <= numPages; n++) {
          const tc = await getText(n); if (my !== searchToken || destroyed) return;
          let k = 0;
          for (const it of tc.items) { const s = (it as { str?: string }).str; if (!s) continue; if (s.trim()) anyText = true; k += findInText(s, q).length; }
          for (let j = 0; j < k; j++) matches.push({ page: n, k: j });
          if (n % 8 === 0) { searchCount.textContent = `Searching… ${Math.round((n / numPages) * 100)}%`; await new Promise((r) => setTimeout(r)); if (my !== searchToken) return; }
        }
      } catch { searchCount.textContent = 'Search failed'; return; }
      if (!matches.length) { searchCount.textContent = anyText ? 'No matches' : 'No searchable text (scanned PDF?)'; return; }
      hitPrev.disabled = hitNext.disabled = false;
      const first = matches.findIndex((m) => m.page >= currentPage);
      showMatch(first < 0 ? 0 : first);
    }
    let debounce = 0;
    searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = window.setTimeout(() => { void runSearch(searchInput.value); }, 250); });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); if (query !== searchInput.value.trim().toLowerCase()) void runSearch(searchInput.value); else stepMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { searchInput.value = ''; void runSearch(''); scroller.focus(); }
    });

    /* ---- keyboard, wheel, pinch ---- */
    wrap.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepZoom(-1); }
      else if (e.key === '0') { e.preventDefault(); setZoom('width'); }
    });
    scroller.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
    let pinchStart = 0, pinchBase = 1, pinchRatio = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    scroller.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { pinchStart = dist(e.touches); const pv = pages[currentPage - 1]; const d = dims(pv); pinchBase = effectiveZoom(zoom, d.w, d.h, availW(), availH()); pinchRatio = 1; } }, { passive: true });
    scroller.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pinchStart) { pinchRatio = dist(e.touches) / pinchStart; pagesBox.style.transform = `scale(${Math.min(3, Math.max(0.4, pinchRatio))})`; pagesBox.style.transformOrigin = '50% 0'; } }, { passive: true });
    scroller.addEventListener('touchend', () => { if (pinchStart) { pinchStart = 0; pagesBox.style.transform = ''; if (Math.abs(pinchRatio - 1) > 0.04) setZoom(pinchBase * pinchRatio); } }, { passive: true });

    const ro = new ResizeObserver(() => { if (destroyed) return; if (zoom === 'width' || zoom === 'page') relayout(true); });
    ro.observe(scroller);
    closeBtn.addEventListener('click', () => { teardown?.(); teardown = null; stage.hidden = true; stage.replaceChildren(); open.hidden = false; status.clear(); });

    /* ---- background: learn the real size of every page so the scroll height is right, without blocking the first view ---- */
    void (async () => {
      for (let n = 1; n <= numPages && !destroyed; n++) {
        const pv = pages[n - 1];
        try {
          const page = await pdf.getPage(n); const v = page.getViewport({ scale: 1, rotation: page.rotate });
          if (!pv.sized || Math.abs(v.width - pv.w0) > 0.5 || Math.abs(v.height - pv.h0) > 0.5) {
            const oldH = pv.el.offsetHeight; pv.w0 = v.width; pv.h0 = v.height; pv.sized = true; applySize(pv);
            const delta = pv.el.offsetHeight - oldH;
            if (delta && n < currentPage) scroller.scrollTop += delta; // keep what you are reading in place
          } else pv.sized = true;
        } catch { /* leave the default size */ }
        if (n === 1) { relayout(false); trackPage(); }
        if (n % 12 === 0) await new Promise((r) => setTimeout(r));
      }
    })();

    // Default layout before the first page size is known, then start the first render.
    pages.forEach(applySize); updateZoomUi(); syncPageUi();
    if (scroller.clientWidth >= 900) requestAnimationFrame(() => { if (!destroyed && thumbs.hidden) toggleThumbs(); });
    scroller.focus({ preventScroll: true });

    // Tools have no unmount hook: when this screen is removed from the page, release the document.
    const watchdog = window.setInterval(() => { if (!root.isConnected) cleanup(); }, 1500);
    function cleanup() {
      if (destroyed) return; destroyed = true;
      clearInterval(watchdog); clearTimeout(debounce); if (raf) cancelAnimationFrame(raf);
      io.disconnect(); thumbIo?.disconnect(); ro.disconnect(); queue.clear();
      pages.forEach((pv) => { try { pv.task?.cancel(); } catch { /* ignore */ } });
      root.closest('.tool-panel')?.classList.remove('rd-panel');
      root.closest('.tool-layout')?.classList.remove('rd-wide');
      void pdf.destroy();
    }
    return cleanup;
  }
}
