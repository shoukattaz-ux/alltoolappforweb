/**
 * Document-scanning maths: find a page in a photo, straighten it (perspective correction) and clean it up.
 * Everything here works on plain pixel arrays (RGBA, like canvas ImageData), with no DOM, so it is unit-tested with
 * synthetic photos. No OpenCV: a few hundred lines of well-known algorithms are enough for pages on a table.
 */
export interface Img { data: Uint8ClampedArray; width: number; height: number }
export interface Pt { x: number; y: number }
/** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export const newImg = (width: number, height: number): Img => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
export const cloneImg = (i: Img): Img => ({ data: new Uint8ClampedArray(i.data), width: i.width, height: i.height });
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/* ------------------------------------------------------------------ basic image ops ------------------------------------------------------------------ */

/** Shrink by an integer box average so that the longest side is at most `maxSide`. Returns the same image if it already fits. */
export function downscale(img: Img, maxSide: number): Img {
  const f = Math.ceil(Math.max(img.width, img.height) / maxSide);
  if (f <= 1) return img;
  const w = Math.max(1, Math.floor(img.width / f)), h = Math.max(1, Math.floor(img.height / f));
  const out = newImg(w, h); const n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) { let p = ((y * f + dy) * img.width + x * f) * 4; for (let dx = 0; dx < f; dx++, p += 4) { r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; } }
    const o = (y * w + x) * 4; out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
  }
  return out;
}

export function toGray(img: Img): Uint8ClampedArray {
  const n = img.width * img.height; const g = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
  return g;
}

/** Separable box blur with clamped edges, O(pixels) regardless of the radius. */
export function boxBlur(src: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const rr = Math.max(0, Math.floor(r));
  for (let y = 0; y < h; y++) {
    const row = y * w; let sum = 0;
    for (let k = -rr; k <= rr; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * rr + 1);
      sum += src[row + Math.min(w - 1, x + rr + 1)] - src[row + Math.max(0, x - rr)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -rr; k <= rr; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * rr + 1);
      sum += tmp[Math.min(h - 1, y + rr + 1) * w + x] - tmp[Math.max(0, y - rr) * w + x];
    }
  }
  return out;
}

/** Otsu's method: the grey level that best separates a dark group of pixels from a bright one. */
export function otsu(gray: ArrayLike<number>): number {
  const hist = new Float64Array(256); for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
  const total = gray.length; let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sumB += t * hist[t]; const mB = sumB / wB, mF = (sumAll - sumB) / wF; const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

/* ------------------------------------------------------------------ geometry ------------------------------------------------------------------ */

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export function polygonArea(p: Pt[]): number { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a) / 2; }

/** Convex hull (Andrew's monotone chain). */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y).filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = []; for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: Pt[] = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}

/** Order four corners as top-left, top-right, bottom-right, bottom-left, whatever order they come in. */
export function orderCorners(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // clockwise on screen
  let start = 0; sorted.forEach((p, i) => { if (p.x + p.y < sorted[start].x + sorted[start].y) start = i; });
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]) as Quad;
}

/** Reduce a convex polygon to `n` vertices by repeatedly dropping the corner that changes the shape least. Returns indices into `hull`. */
function simplifyHull(hull: Pt[], n: number): number[] {
  const idx = hull.map((_, i) => i);
  const area = (a: Pt, b: Pt, c: Pt) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  while (idx.length > n) {
    let best = 0, bestA = Infinity;
    for (let i = 0; i < idx.length; i++) { const a = area(hull[idx[(i + idx.length - 1) % idx.length]], hull[idx[i]], hull[idx[(i + 1) % idx.length]]); if (a < bestA) { bestA = a; best = i; } }
    idx.splice(best, 1);
  }
  return idx;
}

