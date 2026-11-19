import { sniffKind, type FileKind } from '../lib/files';
import { suggest, GROUP_NOUN } from '../lib/launcher';
import { setHandoff } from '../scripts/handoff';
import { toolBySlug } from '../data/tools';
import { icon } from './icons';
import { esc } from './util';

/** Markup for the "Start with a file" card on the dashboard. */
export function launcherMarkup(): string {
  return `<section class="launcher" aria-labelledby="launcher-h">
    <div class="launcher-head"><h2 id="launcher-h">Start with a file</h2><p class="muted">Drop it here and we will show what you can do with it. Nothing is uploaded.</p></div>
    <label class="launcher-drop" id="launcher-drop">
      <span class="dz-icon" aria-hidden="true">${icon('upload', 28)}</span>
      <strong>Drop a PDF, image or video</strong>
      <span class="dz-btn" aria-hidden="true">Choose files</span>
      <input type="file" id="launcher-input" multiple accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,.mp4,.m4v,.mov,.webm,.mkv,video/*" />
    </label>
    <div id="launcher-result" aria-live="polite"></div>
  </section>`;
}

async function showSuggestions(result: HTMLElement, files: File[]) {
  const kinds: (FileKind | null)[] = [];
  for (const f of files) kinds.push(await sniffKind(f));
  const r = suggest(kinds);
  if (!r.group) {
    result.innerHTML = `<div class="notice notice-warn" role="status"><span>That file type is not supported. This app works with PDF, JPG, PNG, WebP, MP4, MOV, WebM and MKV files.</span></div>`;
    return;
  }
  const chosen = r.accepted.map((i) => files[i]);
  const [one, many] = GROUP_NOUN[r.group];
  const count = chosen.length === 1 ? `1 ${one}` : `${chosen.length} ${many}`;
  const notes: string[] = [];
  if (r.skipped.length) notes.push(`${r.skipped.length} file${r.skipped.length === 1 ? ' was' : 's were'} left out because ${r.skipped.length === 1 ? 'it is' : 'they are'} a different type.`);
  if (r.unsupported.length) notes.push(`${r.unsupported.length} unsupported file${r.unsupported.length === 1 ? ' was' : 's were'} ignored.`);
  result.innerHTML = `<div class="launcher-result">
    <p class="launcher-msg">${icon('check', 18)}<span><strong>${esc(count)}</strong> ready. What would you like to do?</span></p>
    <ul class="act-grid">${r.suggestions.map((s) => {
      const t = toolBySlug(s.slug)!;
      const extra = s.single && chosen.length > 1 ? ' (uses the first file)' : '';
      return `<li><button type="button" class="act cat-${t.category}" data-slug="${s.slug}"><span class="act-icon">${icon(t.icon, 20)}</span><span class="act-text"><strong>${esc(s.label)}</strong><small>${esc(s.hint + extra)}</small></span>${icon('arrow', 16)}</button></li>`;
    }).join('')}</ul>
    ${notes.length ? `<p class="hint">${esc(notes.join(' '))}</p>` : ''}
  </div>`;
  result.querySelectorAll<HTMLButtonElement>('[data-slug]').forEach((b) => b.addEventListener('click', () => {
    const slug = b.dataset.slug!; const single = suggest(kinds).suggestions.find((s) => s.slug === slug)?.single;
    setHandoff(single ? chosen.slice(0, 1) : chosen);
    location.hash = `#/tool/${slug}`;
  }));
  result.querySelector<HTMLElement>('.act')?.focus({ preventScroll: true });
}

export function bindLauncher(view: HTMLElement) {
  const input = view.querySelector<HTMLInputElement>('#launcher-input');
  const drop = view.querySelector<HTMLElement>('#launcher-drop');
  const result = view.querySelector<HTMLElement>('#launcher-result');
  if (!input || !drop || !result) return;
  const go = (files: File[]) => { if (files.length) void showSuggestions(result, files); };
  input.addEventListener('change', () => { go([...(input.files ?? [])]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); go([...(e.dataTransfer?.files ?? [])]); });
}

/** On the dashboard, a file dropped anywhere on the page goes to the same suggestion list. Other screens keep their own drop areas. */
export function installGlobalDrop(isHome: () => boolean, getView: () => HTMLElement) {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<div class="drop-overlay-box">${icon('upload', 36)}<strong>Drop to get started</strong><span>PDF, image or video</span></div>`;
  document.body.append(overlay);
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (isHome() && hasFiles(e)) { depth++; overlay.hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (isHome() && hasFiles(e) && --depth <= 0) { depth = 0; overlay.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (isHome() && hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!isHome() || !hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.hidden = true;
    const result = getView().querySelector<HTMLElement>('#launcher-result');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (result && files.length) { void showSuggestions(result, files); result.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
}
