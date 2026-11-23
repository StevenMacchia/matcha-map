// Geocoding: overrides > cache > Mapbox (if token) > Nominatim. 1 req/sec to Nominatim.
import fs from "node:fs";
import { UA } from "./fetch.js";
import { findCity } from "./cities.js";
import { debug, warn } from "./log.js";

const CONF = ["unsure", "likely", "confirmed"];
const capConf = (c, max) => (CONF.indexOf(c) > CONF.indexOf(max) ? max : c);
const MISS_RETRY_MS = 7 * 24 * 3600 * 1000;

// Normalize a query for cache keys: lowercase, strip punctuation, squeeze spaces.
export function normKey(s) {
  return String(s || "").toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}
const stripSuite = (s) => s.replace(/,?\s*(?:suite|ste\.?|unit|#)\s*[\w-]+/i, "");

export function createGeocoder({ noFetch = false, cachePath = "data/geocache.json", overridesPath = "data/overrides.json", env = process.env } = {}) {
  const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
  const cache = read(cachePath, {});
  const overrides = read(overridesPath, {});
  let last = 0;
  let dirty = false;

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
      hit = await lookup(`${ev.venue.replace(/^@/, "")}, ${tail}`);
      viaVenue = !!hit;
    }
    if (hit) {
      ev.lat = hit.lat; ev.lng = hit.lng; ev.geocode_source = hit.source;
      if (viaVenue) ev.confidence = capConf(ev.confidence, "likely");
      return ev;
    }
    // Last resort: the city centre, so it still shows on the map, roughly. A city of data/cities.json with its state comes from the
    // file (Census coordinates), so a listing that names only a city costs no Nominatim request.
    const listed = ev.city && ev.state ? findCity(ev.city, ev.state) : null;
    const c = listed ? { lat: listed.lat, lng: listed.lng } : tail ? await lookup(tail) : null;
    if (c) {
      ev.lat = c.lat; ev.lng = c.lng; ev.geocode_source = "none";
      ev.confidence = "unsure";
    } else {
      ev.lat = null; ev.lng = null; ev.geocode_source = "none";
    }
    debug("geocode fallback", ev.venue || ev.address, tail);
    return ev;
  }

  function save() {
    if (!dirty) return;
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(cachePath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return { geocode, lookup, save };
}
