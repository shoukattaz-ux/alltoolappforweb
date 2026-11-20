/** Pure helpers for the Passport & ID Photo Maker: sizes, cropping, print-sheet layout, background clean-up, JPEG DPI. */

export interface PhotoSize { id: string; label: string; wMm: number; hMm: number; note: string }

export const PHOTO_SIZES: PhotoSize[] = [
  { id: '35x45', label: '35 × 45 mm', wMm: 35, hMm: 45, note: 'A very common passport and visa size (UK, EU and many other countries).' },
  { id: '2x2in', label: '2 × 2 in (51 × 51 mm)', wMm: 50.8, hMm: 50.8, note: 'United States passport and visa photos, and some other countries.' },
  { id: '50x70', label: '50 × 70 mm', wMm: 50, hMm: 70, note: 'Canadian passport photos.' },
  { id: '33x48', label: '33 × 48 mm', wMm: 33, hMm: 48, note: 'Chinese visa photos.' },
  { id: '25x35', label: '25 × 35 mm', wMm: 25, hMm: 35, note: 'Small ID, licence and form photos.' },
];

export interface PaperSize { id: string; label: string; wMm: number; hMm: number }
export const PAPERS: PaperSize[] = [
  { id: '4x6in', label: '4 × 6 in (10 × 15 cm photo paper)', wMm: 101.6, hMm: 152.4 },
  { id: '5x7in', label: '5 × 7 in (13 × 18 cm photo paper)', wMm: 127, hMm: 177.8 },
  { id: 'a4', label: 'A4', wMm: 210, hMm: 297 },
  { id: 'letter', label: 'US Letter', wMm: 215.9, hMm: 279.4 },
];

export const MM_PER_INCH = 25.4;
export const mmToPx = (mm: number, dpi: number) => Math.max(1, Math.round((mm / MM_PER_INCH) * dpi));
export const mmToPt = (mm: number) => (mm / MM_PER_INCH) * 72;

export interface CropRect { x: number; y: number; w: number; h: number }

/**
 * The part of the picture shown in the frame. At zoom 1 the frame is the largest rectangle of the given aspect (w/h)
 * that fits the image; higher zoom shrinks it. (cx, cy) is the wanted centre in image pixels; the result always stays inside the image.
 */
export function cropRect(imgW: number, imgH: number, aspect: number, zoom: number, cx: number, cy: number): CropRect {
  const z = Math.min(8, Math.max(1, zoom));
  const baseW = Math.min(imgW, imgH * aspect);
  const w = baseW / z, h = w / aspect;
  const x = Math.min(imgW - w, Math.max(0, cx - w / 2));
  const y = Math.min(imgH - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}

export interface SheetLayout { paperW: number; paperH: number; landscape: boolean; cols: number; rows: number; count: number; positions: { x: number; y: number }[] }

/** Packs identical photos onto a sheet (millimetres), trying both paper orientations and keeping the one that holds more. */
export function sheetLayout(paper: { wMm: number; hMm: number }, photo: { wMm: number; hMm: number }, marginMm = 4, gapMm = 2): SheetLayout {
  const attempt = (pw: number, ph: number, landscape: boolean): SheetLayout => {
    const cols = Math.max(0, Math.floor((pw - 2 * marginMm + gapMm) / (photo.wMm + gapMm)));
    const rows = Math.max(0, Math.floor((ph - 2 * marginMm + gapMm) / (photo.hMm + gapMm)));
    const gridW = cols * photo.wMm + (cols - 1) * gapMm, gridH = rows * photo.hMm + (rows - 1) * gapMm;
    const x0 = (pw - gridW) / 2, y0 = (ph - gridH) / 2;
    const positions: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) positions.push({ x: x0 + c * (photo.wMm + gapMm), y: y0 + r * (photo.hMm + gapMm) });
    return { paperW: pw, paperH: ph, landscape, cols, rows, count: cols * rows, positions };
  };
  const portrait = attempt(paper.wMm, paper.hMm, false);
  const land = attempt(paper.hMm, paper.wMm, true);
  return land.count > portrait.count ? land : portrait;
}

/**
 * Replaces a plain background with `bg`. The background colour is taken from the picture's border; every pixel connected
 * to the border whose colour is within `tolerance` (RGB distance) of it is repainted, with a softened edge.
 * Works on RGBA bytes in place. Returns the fraction of the picture that was repainted (so callers can warn when it ate the subject).
 */
export function replaceBackground(data: Uint8ClampedArray, width: number, height: number, tolerance: number, bg: [number, number, number]): number {
  if (tolerance <= 0 || width < 3 || height < 3) return 0;
  const n = width * height;
  const ring: number[][] = [[], [], []];
  const sample = (x: number, y: number) => { const i = (y * width + x) * 4; ring[0].push(data[i]); ring[1].push(data[i + 1]); ring[2].push(data[i + 2]); };
  const sx = Math.max(1, Math.floor(width / 40)), sy = Math.max(1, Math.floor(height / 40));
  for (let x = 0; x < width; x += sx) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += sy) { sample(0, y); sample(width - 1, y); }
  const med = ring.map((a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
  const tol2 = tolerance * tolerance;
  const close = (p: number) => { const i = p * 4; const dr = data[i] - med[0], dg = data[i + 1] - med[1], db = data[i + 2] - med[2]; return dr * dr + dg * dg + db * db <= tol2; };

  const mask = new Uint8Array(n);
  const stack = new Int32Array(n); let sp = 0;
  const push = (p: number) => { if (!mask[p] && close(p)) { mask[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (sp > 0) {
    const p = stack[--sp]; const x = p % width, y = (p - x) / width;
    if (x > 0) push(p - 1); if (x < width - 1) push(p + 1); if (y > 0) push(p - width); if (y < height - 1) push(p + width);
  }
  let count = 0;
  const edge: number[] = [];
  for (let p = 0; p < n; p++) {
    if (mask[p]) { count++; continue; }
    const x = p % width, y = (p - x) / width;
    if ((x > 0 && mask[p - 1]) || (x < width - 1 && mask[p + 1]) || (y > 0 && mask[p - width]) || (y < height - 1 && mask[p + width])) edge.push(p);
  }
  for (let p = 0; p < n; p++) if (mask[p]) { const i = p * 4; data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2]; data[i + 3] = 255; }
  for (const p of edge) { const i = p * 4; data[i] = (data[i] + bg[0]) >> 1; data[i + 1] = (data[i + 1] + bg[1]) >> 1; data[i + 2] = (data[i + 2] + bg[2]) >> 1; }
  return count / n;
}

/** Writes a print resolution into a JPEG (JFIF density), so printers and editors place it at the right physical size. */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif = jpeg[2] === 0xff && jpeg[3] === 0xe0 && jpeg[6] === 0x4a && jpeg[7] === 0x46 && jpeg[8] === 0x49 && jpeg[9] === 0x46 && jpeg[10] === 0;
  if (isJfif) {
    const out = jpeg.slice();
    out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2), 0); out.set(app0, 2); out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}
