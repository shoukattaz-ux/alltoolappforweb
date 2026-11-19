// Copies the OCR engine into public/ocr so it is served from this app (never from a CDN): the worker, two WebAssembly cores
// (SIMD and plain, LSTM engine only) and the English model. Run automatically before dev and build.
import { cpSync, mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => resolve(root, 'node_modules', p);
const out = resolve(root, 'public/ocr');
const files = [
  [nm('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  [nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'core/tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core/tesseract-core-lstm.wasm.js'), 'core/tesseract-core-lstm.wasm.js'],
];
// The "best" quantised English model. It is stored UNCOMPRESSED under its plain name on purpose: the Android build tools silently
// decompress any *.gz asset and drop the extension, so a .gz model would 404 inside the app. (The APK and most servers compress it anyway.)
const modelSrc = nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
let total = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) { console.error(`${from} not found; run npm install`); process.exit(1); }
  const dest = resolve(out, to); mkdirSync(dirname(dest), { recursive: true }); cpSync(from, dest); total += statSync(dest).size;
}
if (!existsSync(modelSrc)) { console.error(`${modelSrc} not found; run npm install`); process.exit(1); }
mkdirSync(resolve(out, 'lang'), { recursive: true }); writeFileSync(resolve(out, 'lang/eng.traineddata'), gunzipSync(readFileSync(modelSrc))); total += statSync(resolve(out, 'lang/eng.traineddata')).size;
console.log(`OCR assets copied to public/ocr (${(total / 1048576).toFixed(1)} MB)`);
