import { h, dropzone, field, statusArea, progressBar, withBusy, downloadBlob, zipAndDownload, loadImage, encodeImage, makeCanvas, canvasToBlob, selectControl, OUT_FORMATS, type OutFormat } from '../ui';
import { loadPdfLib, openPdfJs, renderPage, pdfErrorMessage, PDFDocument } from '../pdf';
import { LIMITS, type FileKind } from '../../lib/files';
import { formatBytes, safeBaseName } from '../../lib/format';
import { fitToSize, parseSize, FitCancelled, type Step } from '../../lib/targetSize';

interface Item { file: File; kind: FileKind }
interface Result { name: string; blob: Blob; original: number; target: number; fits: boolean; note: string }

const PRESETS: [string, number][] = [['20 KB', 20], ['50 KB', 50], ['100 KB', 100], ['200 KB', 200], ['500 KB', 500], ['1 MB', 1024], ['2 MB', 2048]];
const BASE_DPI = 150;

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${+(bytes / 1024 / 1024).toFixed(2)}MB` : `${Math.round(bytes / 1024)}KB`);

export function mount(root: HTMLElement) {
  const items: Item[] = [];
  let results: Result[] = [];
  let cancel = { cancelled: false };
  let presetKb = 100;
  const status = statusArea();
  const progress = progressBar();
  const list = h('ul', { class: 'file-list' });

  const chips = PRESETS.map(([label, kb]) => h('button', { type: 'button', class: 'size-chip', 'aria-pressed': String(kb === presetKb), onclick: () => { presetKb = kb; custom.value = ''; syncChips(); } }, label));
  const syncChips = () => chips.forEach((c, i) => c.setAttribute('aria-pressed', String(!custom.value.trim() && PRESETS[i][1] === presetKb)));
  const custom = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 75 KB or 1.5 MB', autocomplete: 'off', maxlength: 14 });
  custom.addEventListener('input', syncChips);
  const format = selectControl([['jpeg', 'JPG (works everywhere)'], ['webp', 'WebP (smaller at the same look)']], 'jpeg');
  const opts = h('div', { hidden: true },
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'Make each file no bigger than' }), h('div', { class: 'size-chips', role: 'group', 'aria-label': 'Size limit' }, ...chips)),
    h('div', { class: 'row' }, field('Or type your own limit', custom, 'Numbers alone count as KB.'), field('Image format', format, 'PDFs stay PDFs.')),
    h('p', { class: 'hint', text: 'The tool keeps the best quality that still fits. Photos lose detail as the limit gets smaller; a PDF over the limit is turned into page images.' }));
  const btn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Make files fit');
  const stop = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true }, 'Cancel');
  const clear = h('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, 'Clear all');
  const zipBtn = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true }, 'Download all as ZIP');
  const table = h('div', { class: 'table-wrap', hidden: true });

  const targetBytes = (): number | null => (custom.value.trim() ? parseSize(custom.value) : presetKb * 1024);

  const refresh = () => {
    list.replaceChildren(...items.map((it, i) => h('li', { class: 'file-item' },
      h('span', { class: 'fname', text: it.file.name, title: it.file.name }), h('span', { class: 'fmeta', text: formatBytes(it.file.size) }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${it.file.name}`, onclick: () => { items.splice(i, 1); refresh(); } }, '✕'))));
    btn.disabled = clear.disabled = items.length === 0;
    opts.hidden = items.length === 0;
  };
  const resetResults = () => { results = []; table.hidden = true; table.replaceChildren(); zipBtn.hidden = true; };
  const dz = dropzone({
    kinds: ['jpeg', 'png', 'webp', 'pdf'], multiple: true, maxBytes: LIMITS.pdfBytes, maxFiles: LIMITS.maxFiles, existing: () => items.length,
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', ['Some files were not added:', ...e]); },
    onFiles: (files) => {
      const ok = files.filter((f) => f.kind === 'pdf' || f.file.size <= LIMITS.imageBytes);
      if (ok.length < files.length) status.show('error', `Images must be under ${Math.round(LIMITS.imageBytes / 1024 / 1024)} MB.`);
      items.push(...ok); resetResults(); refresh();
    },
  });

  async function fitImage(it: Item, target: number, onAttempt: (n: number) => void): Promise<Result> {
    const out: OutFormat = format.value === 'webp' ? 'webp' : 'jpeg';
    const img = await loadImage(it.file);
    try {
      const r = await fitToSize((s: Step) => encodeImage(img, img.width * s.scale, img.height * s.scale, out, s.quality), (b) => b.size, target, { signal: cancel, onAttempt });
      const blob = r.value as Blob; const st = r.step as Step;
      const dims = `${Math.max(1, Math.round(img.width * st.scale))}×${Math.max(1, Math.round(img.height * st.scale))} px, quality ${Math.round(st.quality * 100)}%`;
      return { name: `${safeBaseName(it.file.name, 'image')}-${sizeLabel(target)}.${OUT_FORMATS[out].ext}`, blob, original: it.file.size, target, fits: r.fits, note: dims };
    } finally { img.source.close?.(); }
  }

  async function fitPdf(it: Item, target: number, onAttempt: (n: number) => void, say: (m: string) => void): Promise<Result> {
    const name = `${safeBaseName(it.file.name, 'document')}-${sizeLabel(target)}.pdf`;
    // 1) Try a lossless clean-up first: it keeps the text selectable.
    const doc = await loadPdfLib(it.file);
    const lossless = new Blob([(await doc.save({ useObjectStreams: true })) as BlobPart], { type: 'application/pdf' });
    if (lossless.size <= target) return { name, blob: lossless, original: it.file.size, target, fits: true, note: 'Clean-up only: text stays selectable' };
    // 2) Render each page once at a high base resolution; every attempt then re-encodes from those.
    const src = await openPdfJs(it.file);
    const pages: { blob: Blob; w: number; h: number; pxW: number; pxH: number }[] = [];
    try {
      for (let p = 1; p <= src.numPages; p++) {
        if (cancel.cancelled) throw new FitCancelled();
        say(`Reading page ${p} of ${src.numPages}`);
        const r = await renderPage(src, p, BASE_DPI / 72, '#ffffff');
        pages.push({ blob: await canvasToBlob(r.canvas, 'image/jpeg', 0.92), w: r.widthPt, h: r.heightPt, pxW: r.canvas.width, pxH: r.canvas.height });
        r.canvas.width = r.canvas.height = 0;
      }
    } finally { await src.destroy(); }
    const build = async (s: Step): Promise<Blob> => {
      const dest = await PDFDocument.create();
      for (const pg of pages) {
        const bmp = await createImageBitmap(pg.blob);
        const c = makeCanvas(pg.pxW * s.scale, pg.pxH * s.scale);
        const ctx = c.getContext('2d'); if (!ctx) throw new Error('Your browser could not start its drawing surface.');
        ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
        const jpg = await canvasToBlob(c, 'image/jpeg', s.quality); c.width = c.height = 0;
        const img = await dest.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
        dest.addPage([pg.w, pg.h]).drawImage(img, { x: 0, y: 0, width: pg.w, height: pg.h });
      }
      return new Blob([(await dest.save()) as BlobPart], { type: 'application/pdf' });
    };
    const r = await fitToSize(build, (b) => b.size, target, { signal: cancel, onAttempt, refine: 2 });
    const st = r.step as Step;
    return { name, blob: r.value as Blob, original: it.file.size, target, fits: r.fits, note: `Pages are images now (about ${Math.round(BASE_DPI * st.scale)} DPI, quality ${Math.round(st.quality * 100)}%)` };
  }

  btn.addEventListener('click', () => withBusy(btn, 'Working…', async () => {
    status.clear(); resetResults();
    const target = targetBytes();
    if (target === null) { status.show('error', 'Type a size like 75 KB or 1.5 MB, or pick one of the buttons.'); return; }
    if (target < 2048) { status.show('error', 'That limit is under 2 KB, which is too small for a real image or document. Try 5 KB or more.'); return; }
    cancel = { cancelled: false }; stop.hidden = false;
    const errors: string[] = [];
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; const label = `${it.file.name.slice(0, 40)} (${i + 1} of ${items.length})`;
        progress.set(i, items.length, `Working on ${label}`);
        try {
          if (it.file.size <= target) { results.push({ name: it.file.name, blob: it.file, original: it.file.size, target, fits: true, note: 'Already under the limit: left unchanged' }); continue; }
          const tick = (n: number) => progress.set(i, items.length, `Working on ${label}: try ${n}`);
          results.push(it.kind === 'pdf' ? await fitPdf(it, target, tick, (m) => progress.set(i, items.length, `${label}: ${m}`)) : await fitImage(it, target, tick));
        } catch (e) {
          if (e instanceof FitCancelled) throw e;
          errors.push(`"${it.file.name.slice(0, 40)}": ${it.kind === 'pdf' ? pdfErrorMessage(e, 'This PDF') : e instanceof Error ? e.message : 'failed'}`);
        }
        await new Promise((r) => setTimeout(r));
      }
    } catch (e) {
      if (!(e instanceof FitCancelled)) throw e;
      status.show('info', 'Cancelled.');
    } finally { stop.hidden = true; progress.hide(); }
    if (errors.length) status.show('error', ['Some files could not be processed:', ...errors]);
    if (!results.length) return;
    const miss = results.filter((r) => !r.fits).length;
    status.show(miss ? 'warn' : 'success', miss
      ? `${results.length - miss} of ${results.length} files fit ${formatBytes(target)}. ${miss === 1 ? 'One file' : `${miss} files`} could not get that small without becoming unreadable: the smallest version is offered below.`
      : results.length === 1 ? `Done: ${formatBytes(results[0].original)} → ${formatBytes(results[0].blob.size)}, within the ${formatBytes(target)} limit.` : `Done. All ${results.length} files fit within ${formatBytes(target)}.`);
    const rows = results.map((r) => h('tr', null,
      h('td', { text: r.name }), h('td', { text: formatBytes(r.original) }), h('td', { text: formatBytes(r.blob.size) }),
      h('td', { class: r.fits ? 'saving-good' : 'saving-bad', text: r.fits ? `Fits ${formatBytes(r.target)}` : `Over ${formatBytes(r.target)}` }),
      h('td', { text: r.note }),
      h('td', null, h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => downloadBlob(r.blob, r.name) }, 'Download'))));
    table.replaceChildren(h('table', null, h('thead', null, h('tr', null, ...['File', 'Original', 'Result', 'Limit', 'Details', ''].map((t) => h('th', { text: t })))), h('tbody', null, ...rows)));
    table.hidden = false; zipBtn.hidden = results.length < 2;
  }));
  stop.addEventListener('click', () => { cancel.cancelled = true; });
  zipBtn.addEventListener('click', () => withBusy(zipBtn, 'Building ZIP…', () => zipAndDownload(results, 'compressed-files.zip')));
  clear.addEventListener('click', () => { cancel.cancelled = true; items.length = 0; resetResults(); status.clear(); refresh(); });

  root.append(dz.el, list, opts, h('div', { class: 'actions' }, btn, stop, clear, zipBtn), progress.el, status.el, table);
  refresh();
}
