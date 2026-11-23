// Where each per-city crawler left off, and which cities to leave alone for a while.
//   cursor  per site: the index in the crawl order (population, biggest first) of the next city, so successive runs walk the whole list
//   skip    per site and city: an ISO time until which the city is not asked again (a 404 or a page with no matcha events skips it 7 days)
// Both live in one file under .cache, which is not committed.
import fs from "node:fs";
import path from "node:path";

export const CRAWL_STATE_FILE = ".cache/crawl-state.json";
export const SKIP_DAYS = 7;
const DAY = 86400000;
export const perRunDefault = (env = process.env) => Math.max(1, +env.CRAWL_CITIES_PER_RUN || 150);

const key = (site, c) => `${site}|${c.state}|${c.slug}`;

export function loadCrawlState(file = CRAWL_STATE_FILE, now = new Date()) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const out = { cursor: s.cursor || {}, skip: {} };
  for (const [k, until] of Object.entries(s.skip || {})) if (Date.parse(until) > new Date(now).getTime()) out.skip[k] = until;
  return out;
}

export function saveCrawlState(state, file = CRAWL_STATE_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch { /* cache only */ }
}

// The next `perRun` cities for a site from its cursor, wrapping once round the list and passing over the ones skipped.
// -> { batch, done(city, outcome), finish() }. outcome: "ok" (matcha events seen), "empty" or "404" (skip a week), anything else
// ("error", "stopped") leaves the city as it was. finish() moves the cursor past the last city actually asked and saves.
export function planCities(site, cities, { perRun = perRunDefault(), now = new Date(), file = CRAWL_STATE_FILE, persist = true } = {}) {
  const state = loadCrawlState(file, now);
  const n = cities.length;
  const start = n ? (state.cursor[site] || 0) % n : 0;
  const batch = [], index = new Map();
  for (let i = 0; i < n && batch.length < perRun; i++) {
    const at = (start + i) % n, c = cities[at];
    if (state.skip[key(site, c)]) continue;
    index.set(c, i);
    batch.push(c);
  }
  let last = -1;
  return {
    batch,
    done(city, outcome) {
      last = Math.max(last, index.get(city) ?? -1);
      const k = key(site, city);
      if (outcome === "404" || outcome === "empty") state.skip[k] = new Date(new Date(now).getTime() + SKIP_DAYS * DAY).toISOString();
      else if (outcome === "ok") delete state.skip[k];
    },
    finish() {
      if (last >= 0) state.cursor[site] = (start + last + 1) % n;
      if (persist) saveCrawlState(state, file);
      return { cursor: state.cursor[site] || 0, skipped: Object.keys(state.skip).filter((k) => k.startsWith(site + "|")).length };
    },
  };
}
