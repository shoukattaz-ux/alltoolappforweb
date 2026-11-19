import { h, dropzone, field, statusArea, progressBar, selectControl, withBusy, downloadBlob, zipAndDownload, loadImage, makeCanvas, canvasToBlob, toast } from '../ui';
import { LIMITS } from '../../lib/files';
import { formatBytes, safeBaseName } from '../../lib/format';
import { setHandoff } from '../handoff';
import { PDFDocument } from '../pdf';
import { icon } from '../../app/icons';
import {
  FILTER_LABEL, FULL_FRAME, adjust, shrinkQuad, applyFilter, cloneImg, detectDocument, downscale, outputSize, pageLayout, rotateImg, warpPerspective,
  type Img, type PageSize, type Quad, type ScanFilter,
} from '../../lib/scan';

const MAX_PAGES = 40;
/** Pages are kept at this size (longest side) for editing and export; photos from modern phones are far larger than needed. */
const WORK_MAX = 2600;
/** A smaller copy is used for the on-screen preview so that every slider and button feels instant. */
const PREVIEW_MAX = 900;

interface ScanPage {
  id: number; name: string;
  /** The working-size photo, kept compressed so that dozens of pages do not exhaust a phone's memory. */
  blob: Blob;
  preview: HTMLCanvasElement;
  corners: Quad; detected: boolean;
  /** True while the corners came from automatic detection: those get a tiny inward trim. Corners the person placed are used exactly. */
  auto: boolean;
  turns: number; filter: ScanFilter; brightness: number; contrast: number;
  thumb: string;
}

const QUALITY = {
  small: { label: 'Smaller file', maxSide: 1500, jpeg: 0.72 },
  balanced: { label: 'Balanced (recommended)', maxSide: 2000, jpeg: 0.84 },
  best: { label: 'Best quality', maxSide: 2800, jpeg: 0.93 },
} as const;
type QualityKey = keyof typeof QUALITY;

const cornerName = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'] as const;
const tick = () => new Promise<void>((r) => setTimeout(r));
const isFullFrame = (q: Quad) => q.every((p, i) => Math.abs(p.x - FULL_FRAME[i].x) < 0.004 && Math.abs(p.y - FULL_FRAME[i].y) < 0.004);
const copyQuad = (q: Quad): Quad => q.map((p) => ({ ...p })) as Quad;

