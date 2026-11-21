import { describe, it, expect } from 'vitest';
import {
  newImg, downscale, toGray, boxBlur, otsu, convexHull, polygonArea, orderCorners, detectDocument, FULL_FRAME, homography, applyHomography, outputSize,
  warpPerspective, shrinkQuad, rotateImg, applyFilter, adjust, pageLayout, cloneImg, type Img, type Pt, type Quad,
} from '../../src/lib/scan';

const Q = (...c: number[]): Quad => [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }];
const UNIT: Quad = Q(0, 0, 1, 0, 1, 1, 0, 1);

/** A synthetic "photo": a page (given as a quad of pixels) on a background. `pattern(u, v)` returns the page's grey level at page coordinates 0..1. */
function photo(w: number, h: number, quad: Quad, bg: number, pattern: (u: number, v: number) => number): Img {
  const img = newImg(w, h); const H = homography(quad, UNIT)!; // photo pixel -> page coordinates
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4; const { x: u, y: v } = applyHomography(H, { x, y });
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1; const g = inside ? pattern(u, v) : bg;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = g; img.data[p + 3] = 255;
  }
  return img;
}
const plain = (g: number) => () => g;
const textured = (u: number, v: number) => (Math.floor(v * 24) % 2 === 0 && u > 0.1 && u < 0.9 && Math.floor(v * 24) > 1 ? 40 : 215); // dark text bands on a light page
const near = (d: { corners: Quad }, want0: Quad, tol: number, w: number, h: number) => { const want = orderCorners(want0); d.corners.forEach((c, i) => { expect(Math.abs(c.x - want[i].x / (w - 1))).toBeLessThan(tol); expect(Math.abs(c.y - want[i].y / (h - 1))).toBeLessThan(tol); }); };

describe('detecting a page in a photo', () => {
  it('finds a straight page and returns its corners', () => {
    const quad = Q(50, 40, 270, 40, 270, 200, 50, 200); const d = detectDocument(photo(320, 240, quad, 50, plain(215)));
    expect(d.found).toBe(true); near(d, quad, 0.025, 320, 240);
  });
  it('finds a rotated, perspective-skewed page', () => {
    const quad = Q(70, 30, 285, 58, 255, 215, 38, 185); const d = detectDocument(photo(320, 240, quad, 60, plain(220)));
    expect(d.found).toBe(true); near(d, quad, 0.03, 320, 240);
  });
  it('still finds the page when it is covered in dark text', () => {
    const quad = Q(60, 25, 260, 35, 250, 215, 45, 205); const d = detectDocument(photo(320, 240, quad, 55, textured));
    expect(d.found).toBe(true); near(d, quad, 0.03, 320, 240);
  });
  it('finds a heavily tilted page (about 35 degrees)', () => {
    const quad = Q(170, 20, 300, 110, 160, 225, 30, 130); const d = detectDocument(photo(320, 240, quad, 45, plain(225)));
    expect(d.found).toBe(true); near(d, quad, 0.035, 320, 240);
  });
  it('does not guess when the page is darker than the table (the person adjusts the corners instead)', () => {
    const d = detectDocument(photo(320, 240, Q(60, 50, 250, 50, 250, 190, 60, 190), 215, plain(40)));
    expect(d.found).toBe(false); expect(d.corners).toEqual(FULL_FRAME);
  });
  it('does not crop a full-frame page of text down to the text block', () => {
    const d = detectDocument(photo(320, 240, UNIT, 0, (u, v) => (u > 0.15 && u < 0.85 && v > 0.15 && v < 0.85 && Math.floor(v * 30) % 2 === 0 ? 40 : 215).valueOf()));
    expect(d.found).toBe(false);
  });
  it('finds a page that touches one edge of the photo (partly cut off)', () => {
    const quad = Q(40, 60, 300, 60, 300, 240, 40, 240); const d = detectDocument(photo(320, 240, Q(40, 60, 300, 60, 300, 300, 40, 300), 50, plain(215)));
    expect(d.found).toBe(true); expect(d.corners[0].x).toBeCloseTo(40 / 319, 1); void quad;
  });
  it('says "not found" and returns the whole frame when there is nothing page-like', () => {
    for (const g of [plain(200), plain(30)]) { const d = detectDocument(photo(320, 240, UNIT, 0, g)); expect(d.found).toBe(false); expect(d.corners).toEqual(FULL_FRAME); }
    const noise = newImg(200, 150); for (let i = 0; i < 200 * 150; i++) { const g = (i * 7919) % 256; noise.data.set([g, g, g, 255], i * 4); } // speckle, no big shape
    expect(detectDocument(noise).found).toBe(false);
  });
  it('works on a large photo (it is shrunk internally) and returns normalised corners', () => {
    const quad = Q(500, 400, 2700, 380, 2750, 2000, 450, 2050); const big = photo(3200, 2400, quad, 55, plain(220));
    const d = detectDocument(big); expect(d.found).toBe(true);
    for (const c of d.corners) { expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(1); expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(1); }
    expect(Math.abs(d.corners[0].x - 500 / 3199)).toBeLessThan(0.03);
  });
});

