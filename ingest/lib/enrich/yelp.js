// Yelp Fusion enrichment: rating, review count, price, phone, hours and a photo for a venue or shop, shown on the card with Yelp's
// attribution. OFF until YELP_API_KEY exists in .env (free, no card, 500 calls a day). Official API only; no yelp.com pages are read.
//   GET https://api.yelp.com/v3/businesses/search?term=<venue>&location=<city, state>&limit=3   (or latitude/longitude for a shop)
//   GET https://api.yelp.com/v3/businesses/{id}                                                  (hours)
// A business counts as the venue only when the venue's name words are all in Yelp's name (same rule as the venue geocoder) and it
// lies within 30 km. Results are cached 7 days in data/yelp-cache.json; the file also counts the day's calls (stop at 400).
import fs from "node:fs";
import path from "node:path";
import { UA } from "../fetch.js";
import { kmBetween, lookableVenue, plausibleVenue } from "../geocode.js";
import { findCity } from "../cities.js";
import { tzForPlace } from "../tz.js";
import { info, warn } from "../log.js";

export const BASE = "https://api.yelp.com/v3";
export const CACHE_FILE = "data/yelp-cache.json";
export const PLACES_FILE = "site/data/places.json";
export const MAX_KM = 30;
export const DAILY_CAP = 400;
export const TTL_MS = 7 * 86400000;
export const OFF_LINE = "Yelp: off (set YELP_API_KEY in .env; free, no card, 500 calls a day)";

