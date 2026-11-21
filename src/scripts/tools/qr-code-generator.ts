import { h, field, statusArea, withBusy, downloadBlob, canvasToBlob, selectControl } from '../ui';
import { ECC_LEVELS, buildMatrix, normalizeLink, wifiPayload, vcardPayload, mailtoPayload, telPayload, renderPlan, toSvg, colourWarning, QrTooLong, type EccLevel, type QrMatrix, type WifiSecurity } from '../../lib/qr';

const MARGIN = 4; // quiet zone in modules: the minimum scanners expect
const TYPES: [string, string][] = [['link', 'Link or text'], ['wifi', 'Wi-Fi network'], ['contact', 'Contact card'], ['email', 'Email'], ['phone', 'Phone number']];
const SIZES: [string, string][] = [['300', 'Small (about 300 px)'], ['600', 'Medium (about 600 px)'], ['1200', 'Large (about 1200 px)'], ['2400', 'Print (about 2400 px)']];

export function mount(root: HTMLElement) {
  const status = statusArea();
  const text = (label: string, extra: Record<string, unknown> = {}) => { const i = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...extra }); return { i, f: field(label, i) }; };

  const type = selectControl(TYPES, 'link');
  const linkIn = h('textarea', { rows: 3, placeholder: 'https://example.com or any text', spellcheck: 'false', maxlength: 2900 });
  const linkNote = h('span', { class: 'hint', 'aria-live': 'polite' });
  const linkField = field('Link or text', linkIn); linkField.append(linkNote);
  const ssid = text('Network name (SSID)'), pass = text('Password', { type: 'text', autocapitalize: 'off' });
  const security = selectControl([['WPA', 'WPA / WPA2 / WPA3 (most networks)'], ['WEP', 'WEP (old)'], ['nopass', 'No password']], 'WPA');
  const hidden = h('input', { type: 'checkbox' });
  const wifiBox = h('div', { class: 'qr-panel', hidden: true }, ssid.f, pass.f, field('Security', security), h('label', { class: 'checkline' }, hidden, ' Hidden network'),
    h('p', { class: 'hint', text: 'Your Wi-Fi password stays on this device. It is never sent anywhere or saved.' }));
  const first = text('First name'), last = text('Last name'), org = text('Organization'), phone = text('Phone', { type: 'tel', inputmode: 'tel' }), email = text('Email', { type: 'email', inputmode: 'email' }), url = text('Website', { inputmode: 'url' });
  const contactBox = h('div', { class: 'qr-panel', hidden: true }, h('div', { class: 'row' }, first.f, last.f), org.f, h('div', { class: 'row' }, phone.f, email.f), url.f);
  const mTo = text('To', { type: 'email', inputmode: 'email' }), mSubject = text('Subject'), mBody = h('textarea', { rows: 3, maxlength: 1500 });
  const emailBox = h('div', { class: 'qr-panel', hidden: true }, mTo.f, mSubject.f, field('Message (optional)', mBody));
  const tel = text('Phone number', { type: 'tel', inputmode: 'tel', placeholder: '+92 300 1234567' });
  const phoneBox = h('div', { class: 'qr-panel', hidden: true }, tel.f);
  const panels: Record<string, HTMLElement> = { link: linkField, wifi: wifiBox, contact: contactBox, email: emailBox, phone: phoneBox };

  const ecc = selectControl(ECC_LEVELS.map((l) => [l.id, l.label] as [string, string]), 'M');
  const size = selectControl(SIZES, '600');
  const fg = h('input', { type: 'color', value: '#000000' }), bg = h('input', { type: 'color', value: '#ffffff' });
  const colourNote = h('p', { class: 'notice notice-warn', hidden: true, role: 'status' });

  const canvas = h('canvas', { role: 'img', 'aria-label': 'Your QR code' });
  const empty = h('p', { class: 'qr-empty', text: 'Your QR code will appear here as you type.' });
  const info = h('p', { class: 'hint', 'aria-live': 'polite' });
  const btnPng = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Download PNG');
  const btnSvg = h('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, 'Download SVG');

  let matrix: QrMatrix | null = null, lastType = 'link';

  const payload = (): { text: string; note?: string } => {
    switch (type.value) {
      case 'wifi': return ssid.i.value.trim() ? { text: wifiPayload({ ssid: ssid.i.value, password: pass.i.value, security: security.value as WifiSecurity, hidden: hidden.checked }) } : { text: '' };
      case 'contact': return first.i.value.trim() || last.i.value.trim() || phone.i.value.trim() || email.i.value.trim() ? { text: vcardPayload({ first: first.i.value.trim(), last: last.i.value.trim(), org: org.i.value.trim(), phone: phone.i.value, email: email.i.value.trim(), url: url.i.value.trim() }) } : { text: '' };
      case 'email': return mTo.i.value.trim() ? { text: mailtoPayload({ to: mTo.i.value, subject: mSubject.i.value, body: mBody.value }) } : { text: '' };
      case 'phone': return /\d/.test(tel.i.value) ? { text: telPayload(tel.i.value) } : { text: '' };
      default: { const raw = linkIn.value.trim(); const t = normalizeLink(raw); return { text: t, note: t !== raw ? 'Added https:// so phones open it as a link.' : '' }; }
    }
  };

  function render() {
    status.clear();
    const p = payload();
    linkNote.textContent = type.value === 'link' ? (p.note ?? '') : '';
    const warn = colourWarning(fg.value, bg.value);
    colourNote.hidden = !warn; if (warn) colourNote.textContent = warn;
    matrix = null;
    if (!p.text) { canvas.hidden = true; empty.hidden = false; info.textContent = ''; btnPng.disabled = btnSvg.disabled = true; return; }
    try { matrix = buildMatrix(p.text, ecc.value as EccLevel); }
    catch (e) { canvas.hidden = true; empty.hidden = true; btnPng.disabled = btnSvg.disabled = true; info.textContent = ''; status.show('error', e instanceof QrTooLong ? e.message : 'The QR code could not be created.'); return; }
    const plan = renderPlan(matrix.size, MARGIN, Number(size.value));
    canvas.width = canvas.height = plan.px;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = bg.value; ctx.fillRect(0, 0, plan.px, plan.px);
    ctx.fillStyle = fg.value;
    for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) if (matrix.rows[r][c]) ctx.fillRect((c + MARGIN) * plan.scale, (r + MARGIN) * plan.scale, plan.scale, plan.scale);
    canvas.hidden = false; empty.hidden = true; btnPng.disabled = btnSvg.disabled = false;
    info.textContent = `${matrix.size} × ${matrix.size} squares · PNG ${plan.px} × ${plan.px} px. Test it with your phone camera before you print or share it.`;
  }

  type.addEventListener('change', () => { for (const [k, el] of Object.entries(panels)) el.hidden = k !== type.value; lastType = type.value; render(); });
  root.addEventListener('input', (e) => { if (e.target !== type) render(); });
  root.addEventListener('change', (e) => { if (e.target !== type) render(); });

  const fileName = (ext: string) => `qr-code-${lastType}.${ext}`;
  btnPng.addEventListener('click', () => withBusy(btnPng, 'Preparing…', async () => {
    try { const blob = await canvasToBlob(canvas, 'image/png'); downloadBlob(blob, fileName('png')); status.set('success', `Saved ${fileName('png')}.`); }
    catch (e) { status.set('error', e instanceof Error ? e.message : 'The image could not be created.'); }
  }));
  btnSvg.addEventListener('click', () => {
    if (!matrix) return;
    downloadBlob(new Blob([toSvg(matrix, MARGIN, fg.value, bg.value)], { type: 'image/svg+xml' }), fileName('svg'));
    status.set('success', `Saved ${fileName('svg')}. SVG stays sharp at any size, so it suits printing.`);
  });

  const form = h('form', { class: 'qr-layout', onsubmit: (e: Event) => e.preventDefault(), novalidate: true },
    h('div', { class: 'qr-inputs' },
      field('What is the code for?', type), linkField, wifiBox, contactBox, emailBox, phoneBox,
      h('div', { class: 'row' }, field('Error correction', ecc, 'Higher levels still scan when a printed code is dirty or damaged, but make the code busier.'), field('Size', size)),
      h('div', { class: 'row' }, field('Code colour', fg), field('Background colour', bg)), colourNote),
    h('div', { class: 'qr-out' }, h('div', { class: 'qr-card' }, canvas, empty), info, h('div', { class: 'actions' }, btnPng, btnSvg), status.el));
  root.append(form);
  render();
}
