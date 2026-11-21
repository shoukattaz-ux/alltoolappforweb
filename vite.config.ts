import { defineConfig, type Plugin } from 'vite';

/**
 * Link-preview crawlers (Facebook, LinkedIn, X, Slack...) require ABSOLUTE og:image URLs.
 * Set SITE_URL at build time (e.g. SITE_URL=https://tools.example.com npm run build) to make the preview image
 * absolute and add a canonical link. Without it the tags stay relative, which still works for browsers.
 */
function siteUrl(): Plugin {
  const raw = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  return {
    name: 'site-url',
    transformIndexHtml(html) {
      if (!raw) return html;
      if (!/^https:\/\/[^\s/]+/.test(raw)) throw new Error(`SITE_URL must start with https:// (got "${raw}")`);
      return html
        .replace(/(property="og:image" content=")\/og-image\.png/, `$1${raw}/og-image.png`)
        .replace(/(name="twitter:image" content=")\/og-image\.png/, `$1${raw}/og-image.png`)
        .replace('</head>', `  <link rel="canonical" href="${raw}/" />\n  <meta property="og:url" content="${raw}/" />\n</head>`);
    },
  };
}

export default defineConfig({
  plugins: [siteUrl()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
