/** QR code helpers: payload builders (links, Wi-Fi, contacts…), matrix generation, SVG output, colour checks. DOM-free and unit-tested. */
import qrcode from 'qrcode-generator';

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; // so accents, Urdu, Arabic, emoji… survive

export type EccLevel = 'L' | 'M' | 'Q' | 'H';
export const ECC_LEVELS: { id: EccLevel; label: string; recovers: string }[] = [
  { id: 'L', label: 'Low (7%)', recovers: 'about 7%' }, { id: 'M', label: 'Medium (15%)', recovers: 'about 15%' },
  { id: 'Q', label: 'Quartile (25%)', recovers: 'about 25%' }, { id: 'H', label: 'High (30%)', recovers: 'about 30%' },
];

/** Largest text a QR code can hold in byte mode at level L (version 40): 2953 bytes. */
export const MAX_BYTES = 2953;

export class QrTooLong extends Error { constructor() { super('That is too much for one QR code. Shorten the text or lower the error correction level.'); } }

export interface QrMatrix { size: number; rows: boolean[][] }

export function buildMatrix(text: string, level: EccLevel = 'M'): QrMatrix {
  const q = qrcode(0, level);
  try { q.addData(text, 'Byte'); q.make(); } catch { throw new QrTooLong(); }
  const size = q.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) { const row: boolean[] = []; for (let c = 0; c < size; c++) row.push(q.isDark(r, c)); rows.push(row); }
  return { size, rows };
}

/* ------------------------------ Payloads ------------------------------ */

/** Adds https:// to a bare web address such as "example.com/menu" so phones open it as a link. Other text is left unchanged. */
export function normalizeLink(input: string): string {
  const s = input.trim();
  if (!s || /\s/.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return /^[^\s/@]+\.[a-z]{2,}([/?#].*)?$/i.test(s) ? `https://${s}` : s;
}

const wifiEscape = (s: string) => s.replace(/([\;,:"])/g, '\\$1');
export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';
export function wifiPayload(o: { ssid: string; password: string; security: WifiSecurity; hidden: boolean }): string {
  const pass = o.security === 'nopass' ? '' : `P:${wifiEscape(o.password)};`;
  return `WIFI:T:${o.security};S:${wifiEscape(o.ssid)};${pass}${o.hidden ? 'H:true;' : ''};`;
}

const vEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
export function vcardPayload(o: { first: string; last: string; org: string; phone: string; email: string; url: string }): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEscape(o.last)};${vEscape(o.first)};;;`, `FN:${vEscape([o.first, o.last].filter(Boolean).join(' '))}`];
  if (o.org) lines.push(`ORG:${vEscape(o.org)}`);
  if (o.phone) lines.push(`TEL:${o.phone.replace(/[^\d+*#]/g, '')}`);
  if (o.email) lines.push(`EMAIL:${vEscape(o.email)}`);
  if (o.url) lines.push(`URL:${o.url.trim()}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function mailtoPayload(o: { to: string; subject: string; body: string }): string {
  const q: string[] = [];
  if (o.subject) q.push(`subject=${encodeURIComponent(o.subject)}`);
  if (o.body) q.push(`body=${encodeURIComponent(o.body)}`);
  return `mailto:${o.to.trim()}${q.length ? `?${q.join('&')}` : ''}`;
}

export const telPayload = (number: string) => `tel:${number.replace(/[^\d+]/g, '')}`;

/* ------------------------------ Output ------------------------------ */

/** Integer pixels per module so the code stays razor sharp; the picture is as close as possible to `targetPx` without exceeding it (minimum 1). */
export function renderPlan(modules: number, margin: number, targetPx: number): { scale: number; px: number } {
  const cells = modules + 2 * margin;
  const scale = Math.max(1, Math.floor(targetPx / cells));
  return { scale, px: scale * cells };
}

export function toSvg(m: QrMatrix, margin: number, fg: string, bg: string): string {
  const total = m.size + 2 * margin;
  let d = '';
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.rows[y][x]) { x++; continue; }
      let len = 1; while (x + len < m.size && m.rows[y][x + len]) len++;
      d += `M${x + margin} ${y + margin}h${len}v1h-${len}z`;
      x += len;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * 10}" height="${total * 10}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

/* ------------------------------ Colours ------------------------------ */

export const isHexColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Returns a plain-language warning if the colours are likely to make the code hard to scan, otherwise null. */
export function colourWarning(fg: string, bg: string): string | null {
  if (lum(fg) > lum(bg)) return 'Light code on a dark background (an inverted code) is not read by every scanner. Use a dark code on a light background for reliable scanning.';
  if (contrastRatio(fg, bg) < 4) return 'These colours are too close together. Make the code darker or the background lighter so phones can read it.';
  return null;
}
