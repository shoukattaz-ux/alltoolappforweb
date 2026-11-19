import { describe, it, expect } from 'vitest';
import { normalizeTurns, finalRotation, reorder, dropIndex, summarize, fitRotated, outputName, type PageItem, type Rect } from '../../src/lib/organize';

const item = (id: number, src: number, over: Partial<PageItem> = {}): PageItem => ({ id, src, turns: 0, deleted: false, ...over });
// A 3-column grid of 100x140 cards with 10px gaps.
const grid = (n: number): Rect[] => Array.from({ length: n }, (_, i) => { const c = i % 3, r = Math.floor(i / 3); return { left: c * 110, top: r * 150, right: c * 110 + 100, bottom: r * 150 + 140 }; });

describe('rotation', () => {
  it('normalises turns and adds them to the page\'s own rotation', () => {
    expect([normalizeTurns(5), normalizeTurns(-1), normalizeTurns(0)]).toEqual([1, 3, 0]);
    expect(finalRotation(0, 1)).toBe(90); expect(finalRotation(270, 1)).toBe(0); expect(finalRotation(90, 3)).toBe(0); expect(finalRotation(180, -1)).toBe(90); expect(finalRotation(0, 4)).toBe(0);
  });
});

describe('reorder', () => {
  it('moves an element to the index it should end up at, without changing the original', () => {
    const a = ['a', 'b', 'c', 'd']; expect(reorder(a, 0, 2)).toEqual(['b', 'c', 'a', 'd']); expect(reorder(a, 3, 0)).toEqual(['d', 'a', 'b', 'c']); expect(a).toEqual(['a', 'b', 'c', 'd']);
    expect(reorder(a, 1, 1)).toEqual(a); expect(reorder(a, 9, 0)).toEqual(a); expect(reorder(a, 0, 99)).toEqual(['b', 'c', 'd', 'a']); expect(reorder(a, 2, -5)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('dropIndex (where a dragged card lands)', () => {
  const r = grid(6);
  it('dropping on the left half of a card lands before it, on the right half after it', () => {
    expect(dropIndex(r, 115, 70, 0)).toBe(0);         // left half of card 1, dragged card 0: lands where card 1 is after card 0 leaves -> stays 0
    expect(dropIndex(r, 205, 70, 0)).toBe(1);         // right half of card 1 -> after card 1
    expect(dropIndex(r, 5, 220, 4)).toBe(3);          // left half of card 3 (row 2), dragged 4 -> before card 3
    expect(dropIndex(r, 95, 220, 5)).toBe(4);         // right half of card 3 -> after card 3
  });
  it('dragging to the far end or start of the grid is clamped to the ends', () => {
    expect(dropIndex(r, 9999, 9999, 0)).toBe(5); expect(dropIndex(r, -50, -50, 5)).toBe(0);
  });
  it('picks the nearest card even when the pointer is in a gap or outside', () => {
    expect(dropIndex(r, 104, 70, 2)).toBeGreaterThanOrEqual(0); expect(dropIndex(r, 104, 70, 2)).toBeLessThanOrEqual(5);
    expect(dropIndex([], 10, 10, 0)).toBe(0);
  });
  it('is consistent with reorder: dropping a card on itself changes nothing', () => {
    for (let from = 0; from < 6; from++) { const c = r[from]; const to = dropIndex(r, (c.left + c.right) / 2 + 1, (c.top + c.bottom) / 2, from); expect(reorder([0, 1, 2, 3, 4, 5], from, to)).toEqual([0, 1, 2, 3, 4, 5]); }
  });
});

describe('summarize', () => {
  it('counts kept, deleted, blank, rotated, duplicated pages and detects reordering', () => {
    const items = [item(1, 2), item(2, 0, { turns: 1 }), item(3, 1, { deleted: true }), item(4, -1, { blank: { w: 612, h: 792 } }), item(5, 0)];
    expect(summarize(items, 3)).toEqual({ kept: 4, deleted: 1, blanks: 1, rotated: 1, duplicates: 1, reordered: true, changed: true });
  });
  it('an untouched document is "unchanged"; any edit counts as a change', () => {
    const same = [item(1, 0), item(2, 1), item(3, 2)]; expect(summarize(same, 3).changed).toBe(false); expect(summarize(same, 3).reordered).toBe(false);
    expect(summarize([item(1, 0), item(2, 1, { deleted: true }), item(3, 2)], 3).changed).toBe(true);
    expect(summarize([item(1, 0, { turns: 4 }), item(2, 1), item(3, 2)], 3).changed).toBe(false); // four turns is no turn
    expect(summarize([item(1, 1), item(2, 0), item(3, 2)], 3).reordered).toBe(true);
  });
});

describe('fitRotated and outputName', () => {
  it('sizes the page so that, once turned, it fits the thumbnail box', () => {
    const upright = fitRotated(612, 792, 0, 150, 190); expect(upright.w).toBeLessThanOrEqual(150); expect(upright.h).toBeLessThanOrEqual(190);
    const turned = fitRotated(612, 792, 1, 150, 190); expect(turned.h).toBeLessThanOrEqual(150 + 0.01); expect(turned.w).toBeLessThanOrEqual(190 + 0.01); // after turning, its height is the width we see
    expect(turned.w / turned.h).toBeCloseTo(612 / 792, 2); expect(fitRotated(612, 792, 2, 150, 190)).toEqual(upright);
  });
  it('names the output after the source and strips unsafe characters', () => {
    expect(outputName('Report.PDF')).toBe('Report-organized.pdf'); expect(outputName('a/b:c.pdf')).toBe('a_b_c-organized.pdf'); expect(outputName('')).toBe('document-organized.pdf');
  });
});
