import { TOOLS, CATEGORIES, type Tool, type Category } from '../data/tools';
import { escapeHtml } from '../lib/format';
import { icon } from './icons';

export const esc = escapeHtml;
export const toolHref = (t: Tool) => `#/tool/${t.slug}`;
export const catHref = (c: Category) => `#/${c}`;
export const catLabel: Record<Category, string> = { pdf: 'PDF', image: 'Image', video: 'Video', calculator: 'Calculator' };

/** Simple scored search over name, description and keywords. */
export function searchTools(query: string): Tool[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return TOOLS;
  return TOOLS.map((t) => {
    const name = t.name.toLowerCase(); const hay = `${name} ${t.short} ${t.search} ${CATEGORIES[t.category].name}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!hay.includes(term)) return { t, score: -1 };
      score += name.startsWith(term) ? 6 : name.includes(term) ? 4 : t.search.includes(term) ? 2 : 1;
    }
    return { t, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.t);
}

export function toolCard(t: Tool, opts: { fav?: boolean } = {}): string {
  return `<a class="tcard cat-${t.category}" href="${toolHref(t)}" data-slug="${t.slug}">
    <span class="tcard-icon">${icon(t.icon, 24)}</span>
    <span class="tcard-body"><strong>${esc(t.name)}</strong><span>${esc(t.short)}</span></span>
    <span class="tcard-foot"><span class="chip">${catLabel[t.category]}</span>${opts.fav ? `<span class="tcard-star">${icon('star', 15)}</span>` : ''}<span class="tcard-go">${icon('arrow', 16)}</span></span>
  </a>`;
}
