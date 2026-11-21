/** Streams a Blob as base64 text in fixed-size pieces, so a large file never has to exist as one giant string.
 *  `chunkBytes` must be a multiple of 3: then every piece encodes to base64 with no padding, and the pieces
 *  can simply be appended to each other (only the last may end in "="). */
export async function* base64Chunks(blob: Blob, chunkBytes = 3 * 1024 * 1024): AsyncGenerator<string> {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes % 3 !== 0) throw new RangeError('chunkBytes must be a positive multiple of 3');
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + chunkBytes).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    yield btoa(binary);
  }
}

/** Make a name safe to use as a single file name in app storage. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return cleaned || 'download';
}
