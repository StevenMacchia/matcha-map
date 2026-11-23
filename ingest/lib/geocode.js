// Geocoding: overrides > cache > Mapbox (if token) > Nominatim. 1 req/sec to Nominatim.
import fs from "node:fs";
import { UA } from "./fetch.js";
import { findCity } from "./cities.js";
import { debug, warn } from "./log.js";
import { PLACEHOLDER_VENUE } from "./names.js";

const CONF = ["unsure", "likely", "confirmed"];
const capConf = (c, max) => (CONF.indexOf(c) > CONF.indexOf(max) ? max : c);
const MISS_RETRY_MS = 7 * 24 * 3600 * 1000;

// Normalize a query for cache keys: lowercase, strip punctuation, squeeze spaces.
export function normKey(s) {
  return String(s || "").toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}

// ---- venue lookups (rung 30) ------------------------------------------------------------------
// A venue is looked up only when it is a written name: not a handle ("@shop", "shop_nyc", "shop.nyc") and not a placeholder
// ("Cafe of the month").
export const lookableVenue = (v) => {
  const s = String(v || "").trim();
  if (s.length < 3 || s.startsWith("@") || PLACEHOLDER_VENUE.test(s)) return false;
  return !(!/\s/.test(s) && /[._]/.test(s));
};
const VENUE_STOP = new Set(["the", "and", "cafe", "coffee"]);
const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’‘`]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
const core = (s) => { const w = words(s); const k = w.filter((x) => !VENUE_STOP.has(x)); return k.length ? k : w; };
export const VENUE_MAX_KM = 60;
export function kmBetween(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// Is a Nominatim hit this venue? The venue's words ("the", "cafe", "coffee", "&"/"and" folded away) all appear in the hit's own
// name or in the first segment of its display name (equal or wholly contained), and the hit lies within 60 km of the city centre.
export function plausibleVenue(venue, hit, center = null) {
  const need = core(venue);
  if (!need.length) return false;
  const first = String(hit.display_name || "").split(",")[0];
  const ok = [hit.name, first].some((n) => { const have = new Set(core(n)); return have.size && need.every((w) => have.has(w)); });
  if (!ok) return false;
  if (center && kmBetween(center, { lat: +hit.lat, lng: +hit.lon }) > VENUE_MAX_KM) return false;
  return true;
}
const stripSuite = (s) => s.replace(/,?\s*(?:suite|ste\.?|unit|#)\s*[\w-]+/i, "");

export function createGeocoder({ noFetch = false, cachePath = "data/geocache.json", overridesPath = "data/overrides.json", env = process.env, maxRemote = Infinity } = {}) {
  const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
  const cache = read(cachePath, {});
  const overrides = read(overridesPath, {});
  let last = 0;
  let dirty = false;
  let remoteCalls = 0; // venue requests sent this run; maxRemote keeps a run small
  let throttled = false; // a 429 ends the venue lookups of the run (no retries)

  async function remote(q) {
    if (noFetch) return null;
    const wait = last + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      if (env.MAPBOX_TOKEN) {
        const u = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=us&limit=1&access_token=${env.MAPBOX_TOKEN}`;
        const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        const c = j.features?.[0]?.center;
        return c ? { lat: c[1], lng: c[0], source: "mapbox" } : null;
      }
      const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=us&limit=1`;
      const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return j[0] ? { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6), source: "nominatim" } : null;
    } catch (e) {
      warn("geocode failed:", q, e.message);
      return null;
    }
  }

  // A venue: free-form "<venue>, <city>, <state>" on Nominatim, up to three hits, the first plausible one wins.
  // Cached under "venue: <query>"; an HTTP error (429 included) is not cached as a miss, so the next run asks again.
  // A venue: first the bare name bounded to a 0.4 degree box around the city's centre (finds suburbs the comma form misses),
  // then "<venue>, <city>, <state>"; each up to three hits, the first one that matches the name wins.
  // Cached under "venue: <query>"; an HTTP error (429 included) is not cached as a miss, so the next run asks again.
  async function venueRemote(venue, tail, center) {
    const box = center ? `&viewbox=${center.lng - 0.4},${center.lat + 0.4},${center.lng + 0.4},${center.lat - 0.4}&bounded=1` : "";
    const tries = center ? [`${encodeURIComponent(venue)}${box}`, encodeURIComponent(`${venue}, ${tail}`)] : [encodeURIComponent(`${venue}, ${tail}`)];
    for (const q of tries) {
      if (noFetch || throttled || remoteCalls >= maxRemote) return undefined;
      const wait = last + 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      remoteCalls++;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}&countrycodes=us&limit=3`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
        if (r.status === 429) { throttled = true; warn("geocode: Nominatim answered 429, venue lookups stop for this run"); return undefined; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        const hit = (Array.isArray(j) ? j : []).find((h) => plausibleVenue(venue, h, center));
        if (hit) return { lat: +(+hit.lat).toFixed(6), lng: +(+hit.lon).toFixed(6), source: "nominatim-venue" };
      } catch (e) {
        warn("geocode failed:", venue, e.message);
        return undefined;
      }
    }
    return null;
  }
  async function lookupVenue(venue, city, state) {
    if (!lookableVenue(venue)) return null;
    const tail = [city, state].filter(Boolean).join(", ");
    const key = "venue: " + normKey(`${venue}, ${tail}`);
    const c = cache[key];
    if (c && !c.miss) return c;
    if (c && c.miss && (noFetch || Date.now() - c.at < MISS_RETRY_MS)) return null;
    const listed = city && state ? findCity(city, state) : null;
    const r = await venueRemote(venue.trim(), tail, listed);
    if (r === undefined) return null;
    cache[key] = r || { miss: true, at: Date.now() };
    dirty = true;
    return r;
  }

  // Look a query up: cache first, then remote. Misses are remembered for a week.
  async function lookup(q) {
    const key = normKey(q);
    if (!key) return null;
    const c = cache[key];
    if (c && !c.miss) return c;
    if (c && c.miss && (noFetch || Date.now() - c.at < MISS_RETRY_MS)) return null;
    const r = await remote(q);
    if (r) { cache[key] = r; dirty = true; }
    else if (!noFetch) { cache[key] = { miss: true, at: Date.now() }; dirty = true; }
    return r;
  }

  // Fill lat/lng/geocode_source on an event candidate; may lower confidence.
  async function geocode(ev) {
    // An override by id may name the real city when the source only gave a region ("Northern Virginia") for a venue in another city.
    const ov0 = overrides[ev.id];
    if (ov0 && typeof ov0.city === "string" && ov0.city) { ev.city = ov0.city; if (ov0.state) ev.state = ov0.state; }
    const addrKey = normKey([ev.address, ev.city, ev.state].filter(Boolean).join(" "));
    const ov = overrides[ev.id] || overrides[addrKey];
    if (ov && typeof ov.lat === "number") {
      return Object.assign(ev, { lat: ov.lat, lng: ov.lng, geocode_source: "manual" });
    }
    const tail = [ev.city, ev.state].filter(Boolean).join(", ");
    const z = ev.zip ? " " + ev.zip : "";
    let hit = null;
    let viaVenue = false;
    if (ev.address) {
      hit = await lookup(`${ev.address}, ${tail}${z}`);
      if (!hit && /suite|ste|unit|#/i.test(ev.address)) hit = await lookup(`${stripSuite(ev.address)}, ${tail}${z}`);
    }
    if (!hit && ev.venue && !ev.address) {
      hit = await lookupVenue(ev.venue, ev.city, ev.state);
      viaVenue = !!hit;
    }
    if (hit) {
      ev.lat = hit.lat; ev.lng = hit.lng; ev.geocode_source = hit.source; ev.approx = false;
      if (viaVenue) ev.confidence = capConf(ev.confidence, "likely");
      return ev;
    }
    // Last resort: the city centre, so it still shows on the map, roughly. A city of data/cities.json with its state comes from the
    // file (Census coordinates), so a listing that names only a city costs no Nominatim request.
    const listed = ev.city && ev.state ? findCity(ev.city, ev.state) : null;
    const c = listed ? { lat: listed.lat, lng: listed.lng } : tail ? await lookup(tail) : null;
    if (c) {
      ev.lat = c.lat; ev.lng = c.lng; ev.geocode_source = "none"; ev.approx = true;
      ev.confidence = "unsure";
    } else {
      ev.lat = null; ev.lng = null; ev.geocode_source = "none"; ev.approx = false;
    }
    debug("geocode fallback", ev.venue || ev.address, tail);
    return ev;
  }

  function save() {
    if (!dirty) return;
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(cachePath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return { geocode, lookup, lookupVenue, save, remoteCalls: () => remoteCalls };
}
