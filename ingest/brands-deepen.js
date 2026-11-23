// npm run brands:deepen: fill the gaps of the brand cards (site/data/brands.json) from public pages and from what we hold.
//   bio      <- the brand's own website's meta description (og:description), only when the card has none, with its source named
//   picture  <- the brand's own website's og:image, only when the card has none
//   website  <- the source record's website, only when the card has none
//   last_dated_post_seen <- the latest dated event or post we hold for the handle (YYYY-MM-DD), from data/events.json
//   recent   <- up to 3 posts we hold for the handle (an event with its Instagram post link and picture), only when the card has none
// Result: data/brands-extra.json keyed by Instagram handle, applied by this command and by every `npm run brands` / watch run
// (ingest/lib/enrich/brands.js attachBrandExtras). Own websites only, robots respected, nothing from behind a login: instagram.com and
// Linktree disallow crawling, so they are not read. Nothing is guessed. `-- --dry` prints coverage without writing.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { metaContent, decode } from "./lib/html.js";
import { attachBrandExtras, cleanBio } from "./lib/enrich/brands.js";

const dry = process.argv.includes("--dry");
const cov = (list) => ({
  picture: list.filter((b) => b.picture).length, bio: list.filter((b) => b.bio).length, website: list.filter((b) => b.website).length,
  followers: list.filter((b) => b.followers != null).length, recent: list.filter((b) => (b.recent || []).length).length,
  last_dated_post_seen: list.filter((b) => b.last_dated_post_seen).length,
});

// A usable bio: a description with some words in it, not a template line or a cookie notice.
export function usableBio(s) {
  const t = decode(String(s || "")).replace(/\s+/g, " ").trim();
  if (t.length < 30 || t.length > 400) return null;
  if (/cookie|javascript|just a moment|access denied|coming soon|lorem ipsum|your site title|wix\.com|squarespace|shopify/i.test(t)) return null;
  return t;
}

async function main() {
  const file = "site/data/brands.json";
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
  const byHandle = new Map(sources.filter((s) => s.instagram).map((s) => [s.instagram.toLowerCase(), s]));
  const events = JSON.parse(fs.readFileSync("data/events.json", "utf8")).events;
  const last = new Map(), posts = new Map();
  for (const e of events) {
    const h0 = String(e.handle || "").toLowerCase();
    const k0 = e.source_id ? "src:" + e.source_id : null;
    if (k0 && e.posts && e.posts.instagram && (e.image_url || (e.image && e.image.url))) posts.set(k0, [...(posts.get(k0) || []), { permalink: e.posts.instagram, image_url: e.image_url || e.image.url, timestamp: e.start, caption: String(e.title || "").replace(/\s+/g, " ").trim().slice(0, 80) }]);
    if (k0 && e.start) { const d0 = String(e.start).slice(0, 10); if (!last.get(k0) || d0 > last.get(k0)) last.set(k0, d0); }
    const link = e.posts && e.posts.instagram, img = e.image_url || (e.image && e.image.url);
    if (h0 && link && img) posts.set(h0, [...(posts.get(h0) || []), { permalink: link, image_url: img, timestamp: e.start, caption: String(e.title || "").replace(/\s+/g, " ").trim().slice(0, 80) }]);
    const h = String(e.handle || "").toLowerCase(); if (!h) continue;
    const d = String(e.start || "").slice(0, 10);
    if (d && (!last.get(h) || d > last.get(h))) last.set(h, d);
  }
  const prev = fs.existsSync("data/brands-extra.json") ? JSON.parse(fs.readFileSync("data/brands-extra.json", "utf8")).brands || {} : {};
  const extra = { ...prev };
  const f = createFetcher();
  const siteCache = new Map();
  const before = cov(data.brands);
  let read = 0, unreadable = 0;
  for (const b of data.brands) {
    const h = b.handle.toLowerCase();
    const src = b.source_id ? sources.find((s) => s.id === b.source_id) : byHandle.get(h);
    const key = b.source_id ? "src:" + b.source_id : h;
    const e = { ...(extra[b.handle] || {}) };
    const website = b.website || src?.website || null;
    if (!b.website && src?.website) e.website = src.website;
    if (last.get(key)) e.last_dated_post_seen = last.get(key);
    if (!(b.recent || []).length && posts.get(key)) { const seen = new Set(); e.recent = posts.get(key).sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp))).filter((p) => !seen.has(p.permalink) && seen.add(p.permalink)).slice(0, 3); }
    if (website && (!b.bio || !b.picture)) {
      let page = siteCache.get(website);
      if (page === undefined) {
        try { const r = await f.get(website); read++; page = r.ok ? r.text : null; if (!r.ok) unreadable++; } catch { unreadable++; page = null; }
        siteCache.set(website, page);
      }
      if (page) {
        if (!b.bio) { const bio = cleanBio(usableBio(metaContent(page, "og:description") || metaContent(page, "description"))); if (bio.length >= 30) { e.bio = bio; e.bio_source = website; } }
        if (!b.picture) { const img = metaContent(page, "og:image"); if (img) { try { e.picture = new URL(img, website).href; e.picture_source = website; } catch { /* skip */ } } }
      }
    }
    if (Object.keys(e).length) extra[b.handle] = { ...e, read: new Date().toISOString().slice(0, 10) };
  }
  const after = cov(attachBrandExtras(data.brands, extra));
  console.log(`read ${read} brand sites (${unreadable} not readable)`);
  console.log("before", JSON.stringify(before));
  console.log("after ", JSON.stringify(after), `of ${data.brands.length}`);
  if (dry) return;
  fs.writeFileSync("data/brands-extra.json", JSON.stringify({ about: "Gaps of the brand cards filled from each brand's own public website and from the events we hold (npm run brands:deepen). Only empty fields are filled.", brands: extra }, null, 1) + "\n");
  // Rebuild the file the way `npm run brands` does (so the size cap applies), now that the extras are on disk.
  const wlib = await import("./lib/watchlist.js");
  const { buildBrands, writeBrands } = await import("./lib/enrich/brands.js");
  writeBrands(buildBrands(wlib.load(), sources), file);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
