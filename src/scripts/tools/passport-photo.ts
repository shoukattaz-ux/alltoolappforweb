import { h, dropzone, field, statusArea, withBusy, downloadBlob, loadImage, makeCanvas, canvasToBlob, selectControl, type LoadedImage } from '../ui';
import { PDFDocument } from '../pdf';
import { rgb } from 'pdf-lib';
import { LIMITS } from '../../lib/files';
import { formatBytes, safeBaseName } from '../../lib/format';
import { PHOTO_SIZES, PAPERS, mmToPx, mmToPt, cropRect, sheetLayout, replaceBackground, setJpegDpi } from '../../lib/idphoto';
import { fitToSize, parseSize, type Step } from '../../lib/targetSize';

const DPI = 300;
const PREVIEW_W = 480;
const BACKGROUNDS: Record<string, [number, number, number] | null> = { keep: null, white: [255, 255, 255], blue: [219, 233, 245], grey: [236, 236, 236] };
const fmtMm = (n: number) => `${+n.toFixed(1)}`;

export function mount(root: HTMLElement) {
  let file: File | null = null, img: LoadedImage | null = null;
  let zoom = 1, cx = 0, cy = 0;
  const status = statusArea();
  const info = h('p', { class: 'muted', hidden: true });
  const editor = h('div', { hidden: true });

  const sizeSel = selectControl([...PHOTO_SIZES.map((s) => [s.id, s.label] as [string, string]), ['custom', 'Custom size (mm)…']], '35x45');
  const sizeNote = h('p', { class: 'hint', 'aria-live': 'polite' });
  const customW = h('input', { type: 'number', min: 10, max: 200, step: 0.5, value: 35, inputmode: 'decimal' });
  const customH = h('input', { type: 'number', min: 10, max: 200, step: 0.5, value: 45, inputmode: 'decimal' });
  const customRow = h('div', { class: 'row', hidden: true }, field('Width (mm)', customW), field('Height (mm)', customH));
  const bgSel = selectControl([['keep', 'Keep my background'], ['white', 'White'], ['blue', 'Light blue'], ['grey', 'Light grey']], 'keep');
  const strength = h('input', { type: 'range', min: 5, max: 100, step: 1, value: 40, 'aria-label': 'Clean-up strength' });
  const strengthOut = h('output', { text: '40%' });
  const strengthWrap = h('div', { class: 'field', hidden: true }, h('div', { class: 'range-out' }, h('span', { class: 'label', text: 'Clean-up strength' }), strengthOut), strength,
    h('span', { class: 'hint', text: 'Works best on a plain wall with even light. Raise it if patches of the old background remain; lower it if the clothes or hair start to disappear.' }));
  const bgWarn = h('p', { class: 'notice notice-warn', hidden: true, role: 'status' });

  const canvas = h('canvas', { role: 'img', 'aria-label': 'Preview of the finished photo' });
  const guide = h('div', { class: 'idp-guide', 'aria-hidden': 'true' }, h('div', { class: 'idp-head' }), h('div', { class: 'idp-eyes' }));
  const stage = h('div', { class: 'idp-stage', tabindex: 0, role: 'group', 'aria-label': 'Photo position. Drag to move; arrow keys move; plus and minus zoom.' }, canvas, guide);
  const zoomIn = h('input', { type: 'range', min: 100, max: 400, step: 1, value: 100, 'aria-label': 'Zoom' });
  const guideToggle = h('input', { type: 'checkbox', checked: true });
  const sizeLimit = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 100 KB', autocomplete: 'off', maxlength: 14 });
  const paperSel = selectControl(PAPERS.map((p) => [p.id, p.label] as [string, string]), '4x6in');
  const cutToggle = h('input', { type: 'checkbox', checked: true });
  const sheetInfo = h('p', { class: 'hint', 'aria-live': 'polite' });
  const btnPhoto = h('button', { type: 'button', class: 'btn btn-primary' }, 'Download photo (JPG)');
  const btnSheetJpg = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Download sheet (JPG)');
  const btnSheetPdf = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Download sheet (PDF)');

  const current = () => {
    if (sizeSel.value === 'custom') {
      const w = Math.min(200, Math.max(10, Number(customW.value) || 35)), hh = Math.min(200, Math.max(10, Number(customH.value) || 45));
      return { id: 'custom', wMm: w, hMm: hh, note: 'Use the size your form or authority asks for.' };
    }
    return PHOTO_SIZES.find((s) => s.id === sizeSel.value) ?? PHOTO_SIZES[0];
  };

  /** Draws the framed part of the picture onto a canvas of the given pixel size, then applies the background option. */
  function renderTo(target: HTMLCanvasElement, fraction: { value: number } | null = null) {
    if (!img) return;
    const s = current();
    const r = cropRect(img.width, img.height, s.wMm / s.hMm, zoom, cx, cy);
    const ctx = target.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Your browser could not start its drawing surface.');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img.source, r.x, r.y, r.w, r.h, 0, 0, target.width, target.height);
    const bg = BACKGROUNDS[bgSel.value];
    if (bg) {
      const data = ctx.getImageData(0, 0, target.width, target.height);
      const frac = replaceBackground(data.data, target.width, target.height, Number(strength.value) * 1.5, bg);
      ctx.putImageData(data, 0, 0);
      if (fraction) fraction.value = frac;
    } else if (fraction) fraction.value = 0;
  }

  let raf = 0;
  function layoutStage() {
    const s = current();
    canvas.width = PREVIEW_W; canvas.height = Math.round(PREVIEW_W * s.hMm / s.wMm);
    stage.style.aspectRatio = `${s.wMm} / ${s.hMm}`;
    sizeNote.textContent = `${fmtMm(s.wMm)} × ${fmtMm(s.hMm)} mm = ${mmToPx(s.wMm, DPI)} × ${mmToPx(s.hMm, DPI)} px at ${DPI} DPI. ${s.note} Always check the rules of the office that asks for the photo.`;
    const L = sheetLayout(PAPERS.find((p) => p.id === paperSel.value) ?? PAPERS[0], s);
    sheetInfo.textContent = L.count ? `${L.count} photos fit on this sheet (${L.cols} × ${L.rows}${L.landscape ? ', paper turned sideways' : ''}).` : 'This photo is too big for that paper. Choose a larger sheet.';
    btnSheetJpg.disabled = btnSheetPdf.disabled = L.count === 0;
    draw();
  }
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!img) return;
      const f = { value: 0 };
      renderTo(canvas, f);
      const tooMuch = f.value > 0.85;
      bgWarn.hidden = !tooMuch;
      if (tooMuch) bgWarn.textContent = 'The clean-up removed almost the whole picture. Lower the strength, or choose "Keep my background".';
    });
  }
  const clampCentre = () => {
    if (!img) return;
    const s = current(); const r = cropRect(img.width, img.height, s.wMm / s.hMm, zoom, cx, cy);
    cx = r.x + r.w / 2; cy = r.y + r.h / 2;
  };

  for (const el of [sizeSel, customW, customH]) el.addEventListener('input', () => { customRow.hidden = sizeSel.value !== 'custom'; clampCentre(); layoutStage(); });
  bgSel.addEventListener('change', () => { strengthWrap.hidden = bgSel.value === 'keep'; draw(); });
  strength.addEventListener('input', () => { strengthOut.textContent = `${strength.value}%`; draw(); });
  paperSel.addEventListener('change', layoutStage);
  zoomIn.addEventListener('input', () => { zoom = Number(zoomIn.value) / 100; clampCentre(); draw(); });
  guideToggle.addEventListener('change', () => { guide.hidden = !guideToggle.checked; });

  // Dragging moves the picture under the frame.
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx, cy }; stage.setPointerCapture(e.pointerId); stage.classList.add('is-dragging'); e.preventDefault(); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !img) return;
    const s = current(); const r = cropRect(img.width, img.height, s.wMm / s.hMm, zoom, cx, cy);
    const k = r.w / stage.clientWidth; // image pixels per screen pixel
    cx = drag.cx - (e.clientX - drag.x) * k; cy = drag.cy - (e.clientY - drag.y) * k; clampCentre(); draw();
  });
  const endDrag = () => { drag = null; stage.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  const setZoom = (z: number) => { zoom = Math.min(4, Math.max(1, z)); zoomIn.value = String(Math.round(zoom * 100)); clampCentre(); draw(); };
  stage.addEventListener('keydown', (e) => {
    if (!img) return;
    const s = current(); const r = cropRect(img.width, img.height, s.wMm / s.hMm, zoom, cx, cy); const step = r.w * (e.shiftKey ? 0.15 : 0.04);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); cx += moves[e.key][0]; cy += moves[e.key][1]; clampCentre(); draw(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.1); }
  });

  editor.append(
    h('div', { class: 'row' }, field('Photo size', sizeSel), field('Background', bgSel)), sizeNote, customRow, strengthWrap, bgWarn,
    h('div', { class: 'idp-layout' },
      h('div', null, stage, h('label', { class: 'checkline' }, guideToggle, ' Show face guide')),
      h('div', { class: 'idp-side' },
        h('div', { class: 'field' }, h('div', { class: 'range-out' }, h('span', { class: 'label', text: 'Zoom' })), zoomIn),
        h('p', { class: 'hint', text: 'Drag the picture to position it, and zoom until the head fills the frame as the guide shows. The guide is only a help: it is not an official check.' }),
        field('File size limit (optional)', sizeLimit, 'For forms that reject big files, e.g. 100 KB or 1 MB.'),
        h('div', { class: 'actions' }, btnPhoto))),
    h('h2', { class: 'idp-h3', text: 'Print sheet' }),
    h('div', { class: 'row' }, field('Paper', paperSel), h('div', { class: 'field' }, h('span', { class: 'label', text: 'Options' }), h('label', { class: 'checkline' }, cutToggle, ' Draw thin cutting lines'))),
    sheetInfo, h('div', { class: 'actions' }, btnSheetJpg, btnSheetPdf));

  const baseName = () => safeBaseName(file?.name ?? 'photo', 'photo');
  const exportBase = () => { const s = current(); const c = makeCanvas(mmToPx(s.wMm, DPI), mmToPx(s.hMm, DPI)); renderTo(c); return c; };
  const toJpeg = async (c: HTMLCanvasElement, q: number, dpi: number) => new Blob([setJpegDpi(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', q)).arrayBuffer()), dpi) as BlobPart], { type: 'image/jpeg' });

  btnPhoto.addEventListener('click', () => withBusy(btnPhoto, 'Preparing…', async () => {
    status.clear();
    if (!img) return;
    const s = current();
    let limit: number | null = null;
    if (sizeLimit.value.trim()) { limit = parseSize(sizeLimit.value); if (limit === null || limit < 2048) { status.show('error', 'Type a size limit like 100 KB or 1 MB, or leave it empty.'); return; } }
    try {
      const base = exportBase();
      let blob: Blob, note = `${base.width} × ${base.height} px at ${DPI} DPI`, fits = true;
      if (limit === null) blob = await toJpeg(base, 0.95, DPI);
      else {
        const r = await fitToSize(async (st: Step) => {
          const c = makeCanvas(base.width * st.scale, base.height * st.scale);
          const ctx = c.getContext('2d'); if (!ctx) throw new Error('Your browser could not start its drawing surface.');
          ctx.imageSmoothingQuality = 'high'; ctx.drawImage(base, 0, 0, c.width, c.height);
          return { blob: await toJpeg(c, st.quality, DPI * st.scale), w: c.width, h: c.height };
        }, (v) => v.blob.size, limit);
        const v = r.value as { blob: Blob; w: number; h: number }; blob = v.blob; fits = r.fits;
        note = `${v.w} × ${v.h} px`;
      }
      const name = `${baseName()}-${fmtMm(s.wMm)}x${fmtMm(s.hMm)}mm.jpg`;
      downloadBlob(blob, name);
      status.show(fits ? 'success' : 'warn', fits ? `Saved ${name}: ${note}, ${formatBytes(blob.size)}.` : `Could not reach ${formatBytes(limit as number)}: the smallest version is ${formatBytes(blob.size)} (${note}). It has been saved.`);
      status.el.append(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => downloadBlob(blob, name) }, 'Download again')));
    } catch (e) { status.show('error', e instanceof Error ? e.message : 'The photo could not be created.'); }
  }));

  async function makeSheet(kind: 'jpg' | 'pdf') {
    if (!img) return;
    const s = current(); const paper = PAPERS.find((p) => p.id === paperSel.value) ?? PAPERS[0];
    const L = sheetLayout(paper, s);
    if (!L.count) { status.show('error', 'This photo is too big for that paper.'); return; }
    const base = exportBase();
    const pxmm = DPI / 25.4;
    const name = `${baseName()}-${fmtMm(s.wMm)}x${fmtMm(s.hMm)}mm-sheet-${paper.id}.${kind}`;
    if (kind === 'jpg') {
      const sheet = makeCanvas(L.paperW * pxmm, L.paperH * pxmm);
      const ctx = sheet.getContext('2d'); if (!ctx) throw new Error('Your browser could not start its drawing surface.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, sheet.width, sheet.height);
      for (const p of L.positions) {
        const x = Math.round(p.x * pxmm), y = Math.round(p.y * pxmm);
        ctx.drawImage(base, x, y, base.width, base.height);
        if (cutToggle.checked) { ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, base.width - 1, base.height - 1); }
      }
      const blob = await toJpeg(sheet, 0.93, DPI); sheet.width = sheet.height = 0;
      downloadBlob(blob, name); status.show('success', `Saved ${name}: ${L.count} photos on ${L.paperW.toFixed(0)} × ${L.paperH.toFixed(0)} mm paper, ${formatBytes(blob.size)}. Print at 100% / "actual size".`);
    } else {
      const doc = await PDFDocument.create();
      const page = doc.addPage([mmToPt(L.paperW), mmToPt(L.paperH)]);
      const jpg = await doc.embedJpg(new Uint8Array(await (await toJpeg(base, 0.95, DPI)).arrayBuffer()));
      const pw = mmToPt(s.wMm), ph = mmToPt(s.hMm);
      for (const p of L.positions) {
        const x = mmToPt(p.x), y = mmToPt(L.paperH - p.y) - ph;
        page.drawImage(jpg, { x, y, width: pw, height: ph });
        if (cutToggle.checked) page.drawRectangle({ x, y, width: pw, height: ph, borderColor: rgb(0.61, 0.64, 0.69), borderWidth: 0.5 });
      }
      const blob = new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' });
      downloadBlob(blob, name); status.show('success', `Saved ${name}: ${L.count} photos, ${formatBytes(blob.size)}. Print at 100% / "actual size".`);
    }
  }
  for (const [b, k, label] of [[btnSheetJpg, 'jpg', 'Building…'], [btnSheetPdf, 'pdf', 'Building…']] as const) {
    b.addEventListener('click', () => withBusy(b, label, async () => { status.clear(); try { await makeSheet(k); } catch (e) { status.show('error', e instanceof Error ? e.message : 'The sheet could not be created.'); } }));
  }

  const dz = dropzone({
    kinds: ['jpeg', 'png', 'webp'], multiple: false, maxBytes: LIMITS.imageBytes,
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', e.length === 1 ? e[0] : ['Problems with your file:', ...e]); },
    onFiles: async ([v]) => {
      try {
        const loaded = await loadImage(v.file);
        img?.source.close?.();
        img = loaded; file = v.file; zoom = 1; cx = img.width / 2; cy = img.height * 0.45; zoomIn.value = '100';
        status.clear(); info.hidden = editor.hidden = false;
        info.textContent = `${file.name} · ${img.width} × ${img.height} px · ${formatBytes(file.size)}`;
        clampCentre(); layoutStage();
        if (Math.min(img.width, img.height) < 600) status.show('info', 'This picture is small, so a printed photo may look soft. A sharper picture gives a better result.');
      } catch (e) { file = null; img = null; info.hidden = editor.hidden = true; status.set('error', e instanceof Error ? e.message : 'The image could not be read.'); }
    },
  });

  root.append(dz.el, info, status.el, editor);
}