describe('straightening', () => {
  it('detect + warp turns a skewed photo back into the original page (compared cell by cell)', () => {
    // A low-frequency page: 6 columns x 4 rows of distinct grey cells.
    const cells = (u: number, v: number) => 60 + (Math.min(5, Math.floor(u * 6)) * 4 + Math.min(3, Math.floor(v * 4)) * 31) % 160 + (Math.floor(u * 6) % 2) * 20;
    const quad = Q(60, 30, 275, 55, 250, 215, 40, 190); const shot = photo(320, 240, quad, 20, cells);
    const d = detectDocument(shot); expect(d.found).toBe(true);
    const px = d.corners.map((c) => ({ x: c.x * 319, y: c.y * 239 })) as Quad; const size = outputSize(px, 600);
    const flat = warpPerspective(shot, px, size.width, size.height);
    let worst = 0;
    for (let cu = 0; cu < 6; cu++) for (let cv = 0; cv < 4; cv++) {
      const x = Math.round(((cu + 0.5) / 6) * (size.width - 1)), y = Math.round(((cv + 0.5) / 4) * (size.height - 1));
      worst = Math.max(worst, Math.abs(flat.data[(y * size.width + x) * 4] - cells((cu + 0.5) / 6, (cv + 0.5) / 4)));
    }
    expect(worst).toBeLessThan(12);
  });
  it('homography maps each source corner onto its target, and is exact for a plain scale', () => {
    const from = UNIT, to = Q(10, 20, 110, 25, 105, 90, 5, 80); const H = homography(from, to)!;
    from.forEach((p, i) => { const r = applyHomography(H, p); expect(r.x).toBeCloseTo(to[i].x, 6); expect(r.y).toBeCloseTo(to[i].y, 6); });
    const S = homography(UNIT, Q(0, 0, 4, 0, 4, 2, 0, 2))!; expect(applyHomography(S, { x: 0.5, y: 0.5 })).toEqual({ x: expect.closeTo(2, 6), y: expect.closeTo(1, 6) });
  });
  it('returns null for a degenerate (collapsed) quad instead of garbage', () => {
    expect(homography(UNIT, Q(5, 5, 5, 5, 5, 5, 5, 5))).toBeNull();
  });
  it('outputSize averages opposite sides and respects the size cap', () => {
    expect(outputSize(Q(0, 0, 200, 0, 200, 100, 0, 100), 1000)).toEqual({ width: 200, height: 100 });
    expect(outputSize(Q(0, 0, 200, 0, 200, 100, 0, 100), 100)).toEqual({ width: 100, height: 50 });
    const s = outputSize(Q(0, 0, 100, 0, 90, 80, 10, 80), 1000); expect(s.width).toBe(90); expect(s.height).toBe(81); // top 100 and bottom 80 wide; both sides about 80.6 tall
  });
  it('shrinkQuad pulls corners evenly towards the centre and keeps the shape', () => {
    const q = Q(0, 0, 100, 0, 100, 60, 0, 60); const s = shrinkQuad(q, 0.9);
    expect(s[0].x).toBeCloseTo(5, 6); expect(s[0].y).toBeCloseTo(3, 6); expect(s[2].x).toBeCloseTo(95, 6); expect(s[2].y).toBeCloseTo(57, 6);
    expect(polygonArea(s) / polygonArea(q)).toBeCloseTo(0.81, 6); expect(shrinkQuad(q, 1)).toEqual(q);
  });
  it('rotateImg turns pixels by quarter turns and four turns is the identity', () => {
    const a = newImg(3, 2); for (let i = 0; i < 6; i++) a.data.set([i * 10, 0, 0, 255], i * 4); // row0: 0 10 20 / row1: 30 40 50
    const r1 = rotateImg(a, 1); expect([r1.width, r1.height]).toEqual([2, 3]); expect([r1.data[0], r1.data[4]]).toEqual([30, 0]); // clockwise: top row becomes 30,0
    const r2 = rotateImg(a, 2); expect([r2.data[0], r2.data[20]]).toEqual([50, 0]);
    let r = a; for (let i = 0; i < 4; i++) r = rotateImg(r, 1); expect(Array.from(r.data)).toEqual(Array.from(a.data));
    expect(rotateImg(a, 3).width).toBe(2); expect(rotateImg(a, -1).width).toBe(2); expect(rotateImg(a, 0)).toBe(a);
  });
});

