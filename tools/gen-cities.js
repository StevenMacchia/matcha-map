// Builds the one canonical city list and what is derived from it.
//   data/cities.json   the 50 most populous incorporated places in each state plus DC (about 2,400 entries), ordered by population
//   site/cities.js     the same cities for the site (city jump, "near" labels) plus one centroid per brand home city in data/sources.json
//   data/hashtags.json "candidates": city tags for the rotation to draw from (the active tags and the weekly budget are not touched)
//
// Source (US Census Bureau, public domain; both files are Vintage 2024, downloaded to a folder outside the repo):
//   population  https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv
//               SUMLEV 162 rows (incorporated places; a consolidated city is its "balance" row, the figure the city itself publishes)
//   position    https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
//               joined on GEOID (state + place code): INTPTLAT and INTPTLONG
// Incorporated places only (FUNCSTAT not S, so no census-designated places). New Hampshire and Rhode Island run out of cities, and
// their towns are county subdivisions, not places: a state with fewer than PER_STATE places is filled from its active SUMLEV 061 towns,
// whose positions come from the county subdivisions Gazetteer (2024_Gaz_cousubs_national.zip, same columns).
// Hawaii has no incorporated places; the Census file carries one place there (Urban Honolulu CDP), so it has one entry.
//
// Run: node tools/gen-cities.js [--dir <folder for the two downloads>] [--no-fetch] [--site-only]
// --no-fetch keeps the brand home cities that site/cities.js and the geocache already know and geocodes nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZipEntry } from "./gen-zips.js";
import { tzForPlace } from "../ingest/lib/tz.js";

export const SUB_EST_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv";
export const GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip";
export const COUSUB_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cousubs_national.zip";
export const PER_STATE = 50;

const FIPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };

// One CSV line -> fields (the Census file quotes names that contain a comma).
export function csvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// "Raleigh city" -> "Raleigh"; "Nashville-Davidson metropolitan government (balance)" -> "Nashville"; "Urban Honolulu CDP" -> "Honolulu".
const CONSOLIDATED = /\s+(?:metropolitan government|metro government|consolidated government|unified government|urban county)$/;
const LEGAL = /\s+(?:city and borough|city|town|village|borough|municipality|plantation|township|CDP)$/;
// Census names that keep a word the city does not use.
const RENAMED = { "Boise City": "Boise", "Weymouth Town": "Weymouth" };
export function stripSuffix(raw) {
  let n = String(raw).replace(/\s*\(balance\)$/i, "").trim();
  if (CONSOLIDATED.test(n)) n = n.replace(CONSOLIDATED, "").split(/[/,-]/)[0].trim();
  else n = n.replace(LEGAL, "");
  n = n.replace(/^Urban\s+/, "").replace(/^(.+?)-[A-Za-z ]+ County$/, "$1");
  return RENAMED[n] || n.trim();
}

export const slugOf = (name) => String(name).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// sub-est CSV text -> [{geoid, name, state, pop, cdp, town}] for SUMLEV 162 rows (places) and active SUMLEV 061 rows (county subdivisions,
// kept as towns) of the 50 states and DC. A county subdivision's GEOID is state + county + subdivision code.
export function parseSubEst(text) {
  const lines = text.split(/\r?\n/);
  const head = csvLine(lines[0]);
  const ix = (k) => head.indexOf(k);
  const iLev = ix("SUMLEV"), iSt = ix("STATE"), iPl = ix("PLACE"), iFun = ix("FUNCSTAT"), iName = ix("NAME"), iPop = ix("POPESTIMATE2024");
  const out = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = csvLine(line);
    const town = f[iLev] === "061";
    if ((f[iLev] !== "162" && !(town && f[iFun] === "A" && /\s(?:town|city)$/.test(f[iName]))) || !FIPS[f[iSt]] || f[iFun] === "I") continue;
    const pop = +f[iPop];
    if (!pop) continue;
    out.push({ geoid: town ? f[iSt] + f[head.indexOf("COUNTY")] + f[head.indexOf("COUSUB")] : f[iSt] + f[iPl], name: f[iName], state: FIPS[f[iSt]], pop, cdp: f[iFun] === "S", town });
  }
  return out;
}

