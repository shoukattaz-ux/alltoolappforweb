/** Pure maths for the PDF reader: zoom, canvas pixel budget and text search. No DOM; unit-tested. */

/** CSS pixels per PDF point at "100%" (actual size on a 96 dpi screen). */
export const PDF_PX_PER_PT = 96 / 72;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const LADDER = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export const clampZoom = (z: number) => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : 1);

/** Zoom factor (1 = 100%) for a zoom mode. `w`/`h` are the page size in PDF points; `availW`/`availH` the viewer size in CSS px. */
export function effectiveZoom(mode: 'width' | 'page' | number, w: number, h: number, availW: number, availH: number): number {
  if (typeof mode === 'number') return clampZoom(mode);
  const byWidth = availW / (w * PDF_PX_PER_PT);
  return clampZoom(mode === 'width' ? byWidth : Math.min(byWidth, availH / (h * PDF_PX_PER_PT)));
}

/** The next zoom level up or down on a friendly ladder (25% ... 400%). */
export function nextZoomStep(current: number, dir: 1 | -1): number {
  const eps = 0.005;
  if (dir === 1) return LADDER.find((z) => z > current + eps) ?? MAX_ZOOM;
  return [...LADDER].reverse().find((z) => z < current - eps) ?? MIN_ZOOM;
}

/** Canvas pixels per CSS pixel: sharp on high-DPI screens, but never more than `maxPixels` in total (protects phones from running out of memory). */
export function pixelRatioFor(cssW: number, cssH: number, dpr: number, maxPixels = 16_000_000, maxRatio = 2): number {
  const want = Math.max(1, Math.min(dpr || 1, maxRatio));
  const cap = Math.sqrt(maxPixels / Math.max(1, cssW * cssH));
  return Math.max(0.1, Math.min(want, cap));
}

/** Start indexes of every non-overlapping, case-insensitive match of `lowerQuery` (already lowercase) in `text`. */
export function findInText(text: string, lowerQuery: string): number[] {
  if (!lowerQuery) return [];
  const low = text.toLowerCase();
  if (low.length !== text.length) return []; // a few characters change length when lowercased; skip rather than mis-highlight
  const out: number[] = []; let i = low.indexOf(lowerQuery);
  while (i >= 0) { out.push(i); i = low.indexOf(lowerQuery, i + lowerQuery.length); }
  return out;
}
