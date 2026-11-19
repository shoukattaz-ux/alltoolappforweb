import { describe, it, expect } from 'vitest';
import { wordsFromResult, meanConfidence, tidyText, joinPages, toWinAnsi, placeWord, LOW_CONFIDENCE } from '../../src/lib/ocr';

const w = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });
const width1 = (t: string) => t.length * 0.5; // a fake font: every character is half an em wide

describe('reading the engine result', () => {
  it('collects words from the nested structure and from a flat list, skipping empty or box-less words', () => {
    const nested = { blocks: [{ paragraphs: [{ lines: [{ words: [w('Hello', 0, 0, 50, 20), w('  ', 0, 0, 1, 1), { text: 'nobox' }] }, { words: [w('world', 60, 0, 110, 20, 70)] }] }] }] };
    expect(wordsFromResult(nested).map((x) => x.text)).toEqual(['Hello', 'world']);
    expect(wordsFromResult({ words: [w('flat', 1, 2, 3, 4)] }).map((x) => x.text)).toEqual(['flat']);
    expect(wordsFromResult(null)).toEqual([]); expect(wordsFromResult({ blocks: null })).toEqual([]); expect(wordsFromResult({})).toEqual([]);
    expect(wordsFromResult({ words: [w(' trimmed ', 0, 0, 5, 5)] })[0].text).toBe('trimmed');
  });
  it('averages confidence and flags weak pages', () => {
    expect(meanConfidence(wordsFromResult({ words: [w('a', 0, 0, 1, 1, 90), w('b', 0, 0, 1, 1, 70)] }))).toBe(80); expect(meanConfidence([])).toBe(0); expect(LOW_CONFIDENCE).toBeGreaterThan(40);
  });
});

describe('text clean-up', () => {
  it('tidyText trims line ends, collapses blank runs and strips the edges', () => {
    expect(tidyText('\n\n  Line one   \r\nLine two\t\n\n\n\n\nLine three  \n\n')).toBe('  Line one\nLine two\n\nLine three');
    expect(tidyText('')).toBe('');
  });
  it('joinPages labels pages only when there are several, and skips blank ones', () => {
    expect(joinPages([{ n: 1, text: ' only page \n' }])).toBe('only page');
    expect(joinPages([{ n: 1, text: 'A' }, { n: 2, text: '   ' }, { n: 3, text: 'C' }])).toBe('--- Page 1 ---\nA\n\n--- Page 3 ---\nC');
    expect(joinPages([])).toBe('');
  });
});

describe('PDF-safe text and word placement', () => {
  it('keeps Latin text, converts typographic punctuation, and drops what the font cannot draw', () => {
    expect(toWinAnsi('Café “quoted” — it’s 5 km…')).toBe('Café "quoted" - it\'s 5 km...');
    expect(toWinAnsi('abc العربية 中文 def')).toBe('abc   def'); expect(toWinAnsi('ال')).toBe('');
  });
  it('places a word at its box, scaled from image pixels to PDF points, with the size fitted to its width', () => {
    // 1000x2000 px image on a 500x1000 pt page: every pixel is half a point. The word spans x 100..300 and y 200..260.
    const p = placeWord({ text: 'Hello', x0: 100, y0: 200, x1: 300, y1: 260, confidence: 90 }, 1000, 2000, 500, 1000, width1)!;
    expect(p.text).toBe('Hello'); expect(p.x).toBeCloseTo(50, 6);
    expect(p.size).toBeCloseTo(Math.min(100 / 2.5, 30 * 1.25), 6);               // box 100pt wide, 5 chars x 0.5em = 2.5 em -> 40; capped by the 30pt tall box -> 37.5
    expect(p.y).toBeCloseTo(1000 - 260 * 0.5 + 30 * 0.2, 6);                       // just above the bottom edge of the box, measured from the page bottom
  });
  it('skips words it cannot place: no usable text, a degenerate box or a font with no width', () => {
    expect(placeWord({ text: '中文', x0: 0, y0: 0, x1: 50, y1: 20, confidence: 90 }, 100, 100, 100, 100, width1)).toBeNull();
    expect(placeWord({ text: 'x', x0: 10, y0: 10, x1: 10, y1: 20, confidence: 90 }, 100, 100, 100, 100, width1)).toBeNull();
    expect(placeWord({ text: 'x', x0: 0, y0: 0, x1: 20, y1: 20, confidence: 90 }, 100, 100, 100, 100, () => 0)).toBeNull();
    expect(placeWord({ text: 'x', x0: 0, y0: 0, x1: 20, y1: 20, confidence: 90 }, 0, 100, 100, 100, width1)).toBeNull();
  });
  it('never returns a font size below 1', () => { expect(placeWord({ text: 'WWWWWWWWWWWW', x0: 0, y0: 0, x1: 2, y1: 8, confidence: 90 }, 100, 100, 100, 100, width1)!.size).toBe(1); });
});
