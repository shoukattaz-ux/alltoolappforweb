/**
 * The privacy policy, written once. The in-app Privacy page and the standalone web page that Google Play links to are
 * both rendered from this, so they cannot disagree. Keep this file dependency-free: scripts/make-site.mjs imports it
 * directly under Node.
 */
export interface PrivacySite { name: string; contactEmail: string; privacyUpdated: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const PRIVACY_LEAD = (name: string) => `${name} is built so that your files and data stay with you. Here is exactly what that means.`;

export function privacyHtml(site: PrivacySite): string {
  const mail = site.contactEmail ? `<p>Questions? Email <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>.</p>` : '';
  const n = esc(site.name);
  return `
    <p class="muted">Last updated: ${esc(site.privacyUpdated)}</p>
    <h2>The short version</h2>
    <ul class="ticks">
      <li>Your files are never uploaded. Every tool runs on your own device.</li>
      <li>There are no accounts, no cookies, no analytics, no advertising and no third-party code.</li>
      <li>The Android app asks for no permissions at all, not even internet access, so Android itself stops it from sending anything over a network.</li>
      <li>The app remembers a few preferences on your device only, listed below.</li>
    </ul>
    <h2>Your files</h2>
    <p>When you choose a PDF, image or video, the app reads it into memory on your own device, produces the result there, and hands it back to you to save or share. Nothing is sent to us or anyone else. On the web, the page is also locked down technically: its Content Security Policy only permits connections back to the site itself. In the Android app there is no network permission at all. Closing the app or the tab discards everything held in memory. Files you save or share are kept by your device wherever you choose, and those copies are yours to manage.</p>
    <p>Scan to PDF finds the page in your photo, straightens it and builds the PDF on your device. "Take a photo" opens your phone's own camera app, which takes the picture and hands it back: this app never accesses the camera itself and asks for no camera permission.</p>
    <p>The video compressor uses your device's built-in video engine, which may use its hardware encoder. That also happens locally. In the Android app, a finished file is briefly written to the app's private cache so it can be handed to Android's share sheet, and it is cleared the next time you save a file.</p>
    <h2>What is stored on your device</h2>
    <p>Using local storage inside the app, and only on your device, ${n} can keep:</p>
    <ul>
      <li><strong>Favorites and recently used tools</strong>, so the dashboard can show them.</li>
      <li><strong>Your theme</strong> (light or dark).</li>
      <li><strong>Saved signatures</strong>, only if you tick the option to save one in the PDF Signer.</li>
    </ul>
    <p>None of this is transmitted anywhere. You can remove it at any time by clearing the app's storage in your device settings (or this site's data in your browser). Saved signatures can also be deleted from inside the PDF Signer. The app sets no cookies and is excluded from device backups.</p>
    <h2>Information we collect</h2>
    <p>None. ${n} does not collect, receive, store or share any personal information, and has no servers that could. The Google Play listing's Data safety section says the same.</p>
    <h2>What the website host can see</h2>
    <p>If you use the web version, or read this page, the server that delivers it receives standard technical information when your browser asks for a page, such as your IP address, the address requested, your browser type and the time. This is used to deliver and secure the site. It never includes the contents of your files, because those never leave your device. The Android app does not contact any server.</p>
    <h2>Using the tools</h2>
    <ul>
      <li>Results are provided as they are. Keep your original files, especially after compressing video or images, which is lossy.</li>
      <li>The PDF Signer adds an image of a signature to a PDF. It is not a certificate-based digital signature, and whether it is accepted depends on who you send it to.</li>
      <li>The calculators are for general information. The BMI result in particular is a screening measure, not medical advice.</li>
    </ul>
    <h2>Children</h2>
    <p>${n} is a general-purpose utility. It collects no personal information from anyone, including children.</p>
    <h2>Changes</h2>
    <p>If this ever changes, for example if analytics or advertising were added, this page would be updated first and the date above would change.</p>
    ${mail}`;
}
