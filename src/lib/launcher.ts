/** Decides which tools to suggest for a set of dropped files. Pure logic, unit-tested. */
import type { FileKind } from './files';

export type Group = 'pdf' | 'image' | 'video';
export interface Suggestion { slug: string; label: string; hint: string; single: boolean }

const PDF: Suggestion[] = [
  { slug: 'pdf-reader', label: 'Read it', hint: 'Open and search the document', single: true },
  { slug: 'sign-pdf', label: 'Sign it', hint: 'Add a signature, date or stamp', single: true },
  { slug: 'compress-pdf', label: 'Make it smaller', hint: 'Shrink it for email', single: true },
  { slug: 'split-pdf', label: 'Pull out pages', hint: 'Keep only the pages you need', single: true },
  { slug: 'pdf-to-image', label: 'Turn pages into images', hint: 'Export JPG or PNG', single: true },
  { slug: 'merge-pdf', label: 'Combine PDFs', hint: 'Join files into one', single: false },
];
const IMAGE: Suggestion[] = [
  { slug: 'image-compressor', label: 'Make smaller', hint: 'Cut the file size', single: false },
  { slug: 'image-resizer', label: 'Resize', hint: 'Exact pixels or a percentage', single: true },
  { slug: 'image-cropper', label: 'Crop', hint: 'Trim to a ratio or size', single: true },
  { slug: 'image-converter', label: 'Change format', hint: 'JPG, PNG or WebP', single: false },
  { slug: 'image-to-pdf', label: 'Turn into a PDF', hint: 'One page per image', single: false },
  { slug: 'image-to-base64', label: 'Encode as Base64', hint: 'For code and data URIs', single: true },
];
const VIDEO: Suggestion[] = [
  { slug: 'video-compressor', label: 'Make it smaller', hint: 'Compress, resize or trim', single: true },
];

export const groupOf = (kind: FileKind | null): Group | null =>
  kind === 'pdf' ? 'pdf' : kind === 'jpeg' || kind === 'png' || kind === 'webp' ? 'image' : kind === 'mp4' || kind === 'webm' ? 'video' : null;

export const GROUP_NOUN: Record<Group, [string, string]> = { pdf: ['PDF', 'PDFs'], image: ['image', 'images'], video: ['video', 'videos'] };

/**
 * `kinds` is the sniffed kind of each dropped file in order (null = unsupported). The first supported file decides the
 * group; files of other groups are reported as `skipped`. With several files, tools that take many files come first.
 */
export function suggest(kinds: (FileKind | null)[]): { group: Group | null; accepted: number[]; skipped: number[]; unsupported: number[]; suggestions: Suggestion[] } {
  const first = kinds.map(groupOf).find((g) => g !== null) ?? null;
  const accepted: number[] = [], skipped: number[] = [], unsupported: number[] = [];
  kinds.forEach((k, i) => { const g = groupOf(k); if (g === null) unsupported.push(i); else if (g === first) accepted.push(i); else skipped.push(i); });
  if (!first) return { group: null, accepted, skipped, unsupported, suggestions: [] };
  const base = first === 'pdf' ? PDF : first === 'image' ? IMAGE : VIDEO;
  const many = accepted.length > 1;
  const list = base.filter((s) => !(first === 'pdf' && s.slug === 'merge-pdf' && !many)); // "Combine" only makes sense for 2+ PDFs
  const suggestions = many ? [...list.filter((s) => !s.single), ...list.filter((s) => s.single)] : list;
  return { group: first, accepted, skipped, unsupported, suggestions };
}