describe('geometry helpers', () => {
  it('orders corners as TL, TR, BR, BL whatever order they arrive in', () => {
    const want = Q(10, 10, 90, 15, 85, 70, 5, 65);
    for (const perm of [[0, 1, 2, 3], [2, 3, 0, 1], [3, 2, 1, 0], [1, 3, 0, 2]]) expect(orderCorners(perm.map((i) => want[i]))).toEqual(want);
  });
  it('convex hull of a point cloud keeps only the outline; area is right', () => {
    const pts: Pt[] = []; for (let x = 0; x <= 10; x++) for (let y = 0; y <= 6; y++) pts.push({ x, y });
    const hull = convexHull(pts); expect(hull.length).toBe(4); expect(polygonArea(hull)).toBe(60);
    expect(convexHull([{ x: 1, y: 1 }, { x: 1, y: 1 }]).length).toBe(1);
  });
  it('Otsu finds the gap between a dark and a bright group', () => {
    const g = new Uint8ClampedArray(1000); for (let i = 0; i < 1000; i++) g[i] = i < 400 ? 40 + (i % 10) : 200 + (i % 10); const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(49); expect(t).toBeLessThan(200);
  });
  it('downscale averages blocks and leaves small images alone', () => {
    const a = newImg(4, 4); for (let i = 0; i < 16; i++) a.data.set([i < 8 ? 0 : 200, 0, 0, 255], i * 4);
    const s = downscale(a, 2); expect([s.width, s.height]).toEqual([2, 2]); expect(s.data[0]).toBe(0); expect(s.data[(1 * 2 + 0) * 4]).toBe(200); expect(downscale(a, 10)).toBe(a);
  });
  it('box blur keeps a flat image flat and smooths a spike', () => {
    const flat = new Uint8Array(50).fill(77); expect(Array.from(boxBlur(flat, 10, 5, 3)).every((v) => Math.abs(v - 77) < 1e-3)).toBe(true);
    const spike = new Uint8Array(25); spike[12] = 255; const b = boxBlur(spike, 5, 5, 1); expect(b[12]).toBeLessThan(60); expect(b[12]).toBeGreaterThan(0);
    expect(Array.from(boxBlur(spike, 5, 5, 0))).toEqual(Array.from(spike));
  });
  it('toGray weights green most', () => { const a = newImg(3, 1); a.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]); const g = toGray(a); expect(g[1]).toBeGreaterThan(g[0]); expect(g[0]).toBeGreaterThan(g[2]); });
});

