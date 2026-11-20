import { describe, it, expect } from 'vitest';
import { PHOTO_SIZES, PAPERS, mmToPx, mmToPt, cropRect, sheetLayout, replaceBackground, setJpegDpi } from '../../src/lib/idphoto';

describe('sizes', () => {
  it('converts millimetres to pixels at 300 DPI', () => {
    expect(mmToPx(35, 300)).toBe(413); expect(mmToPx(45, 300)).toBe(531); expect(mmToPx(50.8, 300)).toBe(600);
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
  });
  it('has unique ids and sensible portrait/square sizes', () => {
    expect(new Set(PHOTO_SIZES.map((s) => s.id)).size).toBe(PHOTO_SIZES.length);
    for (const s of PHOTO_SIZES) { expect(s.wMm).toBeGreaterThan(10); expect(s.hMm).toBeGreaterThanOrEqual(s.wMm); }
  });
});

describe('cropRect', () => {
  it('at zoom 1 is the largest frame of that aspect, centred where asked', () => {
    const r = cropRect(2000, 1000, 0.5, 1, 1000, 500);
    expect(r.h).toBeCloseTo(1000); expect(r.w).toBeCloseTo(500); expect(r.x).toBeCloseTo(750); expect(r.w / r.h).toBeCloseTo(0.5);
  });
  it('zooming shrinks the frame and keeps the aspect', () => {
    const a = cropRect(1000, 1000, 35 / 45, 1, 500, 500), b = cropRect(1000, 1000, 35 / 45, 2, 500, 500);
    expect(b.w).toBeCloseTo(a.w / 2); expect(b.w / b.h).toBeCloseTo(35 / 45);
  });
  it('never leaves the image, however far the centre is pushed', () => {
    for (const [cx, cy] of [[-500, -500], [5000, 5000], [0, 999], [999, 0]]) {
      const r = cropRect(1000, 800, 0.8, 3, cx, cy);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1000 + 1e-9); expect(r.y + r.h).toBeLessThanOrEqual(800 + 1e-9);
    }
  });
  it('clamps zoom to a sane range', () => { expect(cropRect(100, 100, 1, 0.2, 50, 50).w).toBeCloseTo(100); expect(cropRect(100, 100, 1, 99, 50, 50).w).toBeCloseTo(12.5); });
});

describe('sheetLayout', () => {
  const photo = { wMm: 35, hMm: 45 };
  it('fits 6 passport photos on 4 x 6 in paper', () => {
    const l = sheetLayout(PAPERS[0], photo); expect(l.count).toBe(6); expect(l.positions).toHaveLength(6);
  });
  it('holds more on A4, all inside the page and not overlapping', () => {
    const l = sheetLayout(PAPERS[2], photo, 5, 2);
    expect(l.count).toBeGreaterThanOrEqual(16);
    for (const p of l.positions) { expect(p.x).toBeGreaterThanOrEqual(5 - 1e-9); expect(p.y).toBeGreaterThanOrEqual(5 - 1e-9); expect(p.x + 35).toBeLessThanOrEqual(l.paperW - 5 + 1e-9); expect(p.y + 45).toBeLessThanOrEqual(l.paperH - 5 + 1e-9); }
    for (let i = 0; i < l.positions.length; i++) for (let j = i + 1; j < l.positions.length; j++) {
      const a = l.positions[i], b = l.positions[j];
      expect(a.x + 35 <= b.x + 1e-9 || b.x + 35 <= a.x + 1e-9 || a.y + 45 <= b.y + 1e-9 || b.y + 45 <= a.y + 1e-9).toBe(true);
    }
  });
  it('picks the orientation that holds more', () => {
    const l = sheetLayout({ wMm: 100, hMm: 60 }, { wMm: 30, hMm: 50 }, 2, 2); expect(l.count).toBe(3);
    const p = sheetLayout({ wMm: 60, hMm: 100 }, { wMm: 30, hMm: 50 }, 2, 2); expect(p.count).toBe(3);
  });
  it('returns zero when a photo does not fit', () => { expect(sheetLayout({ wMm: 40, hMm: 40 }, { wMm: 50, hMm: 70 }).count).toBe(0); });
});

function picture(w: number, h: number, bg: number[], face: { x0: number; y0: number; x1: number; y1: number }, faceColor = [200, 140, 110]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const inside = x >= face.x0 && x < face.x1 && y >= face.y0 && y < face.y1;
    const c = inside ? faceColor : bg; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return d;
}
describe('replaceBackground', () => {
  const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
  it('whitens a plain background and leaves the subject alone', () => {
    const w = 60, h = 80, d = picture(w, h, [120, 150, 200], { x0: 20, y0: 20, x1: 40, y1: 60 });
    const frac = replaceBackground(d, w, h, 40, [255, 255, 255]);
    expect(px(d, w, 2, 2)).toEqual([255, 255, 255]); expect(px(d, w, 57, 77)).toEqual([255, 255, 255]);
    expect(px(d, w, 30, 40)).toEqual([200, 140, 110]);
    expect(frac).toBeCloseTo(1 - (20 * 40) / (60 * 80), 1);
  });
  it('does not repaint background-coloured pixels that are enclosed by the subject', () => {
    const w = 60, h = 60, d = picture(w, h, [120, 150, 200], { x0: 10, y0: 10, x1: 50, y1: 50 });
    for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) { const i = (y * w + x) * 4; d[i] = 120; d[i + 1] = 150; d[i + 2] = 200; }
    replaceBackground(d, w, h, 40, [255, 255, 255]);
    expect(px(d, w, 30, 30)).toEqual([120, 150, 200]);
  });
  it('does nothing at zero tolerance, and reports a huge fraction when tolerance swallows everything', () => {
    const w = 30, h = 30, d = picture(w, h, [120, 150, 200], { x0: 10, y0: 10, x1: 20, y1: 20 });
    const copy = d.slice(); expect(replaceBackground(d, w, h, 0, [255, 255, 255])).toBe(0); expect(d).toEqual(copy);
    expect(replaceBackground(d, w, h, 400, [255, 255, 255])).toBeGreaterThan(0.99);
  });
  it('can paint a coloured background', () => {
    const w = 30, h = 30, d = picture(w, h, [250, 250, 250], { x0: 10, y0: 10, x1: 20, y1: 20 });
    replaceBackground(d, w, h, 30, [219, 233, 245]); expect(px(d, w, 1, 1)).toEqual([219, 233, 245]);
  });
});

describe('setJpegDpi', () => {
  const jfif = (units: number, x: number, y: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, units, x >> 8, x & 255, y >> 8, y & 255, 0, 0, 0xff, 0xd9]);
  it('rewrites an existing JFIF density in place', () => {
    const out = setJpegDpi(jfif(0, 1, 1), 300);
    expect(Array.from(out.slice(13, 18))).toEqual([1, 1, 44, 1, 44]); expect(out.length).toBe(22);
  });
  it('adds a JFIF header when there is none (e.g. EXIF first)', () => {
    const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2, 0xff, 0xd9]);
    const out = setJpegDpi(exif, 300);
    expect(Array.from(out.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]); expect(Array.from(out.slice(13, 18))).toEqual([1, 1, 44, 1, 44]);
    expect(out.length).toBe(exif.length + 18); expect(Array.from(out.slice(20))).toEqual(Array.from(exif.slice(2)));
  });
  it('leaves non-JPEG data untouched', () => { const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); expect(setJpegDpi(png, 300)).toBe(png); });
});
