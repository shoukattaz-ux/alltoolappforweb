import { h, dropzone, field, statusArea, progressBar, withBusy, downloadBlob, toast, loadImage, makeCanvas, canvasToBlob } from '../ui';
import { formatBytes, safeBaseName } from '../../lib/format';
import { parsePageRanges } from '../../lib/pageRange';
import { applyFilter } from '../../lib/scan';
import { LOW_CONFIDENCE, joinPages, meanConfidence, placeWord, tidyText, wordsFromResult, type OcrWord } from '../../lib/ocr';
import { setHandoff } from '../handoff';
import { PDFDocument, loadPdfLib, openPdfJs, pdfErrorMessage, type PdfJsDocument } from '../pdf';
import { StandardFonts } from 'pdf-lib';

const MAX_IMAGES = 30;
const MAX_PDF_PAGES = 50;
const PDF_DPI = 200;
/** Photos larger than this (longest side) are shrunk before recognition: more pixels only make it slower, not more accurate. */
const MAX_SIDE = 3200;
const MAX_PIXELS = 20_000_000;

interface Source { kind: 'image' | 'pdf'; file: File }
interface PageResult { n: number; text: string; words: OcrWord[]; confidence: number; w: number; h: number; jpeg?: Blob; pdfIndex?: number }

type Recognizer = { recognize: (img: HTMLCanvasElement, opts?: object, out?: object) => Promise<{ data: unknown }>; terminate: () => Promise<unknown> };

async function createEngine(logger: (m: { status: string; progress: number }) => void): Promise<Recognizer> {
  const [{ createWorker, OEM }, { simd }] = await Promise.all([import('tesseract.js'), import('wasm-feature-detect')]);
  // Everything is loaded from this app's own files: the worker, one WebAssembly core (SIMD when the device has it) and the English model.
  // The model is plain (not .gz): Android's build tools decompress and rename .gz assets, which would make the file disappear inside the app.
  const corePath = (await simd()) ? '/ocr/core/tesseract-core-simd-lstm.wasm.js' : '/ocr/core/tesseract-core-lstm.wasm.js';
  return (await createWorker('eng', OEM.LSTM_ONLY, { workerPath: '/ocr/worker.min.js', corePath, langPath: '/ocr/lang', workerBlobURL: false, cacheMethod: 'none', gzip: false, logger })) as unknown as Recognizer;
}

