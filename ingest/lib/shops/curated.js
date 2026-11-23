// Curated storefronts: data/shops-<region>-<part>.json files written by research workers (never rewritten by the pipeline).
// Shape of a file: { generated, group, shops: [ { name, address, city, state, zip?, website?, instagram?, phone?, opening_hours?,
//   menu_url?, image_url?, image_credit?, source_url, read, confirmed_via, notes? } ] }.
// A row is kept only with a name, a street address, a city, a two-letter state, a public source_url and a read date. Coordinates are never
// taken from the file: the address is geocoded through the committed Nominatim cache (data/geocache.json) and a row that does not geocode
// is held with the reason. verified = the worker confirmed the shop on its own site or Instagram bio (confirmed_via), never a press list alone.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
export const CONFIRMED_VIA = new Set(["own-site", "instagram-bio", "press+site"]);
const http = (u) => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u.trim()) ? u.trim() : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const handle = (v) => { const s = str(v); if (!s) return null; const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(s); return (m ? m[1] : s.replace(/^@/, "")).toLowerCase().replace(/[^a-z0-9._]/g, "") || null; };
const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

// Ids are "brand:web-<slug>-<hash>" (at most 60 characters after "brand:"): the site's ?shop= deep link accepts only osm:<type>/<n> and
// brand:<[a-z0-9._-]{1,60}>, and a "web-" id never equals an OSM id, so only the 150 m same-name dedupe merges a researched row with another.
export function shopId(name, state, city, address) {
  const full = `${slug(name)}-${state.toLowerCase()}-${slug(city)}-${slug(address)}`;
  const h = createHash("sha1").update(full).digest("hex").slice(0, 6);
  return `brand:web-${full.slice(0, 46).replace(/-+$/, "")}-${h}`;
}

// Tier: "shop" (the default; matcha is the core offer) or "serves" (a coffee or tea shop whose own public menu lists at least three distinct
// matcha drinks: tier "serves", `menu_matcha` = [{name, price?}] read from `menu_url`, drawn as a lighter pin "Matcha on the menu").
export const MIN_SERVES_ITEMS = 3;
function matchaItems(list) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const name = str(x?.name);
    if (!name || !/matcha|ceremonial|usucha|koicha|hojicha|uji|green tea/i.test(name + " " + (x.note || "")) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name: name.slice(0, 80), price: str(x.price) });
  }
  return out;
}

// One raw row -> { shop } (without coordinates) or { held: reason }.
export function checkRow(r, file = "") {
  const name = str(r?.name), address = str(r?.address), city = str(r?.city), state = str(r?.state)?.toUpperCase() || null, source_url = http(r?.source_url);
  if (!name) return { held: "no name" };
  if (!address || !/^\d/.test(address)) return { held: "no street address" };
  if (!city) return { held: "no city" };
  if (!state || !STATES.has(state)) return { held: "no state" };
  if (!source_url) return { held: "no public source_url" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.read || ""))) return { held: "no read date" };
  const via = CONFIRMED_VIA.has(r.confirmed_via) ? r.confirmed_via : null;
  const tier = r.tier === "serves" ? "serves" : "shop";
  const menu_matcha = tier === "serves" ? matchaItems(r.menu_matcha) : null;
  if (tier === "serves" && (!http(r.menu_url) || menu_matcha.length < MIN_SERVES_ITEMS)) return { held: `serves tier needs a menu_url and at least ${MIN_SERVES_ITEMS} distinct matcha drinks` };
  const zip = /^\d{5}/.test(String(r.zip || "")) ? String(r.zip).slice(0, 5) : null;
  return {
    shop: {
      id: shopId(name, state, city, address),
      name, address, city, state, zip,
      website: http(r.website), instagram: handle(r.instagram), phone: str(r.phone), opening_hours: str(r.opening_hours),
      menu_url: http(r.menu_url), image_url: http(r.image_url), image_credit: str(r.image_credit),
      tier, ...(menu_matcha ? { menu_matcha } : {}), note: str(r.note) ? str(r.note).slice(0, 120) : null,
      cuisine: null, source: "web", source_url, read: r.read, confirmed_via: via, verified: !!via,
    },
  };
}

export function readCuratedFiles(dir = "data") {
  const files = fs.readdirSync(dir).filter((f) => /^shops-.+\.json$/.test(f) && f !== "shops-overrides.json").sort();
  const rows = [];
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    for (const r of j.shops || []) rows.push({ file: f, row: r });
  }
  return rows;
}

// -> { shops, held:[{file, name, why}] }. geocoder.geocode(ev) fills ev.lat/lng/geocode_source from ev.address, ev.city, ev.state.
export async function curatedShops({ geocoder, fetched, dir = "data" }) {
  const shops = [], held = [], seen = new Set();
  for (const { file, row } of readCuratedFiles(dir)) {
    const c = checkRow(row, file);
    if (c.held) { held.push({ file, name: row?.name || "?", why: c.held }); continue; }
    const s = c.shop;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const ev = { id: s.id, address: s.address, city: s.city, state: s.state, zip: s.zip, confidence: "confirmed" };
    await geocoder.geocode(ev);
    if (ev.lat == null || !["nominatim", "mapbox", "manual"].includes(ev.geocode_source)) { held.push({ file, name: s.name, why: "address not geocoded" }); continue; }
    shops.push({ ...s, lat: ev.lat, lng: ev.lng, geocode_source: ev.geocode_source, osm_url: null, fetched });
  }
  return { shops, held };
}
