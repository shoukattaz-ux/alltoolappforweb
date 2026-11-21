import { describe, it, expect } from 'vitest';
import { suggest, groupOf } from '../../src/lib/launcher';

const slugs = (k: Parameters<typeof suggest>[0]) => suggest(k).suggestions.map((s) => s.slug);

describe('launcher suggestions', () => {
  it('one PDF offers read/sign/compress/split/images but not "combine"', () => {
    expect(slugs(['pdf'])).toEqual(['pdf-reader', 'sign-pdf', 'organize-pdf', 'extract-text', 'compress-pdf', 'compress-to-size', 'split-pdf', 'pdf-to-image']);
  });
  it('two PDFs put "combine" first (multi-file tools lead)', () => {
    const s = slugs(['pdf', 'pdf']); expect(s[0]).toBe('merge-pdf'); expect(s).toContain('pdf-reader');
  });
  it('images and videos map to their tools', () => {
    expect(slugs(['png'])).toContain('image-resizer'); expect(slugs(['jpeg', 'webp'])[0]).toMatch(/image-(compressor|converter|to-pdf)/);
    expect(slugs(['mp4'])).toEqual(['video-compressor']); expect(slugs(['webm'])).toEqual(['video-compressor']);
  });
  it('the first supported file decides the group; other groups and unknown files are reported, not lost silently', () => {
    const r = suggest([null, 'pdf', 'png', 'pdf']);
    expect(r.group).toBe('pdf'); expect(r.accepted).toEqual([1, 3]); expect(r.skipped).toEqual([2]); expect(r.unsupported).toEqual([0]);
  });
  it('nothing supported yields no suggestions', () => {
    const r = suggest([null, null]); expect(r.group).toBeNull(); expect(r.suggestions).toEqual([]); expect(suggest([]).group).toBeNull();
  });
  it('groupOf covers every kind', () => {
    expect(['pdf', 'jpeg', 'png', 'webp', 'mp4', 'webm'].map((k) => groupOf(k as never))).toEqual(['pdf', 'image', 'image', 'image', 'video', 'video']);
  });
});
