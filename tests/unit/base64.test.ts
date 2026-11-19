import { describe, it, expect } from 'vitest';
import { base64Chunks, safeFileName } from '../../src/lib/base64';

const collect = async (blob: Blob, size?: number) => { const out: string[] = []; for await (const c of base64Chunks(blob, size)) out.push(c); return out; };

describe('base64Chunks (Android file saving)', () => {
  it('concatenated chunks decode to exactly the original bytes', async () => {
    const bytes = new Uint8Array(10_001).map((_, i) => (i * 31 + 7) & 255);
    const chunks = await collect(new Blob([bytes]), 3000);
    expect(chunks.length).toBe(4);
    expect(Buffer.from(chunks.join(''), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
  it('only the last chunk may carry "=" padding, so plain appending is valid', async () => {
    const chunks = await collect(new Blob([new Uint8Array(9_001)]), 3000);
    for (const c of chunks.slice(0, -1)) expect(c.includes('=')).toBe(false);
  });
  it('yields nothing for an empty blob and handles one tiny chunk', async () => {
    expect(await collect(new Blob([]))).toEqual([]);
    expect(await collect(new Blob([new Uint8Array([1, 2, 3, 4])]))).toEqual([Buffer.from([1, 2, 3, 4]).toString('base64')]);
  });
  it('rejects a chunk size that is not a multiple of 3 (would corrupt the output)', async () => {
    await expect(collect(new Blob([new Uint8Array(10)]), 1000)).rejects.toThrow(RangeError);
  });
  it('handles a multi-megabyte blob with the default chunk size', async () => {
    const big = new Uint8Array(7 * 1024 * 1024).fill(200);
    const chunks = await collect(new Blob([big]));
    expect(chunks.length).toBe(3);
    expect(Buffer.from(chunks.join(''), 'base64').length).toBe(big.length);
  });
});

describe('safeFileName', () => {
  it('strips path separators and control characters, keeps the extension', () => {
    const traversal = safeFileName('../../etc/passwd.pdf');
    expect(traversal).toBe('_.._etc_passwd.pdf');
    expect(/[\\/]/.test(traversal)).toBe(false); // no separator survives, so it cannot leave the exports folder
    expect(safeFileName('a:b*c?.mp4')).toBe('a_b_c_.mp4');
    expect(safeFileName('')).toBe('download');
    expect(safeFileName('.hidden')).toBe('hidden');
  });
});