interface Line { px: number; py: number; dx: number; dy: number }
function fitLine(pts: Pt[]): Line | null {
  if (pts.length < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { const x = p.x - mx, y = p.y - my; sxx += x * x; syy += y * y; sxy += x * y; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis of the points = the side's direction
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}
function intersect(a: Line, b: Line): Pt | null {
  const det = a.dx * -b.dy - a.dy * -b.dx; if (Math.abs(det) < 1e-9) return null;
  const rx = b.px - a.px, ry = b.py - a.py; const t = (rx * -b.dy - ry * -b.dx) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/** Four-corner outline of a convex blob: simplify the hull, then refit each side as a straight line so rounded or noisy corners come out sharp. */
export function hullToQuad(hull: Pt[]): Quad | null {
  if (hull.length < 4) return null;
  const idx = simplifyHull(hull, 4);
  const sides: (Line | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const from = idx[i], to = idx[(i + 1) % 4]; const pts: Pt[] = [];
    for (let k = from; ; k = (k + 1) % hull.length) { pts.push(hull[k]); if (k === to) break; }
    const trim = Math.floor(pts.length * 0.12); // ignore the points nearest each corner, they are the roundest
    sides.push(fitLine(pts.length - 2 * trim >= 3 ? pts.slice(trim, pts.length - trim) : pts));
  }
  const corners: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const a = sides[(i + 3) % 4], b = sides[i]; const p = a && b ? intersect(a, b) : null;
    corners.push(p ?? hull[idx[i]]);
  }
  return orderCorners(corners);
}

/* ------------------------------------------------------------------ finding the page ------------------------------------------------------------------ */

export interface Detection {
  /** Corners as fractions of the image width/height (0..1), in reading order. */
  corners: Quad;
  /** True when a page-shaped region was found; false means "the whole photo" was returned as a safe default. */
  found: boolean;
  /** How much of the photo the page covers, 0..1. */
  coverage: number;
}
export const FULL_FRAME: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function largestComponent(mask: Uint8Array, w: number, h: number): { count: number; edge: Pt[]; borderTouch: number } {
  const label = new Int32Array(w * h); const stack = new Int32Array(w * h);
  let bestId = 0, bestCount = 0, id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    id++; let sp = 0, count = 0; stack[sp++] = s; label[s] = id;
    while (sp) {
      const p = stack[--sp]; count++; const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
    }
    if (count > bestCount) { bestCount = count; bestId = id; }
  }
  const edge: Pt[] = []; let onBorder = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (label[p] !== bestId) continue;
    const border = x === 0 || y === 0 || x === w - 1 || y === h - 1; if (border) onBorder++;
    if (border || label[p - 1] !== bestId || label[p + 1] !== bestId || label[p - w] !== bestId || label[p + w] !== bestId) edge.push({ x, y });
  }
  return { count: bestCount, edge, borderTouch: onBorder / (2 * (w + h) - 4) };
}

function candidate(mask: Uint8Array, w: number, h: number): Detection | null {
  const { count, edge, borderTouch } = largestComponent(mask, w, h);
  const coverage = count / (w * h);
  // A region hugging the whole border of the photo is the background (the table), not the page.
  if (coverage < 0.1 || edge.length < 8 || borderTouch > 0.85) return null;
  const hull = convexHull(edge); const quad = hullToQuad(hull); if (!quad) return null;
  const qArea = polygonArea(quad), hArea = polygonArea(hull);
  const fit = Math.min(qArea, hArea) / Math.max(qArea, hArea, 1);
  const frac = qArea / (w * h);
  // Every inner angle of a page-like shape is close to a right angle once perspective is allowed for.
  const angleOk = quad.every((p, i) => { const a = quad[(i + 3) % 4], b = quad[(i + 1) % 4]; const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y }; const ang = Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)) * 180 / Math.PI; return ang > 45 && ang < 135; });
  if (fit < 0.8 || frac < 0.15 || frac > 0.985 || !angleOk) return null;
  const corners = quad.map((p) => ({ x: Math.min(1, Math.max(0, p.x / (w - 1))), y: Math.min(1, Math.max(0, p.y / (h - 1))) })) as Quad;
  return { corners, found: true, coverage };
}

/**
 * Find the page in a photo. Assumes the page is the largest bright shape against a darker surface (the usual case: white paper
 * on a desk). It deliberately does not guess when the page is darker than its surroundings: on a photo of a full page of text
 * that guess would crop to the text block. In that case the whole photo is returned and the person adjusts the corners.
 */
export function detectDocument(src: Img): Detection {
  const img = downscale(src, 320); const { width: w, height: h } = img;
  const blurred = boxBlur(toGray(img), w, h, 2); const t = otsu(blurred);
  const bright = new Uint8Array(w * h);
  let nb = 0; for (let i = 0; i < w * h; i++) if (blurred[i] > t) { bright[i] = 1; nb++; }
  const frac = nb / (w * h);
  if (frac > 0.04 && frac < 0.99) { const a = candidate(bright, w, h); if (a) return a; }
  return { corners: FULL_FRAME.map((p) => ({ ...p })) as Quad, found: false, coverage: 1 };
}

/* ------------------------------------------------------------------ straightening ------------------------------------------------------------------ */

function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length; const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = m[r][n]; for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k]; x[r] = s / m[r][r]; }
  return x;
}

