// The one place the public address is set. Every generated page, feed, sitemap, JSON-LD url, share link and outreach link
// is built from it, so a domain change is this default (or the SITE_URL env for a one-off run) and `npm run ingest`.
// Live at https://matchamap.app since 2026-11-23 (matchamap-cu7.pages.dev redirects there).
export const SITE_URL = (process.env.SITE_URL || "https://matchamap.app").replace(/\/+$/, "");
export const SITE_HOST = new URL(SITE_URL).host;
