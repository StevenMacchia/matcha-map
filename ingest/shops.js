// npm run shops: permanent matcha storefronts -> data/shops.json and site/data/shops.json.
// Sources: OpenStreetMap through Overpass (one query at a time per box), plus our cafe-kind brands
// whose own site shows a street address. Flags: --no-fetch (cache only) | --no-brands | --verbose
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { createGeocoder } from "./lib/geocode.js";
import { setVerbose, warn, info } from "./lib/log.js";
import { BOXES } from "./lib/shops/boxes.js";
import { buildQuery, runQuery, parseElements } from "./lib/shops/overpass.js";
import { findAddress } from "./lib/shops/brandsites.js";
import { dedupe, applyOverrides, fillState } from "./lib/shops/merge.js";

export const ATTRIBUTION = "© OpenStreetMap contributors, ODbL";
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

function cityTable() {
  try {
    const txt = fs.readFileSync("site/cities.js", "utf8");
    return JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1).replace(/,(\s*})/, "$1"));
  } catch { return {}; }
}

export async function brandShops({ fetcher, geocoder, sources, fetched }) {
  const out = [], missing = [];
  for (const s of sources.filter((x) => x.kind === "cafe" && x.website && x.active !== false)) {
    const a = await findAddress(fetcher, s.website);
    if (!a) { missing.push(s.id); continue; }
    const ev = { id: "brand:" + s.id, address: a.address, city: a.city || s.home_city, state: a.state || s.home_state, zip: a.zip, confidence: "confirmed" };
    await geocoder.geocode(ev);
    if (ev.lat == null || ev.geocode_source === "none") { missing.push(s.id + " (address found, not geocoded)"); continue; }
    out.push({
      id: "brand:" + s.id, brand_id: s.id, name: s.brand, lat: ev.lat, lng: ev.lng,
      address: a.address, city: ev.city, state: ev.state, zip: a.zip || null,
      website: s.website, instagram: s.instagram || null, phone: a.phone || null,
      opening_hours: a.hours || null, cuisine: null, source: "brand", geocode_source: ev.geocode_source, osm_url: null, fetched,
    });
  }
  return { shops: out, missing };
}

// One box; a box the server says is too big is cut into four and each part is asked in turn (depth 3 at most).
export async function queryBox(bbox, opts, depth = 0) {
  try {
    const j = await runQuery(buildQuery(bbox), opts);
    return j ? j.elements || [] : [];
  } catch (e) {
    if (!e.tooBig || depth >= 3) throw e;
    const [s, w, n, ea] = bbox, my = (s + n) / 2, mx = (w + ea) / 2, out = [];
    warn(`box ${bbox.join(",")} too big, splitting`);
    for (const b of [[s, w, my, mx], [s, mx, my, ea], [my, w, n, mx], [my, mx, n, ea]]) out.push(...(await queryBox(b, opts, depth + 1)));
    return out;
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
  if (flags.has("verbose")) setVerbose(true);
  const noFetch = flags.has("no-fetch");
  const t0 = Date.now(), fetched = new Date().toISOString();
  const osm = new Map();
  let noCoords = 0;
  const oi = process.argv.indexOf("--only"), only = oi > 0 ? process.argv[oi + 1] : null;
  for (const box of BOXES) {
    if (only && box.name !== only) continue;
    const tb = Date.now();
    const els = await queryBox(box.bbox, { noFetch });
    noCoords += els.filter((el) => (el.lat ?? el.center?.lat) == null || (el.lon ?? el.center?.lon) == null).length;
    const got = parseElements(els, fetched);
    got.forEach((s) => osm.set(s.id, s));
    info(`  ${box.name}: ${got.length} (${Math.round((Date.now() - tb) / 1000)} s)`);
  }
  let brands = { shops: [], missing: [] };
  if (!flags.has("no-brands")) {
    const fetcher = createFetcher({ noFetch });
    const geocoder = createGeocoder({ noFetch });
    brands = await brandShops({ fetcher, geocoder, sources: read("data/sources.json", []), fetched });
    geocoder.save();
    for (const m of brands.missing) warn("brand with no street address found, no point made:", m);
  }
  const cities = cityTable();
  let shops = dedupe([...osm.values(), ...brands.shops]);
  shops = applyOverrides(shops, read("data/shops-overrides.json", {})).map((s) => fillState(s, cities));
  shops.sort((a, b) => (a.state || "~").localeCompare(b.state || "~") || a.name.localeCompare(b.name));
  const out = { generated: fetched, attribution: ATTRIBUTION, shops };
  fs.mkdirSync("site/data", { recursive: true });
  fs.writeFileSync("data/shops.json", JSON.stringify(out, null, 1) + "\n");
  fs.writeFileSync("site/data/shops.json", JSON.stringify(out) + "\n");

  const by = (f) => { const m = {}; shops.forEach((s) => { const k = f(s); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  info(`Dropped, no coordinates (no node position or way center): ${noCoords}. Only OSM coordinates and geocoded street addresses are ever used; nothing is spread or placed at a city centre.`);
  info(`${shops.length} shops (${osm.size} OSM, ${brands.shops.length} brand sites) in ${Math.round((Date.now() - t0) / 1000)} s`);
  info("By state: " + by((s) => s.state || "?").slice(0, 12).map(([k, n]) => `${k} ${n}`).join(", "));
  info("Top cities: " + by((s) => (s.city || "?") + (s.state ? ", " + s.state : "")).slice(0, 10).map(([k, n]) => `${k} ${n}`).join("; "));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