// Gazetteer places text (tab separated) -> Map(geoid -> {lat, lng}).
export function parseGazetteer(text) {
  const lines = text.split(/\r?\n/);
  const head = lines[0].split("\t").map((s) => s.trim());
  const iG = head.indexOf("GEOID"), iLat = head.indexOf("INTPTLAT"), iLng = head.indexOf("INTPTLONG");
  const out = new Map();
  for (const line of lines.slice(1)) {
    const f = line.split("\t");
    if (f.length < head.length) continue;
    const lat = parseFloat(f[iLat]), lng = parseFloat(f[iLng]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.set(f[iG].trim(), { lat, lng });
  }
  return out;
}

// The two files -> the entries: top PER_STATE per state by population, ranked in the state and in the country.
export function buildCities(places, gaz, perState = PER_STATE) {
  const byState = new Map();
  for (const p of places) {
    const pos = gaz.get(p.geoid);
    if (!pos) continue;
    if (!byState.has(p.state)) byState.set(p.state, []);
    byState.get(p.state).push({ ...p, ...pos });
  }
  const picked = [];
  for (const [state, list] of byState) {
    const inc = list.filter((p) => !p.cdp && !p.town);
    let pool = inc.length ? inc : list.filter((p) => !p.town);
    if (pool.length < perState) {
      const seen = new Set(pool.map((p) => stripSuffix(p.name)));
      pool = pool.concat(list.filter((p) => p.town && !seen.has(stripSuffix(p.name))));
    }
    pool = pool.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name)).slice(0, perState);
    pool.forEach((p, i) => {
      const name = state === "DC" ? "Washington" : stripSuffix(p.name);
      picked.push({
        name, state, pop: p.pop, lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4),
        slug: state === "DC" ? "washington-dc" : slugOf(name), rank_in_state: i + 1, rank_us: 0, tz: tzForPlace(state, p.lat, p.lng),
      });
    });
  }
  picked.sort((a, b) => b.pop - a.pop || a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  picked.forEach((c, i) => { c.rank_us = i + 1; });
  return picked;
}

// The file text: one entry per line so a diff reads.
export function citiesFileText(cities, source) {
  const keys = ["name", "state", "pop", "lat", "lng", "slug", "rank_in_state", "rank_us", "tz"];
  const rows = cities.map((c) => "  " + JSON.stringify(Object.fromEntries(keys.map((k) => [k, c[k]]))));
  return `{\n"source": ${JSON.stringify(source)},\n"cities": [\n${rows.join(",\n")}\n]\n}\n`;
}

// Nicknames people tag with, each tied to the listed city it stands for (a tag is a candidate only when that city is in the list).
const NICKNAMES = [["nyc", "New York", "NY"], ["la", "Los Angeles", "CA"], ["sf", "San Francisco", "CA"], ["atl", "Atlanta", "GA"], ["dc", "Washington", "DC"], ["philly", "Philadelphia", "PA"], ["dmv", "Washington", "DC"], ["htx", "Houston", "TX"], ["dtx", "Dallas", "TX"], ["bayarea", "San Francisco", "CA"], ["oc", "Anaheim", "CA"], ["sd", "San Diego", "CA"], ["pdx", "Portland", "OR"], ["stl", "St. Louis", "MO"], ["kc", "Kansas City", "MO"], ["nola", "New Orleans", "LA"]];
const TOP_TAG_CITIES = 60;

// Candidate city hashtags: matchapopup + the slug without hyphens for the biggest cities, plus the nickname forms.
export function candidateTags(cities, active = []) {
  const have = new Set(active);
  const out = [];
  const add = (t) => { if (!have.has(t) && !out.includes(t)) out.push(t); };
  for (const c of cities.slice(0, TOP_TAG_CITIES)) add("matchapopup" + c.slug.replace(/-/g, ""));
  for (const [tag, name, st] of NICKNAMES) if (cities.some((c) => c.name === name && c.state === st)) add("matchapopup" + tag);
  return out;
}

