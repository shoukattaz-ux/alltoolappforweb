import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { buildMatrix, normalizeLink, wifiPayload, vcardPayload, mailtoPayload, telPayload, renderPlan, toSvg, contrastRatio, colourWarning, isHexColor, QrTooLong, MAX_BYTES, type EccLevel } from '../../src/lib/qr';

/** Draws a matrix to RGBA pixels (as the app does) and reads it back with an independent decoder. */
function decode(text: string, level: EccLevel = 'M', scale = 6, margin = 4, invert = false): string | null {
  const m = buildMatrix(text, level); const cells = m.size + 2 * margin; const px = cells * scale;
  const data = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const cx = Math.floor(x / scale) - margin, cy = Math.floor(y / scale) - margin;
    const dark = cx >= 0 && cy >= 0 && cx < m.size && cy < m.size && m.rows[cy][cx];
    const v = (dark !== invert) ? 0 : 255; const i = (y * px + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return jsQR(data, px, px)?.data ?? null;
}

describe('QR generation (verified by decoding with an independent reader)', () => {
  it('round-trips links, plain text and every error-correction level', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      expect(decode('https://example.com/menu?table=5&lang=en', level)).toBe('https://example.com/menu?table=5&lang=en');
      expect(decode('Hello, world', level)).toBe('Hello, world');
    }
  });
  it('keeps non-English text intact (UTF-8)', () => {
    for (const t of ['Café déjà vu', 'سلام دنیا', 'Привет мир', '你好，世界', 'Tea ☕']) expect(decode(t)).toBe(t);
  });
  it('round-trips Wi-Fi, contact, email and phone payloads', () => {
    const w = wifiPayload({ ssid: 'Home;Net', password: 'p:a"ss,word\\1', security: 'WPA', hidden: false });
    expect(decode(w)).toBe(w);
    const v = vcardPayload({ first: 'Ali', last: 'Khan', org: 'Acme, Inc', phone: '+92 300 1234567', email: 'ali@example.com', url: 'https://example.com' });
    expect(decode(v)).toBe(v);
    const m = mailtoPayload({ to: 'a@b.co', subject: 'Hi there & welcome', body: 'Line 1\nLine 2' }); expect(decode(m)).toBe(m);
    expect(decode(telPayload('+92 (300) 123-4567'))).toBe('tel:+923001234567');
  });
  it('holds long text up to a few hundred characters and bigger codes still decode', () => {
    const t = 'The quick brown fox jumps over the lazy dog. '.repeat(20); expect(decode(t, 'M', 4)).toBe(t);
  });
  it('rejects text that cannot fit, with a friendly error', () => {
    expect(() => buildMatrix('x'.repeat(MAX_BYTES + 1), 'L')).toThrow(QrTooLong);
    expect(() => buildMatrix('x'.repeat(2000), 'H')).toThrow(QrTooLong);
    expect(buildMatrix('x'.repeat(MAX_BYTES), 'L').size).toBe(177);
  });
  it('higher error correction makes a bigger code for the same text', () => {
    const t = 'https://example.com/some/path/here'; expect(buildMatrix(t, 'H').size).toBeGreaterThanOrEqual(buildMatrix(t, 'L').size);
  });
  it('draws a clean square with finder patterns in the corners', () => {
    const m = buildMatrix('hello'); expect(m.rows).toHaveLength(m.size); expect(m.rows.every((r) => r.length === m.size)).toBe(true);
    for (const [r, c] of [[0, 0], [0, m.size - 7], [m.size - 7, 0]]) { expect(m.rows[r][c]).toBe(true); expect(m.rows[r + 3][c + 3]).toBe(true); expect(m.rows[r + 1][c + 1]).toBe(false); }
  });
});

describe('payload builders', () => {
  it('adds https:// only to bare web addresses', () => {
    expect(normalizeLink('example.com')).toBe('https://example.com'); expect(normalizeLink(' www.example.com/a?b=1 ')).toBe('https://www.example.com/a?b=1');
    for (const keep of ['https://x.com', 'http://x.com', 'mailto:a@b.co', 'tel:123', 'hello world', 'Just some text', 'a@b.co', '', 'WIFI:T:WPA;S:x;;']) expect(normalizeLink(keep)).toBe(keep.trim());
  });
  it('escapes Wi-Fi special characters and handles open and hidden networks', () => {
    expect(wifiPayload({ ssid: 'My;Net', password: 'a,b:c', security: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:My\\;Net;P:a\\,b\\:c;;');
    expect(wifiPayload({ ssid: 'Cafe', password: 'ignored', security: 'nopass', hidden: false })).toBe('WIFI:T:nopass;S:Cafe;;');
    expect(wifiPayload({ ssid: 'H', password: 'x', security: 'WEP', hidden: true })).toBe('WIFI:T:WEP;S:H;P:x;H:true;;');
  });
  it('builds a valid vCard and leaves out empty fields', () => {
    const v = vcardPayload({ first: 'Ali', last: 'Khan', org: '', phone: '+1 (555) 010-9999', email: '', url: '' });
    expect(v.split('\r\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'N:Khan;Ali;;;', 'FN:Ali Khan', 'TEL:+15550109999', 'END:VCARD']);
    expect(vcardPayload({ first: 'A', last: 'B', org: 'X; Y, Z', phone: '', email: '', url: '' })).toContain('ORG:X\\; Y\\, Z');
  });
  it('encodes mailto subject and body', () => { expect(mailtoPayload({ to: 'a@b.co', subject: 'Hi & bye', body: '' })).toBe('mailto:a@b.co?subject=Hi%20%26%20bye'); expect(mailtoPayload({ to: 'a@b.co', subject: '', body: '' })).toBe('mailto:a@b.co'); });
});

describe('output', () => {
  it('picks whole pixels per module and never exceeds the target size', () => {
    const p = renderPlan(25, 4, 600); expect(p.scale).toBe(Math.floor(600 / 33)); expect(p.px).toBe(p.scale * 33); expect(p.px).toBeLessThanOrEqual(600);
    expect(renderPlan(177, 4, 100).scale).toBe(1);
  });
  it('SVG is well formed, sized to the code plus margin, and encodes the same modules', () => {
    const m = buildMatrix('svg test'); const svg = toSvg(m, 4, '#112233', '#ffffff');
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 (\d+) \1"/); expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
    expect(svg).toContain('fill="#112233"'); expect(svg).toContain('fill="#ffffff"');
    let dark = 0; for (const r of m.rows) for (const v of r) if (v) dark++;
    const area = [...svg.matchAll(/h(\d+)v1h-\1z/g)].reduce((s, x) => s + Number(x[1]), 0); expect(area).toBe(dark);
  });
});

describe('colour checks', () => {
  it('validates hex colours and measures contrast', () => {
    expect(isHexColor('#a1B2c3')).toBe(true); expect(isHexColor('red')).toBe(false); expect(isHexColor('#fff')).toBe(false);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
  it('warns about inverted and low-contrast codes but not about normal ones', () => {
    expect(colourWarning('#000000', '#ffffff')).toBeNull(); expect(colourWarning('#1a237e', '#fff8e1')).toBeNull();
    expect(colourWarning('#ffffff', '#000000')).toMatch(/inverted/); expect(colourWarning('#777777', '#999999')).toMatch(/too close/);
  });
});
