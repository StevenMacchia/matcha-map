// The storefronts the site shows, in three files (perf lane, 2026-11-25). data/shops.json is the source of truth (every row,
// every field the pipeline keeps). The site layer is the rows that may be drawn: verified, or confirmed by a public page or
// Overture, not closed, "serves" rows unless SHOPS_SERVES=0. It reaches the browser as
//   site/data/shops.json          slim rows for the first paint: what a pin, a group and a list row draw and what the
//                                 at-shop pairing and the open-now dot read (id, name, lat, lng, city, state, tier, hours).
//                                 Same file name and same key names as before, so a page cached under the old app.js still
//                                 draws its pins; only the card details are missing there.
//   site/data/shops/<ST>.json     the card's details, one file per state: { state, shops: { <id>: { address, website, ... } } },
//                                 fetched when a shop's card opens (state "_" for rows with no state).
//   site/data/shops-photos.json   { photos: { <id>: image_url } } for the pins' pictures, fetched once the picture loader
//                                 opens (site/pics.js), so the first paint never carries 3,800 photo addresses.
// Fields the site never reads (overture_id, overture_sources, fetched, source_url, read, confirmed_via, geocode_source, the
// liveness bookkeeping, cuisine, phone) stay in data/shops.json only.
// Everything that used to read the full site/data/shops.json (gen-pages, the shop gate, the social plan, tests) calls
// readSiteShops(), which gives the same rows it gave before.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SLIM = ["id", "name", "lat", "lng", "city", "state", "tier", "opening_hours"];
export const DETAIL = ["address", "zip", "website", "instagram", "menu_url", "image_url", "image_credit", "menu_matcha", "menu", "note", "osm_url", "source"];

export const isSiteRow = (s, env = process.env) =>
  !!s && (s.verified || s.confirmed_via === "public-page" || s.confirmed_via === "overture") && s.status !== "closed" && (s.tier !== "serves" || env.SHOPS_SERVES !== "0");

export const shardName = (state) => (/^[A-Z]{2}$/.test(String(state || "")) ? state : "_");
const has = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);
const r5 = (n) => Math.round(n * 1e5) / 1e5;

export function slimRow(s) {
  const o = {};
  for (const k of SLIM) {
    const v = s[k];
    if (!has(v)) continue;
    o[k] = k === "lat" || k === "lng" ? r5(v) : v;
  }
  return o;
}
export function detailRow(s) {
  const o = {};
  for (const k of DETAIL) if (has(s[k])) o[k] = s[k];
  return o;
}

// The site layer from data/shops.json: { generated, attribution, shops } with every field.
export function readSiteShops(root = ".") {
  const src = path.join(root, "data", "shops.json");
  if (!fs.existsSync(src)) return JSON.parse(fs.readFileSync(path.join(root, "site", "data", "shops.json"), "utf8")); // a root with only the site file (a test fixture)
  const d = JSON.parse(fs.readFileSync(src, "utf8"));
  return { ...d, shops: (d.shops || []).filter((s) => isSiteRow(s)) };
}

// Write the three files from the full site layer. Shards for states that no longer have a shop are removed.
export function writeSiteShops(doc, root = ".") {
  const dir = path.join(root, "site", "data"), sd = path.join(dir, "shops");
  fs.mkdirSync(sd, { recursive: true });
  const rows = doc.shops || [], byState = {}, photos = {};
  for (const s of rows) {
    const k = shardName(s.state);
    const d = detailRow(s);
    if (Object.keys(d).length) (byState[k] = byState[k] || {})[s.id] = d;
    if (has(s.image_url)) photos[s.id] = s.image_url;
  }
  const head = { generated: doc.generated, attribution: doc.attribution };
  fs.writeFileSync(path.join(dir, "shops.json"), JSON.stringify({ ...head, shops: rows.map(slimRow) }) + "\n");
  fs.writeFileSync(path.join(dir, "shops-photos.json"), JSON.stringify({ generated: doc.generated, photos }) + "\n");
  for (const f of fs.readdirSync(sd)) if (f.endsWith(".json") && !byState[f.slice(0, -5)]) fs.unlinkSync(path.join(sd, f));
  for (const [k, shops] of Object.entries(byState)) fs.writeFileSync(path.join(sd, k + ".json"), JSON.stringify({ state: k, shops }) + "\n");
  return { rows: rows.length, shards: Object.keys(byState).length, photos: Object.keys(photos).length };
}

// Rebuild the site files from data/shops.json (what the pipeline steps call after they change it).
export function buildSiteShops(root = ".") { return writeSiteShops(readSiteShops(root), root); }

// CLI: node ingest/lib/site-shops.js  (rebuild the three files from data/shops.json)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(buildSiteShops()));
}
