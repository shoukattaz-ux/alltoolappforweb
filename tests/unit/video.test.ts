import { describe, it, expect } from 'vitest';
import { fitDimensions, presetBitrate, bitrateForTargetSize, estimateBytes, parseTimecode, formatDuration, resolveTrim, even } from '../../src/lib/video';
import { sniffKind } from '../../src/lib/files';

const blob = (bytes: number[]) => new Blob([new Uint8Array(bytes)]);

describe('video file detection', () => {
  it('recognises MP4/MOV by the ftyp box and WebM/MKV by the EBML magic', async () => {
    expect(await sniffKind(blob([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0]))).toBe('mp4');
    expect(await sniffKind(blob([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]))).toBe('webm');
  });
  it('does not accept a renamed text file', async () => {
    expect(await sniffKind(new Blob(['hello world, definitely not a video']))).toBeNull();
  });
});

describe('fitDimensions', () => {
  it('scales by the short side, keeps aspect ratio and returns even sizes', () => {
    expect(fitDimensions(1920, 1080, 720)).toEqual({ width: 1280, height: 720, scaled: true });
    expect(fitDimensions(1080, 1920, 720)).toEqual({ width: 720, height: 1280, scaled: true }); // portrait
    const odd = fitDimensions(1000, 563, 360); expect(odd.width % 2).toBe(0); expect(odd.height % 2).toBe(0);
  });
  it('never upscales and passes through when no limit is set', () => {
    expect(fitDimensions(640, 360, 720)).toEqual({ width: 640, height: 360, scaled: false });
    expect(fitDimensions(1281, 721, null)).toEqual({ width: 1280, height: 720, scaled: false });
  });
  it('even() has a floor of 2', () => { expect(even(0)).toBe(2); expect(even(7)).toBe(6); });
});

describe('bitrates and estimates', () => {
  it('presets get progressively smaller and newer codecs need fewer bits', () => {
    const b = (p: 'high' | 'balanced' | 'small' | 'tiny', c: 'avc' | 'vp9' | 'av1' = 'avc') => presetBitrate(p, c, 1280, 720, 30);
    expect(b('high')).toBeGreaterThan(b('balanced')); expect(b('balanced')).toBeGreaterThan(b('small')); expect(b('small')).toBeGreaterThan(b('tiny'));
    expect(b('balanced', 'av1')).toBeLessThan(b('balanced', 'vp9')); expect(b('balanced', 'vp9')).toBeLessThan(b('balanced'));
  });
  it('720p30 balanced H.264 lands in a sensible range (about 2.3 Mbps)', () => {
    const v = presetBitrate('balanced', 'avc', 1280, 720, 30); expect(v).toBeGreaterThan(2_000_000); expect(v).toBeLessThan(2_700_000);
  });
  it('never asks for more than 90% of the source bitrate, and has a floor', () => {
    expect(presetBitrate('high', 'avc', 1920, 1080, 60, 1_000_000)).toBe(900_000);
    expect(presetBitrate('tiny', 'av1', 160, 90, 1)).toBe(60_000);
  });
  it('target-size bitrate reproduces the requested size within a few percent', () => {
    const dur = 120, target = 20 * 1024 * 1024, v = bitrateForTargetSize(target, dur, 96_000);
    const est = estimateBytes(v, 96_000, dur);
    expect(est).toBeLessThan(target); expect(est).toBeGreaterThan(target * 0.9);
  });
  it('handles zero duration and absurdly small targets safely', () => {
    expect(bitrateForTargetSize(1_000_000, 0, 96_000)).toBe(60_000);
    expect(bitrateForTargetSize(1000, 600, 96_000)).toBe(60_000);
    expect(estimateBytes(1_000_000, 96_000, -5)).toBe(0);
  });
});

describe('time parsing', () => {
  it('parses seconds, m:ss and h:mm:ss with decimals', () => {
    expect(parseTimecode('90')).toBe(90); expect(parseTimecode('1:30')).toBe(90); expect(parseTimecode('0:01:30')).toBe(90);
    expect(parseTimecode('1:02:03.5')).toBe(3723.5); expect(parseTimecode(' 2.5 ')).toBe(2.5); expect(parseTimecode('')).toBeNull();
  });
  it('rejects garbage and out-of-range minutes or seconds', () => {
    for (const bad of ['abc', '1:75', '-5', '1::2', '1:2:3:4', '1,5']) expect(parseTimecode(bad)).toBeNull();
  });
  it('formats durations', () => { expect(formatDuration(65)).toBe('1:05'); expect(formatDuration(3725)).toBe('1:02:05'); expect(formatDuration(NaN)).toBe('—'); });
});

describe('resolveTrim', () => {
  it('accepts empty and valid ranges; ignores an end beyond the video', () => {
    expect(resolveTrim('', '', 60)).toEqual({ start: undefined, end: undefined });
    expect(resolveTrim('5', '20', 60)).toEqual({ start: 5, end: 20 });
    expect(resolveTrim('5', '999', 60)).toEqual({ start: 5, end: undefined });
  });
  it('reports clear errors', () => {
    expect(resolveTrim('x', '', 60).error).toMatch(/Start time/);
    expect(resolveTrim('', 'y', 60).error).toMatch(/End time/);
    expect(resolveTrim('70', '', 60).error).toMatch(/before the end/);
    expect(resolveTrim('30', '10', 60).error).toMatch(/after the start/);
    expect(resolveTrim('', '0', 60).error).toMatch(/greater than zero/);
  });
});
