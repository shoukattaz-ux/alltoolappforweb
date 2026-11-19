/** Android (Capacitor) file saving. Loaded only inside the native app, never on the web. */
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { base64Chunks, safeFileName } from '../lib/base64';

const DIR = 'exports';

/** True inside the Android app. The Capacitor bridge injects window.Capacitor; on the web it is absent. */
export const isNativeApp = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

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
