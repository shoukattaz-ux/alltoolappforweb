/** Pure helpers for text recognition (OCR): reading the engine's result, text clean-up and placing invisible text over a page image. No DOM; unit-tested. */

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }

interface RawWord { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }
interface RawData { words?: RawWord[]; blocks?: { paragraphs?: { lines?: { words?: RawWord[] }[] }[] }[] | null }

/** Words with their boxes from a Tesseract.js result. Newer versions nest them (blocks > paragraphs > lines > words), older ones have a flat list. */
export function wordsFromResult(data: RawData | null | undefined): OcrWord[] {
  if (!data) return [];
  const raw: RawWord[] = [];
  if (Array.isArray(data.blocks)) for (const b of data.blocks) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) raw.push(w);
  else if (Array.isArray(data.words)) raw.push(...data.words);
  return raw.filter((w) => typeof w.text === 'string' && w.text.trim() && w.bbox)
    .map((w) => ({ text: w.text!.trim(), x0: w.bbox!.x0, y0: w.bbox!.y0, x1: w.bbox!.x1, y1: w.bbox!.y1, confidence: w.confidence ?? 0 }));
}

/** Average confidence (0-100) of the words, or 0 for none. */
export const meanConfidence = (words: readonly OcrWord[]) => (words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0);
/** Below this, a page's text probably has mistakes worth warning about. */
export const LOW_CONFIDENCE = 60;

/** Neaten recognised text: trim line ends, collapse runs of blank lines, drop leading and trailing blanks. */
export function tidyText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
}

/** All pages' text in one string. With several pages each is introduced by a "--- Page n ---" line. */
export function joinPages(pages: readonly { n: number; text: string }[]): string {
  const withText = pages.filter((p) => p.text.trim());
  if (pages.length <= 1) return withText[0]?.text.trim() ?? '';
  return withText.map((p) => `--- Page ${p.n} ---\n${p.text.trim()}`).join('\n\n');
}

const WINANSI_MAP: Record<string, string> = { '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '−': '-', '•': '*', '…': '...', ' ': ' ', '™': 'TM' };
/**
 * Text a standard PDF font (Helvetica) can draw: Basic Latin plus Latin-1. Typographic quotes and dashes become plain ones; anything else
 * (other scripts, symbols) is dropped, so building the PDF can never fail on a stray character.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c <= 126) || (c >= 161 && c <= 255)) out += ch; else if (WINANSI_MAP[ch]) out += WINANSI_MAP[ch];
  }
  return out;
}

export interface WordPlacement { text: string; x: number; y: number; size: number }

/**
 * Where to draw an invisible word on a PDF page so that selecting or searching the PDF lands on the word in the picture.
 * `widthAtSize1` is the width of the text in the PDF font at font size 1. Coordinates are PDF points (y counts from the bottom).
 */
export function placeWord(w: OcrWord, imgW: number, imgH: number, pageW: number, pageH: number, widthAtSize1: (text: string) => number): WordPlacement | null {
  const text = toWinAnsi(w.text).trim();
  if (!text || imgW <= 0 || imgH <= 0) return null;
  const sx = pageW / imgW, sy = pageH / imgH;
  const boxW = (w.x1 - w.x0) * sx, boxH = (w.y1 - w.y0) * sy;
  if (!(boxW > 0.5) || !(boxH > 0.5)) return null;
  const w1 = widthAtSize1(text); if (!(w1 > 0)) return null;
  const size = Math.max(1, Math.min(boxW / w1, boxH * 1.25)); // fit the word's width, but never taller than its box allows
  return { text, x: w.x0 * sx, y: pageH - w.y1 * sy + boxH * 0.2, size };
}
