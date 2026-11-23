// Overpass API client for the storefront layer. One query at a time per metro box, a plain User-Agent,
// [timeout:60], 1 request per second, three mirrors tried in order, a one-day disk cache per query.
// A server-side timeout ends the box at once (no retry). Usage rules: https://wiki.openstreetmap.org/wiki/Overpass_API
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UA } from "../fetch.js";
import { BRAND_NAMES } from "./brands.js";
import { warn, debug } from "../log.js";

export const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const DAY = 24 * 3600 * 1000;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
const MATCHA = /matcha/i;
const CHAIN_RX = new RegExp("^(" + BRAND_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")$", "i");

// The query for one metro box (nodes and ways only): name or brand says matcha, or the name is on the confirmed chains list.
export function buildQuery([s, w, n, e]) {
  const bb = `(${s},${w},${n},${e})`;
  const names = BRAND_NAMES.map(esc).join("|");
  const lines = [`nw["name"~"matcha",i]${bb};`, `nw["brand"~"matcha",i]${bb};`, `nw["name"~"^(${names})$",i]${bb};`];
  return `[out:json][timeout:60];\n(\n  ${lines.join("\n  ")}\n);\nout center tags;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;

// POST one query, trying each mirror once in order. Returns parsed JSON (cached a day per query).
// A timeout ends the box at once: err.timeout = true, no retry. Every mirror failing otherwise: err.allFailed = true.
// An HTTP 429 (rate limited) or 504 (gateway timeout) makes us wait before the next mirror: backoffMs, doubled for each one in a row.
export async function runQuery(query, { cacheDir = ".cache", noFetch = false, endpoints = ENDPOINTS, fetchImpl = fetch, gapMs = 1000, timeoutMs = 75000, backoffMs = 15000 } = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "overpass-" + createHash("sha1").update(query).digest("hex") + ".json");
  try {
    const st = fs.statSync(file);
    if (noFetch || Date.now() - st.mtimeMs < DAY) { debug("overpass cache", file); return JSON.parse(fs.readFileSync(file, "utf8")); }
  } catch { /* no cache */ }
  if (noFetch) return null;
  const errs = [];
  let backoffs = 0;
  for (const ep of endpoints) {
    const wait = lastReq + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    try {
      const res = await fetchImpl(ep, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const j = JSON.parse(await res.text());
        if (j.remark && /timed out|out of memory/i.test(j.remark)) throw Object.assign(new Error(`${ep} query timed out: ${j.remark}`), { timeout: true });
        fs.writeFileSync(file, JSON.stringify(j));
        return j;
      }
      errs.push(`${ep} HTTP ${res.status}`);
      warn(errs[errs.length - 1]);
      if (res.status === 429 || res.status === 504) await sleep(backoffMs * 2 ** backoffs++);
    } catch (e) {
      if (e.timeout) throw e;
      errs.push(`${ep} ${e.name === "TimeoutError" ? "timeout" : e.message}`);
      warn(errs[errs.length - 1]);
      if (e.name === "TimeoutError") throw Object.assign(new Error(errs.join("; ")), { timeout: true });
    }
  }
  throw Object.assign(new Error("Overpass failed: " + errs.join("; ")), { allFailed: true });
}

const IG_URL = /instagram\.com\/([A-Za-z0-9._]+)/i;
function igHandle(tags) {
  const c = tags["contact:instagram"] || tags.instagram;
  if (c) { const m = IG_URL.exec(c); return (m ? m[1] : String(c).replace(/^@/, "").replace(/\/.*$/, "")).toLowerCase() || null; }
  for (const k of ["website", "contact:website", "url"]) { const m = IG_URL.exec(tags[k] || ""); if (m) return m[1].toLowerCase(); }
  return null;
}
const isIgUrl = (u) => IG_URL.test(u || "");

// Tagged as gone: any disused:* or abandoned:* key, opening_hours off or closed, a closed tag, or an end_date in the past.
export function isClosed(t, now = new Date()) {
  for (const k of Object.keys(t)) if (/^(disused|abandoned):/.test(k)) return true;
  if (/^(off|closed)$/i.test(String(t.opening_hours || "").trim())) return true;
  if (t.closed && !/^no$/i.test(t.closed)) return true;
  if (t.end_date) {
    const e = String(t.end_date);
    const d = new Date(/^\d{4}$/.test(e) ? e + "-12-31" : /^\d{4}-\d{2}$/.test(e) ? e + "-28" : e);
    if (!isNaN(d) && d < now) return true;
  }
  return false;
}

// Overpass elements -> shop records (matcha by name or brand, or a confirmed chain name).
export function parseElements(elements, fetched) {
  const out = [];
  for (const el of elements || []) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!t.name || lat == null || lng == null) continue;
    if (!(MATCHA.test(t.name) || MATCHA.test(t.brand || "") || CHAIN_RX.test(t.name.trim()))) continue;
    const site = [t.website, t["contact:website"], t.url].find((u) => /^https?:\/\//i.test(u || "") && !isIgUrl(u)) || null;
    const street = t["addr:housenumber"] && t["addr:street"] ? `${t["addr:housenumber"]} ${t["addr:street"]}` : String(t["addr:full"] || "").trim();
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
      closed: isClosed(t),
      source: "osm",
      osm_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      fetched,
    });
  }
  return out;
}
