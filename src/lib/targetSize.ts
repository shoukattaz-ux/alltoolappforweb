/**
 * "Make it fit" search: find the best-looking encoding whose size is at or below a target.
 * Pure and DOM-free: the caller supplies `encode` (scale, quality -> result) and `sizeOf`, so the search is unit-testable.
 */

export interface Step { scale: number; quality: number }

export interface FitResult<T> {
  /** The best encoding that fits, or (when nothing fits) the smallest one tried. */
  value: T | null;
  step: Step | null;
  size: number;
  fits: boolean;
  attempts: number;
}

const SCALES = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18];
const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5];

/** Candidate settings ordered from best looking to smallest. */
export function defaultSteps(): Step[] {
  const out: Step[] = [];
  for (const scale of SCALES) for (const quality of QUALITIES) out.push({ scale, quality });
  return out;
}

export interface FitOptions {
  steps?: Step[];
  /** Extra bisection rounds between the last failing and first fitting step. */
  refine?: number;
  onAttempt?: (attempts: number) => void;
  signal?: { cancelled: boolean };
}

export class FitCancelled extends Error { constructor() { super('Cancelled'); } }

export async function fitToSize<T>(encode: (s: Step) => Promise<T>, sizeOf: (v: T) => number, target: number, opts: FitOptions = {}): Promise<FitResult<T>> {
  const steps = opts.steps ?? defaultSteps();
  const refine = opts.refine ?? 3;
  let attempts = 0;
  type Tried = { v: T; s: Step; size: number };
  const track: { smallest?: Tried } = {};
  const cache = new Map<number, { v: T; size: number }>();

  const run = async (s: Step) => {
    if (opts.signal?.cancelled) throw new FitCancelled();
    const v = await encode(s);
    attempts++; opts.onAttempt?.(attempts);
    const size = sizeOf(v);
    if (!track.smallest || size < track.smallest.size) track.smallest = { v, s, size };
    return { v, size };
  };
  const at = async (i: number) => {
    let r = cache.get(i);
    if (!r) { r = await run(steps[i]); cache.set(i, r); }
    return r;
  };

  // Best setting already fits: nothing to give up.
  const first = await at(0);
  if (first.size <= target) return { value: first.v, step: steps[0], size: first.size, fits: true, attempts };
  // Even the smallest setting is too big: report the smallest we can do.
  const last = await at(steps.length - 1);
  if (last.size > target) { const m = track.smallest as Tried; return { value: m.v, step: m.s, size: m.size, fits: false, attempts }; }

  // Invariant: steps[lo] does not fit, steps[hi] fits.
  let lo = 0, hi = steps.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await at(mid)).size <= target) hi = mid; else lo = mid;
  }
  let best = { v: (await at(hi)).v, step: steps[hi], size: (await at(hi)).size };

  // Bisect between the failing and fitting settings to land close to the target.
  let a = steps[lo], b = steps[hi];
  for (let k = 0; k < refine; k++) {
    const mid: Step = { scale: (a.scale + b.scale) / 2, quality: (a.quality + b.quality) / 2 };
    const r = await run(mid);
    if (r.size <= target) { b = mid; best = { v: r.v, step: mid, size: r.size }; }
    else a = mid;
  }
  return { value: best.v, step: best.step, size: best.size, fits: true, attempts };
}

/** Parses "50", "50 KB", "1.5mb" etc. into bytes. Plain numbers use `defaultUnit`. Returns null if invalid. */
export function parseSize(text: string, defaultUnit: 'kb' | 'mb' = 'kb'): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kb|k|mb|m|bytes|b)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] ?? defaultUnit).toLowerCase();
  const mult = u === 'mb' || u === 'm' ? 1024 * 1024 : u === 'kb' || u === 'k' ? 1024 : 1;
  const bytes = Math.round(n * mult);
  return bytes >= 1 ? bytes : null;
}
