import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]);
const filterFor = (action: string) => filters.find((f) => f.includes(`android.intent.action.${action}`)) ?? '';

describe('Android "Open with" and "Share" wiring', () => {
  it('the app is offered for PDFs, images and videos by VIEW, SEND and SEND_MULTIPLE', () => {
    for (const action of ['VIEW', 'SEND', 'SEND_MULTIPLE']) {
      const f = filterFor(action); expect(f, action).not.toBe('');
      expect(f).toContain('android.intent.category.DEFAULT');
      for (const mime of ['application/pdf', 'image/*', 'video/*']) expect(f, `${action} ${mime}`).toContain(`android:mimeType="${mime}"`);
    }
    expect(filterFor('VIEW')).toMatch(/android:scheme="content"/); expect(filterFor('VIEW')).not.toMatch(/android:scheme="file"/); // file:// paths would need a storage permission
  });
  it('still declares no permissions (reading a shared file needs none) and keeps the launcher entry', () => {
    expect(manifest).not.toMatch(/<uses-permission/); expect(manifest).toContain('android.intent.action.MAIN'); expect(manifest).toContain('android.intent.category.LAUNCHER');
    expect(manifest).toMatch(/android:launchMode="singleTask"/); // a share while the app is open arrives as onNewIntent, not a second copy of the app
  });
  it('the plugin is registered before the bridge starts, and holds the event until the page is listening', () => {
    const main = read('android/app/src/main/java/app/toolhaven/studio/MainActivity.java');
    expect(main.indexOf('registerPlugin(SharedFilesPlugin.class)')).toBeGreaterThan(-1);
    expect(main.indexOf('registerPlugin(SharedFilesPlugin.class)')).toBeLessThan(main.indexOf('super.onCreate'));
    const plugin = read('android/app/src/main/java/app/toolhaven/studio/SharedFilesPlugin.java');
    expect(plugin).toMatch(/@CapacitorPlugin\(name = "SharedFiles"\)/); expect(plugin).toMatch(/handleOnNewIntent/);
    expect(plugin).toMatch(/notifyListeners\("sharedFiles", data, true\)/);                  // retainUntilConsumed: a cold start is not lost
    expect(plugin).toMatch(/FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY/);                          // re-opening from recents is not a new share
    expect(plugin).not.toMatch(/openInputStream|FileOutputStream|getCacheDir/);              // nothing is copied anywhere
  });
  it('the page and the plugin agree on the event name and payload fields', () => {
    const js = read('src/scripts/native.ts'); const java = read('android/app/src/main/java/app/toolhaven/studio/SharedFilesPlugin.java');
    expect(js).toContain("'sharedFiles'");
    for (const field of ['uri', 'name', 'mimeType', 'size']) { expect(java).toContain(`f.put("${field}"`); expect(js).toMatch(new RegExp(`${field}: `)); }
    expect(java).toContain('data.put("files"'); expect(java).toContain('data.put("skipped"');
  });
});

describe('OCR assets survive the Android build', () => {
  it('the model is shipped uncompressed under its plain name, because Android\'s asset merge strips and decompresses .gz files', () => {
    const copy = read('scripts/copy-ocr-assets.mjs'); const tool = read('src/scripts/tools/extract-text.ts');
    expect(copy).toMatch(/gunzipSync/); expect(copy).toContain("'lang/eng.traineddata'"); expect(copy).not.toMatch(/'lang\/eng\.traineddata\.gz'/);
    expect(tool).toMatch(/gzip: false/); expect(tool).toMatch(/langPath: '\/ocr\/lang'/);
  });
});
