/** Tiny persisted state (favorites, recents, theme). Every access is guarded: storage can be blocked or full. */
const read = <T>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } };

type Listener = () => void;
const listeners = new Set<Listener>();
export const subscribe = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());

let favorites: string[] = read('th:favs', []);
let recents: string[] = read('th:recent', []);

export const getFavorites = () => favorites;
export const isFavorite = (slug: string) => favorites.includes(slug);
export function toggleFavorite(slug: string) {
  favorites = isFavorite(slug) ? favorites.filter((s) => s !== slug) : [...favorites, slug];
  write('th:favs', favorites); emit();
}
export const getRecents = () => recents;
export function pushRecent(slug: string) {
  recents = [slug, ...recents.filter((s) => s !== slug)].slice(0, 6);
  write('th:recent', recents); emit();
}

export type Theme = 'light' | 'dark';
export const getTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('th:theme', t); } catch { /* ignore */ }
  emit();
}