/** Run a page through the whole pipeline (straighten, rotate, clean up) and return it as a canvas. */
function processToCanvas(src: HTMLCanvasElement, p: Pick<ScanPage, 'corners' | 'auto' | 'turns' | 'filter' | 'brightness' | 'contrast'>, maxSide: number): HTMLCanvasElement {
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const raw = ctx.getImageData(0, 0, src.width, src.height);
  const img: Img = { data: raw.data, width: raw.width, height: raw.height };
  let out: Img;
  if (isFullFrame(p.corners)) out = img.width > maxSide || img.height > maxSide ? downscale(img, maxSide) : cloneImg(img);
  else {
    const corners = p.auto ? shrinkQuad(p.corners, 0.98) : p.corners;
    const px = corners.map((c) => ({ x: c.x * (img.width - 1), y: c.y * (img.height - 1) })) as Quad;
    const size = outputSize(px, maxSide); out = warpPerspective(img, px, size.width, size.height);
  }
  out = rotateImg(out, p.turns);
  applyFilter(out, p.filter); adjust(out, p.brightness, p.contrast);
  const canvas = makeCanvas(out.width, out.height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
  return canvas;
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(blob); const c = makeCanvas(img.width, img.height);
  c.getContext('2d')!.drawImage(img.source, 0, 0); img.source.close?.(); return c;
}

/* ===================================================================================== corner editor ===================================================================================== */

/** A dialog to drag the four corners of the page. Resolves with the new corners, or null if cancelled. */
function editCorners(page: ScanPage): Promise<Quad | null> {
  return new Promise((resolve) => {
    let quad = copyQuad(page.corners); let done = false;
    const finish = (v: Quad | null) => { if (done) return; done = true; dialog.close(); resolve(v); };
    const title = h('h2', { id: 'sc-crop-title', text: 'Adjust the page corners' });
    const hint = h('p', { class: 'hint', text: 'Drag each round handle to a corner of the page. With a keyboard, focus a handle and use the arrow keys (hold Shift for bigger steps).' });
    const canvas = h('canvas', { class: 'sc-crop-canvas', role: 'img', 'aria-label': 'Photo of the page' });
    canvas.width = page.preview.width; canvas.height = page.preview.height; canvas.getContext('2d')!.drawImage(page.preview, 0, 0);
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg'); svg.setAttribute('class', 'sc-crop-svg'); svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const poly = document.createElementNS(svgNs, 'polygon'); poly.setAttribute('class', 'sc-crop-poly'); svg.append(poly);
    const wrap = h('div', { class: 'sc-crop-wrap' }, canvas, svg);
    const handles = quad.map((_, i) => {
      const b = h('button', { type: 'button', class: 'sc-handle', 'aria-label': `${cornerName[i]} corner`, 'data-corner': i });
      wrap.append(b); return b;
    });
    const layout = () => {
      poly.setAttribute('points', quad.map((p) => `${p.x},${p.y}`).join(' '));
      handles.forEach((b, i) => { b.style.left = `${quad[i].x * 100}%`; b.style.top = `${quad[i].y * 100}%`; });
    };
    handles.forEach((b, i) => {
      const move = (nx: number, ny: number) => { quad[i] = { x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) }; layout(); };
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); b.classList.add('active'); e.preventDefault(); });
      b.addEventListener('pointermove', (e) => { if (!b.hasPointerCapture(e.pointerId)) return; const r = wrap.getBoundingClientRect(); move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
      const up = (e: PointerEvent) => { if (b.hasPointerCapture(e.pointerId)) b.releasePointerCapture(e.pointerId); b.classList.remove('active'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      b.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.02 : 0.004; let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step; else if (e.key === 'ArrowRight') dx = step; else if (e.key === 'ArrowUp') dy = -step; else if (e.key === 'ArrowDown') dy = step; else return;
        e.preventDefault(); move(quad[i].x + dx, quad[i].y + dy);
      });
    });
    const autoBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { const d = detectDocument(imageOf(page.preview)); quad = copyQuad(d.corners); layout(); status.textContent = d.found ? 'Page edges found.' : 'No clear page edges found, so the whole photo is selected.'; } }, 'Find edges again');
    const wholeBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { quad = copyQuad(FULL_FRAME); layout(); status.textContent = 'Whole photo selected.'; } }, 'Use whole photo');
    const status = h('p', { class: 'hint', 'aria-live': 'polite' });
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => finish(null) }, 'Cancel');
    const apply = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => finish(copyQuad(quad)) }, 'Apply');
    const dialog = h('dialog', { class: 'modal modal-wide sc-crop-dialog', 'aria-labelledby': 'sc-crop-title' }, title, hint, h('div', { class: 'sc-crop-center' }, wrap), status,
      h('div', { class: 'modal-actions' }, autoBtn, wholeBtn, cancel, apply));
    dialog.addEventListener('close', () => { dialog.remove(); finish(null); });
    document.body.append(dialog); dialog.showModal(); layout(); handles[0].focus();
  });
}

function imageOf(canvas: HTMLCanvasElement): Img {
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  return { data: d.data, width: d.width, height: d.height };
}

/* ===================================================================================== the tool ===================================================================================== */

