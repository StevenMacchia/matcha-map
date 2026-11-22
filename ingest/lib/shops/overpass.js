// Overpass API client for the storefront layer. One query at a time, a plain User-Agent, [timeout:180],
// a 60 s wait and one retry on 429 or 504, and a one-day disk cache of the raw responses.
// Usage rules: https://wiki.openstreetmap.org/wiki/Overpass_API
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UA } from "../fetch.js";
import { BRAND_NAMES } from "./brands.js";
import { warn, debug } from "../log.js";

export const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const DAY = 24 * 3600 * 1000;
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");

// The query for one box (nodes and ways only: a bbox over relations scans every relation and times out): matcha-ish venues by name, brand, cuisine or description, plus curated chains.
export function buildQuery([s, w, n, e]) {
  const bb = `(${s},${w},${n},${e})`;
  const types = `["amenity"~"^(cafe|tea|restaurant|ice_cream)$"]`;
  const shop = `["shop"~"^(tea|coffee|beverages)$"]`;
  const lines = [];
  for (const key of ["name", "brand", "cuisine", "description"]) {
    lines.push(`nw${types}["${key}"~"matcha",i]${bb};`, `nw${shop}["${key}"~"matcha",i]${bb};`);
  }
  const names = BRAND_NAMES.map(rx).join("|");
  lines.push(`nw["name"~"^(${names})$",i]${bb};`);
  return `[out:json][timeout:180];\n(\n  ${lines.join("\n  ")}\n);\nout center tags;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST one query. Returns parsed JSON. Waits and retries once on 429/504, then tries the next endpoint.
export async function runQuery(query, { cacheDir = ".cache", noFetch = false, waitMs = 60000, endpoints = ENDPOINTS, fetchImpl = fetch } = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "overpass-" + createHash("sha1").update(query).digest("hex") + ".json");
  try {
    const st = fs.statSync(file);
    if (noFetch || Date.now() - st.mtimeMs < DAY) { debug("overpass cache", file); return JSON.parse(fs.readFileSync(file, "utf8")); }
  } catch { /* no cache */ }
  if (noFetch) return null;
  let lastErr = "";
  for (const ep of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(ep, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(240000),
        });
        if (res.ok) {
          const j = JSON.parse(await res.text());
          if (j.remark && /timed out|out of memory/i.test(j.remark)) throw Object.assign(new Error("too big for one query: " + j.remark), { tooBig: true });
          fs.writeFileSync(file, JSON.stringify(j));
          return j;
        }
        lastErr = `${ep} HTTP ${res.status}`;
        if ([429, 504, 406].includes(res.status) && attempt === 0) { warn(lastErr + ", waiting " + waitMs / 1000 + " s"); await sleep(waitMs); continue; }
        break;
      } catch (e) {
        if (e.tooBig) throw e; // the caller splits the box; retrying the same query only wastes the server
        lastErr = `${ep} ${e.message}`;
        if (attempt === 0) { warn(lastErr + ", waiting " + waitMs / 1000 + " s"); await sleep(waitMs); continue; }
      }
    }
  }
  throw new Error("Overpass failed: " + lastErr);
}

const IG_URL = /instagram\.com\/([A-Za-z0-9._]+)/i;
function igHandle(tags) {
  const c = tags["contact:instagram"] || tags.instagram;
  if (c) { const m = IG_URL.exec(c); return (m ? m[1] : String(c).replace(/^@/, "").replace(/\/.*$/, "")).toLowerCase() || null; }
  for (const k of ["website", "contact:website", "url"]) { const m = IG_URL.exec(tags[k] || ""); if (m) return m[1].toLowerCase(); }
  return null;
}
const isIgUrl = (u) => IG_URL.test(u || "");

// Overpass elements -> shop records.
export function parseElements(elements, fetched) {
  const out = [];
  for (const el of elements || []) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!t.name || lat == null || lng == null) continue;
    const site = [t.website, t["contact:website"], t.url].find((u) => /^https?:\/\//i.test(u || "") && !isIgUrl(u)) || null;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: t.name,
      lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6),
      address: street || null,
      city: t["addr:city"] || null,
      state: t["addr:state"] || null,
      zip: t["addr:postcode"] || null,
      website: site,
      instagram: igHandle(t),
      phone: t.phone || t["contact:phone"] || null,
      opening_hours: t.opening_hours || null,
      cuisine: t.cuisine || null,
      source: "osm",
      osm_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      fetched,
    });
  }
  return out;
}
