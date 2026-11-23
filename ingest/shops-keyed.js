// npm run shops:keyed -- [--provider yelp|foursquare] [--cities "Raleigh NC,Durham NC"] [--limit 40] [--dry]
// Searches Yelp Fusion and Foursquare Places (keys in .env; each is skipped when its key is missing) city by city, biggest city first
// from a saved position (.cache/keyed-cursor.json), confirms every candidate on the shop's own public site (ingest/lib/shops/providers.js)
// and writes the confirmed rows to data/shops-keyed-<provider>.json (rows accumulate across runs, newest read wins). Unconfirmed
// candidates stay in the 24-hour cache and are listed in the run summary for a worker. Run `npm run shops -- --no-osm --no-brands` afterwards.
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { crawlCities, resolveCityNames } from "./lib/cities.js";
import { createProviders, confirmCandidate, knownSites, nameKey } from "./lib/shops/providers.js";
import { info, warn } from "./lib/log.js";

const CURSOR = ".cache/keyed-cursor.json";
// Stored rows carry no provider id (docs/YELP-TERMS.md); the same shop is the same name at the same street number (or zip).
export const rowKey = (r) => `${nameKey(r.name)}|${(String(r.address || "").match(/^\d+/) || [r.zip || ""])[0]}`;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

export async function run({ argv = process.argv.slice(2), env = process.env, http = fetch, fetcher = createFetcher({}), out = (p) => `data/shops-keyed-${p}.json` } = {}) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const dry = argv.includes("--dry");
  const only = arg("--provider");
  const limit = +arg("--limit") || 40;
  const names = arg("--cities");
  const all = crawlCities();
  const exact = names ? resolveCityNames(names.split(",").map((s) => s.trim()).filter(Boolean)).cities : null;
  const cursor = readJson(CURSOR, { next: 0 });
  const start = exact ? 0 : cursor.next % all.length;
  const batch = exact || Array.from({ length: Math.min(limit, all.length) }, (_, i) => all[(start + i) % all.length]);
  const prov = createProviders({ env, http });
  const shopsNow = readJson("data/shops.json", { shops: [] }).shops;
  const known = knownSites(readJson("data/sources.json", []), shopsNow);
  const have = (c) => shopsNow.some((s) => nameKey(s.name) === nameKey(c.name) && Math.abs((s.lat ?? 0) - (c.lat ?? 99)) < 0.002 && Math.abs((s.lng ?? 0) - (c.lng ?? 999)) < 0.002);
  const leads = {};
  const providers = ["yelp", "foursquare"].filter((p) => (!only || only === p));
  const summary = {};
  for (const p of providers) {
    summary[p] = { cities: 0, candidates: 0, core: 0, serves: 0, onMap: 0, held: {}, off: !prov.enabled(p), calls: 0 };
    if (!prov.enabled(p)) { info(`${p}: off (no key in .env)`); continue; }
    const file = out(p);
    const prev = readJson(file, { shops: [] }).shops;
    const rows = new Map(prev.map((r) => [rowKey(r), r]));
    for (const city of batch) {
      const res = await prov.search(p, city.name, city.state);
      if (res.skipped) { warn(`${p}: ${res.skipped} at ${city.name}, ${city.state}; stopping this provider`); break; }
      summary[p].cities++;
      for (const c of res.candidates) {
        summary[p].candidates++;
        if (have(c)) { summary[p].onMap++; continue; }
        if (!c.website && known.get(nameKey(c.name))) c.website = known.get(nameKey(c.name));
        const r = await confirmCandidate(c, (u) => fetcher.get(u));
        if (r.held) { summary[p].held[r.held] = (summary[p].held[r.held] || 0) + 1; (leads[p] ||= []).push({ provider: p, provider_id: c.provider_id, name: c.name, address: c.address, city: c.city, state: c.state, zip: c.zip, phone: c.phone, categories: c.categories, hint: c.hint, why: r.held }); continue; }
        rows.set(rowKey(r.row), r.row);
        summary[p][r.row.tier === "serves" ? "serves" : "core"]++;
      }
    }
    if (!dry) {
      fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), group: `keyed-${p}`, shops: [...rows.values()] }, null, 1) + "\n");
    }
  }
  if (!dry && !exact) fs.mkdirSync(".cache", { recursive: true }), fs.writeFileSync(CURSOR, JSON.stringify({ next: (start + batch.length) % all.length }));
  prov.save();
  for (const p of providers) summary[p].calls = prov.used(p);
  // Leads (unconfirmed candidates) stay in the gitignored cache, 24 hours, for a worker to confirm by name.
  if (!dry) for (const [p, list] of Object.entries(leads)) { fs.mkdirSync(".cache", { recursive: true }); const f = `.cache/keyed-leads-${p}.json`; const old = readJson(f, { at: 0, leads: [] }); const keep = Date.now() - old.at < 86400000 ? old.leads.filter((x) => !list.some((y) => y.provider_id === x.provider_id)) : []; fs.writeFileSync(f, JSON.stringify({ at: Date.now(), leads: [...keep, ...list] })); }
  for (const [p, s] of Object.entries(summary)) info(`${p}: ${s.off ? "off" : `${s.cities} cities, ${s.calls} calls today, ${s.onMap} already on the map, ${s.candidates} candidates, ${s.core} core and ${s.serves} serves rows confirmed on their own sites; held ${JSON.stringify(s.held)}`}`);
  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) run().catch((e) => { console.error(e); process.exit(1); });