/** Perspective transform taking points of `from` onto points of `to` (both four corners). Returns the 3x3 matrix, row-major. */
export function homography(from: Pt[], to: Pt[]): number[] | null {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i], { x, y } = to[i];
    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]); b.push(y);
  }
  const h = solveLinear(A, b); return h ? [...h, 1] : null;
}
export function applyHomography(H: number[], p: Pt): Pt { const d = H[6] * p.x + H[7] * p.y + H[8]; return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d }; }

/** Pull every corner towards the middle by `1 - factor` (0.98 trims about 1% off each side). Hides the thin dark fringe of the table that automatic edges can leave. */
export function shrinkQuad(q: Quad, factor: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor })) as Quad;
}

/** Size of the straightened page: the average length of opposite sides, shrunk so the longest side is at most `maxSide`. */
export function outputSize(q: Quad, maxSide: number): { width: number; height: number } {
  let w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const k = Math.min(1, maxSide / Math.max(w, h, 1)); w *= k; h *= k;
  return { width: Math.max(16, Math.round(w)), height: Math.max(16, Math.round(h)) };
}

/** Cut the quadrilateral `quad` (pixel coordinates) out of `src` and stretch it to a straight rectangle. */
export function warpPerspective(src: Img, quad: Quad, outW: number, outH: number): Img {
  const dst: Quad = [{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }];
  const H = homography(dst, quad); const out = newImg(outW, outH);
  if (!H) return out;
  const sw = src.width, sh = src.height, sd = src.data, od = out.data;
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const d = H[6] * x + H[7] * y + H[8]; const sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d;
    const x0 = Math.floor(sx), y0 = Math.floor(sy); const fx = sx - x0, fy = sy - y0;
    const xa = Math.min(sw - 1, Math.max(0, x0)), xb = Math.min(sw - 1, Math.max(0, x0 + 1)), ya = Math.min(sh - 1, Math.max(0, y0)), yb = Math.min(sh - 1, Math.max(0, y0 + 1));
    const i00 = (ya * sw + xa) * 4, i10 = (ya * sw + xb) * 4, i01 = (yb * sw + xa) * 4, i11 = (yb * sw + xb) * 4, o = (y * outW + x) * 4;
    for (let c = 0; c < 3; c++) od[o + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
    od[o + 3] = 255;
  }
  return out;
}

export function rotateImg(img: Img, quarterTurns: number): Img {
  const t = ((quarterTurns % 4) + 4) % 4; if (!t) return img;
  const { width: w, height: h } = img; const out = t === 2 ? newImg(w, h) : newImg(h, w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = t === 1 ? h - 1 - y : t === 2 ? w - 1 - x : y; const ny = t === 1 ? x : t === 2 ? h - 1 - y : w - 1 - x;
    const s = (y * w + x) * 4, d = (ny * out.width + nx) * 4; out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1]; out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------------------ cleaning up ------------------------------------------------------------------ */

export type ScanFilter = 'original' | 'auto' | 'magic' | 'gray' | 'bw';
export const FILTER_LABEL: Record<ScanFilter, string> = { original: 'Original', auto: 'Auto', magic: 'Clean page', gray: 'Grayscale', bw: 'Black & white' };

/** Stretch each colour channel so the darkest and brightest 0.5% of pixels become black and white. */
function autoLevels(img: Img): void {
  const n = img.width * img.height; const lo = [0, 0, 0], hi = [255, 255, 255];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[img.data[i * 4 + c]]++;
    let acc = 0, l = 0, hgh = 255; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.005) { l = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.005) { hgh = v; break; } }
    lo[c] = l; hi[c] = Math.max(l + 1, hgh);
  }
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) img.data[i * 4 + c] = clamp255(((img.data[i * 4 + c] - lo[c]) / (hi[c] - lo[c])) * 255);
}

