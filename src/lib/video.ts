/** Pure maths for the video compressor: dimensions, bitrates, size estimates and time parsing. No DOM, fully unit-tested. */

export type Preset = 'high' | 'balanced' | 'small' | 'tiny';
export type Codec = 'avc' | 'vp9' | 'av1';

/** Bits per pixel per frame for H.264 at each preset. Other codecs need fewer bits for similar quality. */
const BPP: Record<Preset, number> = { high: 0.14, balanced: 0.085, small: 0.05, tiny: 0.03 };
const CODEC_EFFICIENCY: Record<Codec, number> = { avc: 1, vp9: 0.75, av1: 0.6 };
export const AUDIO_BPS = 96_000;
export const MIN_VIDEO_BPS = 60_000;

export const PRESET_LABEL: Record<Preset, string> = {
  high: 'High quality (visually near-identical)',
  balanced: 'Balanced (recommended)',
  small: 'Small file (some softness)',
  tiny: 'Tiny (for sharing, visible quality loss)',
};

/** Round down to an even number (video encoders require even dimensions), minimum 2. */
export const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Fit a frame inside `maxHeight` (the shorter-edge convention: 720p means 720 on the short side). Never upscales. */
export function fitDimensions(width: number, height: number, maxShortSide: number | null): { width: number; height: number; scaled: boolean } {
  const short = Math.min(width, height);
  if (!maxShortSide || short <= maxShortSide) return { width: even(width), height: even(height), scaled: false };
  const k = maxShortSide / short;
  return { width: even(width * k), height: even(height * k), scaled: true };
}

/** Video bitrate (bits/s) for a quality preset. Never exceeds 90% of the source bitrate when it is known, because a re-encode cannot add quality. */
export function presetBitrate(preset: Preset, codec: Codec, width: number, height: number, fps: number, sourceBps?: number): number {
  const raw = BPP[preset] * CODEC_EFFICIENCY[codec] * width * height * Math.max(1, fps);
  const cap = sourceBps && Number.isFinite(sourceBps) && sourceBps > 0 ? sourceBps * 0.9 : Infinity;
  return Math.round(Math.max(MIN_VIDEO_BPS, Math.min(raw, cap)));
}

/** Video bitrate that makes the whole file land near `targetBytes` (5% headroom for container overhead and rate-control drift). */
export function bitrateForTargetSize(targetBytes: number, durationSec: number, audioBps: number): number {
  if (!(durationSec > 0)) return MIN_VIDEO_BPS;
  const totalBps = (targetBytes * 8 * 0.95) / durationSec;
  return Math.max(MIN_VIDEO_BPS, Math.round(totalBps - audioBps));
}

export function estimateBytes(videoBps: number, audioBps: number, durationSec: number): number {
  return Math.round(((videoBps + audioBps) * Math.max(0, durationSec)) / 8 * 1.02);
}

/** Parse "90", "1:30", "01:02:03.5" into seconds. Returns null for empty or invalid input. */
export function parseTimecode(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  if (parts.length > 1 && parts.slice(1).some((p) => p >= 60)) return null;
  return Number.isFinite(secs) ? secs : null;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Validate an optional trim range against the video length. Returns an error message, or the resolved range. */
export function resolveTrim(startText: string, endText: string, duration: number): { start?: number; end?: number; error?: string } {
  const start = parseTimecode(startText); const end = parseTimecode(endText);
  if (startText.trim() && start === null) return { error: 'Start time must look like 90, 1:30 or 0:01:30.' };
  if (endText.trim() && end === null) return { error: 'End time must look like 90, 1:30 or 0:01:30.' };
  if (start !== null && start >= duration) return { error: `Start time must be before the end of the video (${formatDuration(duration)}).` };
  if (end !== null && start !== null && end <= start) return { error: 'End time must be after the start time.' };
  if (end !== null && end <= 0) return { error: 'End time must be greater than zero.' };
  return { start: start ?? undefined, end: end !== null && end < duration ? end : undefined };
}
