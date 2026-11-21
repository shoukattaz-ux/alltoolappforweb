/** Pure logic for the page organiser: rotation, reordering, drop position, summaries. No DOM; unit-tested. */

export interface PageItem {
  id: number;
  /** 0-based page of the source PDF, or -1 for a blank page added here. */
  src: number;
  /** Extra clockwise quarter turns on top of the page's own rotation (0-3). */
  turns: number;
  deleted: boolean;
  /** Size of a blank page in PDF points. */
  blank?: { w: number; h: number };
}

export const normalizeTurns = (t: number) => ((t % 4) + 4) % 4;

/** The rotation to write into the new PDF: the page's existing rotation plus our quarter turns, as 0/90/180/270. */
export const finalRotation = (existingDegrees: number, turns: number) => (((existingDegrees + normalizeTurns(turns) * 90) % 360) + 360) % 360;

/** A copy of `arr` with the element at `from` moved to index `to` (the index it ends up at). */
export function reorder<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const t = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1); out.splice(t, 0, item);
  return out;
}

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Where a dragged card should land, given the pointer position and the on-screen rectangles of all cards in a wrapping grid.
 * Returns the index the dragged card ends up at after the move. The nearest card to the pointer is the target; the pointer being
 * on its left or right half decides whether to land before or after it.
 */
export function dropIndex(rects: readonly Rect[], x: number, y: number, from: number): number {
  if (!rects.length) return 0;
  let best = 0, bestD = Infinity;
  rects.forEach((r, i) => { const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2; const d = (cx - x) ** 2 + ((cy - y) * 1.6) ** 2; if (d < bestD) { bestD = d; best = i; } });
  const r = rects[best]; const after = x > (r.left + r.right) / 2;
  let insert = best + (after ? 1 : 0);        // position in the list that still contains the dragged card
  if (from < insert) insert -= 1;             // once the dragged card is lifted out, everything after it shifts up by one
  return Math.max(0, Math.min(rects.length - 1, insert));
}

export function summarize(items: readonly PageItem[], sourcePages: number) {
  const kept = items.filter((i) => !i.deleted);
  const order = kept.filter((i) => i.src >= 0).map((i) => i.src);
  const inOrder = order.every((v, k) => k === 0 || v > order[k - 1]);
  return {
    kept: kept.length, deleted: items.filter((i) => i.deleted && i.src >= 0).length, blanks: kept.filter((i) => i.src < 0).length,
    rotated: kept.filter((i) => normalizeTurns(i.turns) !== 0).length,
    duplicates: kept.filter((i) => i.src >= 0).length - new Set(order).size,
    reordered: !inOrder, changed: kept.length !== sourcePages || !inOrder || kept.some((i) => i.src < 0 || normalizeTurns(i.turns) !== 0) || items.some((i) => i.deleted),
  };
}

/** CSS size (before a `rotate()` transform) that makes a page of w x h points, turned `turns` quarter turns, fit inside a box. */
export function fitRotated(w: number, h: number, turns: number, boxW: number, boxH: number): { w: number; h: number } {
  const odd = normalizeTurns(turns) % 2 === 1;
  const rw = odd ? h : w, rh = odd ? w : h;            // the size it appears at after turning
  const s = Math.min(boxW / rw, boxH / rh);
  return { w: Math.round(w * s * 100) / 100, h: Math.round(h * s * 100) / 100 };
}

export const outputName = (name: string) => `${name.replace(/\.pdf$/i, '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim().slice(0, 80) || 'document'}-organized.pdf`;
