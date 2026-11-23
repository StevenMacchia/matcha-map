// The canonical city list (data/cities.json, built by tools/gen-cities.js from US Census data) and the lookups every city-driven
// part of the pipeline shares. Entries are { name, state, pop, lat, lng, slug, rank_in_state, rank_us, tz }, ordered by population.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CITIES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "cities.json");

let cache = null;
export function loadCities(file = CITIES_FILE) {
  if (file === CITIES_FILE && cache) return cache;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, "utf8")).cities || []; } catch { /* the pipeline still runs, with no city list */ }
  list = list.slice().sort((a, b) => a.rank_us - b.rank_us);
  if (file === CITIES_FILE) cache = list;
  return list;
}

// Boroughs and districts people name as a city that are not places of their own in the Census list; crawled after the big cities.
export const EXTRA_CITIES = [{ name: "Brooklyn", state: "NY", pop: 2736074, lat: 40.6526, lng: -73.9497, slug: "brooklyn", rank_in_state: 0, rank_us: 0, tz: "America/New_York" }];

export const norm = (s) => String(s || "").toLowerCase().replace(/\./g, "").replace(/^saint\b/, "st").replace(/[^a-z0-9]+/g, " ").trim();

// "Washington DC" and "Washington, DC" are the one DC entry.
const DC_NAME = /^washington(?:\s*,?\s*d\.?c\.?)?$/i;

// A city by name (and state when the name is shared: Columbus, Portland, Springfield). Without a state the biggest city of
// that name wins only when it is at least AMBIGUOUS_RATIO times the next one (Columbus OH over GA, Kansas City MO over KS);
// closer pairs (Pasadena CA and TX, Springfield MO and MA) need the state, or a bare mention files the event in the wrong state.
export const AMBIGUOUS_RATIO = 3;
export function findCity(name, state = null, list = loadCities()) {
  const st = state ? String(state).toUpperCase() : null;
  const n = norm(name);
  if (!n) return null;
  if (DC_NAME.test(String(name).trim()) && (!st || st === "DC")) return list.find((c) => c.state === "DC") || null;
  const hits = list.concat(EXTRA_CITIES).filter((c) => norm(c.name) === n && (!st || c.state === st)).sort((a, b) => b.pop - a.pop);
  if (!hits.length) return null;
  if (!st && hits.length > 1 && hits[0].pop < AMBIGUOUS_RATIO * hits[1].pop) return null;
  return hits[0];
}

// The crawl order: every listed city biggest first, then the extras at the place their population gives them.
export function crawlCities(list = loadCities()) {
  return list.concat(EXTRA_CITIES).sort((a, b) => b.pop - a.pop || a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
}

// "Columbus, GA" for a name another listed city shares (the biggest keeps the bare name); used in search text.
export function searchLabel(city, list = loadCities()) {
  if (city.state === "DC") return "Washington DC";
  const bigger = list.some((c) => c !== city && c.name === city.name && c.pop > city.pop);
  return bigger ? `${city.name}, ${city.state}` : city.name;
}

// The cities the Tavily and Brave searches rotate through: the biggest SEARCH_CITIES_POOL (default 100). The search tiers are paid
// or capped per query, so their budget goes to the biggest cities and does not grow with the list.
export const SEARCH_POOL = Math.max(1, +process.env.SEARCH_CITIES_POOL || 100);
export function searchLabels(pool = SEARCH_POOL, list = loadCities()) {
  return list.slice(0, pool).map((c) => searchLabel(c, list));
}

// Accept a crawler's city argument as an entry or a name (tests and old callers pass names).
export function cityOf(x) {
  if (x && typeof x === "object") return x;
  return findCity(x);
}
