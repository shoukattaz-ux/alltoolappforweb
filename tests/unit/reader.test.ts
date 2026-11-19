import { describe, it, expect } from 'vitest';
import { clampZoom, effectiveZoom, nextZoomStep, pixelRatioFor, findInText, PDF_PX_PER_PT } from '../../src/lib/reader';

describe('reader zoom', () => {
  it('fit width makes a US Letter page fill the available width', () => {
    const z = effectiveZoom('width', 612, 792, 800, 600); expect(z * 612 * PDF_PX_PER_PT).toBeCloseTo(800, 5);
  });
  it('fit page picks the smaller of width-fit and height-fit', () => {
    const z = effectiveZoom('page', 612, 792, 2000, 600); expect(z * 792 * PDF_PX_PER_PT).toBeCloseTo(600, 5);
    const w = effectiveZoom('page', 612, 792, 300, 2000); expect(w * 612 * PDF_PX_PER_PT).toBeCloseTo(300, 5);
  });
  it('numeric zoom is used as given but clamped to 25%-400%', () => {
    expect(effectiveZoom(1.5, 612, 792, 100, 100)).toBe(1.5); expect(clampZoom(0.01)).toBe(0.25); expect(clampZoom(99)).toBe(4); expect(clampZoom(NaN)).toBe(1);
  });
  it('zoom steps move through the ladder in both directions and stop at the ends', () => {
    expect(nextZoomStep(1, 1)).toBe(1.1); expect(nextZoomStep(1, -1)).toBe(0.9); expect(nextZoomStep(0.8, 1)).toBe(0.9); expect(nextZoomStep(0.8, -1)).toBe(0.75);
    expect(nextZoomStep(4, 1)).toBe(4); expect(nextZoomStep(0.25, -1)).toBe(0.25);
    let z = 0.25; for (let i = 0; i < 40; i++) z = nextZoomStep(z, 1); expect(z).toBe(4);
  });
});

describe('pixelRatioFor', () => {
  it('uses the device ratio up to 2x', () => { expect(pixelRatioFor(800, 1000, 3)).toBe(2); expect(pixelRatioFor(800, 1000, 1.5)).toBe(1.5); expect(pixelRatioFor(800, 1000, 0)).toBe(1); });
  it('never exceeds the pixel budget, even if that means below 1x', () => {
    const r = pixelRatioFor(3000, 4000, 2); expect(3000 * 4000 * r * r).toBeLessThanOrEqual(16_000_001);
    const huge = pixelRatioFor(20000, 20000, 2); expect(huge).toBeLessThan(1); expect(huge).toBeGreaterThan(0);
  });
});

describe('findInText', () => {
  it('finds every non-overlapping case-insensitive match', () => {
    expect(findInText('The cat sat. THE end. the', 'the')).toEqual([0, 13, 22]);
    expect(findInText('aaaa', 'aa')).toEqual([0, 2]);
  });
  it('returns nothing for empty queries or misses', () => { expect(findInText('hello', '')).toEqual([]); expect(findInText('hello', 'xyz')).toEqual([]); });
  it('skips strings whose length changes when lowercased, instead of returning wrong offsets', () => { expect(findInText('İstanbul', 'i')).toEqual([]); });
});
