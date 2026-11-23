// npm run shops: permanent matcha storefronts -> data/shops.json and site/data/shops.json.
// Sources: OpenStreetMap through Overpass (one query at a time per box), plus our cafe-kind brands
// whose own site shows a street address. One box per city of data/cities.json, biggest first; a run asks SHOP_BOXES_PER_RUN of them
// (default 120) from a saved position (.cache/shops-cursor.json), so successive runs walk the whole country. Shops already in
// data/shops.json from boxes not asked this run are kept; the ones inside a box asked again are replaced by what that box returns now.
// Flags: --no-osm (skip Overpass; keep OSM rows already in data/shops.json) | --no-fetch (cache only) | --no-brands | --all (every box this run) | --only <city> | --verbose
import { attachMenus } from "./lib/shops/menus.js";
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { createGeocoder } from "./lib/geocode.js";
import { setVerbose, warn, info } from "./lib/log.js";
import { loadBoxes, nextBoxes, boxesPerRun } from "./lib/shops/boxes.js";
import { buildQuery, runQuery, parseElements } from "./lib/shops/overpass.js";
import { findAddress } from "./lib/shops/brandsites.js";
import { curatedShops } from "./lib/shops/curated.js";
import { dedupe, applyOverrides, fillState, legitimate } from "./lib/shops/merge.js";

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
    if (ev.lat == null || !["nominatim", "mapbox"].includes(ev.geocode_source)) { missing.push(s.id + " (address found, not geocoded)"); continue; }
    out.push({
      id: "brand:" + s.id, brand_id: s.id, name: s.brand, lat: ev.lat, lng: ev.lng,
      address: a.address, city: ev.city, state: ev.state, zip: a.zip || null,
      website: s.website, instagram: s.instagram || null, phone: a.phone || null,
      opening_hours: a.hours || null, cuisine: null, source: "brand", verified: true, geocode_source: ev.geocode_source, osm_url: null, fetched,
    });
  }
  return { shops: out, missing };
}

// One metro box. Throws with .timeout (skip the box) or .allFailed (every mirror failed).
export async function queryBox(bbox, opts) {
  const j = await runQuery(buildQuery(bbox), opts);
  return j ? j.elements || [] : [];
}

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
  if (flags.has("verbose")) setVerbose(true);
  const noFetch = flags.has("no-fetch");
  const t0 = Date.now(), fetched = new Date().toISOString();
  const osm = new Map();
  let noCoords = 0, raw = 0, ran = 0, skipped = 0, fails = 0, stopped = false;
  const oi = process.argv.indexOf("--only"), only = oi > 0 ? process.argv[oi + 1] : null;
  const boxes = loadBoxes();
  const plan = only ? { batch: boxes.filter((b) => b.name === only), commit() {} } : flags.has("no-osm") ? { batch: [], commit() {} } : nextBoxes(boxes, { perRun: flags.has("all") ? boxes.length : boxesPerRun() });
  const asked = [];
  let attempted = 0;
  for (const box of plan.batch) {
    attempted++;
    const tb = Date.now();
    let els;
    try { els = await queryBox(box.bbox, { noFetch }); fails = 0; }
    catch (e) {
      if (e.timeout) { skipped++; warn(`box ${box.name} skipped, timed out: ${e.message}`); continue; }
      fails++; skipped++; warn(`box ${box.name} failed on every mirror: ${e.message}`);
      if (fails >= 3) { warn("three boxes in a row failed on every mirror; stopping the Overpass pass for this run"); stopped = true; break; }
      continue;
    }
    ran++;
    asked.push(box.bbox);
    noCoords += els.filter((el) => (el.lat ?? el.center?.lat) == null || (el.lon ?? el.center?.lon) == null).length;
    const got = parseElements(els, fetched);
    raw += got.length;
    got.forEach((s) => osm.set(s.id, s));
    info(`  ${box.name}: ${got.length} (${Math.round((Date.now() - tb) / 1000)} s)`);
  }
  if (!noFetch) plan.commit(stopped ? attempted - 1 : attempted);
  // OSM shops from earlier runs outside the boxes asked now stay (the cursor means a run covers only part of the country).
  const inside = (s, bb) => s.lat >= bb[0] && s.lat <= bb[2] && s.lng >= bb[1] && s.lng <= bb[3];
  for (const s of read("data/shops.json", { shops: [] }).shops) if (s.source === "osm" && !osm.has(s.id) && !asked.some((bb) => inside(s, bb))) osm.set(s.id, s);
  let brands = { shops: [], missing: [] };
  if (!flags.has("no-brands")) {
    const fetcher = createFetcher({ noFetch });
    const geocoder = createGeocoder({ noFetch });
    brands = await brandShops({ fetcher, geocoder, sources: read("data/sources.json", []), fetched });
    geocoder.save();
    for (const m of brands.missing) warn("brand with no street address found, no point made:", m);
  }
  const cities = cityTable();
  // Researched storefronts (data/shops-<region>-<part>.json): geocoded from their street address, verified by their own site.
  let web = { shops: [], held: [] };
  { const geocoder = createGeocoder({ noFetch }); web = await curatedShops({ geocoder, fetched }); geocoder.save(); for (const h of web.held) warn(`curated shop held: ${h.name} (${h.file}): ${h.why}`); }
  const leg = legitimate([...osm.values(), ...brands.shops, ...web.shops]);
  let shops = dedupe(leg.kept);
  shops = applyOverrides(shops, read("data/shops-overrides.json", {})).map((s) => fillState(s, cities));
  shops = attachMenus(shops, read("data/menus.json", { menus: {} }).menus);
  shops.sort((a, b) => (a.state || "~").localeCompare(b.state || "~") || a.name.localeCompare(b.name));
  const out = { generated: fetched, attribution: ATTRIBUTION, shops };
  // "serves" rows (coffee and tea shops with matcha on the menu) stay in data/shops.json; the site layer gets them only with SHOPS_SERVES=1
  // (the site session switches that on once it draws the lighter "Matcha on the menu" pin).
  const site = shops.filter((s) => s.verified && (s.tier !== "serves" || process.env.SHOPS_SERVES === "1"));
  fs.mkdirSync("site/data", { recursive: true });
  fs.writeFileSync("data/shops.json", JSON.stringify(out, null, 1) + "\n");
  fs.writeFileSync("site/data/shops.json", JSON.stringify({ ...out, shops: site }) + "\n");

  const by = (f) => { const m = {}; shops.forEach((s) => { const k = f(s); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  info(`Dropped, no coordinates (no node position or way center): ${noCoords}. Only OSM coordinates and geocoded street addresses are ever used; nothing is spread or placed at a city centre.`);
  info(`Boxes run ${ran}, skipped ${skipped}${stopped ? " (stopped early)" : ""} of ${plan.batch.length} asked this run (${boxes.length} in all). Raw OSM hits ${raw}; dropped closed ${leg.dropped.closed}, no address ${leg.dropped.noAddress}, no name ${leg.dropped.noName}.`);
  info(`${shops.length} kept (${site.length} verified, written to the site; ${shops.length - site.length} unverified, data/ only; ${brands.shops.length} brand sites) in ${Math.round((Date.now() - t0) / 1000)} s; ${web.shops.length} researched rows kept, ${web.held.length} held`);
  info("By state: " + by((s) => s.state || "?").slice(0, 12).map(([k, n]) => `${k} ${n}`).join(", "));
  info("Top cities: " + by((s) => (s.city || "?") + (s.state ? ", " + s.state : "")).slice(0, 10).map(([k, n]) => `${k} ${n}`).join("; "));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
