import { describe, it, expect } from 'vitest';
import { fitToSize, defaultSteps, parseSize, FitCancelled, type Step } from '../../src/lib/targetSize';

// A fake encoder: size shrinks smoothly with both scale (area) and quality.
const model = (full: number) => async (s: Step) => Math.round(full * s.scale * s.scale * (0.15 + 0.85 * s.quality));
const id = (n: number) => n;

describe('fitToSize', () => {
  it('returns the best setting straight away when it already fits', async () => {
    const r = await fitToSize(model(50_000), id, 80_000);
    expect(r.fits).toBe(true); expect(r.step).toEqual(defaultSteps()[0]); expect(r.attempts).toBe(1);
  });
  it('finds a setting at or under the target and close to it', async () => {
    for (const target of [20_000, 50_000, 100_000, 300_000]) {
      const r = await fitToSize(model(900_000), id, target);
      expect(r.fits).toBe(true);
      expect(r.size).toBeLessThanOrEqual(target);
      expect(r.size).toBeGreaterThan(target * 0.6); // not wastefully small
    }
  });
  it('uses few encodes (cheap on a phone)', async () => {
    const r = await fitToSize(model(900_000), id, 100_000);
    expect(r.attempts).toBeLessThanOrEqual(12);
  });
  it('reports the smallest result and fits=false when the target is unreachable', async () => {
    const r = await fitToSize(model(900_000), id, 10);
    expect(r.fits).toBe(false);
    const steps = defaultSteps(); const smallest = Math.min(...(await Promise.all(steps.map(model(900_000)))));
    expect(r.size).toBe(smallest);
  });
  it('never returns a result larger than the target when it says it fits (even with a noisy encoder)', async () => {
    const noisy = async (s: Step) => Math.round(900_000 * s.scale * s.scale * (0.15 + 0.85 * s.quality) * (1 + 0.05 * Math.sin(s.scale * 97 + s.quality * 31)));
    for (const target of [30_000, 120_000, 400_000]) {
      const r = await fitToSize(noisy, id, target);
      if (r.fits) expect(r.size).toBeLessThanOrEqual(target);
    }
  });
  it('can be cancelled', async () => {
    const signal = { cancelled: false };
    await expect(fitToSize(async (s) => { signal.cancelled = true; return model(900_000)(s); }, id, 50_000, { signal })).rejects.toBeInstanceOf(FitCancelled);
  });
  it('steps run from best looking to smallest', () => {
    const s = defaultSteps();
    expect(s[0]).toEqual({ scale: 1, quality: 0.9 });
    expect(s.every((x, i) => i === 0 || x.scale <= s[i - 1].scale)).toBe(true);
  });
});

describe('parseSize', () => {
  it('reads common ways of writing a size', () => {
    expect(parseSize('50')).toBe(50 * 1024);
    expect(parseSize('50 KB')).toBe(50 * 1024);
    expect(parseSize('100kb')).toBe(100 * 1024);
    expect(parseSize('1.5 MB')).toBe(Math.round(1.5 * 1024 * 1024));
    expect(parseSize('2', 'mb')).toBe(2 * 1024 * 1024);
    expect(parseSize('0,5mb')).toBe(Math.round(0.5 * 1024 * 1024));
  });
  it('rejects nonsense', () => {
    for (const bad of ['', 'abc', '-5', '0', '5 gb', '1e3']) expect(parseSize(bad)).toBeNull();
  });
});