/** Even out lighting: divide every pixel by the local paper brightness, so shadows and gradients vanish and paper turns white. */
function flattenLighting(img: Img): void {
  const { width: w, height: h } = img; const k = Math.max(1, Math.ceil(Math.max(w, h) / 500));
  const sw = Math.max(1, Math.floor(w / k)), sh = Math.max(1, Math.floor(h / k)); const radius = Math.max(3, Math.round(Math.min(sw, sh) / 12));
  const small = downscale(img, Math.max(sw, sh)); const sW = small.width, sH = small.height;
  const bg: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    // A grey "close" (max filter then blur) keeps thin dark text from pulling the paper estimate down.
    const ch = new Float32Array(sW * sH); for (let i = 0; i < sW * sH; i++) ch[i] = small.data[i * 4 + c];
    const maxed = new Float32Array(sW * sH);
    for (let y = 0; y < sH; y++) for (let x = 0; x < sW; x++) { let m = 0; for (let dy = -2; dy <= 2; dy++) { const yy = Math.min(sH - 1, Math.max(0, y + dy)); for (let dx = -2; dx <= 2; dx++) { const v = ch[yy * sW + Math.min(sW - 1, Math.max(0, x + dx))]; if (v > m) m = v; } } maxed[y * sW + x] = m; }
    bg.push(boxBlur(maxed, sW, sH, radius));
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sH - 1, (y / h) * sH), y0 = Math.floor(fy), y1 = Math.min(sH - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sW - 1, (x / w) * sW), x0 = Math.floor(fx), x1 = Math.min(sW - 1, x0 + 1), tx = fx - x0; const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b = bg[c]; const ref = (b[y0 * sW + x0] * (1 - tx) + b[y0 * sW + x1] * tx) * (1 - ty) + (b[y1 * sW + x0] * (1 - tx) + b[y1 * sW + x1] * tx) * ty;
        const ratio = img.data[o + c] / Math.max(24, ref * 0.94);           // paper is about 1.06, ink is well below
        img.data[o + c] = clamp255(((ratio - 0.18) / 0.82) * 255);          // lift the paper to white and deepen the ink
      }
    }
  }
}

function toGrayscaleInPlace(img: Img): void {
  for (let i = 0; i < img.width * img.height; i++) { const p = i * 4; const g = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2]; img.data[p] = img.data[p + 1] = img.data[p + 2] = g; }
}

/** Pure black text on white paper, using a local threshold so uneven light does not matter. */
function binarize(img: Img): void {
  const { width: w, height: h } = img; const g = toGray(img);
  const mean = boxBlur(g, w, h, Math.max(8, Math.round(Math.min(w, h) / 24)));
  for (let i = 0; i < w * h; i++) { const v = g[i] < mean[i] * 0.88 - 2 ? 0 : 255; const p = i * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = v; }
}

/** Apply a clean-up filter. Works on (and returns) the image passed in. */
export function applyFilter(img: Img, filter: ScanFilter): Img {
  if (filter === 'auto') autoLevels(img);
  else if (filter === 'magic') flattenLighting(img);
  else if (filter === 'gray') { autoLevels(img); toGrayscaleInPlace(img); }
  else if (filter === 'bw') binarize(img);
  return img;
}

/** Brightness and contrast, each -100..100 (0 = unchanged). */
export function adjust(img: Img, brightness: number, contrast: number): Img {
  if (!brightness && !contrast) return img;
  const c = Math.max(-100, Math.min(100, contrast)) * 2.55; const f = (259 * (c + 255)) / (255 * (259 - c)); const b = Math.max(-100, Math.min(100, brightness)) * 1.28;
  const lut = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) lut[v] = clamp255(f * (v - 128) + 128 + b);
  for (let i = 0; i < img.width * img.height; i++) { const p = i * 4; img.data[p] = lut[img.data[p]]; img.data[p + 1] = lut[img.data[p + 1]]; img.data[p + 2] = lut[img.data[p + 2]]; }
  return img;
}

/* ------------------------------------------------------------------ PDF page layout ------------------------------------------------------------------ */

export type PageSize = 'fit' | 'a4' | 'letter';
export const PAGE_SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };
/** The assumed resolution when "fit to scan" sizes a page from its pixels. */
export const FIT_DPI = 200;

/** Where to draw an image on a PDF page (all in PDF points; y counts from the bottom). */
export function pageLayout(size: PageSize, marginPt: number, imgW: number, imgH: number): { pageW: number; pageH: number; x: number; y: number; w: number; h: number } {
  if (size === 'fit') {
    const w = (imgW * 72) / FIT_DPI, h = (imgH * 72) / FIT_DPI; return { pageW: w + 2 * marginPt, pageH: h + 2 * marginPt, x: marginPt, y: marginPt, w, h };
  }
  let [pw, ph] = PAGE_SIZES[size]; if (imgW > imgH) [pw, ph] = [ph, pw]; // landscape scans get a landscape page
  const availW = pw - 2 * marginPt, availH = ph - 2 * marginPt; const k = Math.min(availW / imgW, availH / imgH); const w = imgW * k, h = imgH * k;
  return { pageW: pw, pageH: ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}