export function mount(root: HTMLElement) {
  const pages: ScanPage[] = [];
  let sel = 0; let seq = 0; let lastImages: { name: string; blob: Blob }[] = []; let lastPdf: File | null = null;
  const status = statusArea(); const progress = progressBar();

  /* ---- adding photos ---- */
  const addFiles = async (files: File[]) => {
    const errors: string[] = []; // (the status area is not cleared here: the file picker may just have written a message to it)
    for (const file of files) {
      if (pages.length >= MAX_PAGES) { errors.push(`A scan can have up to ${MAX_PAGES} pages; the rest were skipped.`); break; }
      try {
        progress.set(0, 1, `Preparing ${file.name.slice(0, 40)}…`); await tick();
        const img = await loadImage(file);
        const k = Math.min(1, WORK_MAX / Math.max(img.width, img.height));
        const work = makeCanvas(img.width * k, img.height * k); work.getContext('2d')!.drawImage(img.source, 0, 0, work.width, work.height); img.source.close?.();
        const blob = await canvasToBlob(work, 'image/jpeg', 0.92);
        const pk = Math.min(1, PREVIEW_MAX / Math.max(work.width, work.height));
        const preview = makeCanvas(work.width * pk, work.height * pk); preview.getContext('2d')!.drawImage(work, 0, 0, preview.width, preview.height);
        work.width = work.height = 0;
        const det = detectDocument(imageOf(preview));
        const page: ScanPage = { id: ++seq, name: file.name, blob, preview, corners: det.corners, detected: det.found, auto: det.found, turns: 0, filter: 'magic', brightness: 0, contrast: 0, thumb: '' };
        pages.push(page); sel = pages.length - 1; page.thumb = thumbOf(page);
        renderAll(); await tick();
      } catch (e) { errors.push(`"${file.name.slice(0, 40)}": ${e instanceof Error ? e.message : 'could not be read'}`); }
    }
    progress.hide();
    if (errors.length) status.show('error', ['Some photos could not be added:', ...errors]);
  };

  const dz = dropzone({
    kinds: ['jpeg', 'png', 'webp'], multiple: true, maxBytes: LIMITS.imageBytes, maxFiles: MAX_PAGES, existing: () => pages.length, title: 'Drop photos of your pages here',
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', ['Some files were not added:', ...e]); },
    onFiles: (files) => addFiles(files.map((f) => f.file)),
  });
  // On a phone, this opens the camera app directly (no camera permission is needed, the camera app takes the photo).
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });
  cameraInput.addEventListener('change', async () => { await dz.handle([...(cameraInput.files ?? [])]); cameraInput.value = ''; });
  const cameraBtn = h('button', { type: 'button', class: 'btn btn-primary sc-camera', onclick: () => cameraInput.click() });
  cameraBtn.innerHTML = `${icon('scan', 18)} Take a photo`;
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  const startRow = h('div', { class: 'sc-start' }, dz.el, touch ? h('div', { class: 'sc-start-cam' }, cameraBtn, h('span', { class: 'hint', text: 'Opens your camera. Put the page on a darker surface with good light.' })) : null, cameraInput);

  /* ---- workspace ---- */
  const strip = h('ul', { class: 'sc-strip', 'aria-label': 'Pages' });
  const previewCanvas = h('canvas', { class: 'sc-preview', role: 'img' });
  const edgeNote = h('p', { class: 'sc-note', 'aria-live': 'polite' });
  const previewBox = h('div', { class: 'sc-preview-box' }, previewCanvas);

  const mkBtn = (label: string, ic: string, fn: () => void, cls = 'btn btn-secondary btn-small') => { const b = h('button', { type: 'button', class: cls, onclick: fn }); b.innerHTML = `${icon(ic, 16)}<span>${label}</span>`; return b; };
  const cornersBtn = mkBtn('Adjust corners', 'crop', async () => { const p = pages[sel]; const q = await editCorners(p); if (q) { p.corners = q; p.detected = true; p.auto = false; refreshPage(); } });
  const autoBtn = mkBtn('Find edges', 'sparkles', () => { const p = pages[sel]; const d = detectDocument(imageOf(p.preview)); p.corners = d.corners; p.detected = d.found; p.auto = d.found; refreshPage(); });
  const rotL = mkBtn('Rotate left', 'rotate', () => { pages[sel].turns = (pages[sel].turns + 3) % 4; refreshPage(); });
  const rotR = mkBtn('Rotate right', 'rotate', () => { pages[sel].turns = (pages[sel].turns + 1) % 4; refreshPage(); });
  rotL.querySelector('svg')!.style.transform = 'scaleX(-1)';
  const earlier = mkBtn('Move earlier', 'up', () => movePage(-1));
  const later = mkBtn('Move later', 'down', () => movePage(1));
  const del = mkBtn('Delete page', 'trash', () => { pages.splice(sel, 1); sel = Math.min(sel, pages.length - 1); lastPdf = null; renderAll(); });
  const addMore = h('div', { class: 'sc-add' });

  const filterBtns = (Object.keys(FILTER_LABEL) as ScanFilter[]).map((f) => h('button', { type: 'button', 'aria-pressed': 'false', 'data-filter': f, onclick: () => { pages[sel].filter = f; refreshPage(); } }, FILTER_LABEL[f]));
  const filterSeg = h('div', { class: 'seg sc-seg', role: 'group', 'aria-label': 'Clean-up style' }, ...filterBtns);
  const slider = (label: string, key: 'brightness' | 'contrast') => {
    const input = h('input', { type: 'range', min: -100, max: 100, step: 5, value: 0 }); const out = h('output', { text: '0' });
    let raf = 0;
    input.addEventListener('input', () => { pages[sel][key] = Number(input.value); out.textContent = input.value; if (!raf) raf = requestAnimationFrame(() => { raf = 0; refreshPage(); }); });
    const el = h('div', { class: 'field' }, h('div', { class: 'range-out' }, h('label', { for: `sc-${key}`, text: label }), out), input); input.id = `sc-${key}`;
    return { el, input, out };
  };
  const bright = slider('Brightness', 'brightness'); const contr = slider('Contrast', 'contrast');
  const applyAll = h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { const s = pages[sel]; pages.forEach((p) => { p.filter = s.filter; p.brightness = s.brightness; p.contrast = s.contrast; p.thumb = thumbOf(p); }); lastPdf = null; renderAll(); toast('This clean-up style was applied to every page.'); } }, 'Use this style for all pages');

  const controls = h('div', { class: 'sc-controls' },
    h('div', { class: 'sc-group' }, h('h2', { text: 'This page' }), h('div', { class: 'sc-btns' }, cornersBtn, autoBtn, rotL, rotR), h('div', { class: 'sc-btns' }, earlier, later, del)),
    h('div', { class: 'sc-group' }, h('h2', { text: 'Clean-up' }), filterSeg, bright.el, contr.el, applyAll));

  /* ---- export ---- */
  const sizeSel = selectControl([['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Fit to the scan']], 'a4');
  const marginSel = selectControl([['0', 'None'], ['18', 'Small'], ['36', 'Normal']], '0');
  const qualitySel = selectControl((Object.keys(QUALITY) as QualityKey[]).map((k) => [k, QUALITY[k].label] as [string, string]), 'balanced');
  const nameInput = h('input', { type: 'text', value: 'scan', maxlength: 80, autocomplete: 'off' });
  const makeBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' }, 'Create PDF');
  const result = h('div', { class: 'sc-result', hidden: true });
  const exportBox = h('div', { class: 'sc-export' }, h('h2', { text: 'Make the PDF' }),
    h('div', { class: 'row' }, field('Page size', sizeSel), field('Margin', marginSel), field('Quality', qualitySel)), field('File name', nameInput), h('div', { class: 'actions' }, makeBtn));

  const more = h('input', { type: 'file', accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp', multiple: true, class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });
  more.addEventListener('change', async () => { await dz.handle([...(more.files ?? [])]); more.value = ''; });
  const work = h('div', { class: 'sc-work', hidden: true },
    strip,
    h('div', { class: 'sc-editor' }, h('div', { class: 'sc-left' }, previewBox, edgeNote), controls),
    addMore, exportBox, more);

  /* ---- rendering ---- */
  function thumbOf(p: ScanPage): string {
    const c = processToCanvas(p.preview, p, 160); const url = c.toDataURL('image/jpeg', 0.7); c.width = c.height = 0; return url;
  }
  function renderStrip() {
    strip.replaceChildren(...pages.map((p, i) => {
      const b = h('button', { type: 'button', class: 'sc-thumb', 'aria-label': `Page ${i + 1} of ${pages.length}`, 'aria-pressed': String(i === sel), onclick: () => { sel = i; renderAll(); } },
        h('img', { src: p.thumb, alt: '' }), h('span', { class: 'sc-thumb-n', text: String(i + 1) }));
      return h('li', null, b);
    }));
  }
  function renderPreview() {
    const p = pages[sel]; if (!p) return;
    const out = processToCanvas(p.preview, p, PREVIEW_MAX);
    previewCanvas.width = out.width; previewCanvas.height = out.height; previewCanvas.getContext('2d')!.drawImage(out, 0, 0); out.width = out.height = 0;
    previewCanvas.setAttribute('aria-label', `Preview of page ${sel + 1}, ${FILTER_LABEL[p.filter]} style`);
    edgeNote.textContent = p.detected ? (isFullFrame(p.corners) ? 'Using the whole photo.' : 'Page edges found and straightened. Use "Adjust corners" if they are off.') : 'No clear page edges found, so the whole photo is used. Use "Adjust corners" to select the page.';
    edgeNote.classList.toggle('sc-note-warn', !p.detected);
    filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === p.filter)));
    bright.input.value = String(p.brightness); bright.out.textContent = String(p.brightness); contr.input.value = String(p.contrast); contr.out.textContent = String(p.contrast);
    earlier.disabled = sel === 0; later.disabled = sel === pages.length - 1;
  }
  function renderAdd() {
    addMore.replaceChildren(h('p', { class: 'muted', text: `${pages.length} page${pages.length === 1 ? '' : 's'}. ` }),
      h('div', { class: 'sc-add-btns' }, mkBtn('Add more photos', 'upload', () => more.click(), 'btn btn-secondary'), touch ? mkBtn('Take another photo', 'scan', () => cameraInput.click(), 'btn btn-secondary') : null,
        mkBtn('Start over', 'trash', () => { pages.length = 0; sel = 0; lastPdf = null; lastImages = []; result.hidden = true; status.clear(); renderAll(); }, 'btn btn-ghost')));
  }

  function renderAll() {
    const has = pages.length > 0; work.hidden = !has; dz.el.hidden = has; startRow.classList.toggle('sc-start-compact', has);
    if (touch) startRow.querySelector<HTMLElement>('.sc-start-cam')?.toggleAttribute('hidden', has);
    if (!has) { result.hidden = true; strip.replaceChildren(); previewCanvas.width = previewCanvas.height = 0; return; }
    renderStrip(); renderPreview(); renderAdd();
  }
  function refreshPage() { const p = pages[sel]; p.thumb = thumbOf(p); lastPdf = null; result.hidden = true; renderStrip(); renderPreview(); }
  function movePage(d: number) { const j = sel + d; if (j < 0 || j >= pages.length) return; [pages[sel], pages[j]] = [pages[j], pages[sel]]; sel = j; lastPdf = null; renderAll(); }

  /* ---- creating the PDF ---- */
  makeBtn.addEventListener('click', () => withBusy(makeBtn, 'Creating PDF…', async () => {
    status.clear(); result.hidden = true; lastImages = [];
    try {
      const q = QUALITY[qualitySel.value as QualityKey]; const size = sizeSel.value as PageSize; const margin = Number(marginSel.value);
      const base = safeBaseName(nameInput.value, 'scan');
      const doc = await PDFDocument.create(); doc.setTitle(base); doc.setCreator('ToolHaven'); doc.setProducer('ToolHaven');
      for (let i = 0; i < pages.length; i++) {
        progress.set(i, pages.length, `Processing page ${i + 1} of ${pages.length}…`); await tick();
        const src = await blobToCanvas(pages[i].blob);
        const out = processToCanvas(src, pages[i], q.maxSide); src.width = src.height = 0;
        const jpg = await canvasToBlob(out, 'image/jpeg', q.jpeg); const lay = pageLayout(size, margin, out.width, out.height); out.width = out.height = 0;
        lastImages.push({ name: `${base}-page-${String(i + 1).padStart(2, '0')}.jpg`, blob: jpg });
        const embedded = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
        doc.addPage([lay.pageW, lay.pageH]).drawImage(embedded, { x: lay.x, y: lay.y, width: lay.w, height: lay.h });
      }
      progress.set(pages.length, pages.length, 'Saving the PDF…'); await tick();
      const bytes = await doc.save(); lastPdf = new File([bytes as BlobPart], `${base}.pdf`, { type: 'application/pdf' });
      showResult();
    } catch (e) { status.show('error', ['The PDF could not be created.', e instanceof Error ? e.message : 'Try fewer pages or the "Smaller file" quality.']); }
    finally { progress.hide(); }
  }));

  function showResult() {
    if (!lastPdf) return; const f = lastPdf;
    const dl = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => downloadBlob(f, f.name) }, 'Download PDF');
    const read = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { setHandoff([f]); location.hash = '#/tool/pdf-reader'; } }, 'Open in PDF Reader');
    const ocr = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { setHandoff([f]); location.hash = '#/tool/extract-text'; } }, 'Extract the text (OCR)');
    const zip = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => withBusy(zip, 'Building ZIP…', () => zipAndDownload(lastImages, `${safeBaseName(f.name, 'scan')}-pages.zip`)) }, 'Download pages as images');
    result.replaceChildren(h('div', { class: 'notice notice-success', role: 'status' }, h('span', { text: `Your ${pages.length}-page PDF is ready (${formatBytes(f.size)}).` })), h('div', { class: 'actions' }, dl, read, ocr, zip)); result.hidden = false;
  }

  root.closest('.tool-panel')?.classList.add('rd-panel');
  root.closest('.tool-layout')?.classList.add('rd-wide'); // give the editor the full width; the side notes move underneath
  root.append(startRow, status.el, progress.el, work, result);
}