describe('cleaning up a scan', () => {
  // A page lit unevenly (dark on the left, bright on the right) with black text lines: the classic bad phone scan.
  const W = 400, H = 300;
  const isText = (x: number, y: number) => x > 40 && x < 360 && y > 30 && y < 270 && Math.floor((y - 30) / 12) % 2 === 0 && x % 7 < 5;
  const scan = (() => { const img = newImg(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const light = 0.55 + 0.45 * (x / W); const v = (isText(x, y) ? 35 : 225) * light; img.data.set([v, v, v * 0.96, 255], (y * W + x) * 4); } return img; })();
  const stats = (img: Img, text: boolean) => { let n = 0, sum = 0, sq = 0, minv = 255; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (isText(x, y) !== text || x < 20 || x > 380 || y < 15 || y > 285) continue; if (!text && !(x > 40 && x < 360 && y > 30 && y < 270 && Math.floor((y - 30) / 12) % 2 === 1)) continue; const v = img.data[(y * W + x) * 4]; n++; sum += v; sq += v * v; if (v < minv) minv = v; } const m = sum / n; return { mean: m, std: Math.sqrt(Math.max(0, sq / n - m * m)), n }; };

  it('"Clean page" removes the shadow gradient: the paper becomes evenly white and the text stays dark', () => {
    const before = stats(scan, false); const out = applyFilter(cloneImg(scan), 'magic'); const paper = stats(out, false), ink = stats(out, true);
    expect(before.std).toBeGreaterThan(20); expect(paper.mean).toBeGreaterThan(235); expect(paper.std).toBeLessThan(12); expect(ink.mean).toBeLessThan(80);
  });
  it('"Black & white" gives pure black and white, mostly right on both paper and text', () => {
    const out = applyFilter(cloneImg(scan), 'bw'); const values = new Set<number>(); for (let i = 0; i < W * H; i++) values.add(out.data[i * 4]);
    expect([...values].sort()).toEqual([0, 255]);
    const paper = stats(out, false), ink = stats(out, true); expect(paper.mean).toBeGreaterThan(0.97 * 255); expect(ink.mean).toBeLessThan(0.25 * 255);
  });
  it('"Grayscale" has equal channels and stretches the contrast', () => {
    const out = applyFilter(cloneImg(scan), 'gray'); for (let i = 0; i < W * H; i += 97) expect(out.data[i * 4]).toBe(out.data[i * 4 + 1]);
    let lo = 255, hi = 0; for (let i = 0; i < W * H; i++) { lo = Math.min(lo, out.data[i * 4]); hi = Math.max(hi, out.data[i * 4]); } expect(hi - lo).toBeGreaterThan(240);
  });
  it('"Auto" widens a washed-out photo to the full range, and "Original" changes nothing', () => {
    const dull = newImg(50, 50); for (let i = 0; i < 2500; i++) { const v = 100 + (i % 50); dull.data.set([v, v, v, 255], i * 4); }
    const a = applyFilter(cloneImg(dull), 'auto'); let lo = 255, hi = 0; for (let i = 0; i < 2500; i++) { lo = Math.min(lo, a.data[i * 4]); hi = Math.max(hi, a.data[i * 4]); } expect(lo).toBeLessThan(10); expect(hi).toBeGreaterThan(245);
    expect(Array.from(applyFilter(cloneImg(dull), 'original').data)).toEqual(Array.from(dull.data));
  });
  it('brightness and contrast move values the right way; zero changes nothing', () => {
    const base = newImg(2, 1); base.data.set([100, 100, 100, 255, 180, 180, 180, 255]);
    const same = cloneImg(base); expect(adjust(same, 0, 0)).toBe(same); expect(Array.from(same.data)).toEqual(Array.from(base.data));
    expect(adjust(cloneImg(base), 40, 0).data[0]).toBeGreaterThan(100); expect(adjust(cloneImg(base), -40, 0).data[0]).toBeLessThan(100);
    const hi = adjust(cloneImg(base), 0, 80); expect(hi.data[0]).toBeLessThan(100); expect(hi.data[4]).toBeGreaterThan(180);
    for (const v of adjust(cloneImg(base), 100, 100).data) expect(v).toBeLessThanOrEqual(255);
  });
});

describe('PDF page layout', () => {
  it('"fit" sizes the page from the pixels at 200 dpi, plus margins', () => {
    const l = pageLayout('fit', 0, 1654, 2339); expect(l.pageW).toBeCloseTo(595.4, 1); expect(l.pageH).toBeCloseTo(841.9, 0); expect([l.x, l.y]).toEqual([0, 0]);
    const m = pageLayout('fit', 18, 200, 200); expect(m.pageW).toBeCloseTo(72 + 36, 5); expect(m.x).toBe(18);
  });
  it('A4 and Letter centre the image, keep its proportions and respect margins', () => {
    const l = pageLayout('a4', 20, 1000, 2000); expect(l.pageW).toBeCloseTo(595.28, 2); expect(l.pageH).toBeCloseTo(841.89, 2);
    expect(l.w / l.h).toBeCloseTo(0.5, 5); expect(l.x).toBeGreaterThanOrEqual(20 - 1e-9); expect(l.x + l.w).toBeLessThanOrEqual(l.pageW - 20 + 1e-9); expect(l.y + l.h).toBeLessThanOrEqual(l.pageH - 20 + 1e-9);
    expect(l.x).toBeCloseTo((l.pageW - l.w) / 2, 6); expect(pageLayout('letter', 0, 800, 1000).pageW).toBe(612);
  });
  it('landscape scans get a landscape page', () => { const l = pageLayout('a4', 0, 2000, 1000); expect(l.pageW).toBeGreaterThan(l.pageH); expect(l.w).toBeCloseTo(l.pageW, 5); });
});