export function mount(root: HTMLElement) {
  const status = statusArea(); const progress = progressBar();
  let sources: Source[] = []; let pdf: PdfJsDocument | null = null;
  let results: PageResult[] = []; let engine: Recognizer | null = null; let cancelled = false; let running = false;
  // Stopping the engine does not settle a page it was in the middle of reading, so waits race against this instead.
  const CANCELED = Symbol('canceled'); let stopWaiting: (v: symbol) => void = () => {}; let cancelSignal: Promise<symbol> = Promise.resolve(CANCELED);

  /* ---- choosing files ---- */
  const dz = dropzone({
    kinds: ['jpeg', 'png', 'webp', 'pdf'], multiple: true, maxBytes: 100 * 1024 * 1024, maxFiles: MAX_IMAGES, existing: () => sources.length, title: 'Drop photos, scans or a PDF here',
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', ['Some files were not added:', ...e]); },
    onFiles: async (files) => {
      const pdfFile = files.find((f) => f.kind === 'pdf');
      if (pdfFile) { // one PDF at a time; it replaces whatever was chosen before
        try { const doc = await openPdfJs(pdfFile.file); void pdf?.destroy(); pdf = doc; sources = [{ kind: 'pdf', file: pdfFile.file }]; if (files.length > 1) status.show('info', 'Only the PDF was used. Choose photos or a PDF, not both.'); pagesInput.value = ''; }
        catch (e) { status.show('error', pdfErrorMessage(e, `"${pdfFile.file.name.slice(0, 50)}"`)); return; }
      } else {
        if (sources[0]?.kind === 'pdf') { sources = []; void pdf?.destroy(); pdf = null; }
        for (const f of files) { if (f.file.size > 30 * 1024 * 1024) { status.show('error', `"${f.file.name.slice(0, 50)}" is larger than the 30 MB limit for photos.`); continue; } sources.push({ kind: 'image', file: f.file }); }
      }
      cleanup.checked = sources[0]?.kind === 'image'; resetResults(); refresh();
    },
  });

  const list = h('ul', { class: 'file-list' });
  const cleanup = h('input', { type: 'checkbox', id: 'ocr-clean' }); cleanup.checked = true;
  const pagesInput = h('input', { type: 'text', inputmode: 'text', placeholder: `All pages (up to ${MAX_PDF_PAGES})`, autocomplete: 'off' });
  const pagesField = field('Pages to read (optional)', pagesInput, 'For example 1-3, 5. Reading takes a few seconds per page.');
  const opts = h('div', { class: 'ocr-opts', hidden: true },
    h('label', { class: 'check', for: 'ocr-clean' }, cleanup, h('span', { text: 'Clean up photos first (removes shadows and uneven light; recommended for camera photos)' })), pagesField,
    h('p', { class: 'hint', text: 'Language: English. The recognition engine runs on this device; nothing is uploaded.' }));
  const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: true }, 'Recognize text');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true }, 'Cancel');
  const clearBtn = h('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, 'Clear');
  const out = h('div', { class: 'ocr-out', hidden: true });

  function refresh() {
    list.replaceChildren(...sources.map((s, i) => h('li', { class: 'file-item' },
      h('span', { class: 'fname', text: s.file.name, title: s.file.name }), h('span', { class: 'fmeta', text: s.kind === 'pdf' ? `${pdf?.numPages ?? '?'} pages · ${formatBytes(s.file.size)}` : formatBytes(s.file.size) }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${s.file.name}`, onclick: () => { sources.splice(i, 1); if (!sources.length) { void pdf?.destroy(); pdf = null; } resetResults(); refresh(); } }, '✕'))));
    const has = sources.length > 0; opts.hidden = !has; startBtn.disabled = !has || running; clearBtn.disabled = !has || running;
    pagesField.hidden = sources[0]?.kind !== 'pdf';
  }
  function resetResults() { results = []; out.hidden = true; out.replaceChildren(); }

  /* ---- recognition ---- */
  async function pageCanvas(job: { source: Source; pageNumber?: number; file?: File }): Promise<HTMLCanvasElement> {
    if (job.source.kind === 'pdf') {
      const page = await pdf!.getPage(job.pageNumber!); const v1 = page.getViewport({ scale: 1 });
      let scale = PDF_DPI / 72; if (v1.width * v1.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (v1.width * v1.height));
      const vp = page.getViewport({ scale }); const c = makeCanvas(vp.width, vp.height); const ctx = c.getContext('2d', { alpha: false, willReadFrequently: true })!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise; page.cleanup(); return c;
    }
    const img = await loadImage(job.source.file); const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const c = makeCanvas(img.width * k, img.height * k); const ctx = c.getContext('2d', { alpha: false, willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img.source, 0, 0, c.width, c.height); img.source.close?.(); return c;
  }

  const stopEngine = async () => { const e = engine; engine = null; try { await e?.terminate(); } catch { /* already stopped */ } };

  startBtn.addEventListener('click', async () => {
    if (!sources.length || running) return;
    status.clear(); resetResults(); cancelled = false; running = true; startBtn.disabled = true; clearBtn.disabled = true; cancelBtn.hidden = false;
    cancelSignal = new Promise<symbol>((res) => { stopWaiting = res; });
    const jobs: { source: Source; pageNumber?: number; label: number; pdfIndex?: number }[] = [];
    try {
      if (sources[0].kind === 'pdf') {
        const total = pdf!.numPages; const sel = pagesInput.value.trim() ? parsePageRanges(pagesInput.value, total).pages : Array.from({ length: total }, (_, i) => i + 1);
        if (sel.length > MAX_PDF_PAGES) throw new Error(`Choose up to ${MAX_PDF_PAGES} pages at a time. This PDF has ${sel.length} selected; use the "Pages to read" box.`);
        for (const n of sel) jobs.push({ source: sources[0], pageNumber: n, label: n, pdfIndex: n - 1 });
      } else sources.forEach((s, i) => jobs.push({ source: s, label: i + 1 }));
      let frac = 0; let done = 0;
      const report = (text: string) => progress.set(Math.round(((done + frac) / jobs.length) * 100), 100, text);
      progress.set(0, 100, 'Loading the text recognition engine (first time only)…'); await new Promise((r) => setTimeout(r));
      const made = await Promise.race([createEngine((m) => { if (m.status === 'recognizing text') { frac = m.progress; report(`Reading page ${done + 1} of ${jobs.length}… ${Math.round(((done + frac) / jobs.length) * 100)}%`); } else if (/loading|initializ/i.test(m.status)) progress.set(0, 100, 'Loading the text recognition engine (first time only)…'); }), cancelSignal]);
      if (made === CANCELED) throw new Error('canceled'); engine = made as Recognizer;
      for (const job of jobs) {
        if (cancelled) break; frac = 0; report(`Reading page ${done + 1} of ${jobs.length}…`);
        const canvas = await pageCanvas(job);
        if (cleanup.checked && job.source.kind === 'image') { const ctx = canvas.getContext('2d', { willReadFrequently: true })!; const d = ctx.getImageData(0, 0, canvas.width, canvas.height); applyFilter({ data: d.data, width: d.width, height: d.height }, 'magic'); ctx.putImageData(d, 0, 0); }
        const got = await Promise.race([engine.recognize(canvas, {}, { blocks: true, text: true }), cancelSignal]);
        if (got === CANCELED || cancelled) { canvas.width = canvas.height = 0; break; }
        const res = got as { data: unknown };
        const data = res.data as { text?: string; blocks?: unknown; words?: unknown };
        const words = wordsFromResult(data as Parameters<typeof wordsFromResult>[0]);
        const jpeg = job.source.kind === 'image' ? await canvasToBlob(canvas, 'image/jpeg', 0.85) : undefined;
        results.push({ n: job.label, text: tidyText(data.text ?? words.map((w) => w.text).join(' ')), words, confidence: meanConfidence(words), w: canvas.width, h: canvas.height, jpeg, pdfIndex: job.pdfIndex });
        canvas.width = canvas.height = 0; done++; frac = 0; report(`Finished page ${done} of ${jobs.length}`);
      }
    } catch (e) {
      if (!cancelled) status.show('error', ['The text could not be read.', e instanceof Error ? e.message : 'Try a smaller photo or fewer pages.']);
    } finally {
      progress.hide(); await stopEngine(); running = false; cancelBtn.hidden = true; refresh();
    }
    if (cancelled) { status.show('info', results.length ? `Canceled. Showing the ${results.length} page${results.length === 1 ? '' : 's'} read so far.` : 'Canceled.'); }
    if (results.length) showResults();
  });
  cancelBtn.addEventListener('click', () => { cancelled = true; stopWaiting(CANCELED); void stopEngine(); });
  clearBtn.addEventListener('click', () => { sources = []; void pdf?.destroy(); pdf = null; resetResults(); status.clear(); refresh(); });

  /* ---- results ---- */
  const textareas: HTMLTextAreaElement[] = [];
  const allText = () => joinPages(results.map((r, i) => ({ n: r.n, text: textareas[i]?.value ?? r.text })));
  const baseName = () => safeBaseName(sources[0]?.file.name ?? 'text', 'text');

  function showResults() {
    textareas.length = 0;
    const words = results.reduce((s, r) => s + r.words.length, 0); const avg = meanConfidence(results.flatMap((r) => r.words));
    const anyText = results.some((r) => r.text.trim());
    const summary = h('div', { class: `notice notice-${anyText ? (avg < LOW_CONFIDENCE ? 'warn' : 'success') : 'warn'}`, role: 'status' }, h('span', { text: anyText
      ? `Read ${results.length} page${results.length === 1 ? '' : 's'}: ${words} words, about ${Math.round(avg)}% confident.${avg < LOW_CONFIDENCE ? ' Some words may be wrong. Check the text, and try "Clean up photos first" with a sharper, better-lit photo.' : ''}`
      : 'No text was found. Try a sharper photo in better light, with the page filling the picture.' }));
    const copy = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { try { await navigator.clipboard.writeText(allText()); toast('Text copied to the clipboard.'); } catch { toast('Could not copy. Select the text and copy it instead.'); } } }, 'Copy all text');
    const txt = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => downloadBlob(new Blob([allText()], { type: 'text/plain;charset=utf-8' }), `${baseName()}.txt`) }, 'Download as .txt');
    const searchable = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Make a searchable PDF');
    searchable.addEventListener('click', () => withBusy(searchable, 'Building the PDF…', async () => {
      try { const file = await buildSearchablePdf(); downloadBlob(file, file.name); result.replaceChildren(h('div', { class: 'notice notice-success', role: 'status' }, h('span', { text: `Searchable PDF ready (${formatBytes(file.size)}).` }), ' ', h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { setHandoff([file]); location.hash = '#/tool/pdf-reader'; } }, 'Open in PDF Reader'))); }
      catch (e) { status.show('error', ['The PDF could not be built.', e instanceof Error ? e.message : 'Try fewer pages.']); }
    }));
    const result = h('div', { class: 'ocr-pdf-result' });
    const pages = results.map((r, i) => {
      const ta = h('textarea', { class: 'ocr-text', rows: Math.min(18, Math.max(4, r.text.split('\n').length + 1)), 'aria-label': `Recognized text, page ${r.n}`, spellcheck: 'false' }); ta.value = r.text; textareas.push(ta);
      const low = r.words.length > 0 && r.confidence < LOW_CONFIDENCE;
      return h('details', { class: 'ocr-page', open: i < 3 ? true : null }, h('summary', null, `Page ${r.n}`, h('span', { class: `ocr-conf${low ? ' low' : ''}`, text: r.words.length ? `${Math.round(r.confidence)}% confident${low ? ' (check this page)' : ''}` : 'no text found' })), ta);
    });
    const parts: Node[] = [summary]; if (anyText) parts.push(h('div', { class: 'actions' }, copy, txt, searchable));
    parts.push(result, h('div', { class: 'ocr-pages' }, ...pages), h('p', { class: 'hint', text: 'You can correct the text above before copying or downloading it. The searchable PDF uses the words exactly as first recognized.' }));
    out.replaceChildren(...parts);
    out.hidden = false;
  }

  async function buildSearchablePdf(): Promise<File> {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    const width1 = (t: string) => { try { return font.widthOfTextAtSize(t, 1); } catch { return 0; } };
    const addText = (p: ReturnType<typeof doc.addPage>, r: PageResult, pw: number, ph: number) => {
      for (const w of r.words) { const pl = placeWord(w, r.w, r.h, pw, ph, width1); if (pl) p.drawText(pl.text, { x: pl.x, y: pl.y, size: pl.size, font, opacity: 0 }); }
    };
    if (sources[0].kind === 'pdf') {
      // Keep the original pages exactly as they are and layer invisible text on top.
      const src = await loadPdfLib(sources[0].file); const copied = await doc.copyPages(src, results.map((r) => r.pdfIndex!));
      copied.forEach((p, i) => { doc.addPage(p); if (p.getRotation().angle % 360 === 0) { const { width, height } = p.getSize(); addText(p, results[i], width, height); } }); // rotated pages are kept as they are, without a text layer
    } else {
      for (const r of results) {
        const img = await doc.embedJpg(new Uint8Array(await r.jpeg!.arrayBuffer())); const pw = (r.w * 72) / PDF_DPI, ph = (r.h * 72) / PDF_DPI;
        const p = doc.addPage([pw, ph]); p.drawImage(img, { x: 0, y: 0, width: pw, height: ph }); addText(p, r, pw, ph);
      }
    }
    doc.setCreator('ToolHaven'); doc.setProducer('ToolHaven'); doc.setTitle(baseName());
    return new File([(await doc.save()) as BlobPart], `${baseName()}-searchable.pdf`, { type: 'application/pdf' });
  }

  root.closest('.tool-panel')?.classList.add('rd-panel'); root.closest('.tool-layout')?.classList.add('rd-wide');
  root.append(dz.el, list, opts, h('div', { class: 'actions' }, startBtn, cancelBtn, clearBtn), progress.el, status.el, out);
  const watchdog = window.setInterval(() => { if (!root.isConnected) { clearInterval(watchdog); cancelled = true; stopWaiting(CANCELED); void stopEngine(); void pdf?.destroy(); } }, 1500);
}