const squeeze = (s) => String(s || "").toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
// The cache and places key: "venue|city|state", lowercase. A shop with no city uses its rounded position so two shops never share one.
export function placeKey(name, city, state, lat = null, lng = null) {
  if (city && state) return [name, city, state].map(squeeze).join("|");
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${squeeze(name)}|${lat.toFixed(2)},${lng.toFixed(2)}|`;
  return [name, city, state].map(squeeze).join("|");
}
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// Does this Yelp business match the venue near where it should be? `near` is {lat, lng} (the city centre or the shop).
export function matchBusiness(venue, biz, near) {
  const c = biz?.coordinates;
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return false;
  if (!plausibleVenue(venue, { name: biz.name, display_name: biz.name, lat: c.latitude, lon: c.longitude }, null)) return false;
  return !near || kmBetween(near, { lat: c.latitude, lng: c.longitude }) <= MAX_KM;
}

export function createYelp({ env = process.env, http = fetch, cachePath = CACHE_FILE, now = () => Date.now() } = {}) {
  const key = env.YELP_API_KEY || "";
  let cache = { days: {}, entries: {} };
  try { cache = { days: {}, entries: {}, ...JSON.parse(fs.readFileSync(cachePath, "utf8")) }; } catch { /* first run */ }
  let dirty = false, announced = false, stopped = false, made = 0;
  const today = () => dayOf(now());
  const used = () => cache.days[today()] || 0;

  async function call(pathAndQuery) {
    if (used() >= DAILY_CAP) { stopped = true; return null; }
    cache.days[today()] = used() + 1; made++; dirty = true;
    const r = await http(BASE + pathAndQuery, { headers: { Authorization: `Bearer ${key}`, "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { if (r.status === 429) stopped = true; throw new Error(`Yelp HTTP ${r.status}`); }
    return r.json();
  }

  // -> place object, null (no match), or undefined (not asked: no key, daily cap reached, or the call failed).
  // ask = {name, city, state, lat, lng}: city/state for an event venue, lat/lng for a shop (or both).
  async function lookup(ask) {
    if (!key) { if (!announced) { announced = true; info(OFF_LINE); } return undefined; }
    const name = String(ask.name || "").trim();
    if (!lookableVenue(name)) return null;
    const k = placeKey(name, ask.city, ask.state, ask.lat, ask.lng);
    const hit = cache.entries[k];
    if (hit && now() - hit.at < TTL_MS) return hit.miss ? null : hit.place;
    if (stopped || used() >= DAILY_CAP) { stopped = true; return undefined; }
    const listed = ask.city && ask.state ? findCity(ask.city, ask.state) : null;
    const hasPos = Number.isFinite(ask.lat) && Number.isFinite(ask.lng);
    const near = hasPos ? { lat: ask.lat, lng: ask.lng } : listed ? { lat: listed.lat, lng: listed.lng } : null;
    const where = hasPos && !ask.city ? `latitude=${ask.lat}&longitude=${ask.lng}` : `location=${encodeURIComponent([ask.city, ask.state].filter(Boolean).join(", "))}`;
    let place = null;
    try {
      const s = await call(`/businesses/search?term=${encodeURIComponent(name)}&${where}&limit=3`);
      if (s === null) return undefined;
      const biz = (s.businesses || []).find((b) => !b.is_closed && matchBusiness(name, b, near));
      if (biz) {
        let detail = null;
        try { detail = await call(`/businesses/${encodeURIComponent(biz.id)}`); } catch { /* the search answer is enough */ }
        const d = detail || biz, c = biz.coordinates;
        place = {
          key: k, name: biz.name, rating: biz.rating ?? null, review_count: biz.review_count ?? null, price: biz.price || null,
          phone: biz.phone || d.phone || null, url: String(biz.url || "").split("?")[0] || null, image_url: biz.image_url || d.image_url || null,
          hours: d.hours?.[0]?.open || [], tz: tzForPlace(ask.state || biz.location?.state, c.latitude, c.longitude),
          lat: c.latitude, lng: c.longitude, yelp_id: biz.id, fetched_at: new Date(now()).toISOString(),
        };
      }
    } catch (e) { warn(`Yelp: ${name}: ${e.message}`); return undefined; }
    cache.entries[k] = place ? { at: now(), place } : { at: now(), miss: true };
    dirty = true;
    return place;
  }

  return {
    on: !!key, lookup, calls: () => made, usedToday: used, stopped: () => stopped,
    // Places still fresh in the cache, as the list written to site/data/places.json.
    places() { return Object.values(cache.entries).filter((e) => !e.miss && now() - e.at < TTL_MS).map((e) => e.place).sort((a, b) => a.key.localeCompare(b.key)); },
    save() {
      if (!dirty) return;
      for (const d of Object.keys(cache.days)) if (d < dayOf(now() - 7 * 86400000)) delete cache.days[d];
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(cache));
      dirty = false;
    },
  };
}

export function writePlaces(places, { file = PLACES_FILE, now = new Date() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ generated: new Date(now).toISOString(), places }) + "\n");
}

// A venue still drawn at its city's centre gets Yelp's coordinates when Yelp matched its name. Mutates; returns the events changed.
export function fillApproxFromYelp(events, places) {
  const byKey = new Map((places || []).map((p) => [p.key, p]));
  const changed = [];
  for (const e of events) {
    if (!(e.approx === true && e.geocode_source === "none" && e.venue && !e.address)) continue;
    const p = byKey.get(placeKey(e.venue, e.city, e.state));
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    e.lat = p.lat; e.lng = p.lng; e.geocode_source = "yelp"; e.approx = false;
    if (e.confidence === "confirmed") e.confidence = "likely";
    changed.push(e);
  }
  return changed;
}

// Look up upcoming events' venues, then shops; write places.json and the cache. Returns {on, looked, matched, calls}.
// Without a key it prints the one "Yelp: off" line and does nothing else.
export async function enrich({ events, shops = [], yelp = createYelp(), dry = false, placesFile = PLACES_FILE } = {}) {
  if (!yelp.on) { await yelp.lookup({ name: "off" }); return { on: false, looked: 0, matched: 0, calls: 0 }; }
  const asks = [], seen = new Set();
  const add = (a) => { const k = placeKey(a.name, a.city, a.state, a.lat, a.lng); if (!seen.has(k)) { seen.add(k); asks.push(a); } };
  for (const e of events) if (e.status === "upcoming" && e.venue && lookableVenue(e.venue)) add({ name: e.venue, city: e.city, state: e.state });
  for (const s of shops) if (s.name) add({ name: s.name, city: s.city, state: s.state, lat: s.lat, lng: s.lng });
  let looked = 0, matched = 0;
  for (const a of asks) {
    const p = await yelp.lookup(a);
    if (p === undefined) { if (yelp.stopped()) break; continue; }
    looked++; if (p) matched++;
  }
  if (!dry) { yelp.save(); writePlaces(yelp.places(), { file: placesFile }); }
  info(`Yelp: ${looked} of ${asks.length} places looked up, ${matched} matched, ${yelp.calls()} calls this run (${yelp.usedToday()} of ${DAILY_CAP} today)`);
  return { on: true, looked, matched, calls: yelp.calls() };
}
