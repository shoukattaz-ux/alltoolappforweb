/** Android (Capacitor) file saving. Loaded only inside the native app, never on the web. */
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { base64Chunks, safeFileName } from '../lib/base64';

const DIR = 'exports';

/**
 * WebView ignores `<a download>`, so write the result to app-private cache storage and open Android's share sheet.
 * From there the person chooses "Save to Files", Drive, WhatsApp, email and so on. Returns false if they dismissed it.
 */
export async function saveNative(blob: Blob, filename: string): Promise<boolean> {
  // Clear earlier exports first so cache storage cannot grow without limit.
  try { await Filesystem.rmdir({ path: DIR, directory: Directory.Cache, recursive: true }); } catch { /* nothing to clear */ }
  const path = `${DIR}/${safeFileName(filename)}`;
  let first = true;
  for await (const data of base64Chunks(blob)) {
    if (first) { await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true }); first = false; }
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  }
  if (first) await Filesystem.writeFile({ path, data: '', directory: Directory.Cache, recursive: true }); // empty file
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Save or share' });
    return true;
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return false; // dismissed the share sheet: not an error
    throw e;
  }
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Files that other apps open with, or share to, this app ("Open with ToolHaven", the Share sheet).                    */
/* The Android plugin (SharedFilesPlugin.java) reports each file's content:// link; the page reads it straight through.  */
/* ------------------------------------------------------------------------------------------------------------------ */

interface SharedFile { uri: string; name: string; mimeType: string; size: number }
interface SharedPayload { files: SharedFile[]; skipped?: number }
interface SharedFilesApi { addListener(event: 'sharedFiles', callback: (data: SharedPayload) => void): Promise<{ remove: () => Promise<void> }> }
const SharedFiles = registerPlugin<SharedFilesApi>('SharedFiles');

/**
 * Starts listening. A file that launched the app is delivered as soon as this listener exists (Android keeps the event until then).
 * `onFiles` gets the opened files; `onError` gets a message when none could be read.
 */
export async function listenForSharedFiles(onFiles: (files: File[], info: { skipped: number; failed: number }) => void, onError: (message: string) => void) {
  try {
  await SharedFiles.addListener('sharedFiles', async (data) => {
    const files: File[] = []; let failed = 0;
    for (const f of data.files ?? []) {
      try {
        const res = await fetch(Capacitor.convertFileSrc(f.uri));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.size) throw new Error('empty');
        files.push(new File([blob], f.name || 'shared-file', { type: f.mimeType || blob.type }));
      } catch { failed++; }
    }
    if (!files.length) { onError('The shared file could not be opened. Try sharing it again.'); return; }
    onFiles(files, { skipped: data.skipped ?? 0, failed });
  });
  } catch { /* the native plugin is not present (an older Android shell): there is simply nothing to listen for */ }
}