async function download(url, file) {
  const r = await fetch(url, { headers: { "User-Agent": "matcha-map/0.1 (+https://github.com/StevenMacchia/matcha-map)" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// ---- site/cities.js -------------------------------------------------------------------------
// Brand home cities that are not in the list (Brooklyn, Cambridge ...): kept from the old file, else from the geocache, else
// geocoded through Nominatim (1 request per second, cached under "city:" keys).
async function homeCityCentres(have, noFetch) {
  const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
  const existing = {};
  try {
    const txt = fs.readFileSync("site/cities.js", "utf8");
    for (const m of txt.matchAll(/"([^"]+\|[A-Z]{2})":\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/g)) existing[m[1]] = [+m[2], +m[3]];
  } catch { /* first run */ }
  const cachePath = "data/geocache.json";
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
  const out = {}, failed = [];
  let fetched = 0;
  for (const k of [...new Set(sources.map((s) => s.home_city + "|" + s.home_state))].sort()) {
    if (have.has(k)) continue;
    const ck = "city:" + k.toLowerCase();
    if (existing[k]) { out[k] = existing[k]; continue; }
    if (cache[ck] && cache[ck].lat) { out[k] = [cache[ck].lat, cache[ck].lng]; continue; }
    if (noFetch) { failed.push(k); continue; }
    const [city, st] = k.split("|");
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" + encodeURIComponent(`${city}, ${st}, USA`);
    try {
      const r = await fetch(url, { headers: { "User-Agent": "matcha-map/0.1 (+https://github.com/StevenMacchia/matcha-map)" } });
      const j = await r.json();
      if (j[0]) { out[k] = [+(+j[0].lat).toFixed(4), +(+j[0].lon).toFixed(4)]; cache[ck] = { lat: out[k][0], lng: out[k][1], source: "nominatim", at: new Date().toISOString() }; fetched++; }
      else failed.push(k);
    } catch (e) { failed.push(k + " (" + e.message + ")"); }
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (fetched) fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");
  return { out, fetched, failed };
}

// window.CITIES keeps the shape the site reads ("City|ST": [lat, lng]); window.CITY_LIST adds [name, state, lat, lng, pop] biggest first.
export function siteCitiesText(cities, extra = {}) {
  const centres = {};
  for (const c of cities) centres[`${c.name}|${c.state}`] = [c.lat, c.lng];
  for (const [k, v] of Object.entries(extra)) if (!centres[k]) centres[k] = v;
  const lines = Object.keys(centres).sort().map((k) => `  ${JSON.stringify(k)}: [${centres[k][0]}, ${centres[k][1]}],`);
  const list = cities.map((c) => "  " + JSON.stringify([c.name, c.state, c.lat, c.lng, c.pop]));
  return `// City centroids (degrees): the 50 most populous incorporated places per state from data/cities.json (US Census Bureau), plus every\n// home_city|home_state in data/sources.json that is not in that list. Generated by tools/gen-cities.js; do not edit by hand.\nwindow.CITIES = {\n${lines.join("\n")}\n};\n// The listed cities, biggest first: [name, state, lat, lng, population]. The city jump reads this.\nwindow.CITY_LIST = [\n${list.join(",\n")}\n];\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const noFetch = argv.includes("--no-fetch");
  const di = argv.indexOf("--dir");
  const dir = di > 0 ? argv[di + 1] : path.join(os.tmpdir(), "matcha-census");
  let cities;
  if (argv.includes("--site-only")) cities = JSON.parse(fs.readFileSync("data/cities.json", "utf8")).cities;
  else {
    fs.mkdirSync(dir, { recursive: true });
    const subFile = path.join(dir, "sub-est2024.csv"), zipFile = path.join(dir, "2024_Gaz_place_national.zip");
    if (!fs.existsSync(subFile)) await download(SUB_EST_URL, subFile);
    if (!fs.existsSync(zipFile)) await download(GAZETTEER_URL, zipFile);
    const subZip = path.join(dir, "2024_Gaz_cousubs_national.zip");
    if (!fs.existsSync(subZip)) await download(COUSUB_URL, subZip);
    const places = parseSubEst(fs.readFileSync(subFile, "utf8"));
    const gaz = parseGazetteer(readZipEntry(fs.readFileSync(zipFile), "2024_Gaz_place_national.txt").toString("utf8"));
    for (const [k, v] of parseGazetteer(readZipEntry(fs.readFileSync(subZip), "2024_Gaz_cousubs_national.txt").toString("utf8"))) gaz.set(k, v);
    cities = buildCities(places, gaz);
    const source = {
      provider: "US Census Bureau (public domain)", vintage: "2024 (population estimates for July 1, 2024)", population: SUB_EST_URL, gazetteer: GAZETTEER_URL, gazetteer_county_subdivisions: COUSUB_URL,
      method: "SUMLEV 162 places of the 50 states and DC joined to the Gazetteer on GEOID; top 50 per state by POPESTIMATE2024; consolidated cities use their balance row; census-designated places are left out; NH and RI are filled from their active towns (SUMLEV 061); legal suffixes stripped.",
      generated: new Date().toISOString().slice(0, 10), generator: "tools/gen-cities.js",
    };
    fs.writeFileSync("data/cities.json", citiesFileText(cities, source));
    const byState = {};
    cities.forEach((c) => { byState[c.state] = (byState[c.state] || 0) + 1; });
    console.log(`${cities.length} cities in ${Object.keys(byState).length} places; fewer than ${PER_STATE}: ${Object.entries(byState).filter(([, n]) => n < PER_STATE).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`);
    try {
      const hp = "data/hashtags.json";
      const h = JSON.parse(fs.readFileSync(hp, "utf8"));
      h.candidates = candidateTags(cities, h.active || []);
      h.candidates_note = "City tags for the rotation to draw from, generated by tools/gen-cities.js (top 60 cities by population plus common nicknames). Not read by the weekly budget until moved into active or rotation.";
      fs.writeFileSync(hp, JSON.stringify(h, null, 2) + "\n");
      console.log(`${h.candidates.length} candidate hashtags`);
    } catch (e) { console.warn("hashtags.json not updated: " + e.message); }
  }
  const have = new Set(cities.map((c) => `${c.name}|${c.state}`));
  const home = await homeCityCentres(have, noFetch);
  fs.writeFileSync("site/cities.js", siteCitiesText(cities, home.out));
  console.log(`site/cities.js: ${cities.length} listed + ${Object.keys(home.out).length} brand home cities, ${home.fetched} geocoded, ${home.failed.length} failed${home.failed.length ? ": " + home.failed.join(", ") : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
