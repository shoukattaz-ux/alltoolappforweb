import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SITE } from '../../src/data/site';
import { privacyHtml, PRIVACY_LEAD } from '../../src/data/privacy';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const png = (p: string) => { const b = readFileSync(resolve(root, p)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length, magic: b.subarray(1, 4).toString() }; };
const listing = JSON.parse(read('store/listing.json'));

describe('Google Play listing text limits', () => {
  it('title 30, short description 80, full description 4000, release notes 500 characters', () => {
    expect(listing.appName.length).toBeLessThanOrEqual(30); expect(listing.shortDescription.length).toBeLessThanOrEqual(80);
    expect(listing.fullDescription.length).toBeLessThanOrEqual(4000); expect(listing.releaseNotes.length).toBeLessThanOrEqual(500);
    expect(listing.appName.length).toBeGreaterThan(2); expect(listing.shortDescription.length).toBeGreaterThan(20);
  });
  it('has a public contact email matching the site settings, and an https privacy policy URL', () => {
    expect(listing.contactEmail).toBe(SITE.contactEmail); expect(listing.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(listing.privacyPolicyUrl).toMatch(/^https:\/\/.+\/privacy\.html$/); expect(listing.fullDescription).toContain(listing.contactEmail);
  });
  it('makes no claims the app cannot back up (no "ads free" wording slip, no unsupported features)', () => {
    const t = listing.fullDescription as string;
    expect(t).toMatch(/no permissions/i); expect(t).not.toMatch(/digital certificate signature(?!.*not)/i); expect(t).toMatch(/not a certificate-based digital signature/);
  });
});

describe('Google Play graphics meet the store requirements', () => {
  it('icon is a 512x512 PNG under 1 MB', () => { const i = png('store/icon-512.png'); expect([i.magic, i.w, i.h]).toEqual(['PNG', 512, 512]); expect(i.bytes).toBeLessThan(1024 * 1024); });
  it('feature graphic is exactly 1024x500', () => { const i = png('store/feature-graphic-1024x500.png'); expect([i.magic, i.w, i.h]).toEqual(['PNG', 1024, 500]); expect(i.bytes).toBeLessThan(15 * 1024 * 1024); });
  it('has 2 to 8 phone screenshots, each 320-3840 px, aspect ratio no more extreme than 2:1, under 8 MB', () => {
    const files = readdirSync(resolve(root, 'store/screenshots')).filter((f) => f.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(2); expect(files.length).toBeLessThanOrEqual(8);
    for (const f of files) {
      const i = png(`store/screenshots/${f}`); const long = Math.max(i.w, i.h), short = Math.min(i.w, i.h);
      expect(short).toBeGreaterThanOrEqual(320); expect(long).toBeLessThanOrEqual(3840); expect(long / short).toBeLessThanOrEqual(2); expect(statSync(resolve(root, `store/screenshots/${f}`)).size).toBeLessThan(8 * 1024 * 1024);
    }
  });
});

describe('Android manifest and privacy policy', () => {
  it('the manifest declares no permissions at all (so no INTERNET), and turns backups off', () => {
    const m = read('android/app/src/main/AndroidManifest.xml');
    expect(m).not.toMatch(/<uses-permission/); expect(m).toMatch(/android:allowBackup="false"/);
  });
  it('the privacy policy states the key facts and shows the contact email, escaped', () => {
    const html = privacyHtml(SITE);
    for (const claim of [/never uploaded/i, /no cookies/i, /no permissions at all/i, /not even internet access/i, /Saved signatures/, /Information we collect/, /None\./]) expect(html).toMatch(claim);
    expect(html).toContain(`mailto:${SITE.contactEmail}`); expect(PRIVACY_LEAD(SITE.name)).toContain(SITE.name);
    const evil = privacyHtml({ name: '<b>x</b>', contactEmail: 'a"b@c.d', privacyUpdated: '<i>' }); expect(evil).not.toContain('<b>x</b>'); expect(evil).not.toContain('<i>');
  });
  it('lists exactly the storage the app uses (guards against the policy and the code drifting apart)', () => {
    const src = ['src/app/store.ts', 'src/scripts/tools/sign-pdf.ts'].map(read).join('\n');
    const keys = [...src.matchAll(/['"](th[:-][a-z]+)['"]/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(new Set(['th:favs', 'th:recent', 'th:theme', 'th-signatures']));
  });
});
