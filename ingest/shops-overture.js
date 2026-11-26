// npm run shops:overture -- [--pull | --pull-wide --state NC --counties Wake,Durham --in file] [--wide (menus: restaurants, bars, bakeries and the rest, not only cafes)] [--build] [--menus [--limit 1500]] [--release 2026-11-18.0] [--in file.ndjson]
// Overture Maps places (open, storable; see docs/OVERTURE.md) -> the storefront layer.
//   --pull   DuckDB over the public Parquet (no key): US places that are matcha-named or cafe, coffee, tea room, bubble tea, dessert, Japanese,
//            bakery, ice cream or juice, into .cache/overture/<release>/places-us.ndjson (gitignored, not committed).
//   --build  every matcha-named food or drink place becomes a core shop row in data/shops-zz-overture-core.json (shown, confirmed_via "overture",
//            verified false until its own site confirms); Matcha Cafe Maiko stays held (all stores reported closed Nov 8).
//   --menus  the cafes and tea rooms with a website are read in priority order, --limit sites a run (cursor in .cache/overture/menus-cursor.json):
//            a place whose own menu lists three distinct matcha drinks becomes a tier "serves" row in data/shops-zz-overture-serves.json (verified).
// Every row keeps its Overture id and the dataset and license of each source (the theme is multi-license). Rows are read by ingest/lib/shops/curated.js.
import "./lib/env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { confirmCandidate } from "./lib/shops/providers.js";
import { createPdfGetter } from "./lib/shops/pdf-menus.js";
import { STATES } from "./lib/shops/curated.js";
import { info, warn } from "./lib/log.js";

export const RELEASE = "2026-11-18.0";
export const BUCKET = "s3://overturemaps-us-west-2/release";
const FOOD = new Set(["cafe", "coffee_shop", "tea_room", "bubble_tea_shop", "dessert_shop", "japanese_restaurant", "coffee_roastery", "juice_bar", "bakery", "ice_cream_shop", "tea_shop", "smoothie_juice_bar"]);
const CLOSED = /closed/i;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

// ---- pull ---------------------------------------------------------------------------------------------------------------------------------
export async function pull({ release = RELEASE, out }) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");
  const cats = [...FOOD].map((x) => `'${x}'`).join(",");
  const where = `((bbox.xmin BETWEEN -125 AND -66.9 AND bbox.ymin BETWEEN 24.4 AND 49.5) OR (bbox.xmin BETWEEN -170 AND -129 AND bbox.ymin BETWEEN 51 AND 72) OR (bbox.xmin BETWEEN -160.6 AND -154.7 AND bbox.ymin BETWEEN 18.8 AND 22.4))
    AND confidence >= 0.5 AND (names.primary ILIKE '%matcha%' OR names.primary LIKE '%抹茶%' OR taxonomy.primary IN (${cats}))`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const target = out.split(String.fromCharCode(92)).join("/");
  await c.run(`COPY (SELECT id, names.primary AS name, taxonomy.primary AS tax, round(confidence,3) AS conf, operating_status AS status,
    addresses[1].freeform AS street, addresses[1].locality AS city, addresses[1].region AS state, addresses[1].postcode AS zip, addresses[1].country AS country,
    websites[1] AS website, socials AS socials, phones[1] AS phone, round((bbox.xmin+bbox.xmax)/2,6) AS lng, round((bbox.ymin+bbox.ymax)/2,6) AS lat,
    to_json([{'dataset':s.dataset,'license':s.license,'record_id':s.record_id} for s in sources]) AS sources
    FROM read_parquet('${BUCKET}/${release}/theme=places/type=place/*', hive_partitioning=1) WHERE ${where}) TO '${target}' (FORMAT JSON)`);
}

// Wider pull (Triangle gap lane): every food and drink place (any category under food_and_drink) in the named counties of one state, using Overture's own
// county polygons (theme=divisions), or in the whole state when no counties are named. Same columns as pull(), plus the taxonomy path.
export async function pullWide({ release = RELEASE, out, state, counties = [] }) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const target = out.split(String.fromCharCode(92)).join("/");
  const names = counties.map((x) => `'${x.replace(/'/g, "''")} County'`).join(",");
  const poly = counties.length ? `(SELECT ST_Union_Agg(geometry) FROM read_parquet('${BUCKET}/${release}/theme=divisions/type=division_area/*', hive_partitioning=1) WHERE subtype='county' AND region='US-${state}' AND names.primary IN (${names}))` : null;
  const where = `confidence >= 0.5 AND list_contains(taxonomy.hierarchy, 'food_and_drink') AND ${poly ? `ST_Within(geometry, ${poly})` : `addresses[1].region = 'US-${state}'`}`;
  await c.run(`COPY (SELECT id, names.primary AS name, taxonomy.primary AS tax, round(confidence,3) AS conf, operating_status AS status,
    addresses[1].freeform AS street, addresses[1].locality AS city, addresses[1].region AS state, addresses[1].postcode AS zip, addresses[1].country AS country,
    websites[1] AS website, socials AS socials, phones[1] AS phone, round((bbox.xmin+bbox.xmax)/2,6) AS lng, round((bbox.ymin+bbox.ymax)/2,6) AS lat,
    to_json([{'dataset':s.dataset,'license':s.license,'record_id':s.record_id} for s in sources]) AS sources
    FROM read_parquet('${BUCKET}/${release}/theme=places/type=place/*', hive_partitioning=1) WHERE ${where}) TO '${target}' (FORMAT JSON)`);
}
// The wide category set: restaurants of every cuisine, bars of every kind, bakeries, desserts, ice cream, juice, bubble tea, brunch and breakfast.
export const WIDE = /(^|_)restaurant$|^(bar|cocktail_bar|wine_bar|pub|sports_bar|lounge|beer_bar|hotel_bar|tiki_bar|brewery|winery|bakery|dessert_shop|ice_cream_shop|frozen_yogurt_shop|juice_bar|smoothie_juice_bar|bubble_tea_shop|donut_shop|bagel_shop|creperie|breakfast_and_brunch|diner|gastropub|food_truck|cafeteria|sandwich_shop|salad_bar|health_food_restaurant|patisserie|chocolate_shop|candy_store|tea_room|tea_shop|coffee_shop|cafe|coffee_roastery)$/;
export const wideCategory = (p) => WIDE.test(p.tax || "");

// ---- rows ---------------------------------------------------------------------------------------------------------------------------------
export function readPlaces(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export const igHandle = (socials) => {
  for (const u of [].concat(typeof socials === "string" ? safeJson(socials) : socials || [])) {
    const m = /instagram\.com\/([A-Za-z0-9._]{2,30})/i.exec(String(u));
    if (m && !/^(p|reel|reels|explore|accounts|tv)$/i.test(m[1])) return m[1].toLowerCase();
  }
  return null;
};
// A website that is really a listing, social or ordering page is not the shop's own site (and a yelp.com URL must never be stored).
const LISTING_HOST = /^(?:[a-z0-9-]+\.)*(?:yelp|facebook|instagram|tripadvisor|ubereats|doordash|grubhub|toasttab|linktr|google|foursquare|mapquest|yellowpages|opentable|tiktok|twitter|x)\.[a-z]+$/i;
export const ownSite = (u) => {
  if (!/^https?:\/\//i.test(u || "")) return null;
  try { return LISTING_HOST.test(new URL(u).hostname) ? null : u; } catch { return null; }
};
const safeJson = (s) => { try { return JSON.parse(s); } catch { return []; } };
const compactSources = (s) => (typeof s === "string" ? safeJson(s) : s || []).map((x) => ({ dataset: x.dataset || null, license: x.license || null, record_id: x.record_id || null })).slice(0, 4);

// Overture regions are ISO 3166-2 ("US-HI").
export const stateOf = (p) => String(p.state || "").toUpperCase().replace(/^US-/, "");
export const usable = (p) => p && p.name && STATES.has(stateOf(p)) && /^\d/.test(String(p.street || "").trim()) && p.country === "US" && !CLOSED.test(p.status || "") && (p.conf ?? 0) >= 0.6;
export const isMatchaNamed = (p) => /matcha|抹茶/i.test(p.name) && (FOOD.has(p.tax) || /cafe|coffee|tea|restaurant|bakery|dessert|juice|food/i.test(p.tax || ""));

export function coreRow(p, today = new Date().toISOString().slice(0, 10)) {
  const held = /maiko/i.test(p.name);
  return {
    name: p.name, address: String(p.street).trim(), city: p.city, state: stateOf(p), zip: p.zip || null,
    website: ownSite(p.website), instagram: igHandle(p.socials), phone: p.phone || null, opening_hours: null, menu_url: null, image_url: null, image_credit: null,
    source_url: ownSite(p.website) || "https://docs.overturemaps.org/guides/places/", read: today, ...(held ? {} : { confirmed_via: "overture" }), tier: "shop",
    overture_id: p.id, lat: p.lat, lng: p.lng, overture_sources: compactSources(p.sources),
    notes: held ? "Held: all Matcha Cafe Maiko stores reported closed Nov 8 (Matcha Toko rebrand); see data/maiko-check-2026-11-23.json." : `From Overture Maps places (${p.tax}); matcha in the name; unverified until the shop's own site confirms.`,
  };
}

// Cafes, tea rooms and the rest with a website, in the order the menu reader should read them.
const PRIORITY = { tea_room: 0, bubble_tea_shop: 0, tea_shop: 0, japanese_restaurant: 1, dessert_shop: 1, coffee_roastery: 2, cafe: 3, coffee_shop: 3, bakery: 4, juice_bar: 4, smoothie_juice_bar: 4, ice_cream_shop: 4 };
export const isServesCandidate = (p, wide = false) => usable(p) && ownSite(p.website) && !isMatchaNamed(p) && (FOOD.has(p.tax) || (wide && wideCategory(p))) && !/starbucks|dunkin|mcdonald|dutch bros|tim hortons|7-eleven|panera|subway|krispy|dairy queen|baskin|burger king|wendy's|taco bell|chick-fil-a|chipotle|domino|pizza hut|papa john|kfc|popeyes|sonic drive|arby|jimmy john|jersey mike|firehouse|five guys|wingstop|zaxby|bojangles|cook out|cookout|waffle house|ihop|denny's|applebee|chili's|olive garden|outback|texas roadhouse|buffalo wild|red robin|cracker barrel|golden corral|bob evans|hardee|carl's jr|jack in the box|whataburger|culver|raising cane|panda express|qdoba|moe's southwest|jason's deli|potbelly|cinnabon|auntie anne|pretzel|smoothie king|tropical smoothie|jamba|chuck e|mod pizza|marco's pizza|little caesars/i.test(p.name);
export const toCandidate = (p) => ({ provider: "overture", name: p.name, address: String(p.street).trim(), city: p.city, state: stateOf(p), zip: p.zip || null, website: ownSite(p.website), instagram: igHandle(p.socials), phone: p.phone || null, lat: p.lat, lng: p.lng, hint: "serves-check", id: p.id, sources: p.sources });

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d = null) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const release = arg("--release", RELEASE);
  const dir = `.cache/overture/${release}`;
  const file = arg("--in", `${dir}/places-us.ndjson`);
  if (argv.includes("--pull")) { info(`overture: pulling ${release} (DuckDB over S3)`); await pull({ release, out: file }); info(`overture: wrote ${file}`); }
  if (argv.includes("--pull-wide")) {
    const counties = String(arg("--counties", "")).split(",").map((x) => x.trim()).filter(Boolean);
    info(`overture: wide pull ${release} state ${arg("--state", "NC")} counties ${counties.join("+") || "all"}`);
    await pullWide({ release, out: file, state: arg("--state", "NC"), counties });
    info(`overture: wrote ${file}`);
  }
  const places = fs.existsSync(file) ? readPlaces(file) : [];
  if (!places.length) { warn(`overture: no places at ${file}; run with --pull`); return; }
  if (argv.includes("--build")) {
    const rows = places.filter((p) => usable(p) && isMatchaNamed(p)).map((p) => coreRow(p));
    const seen = new Set(), uniq = rows.filter((r) => { const k = `${r.name}|${r.address}`.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
    fs.writeFileSync("data/shops-zz-overture-core.json", JSON.stringify({ generated: new Date().toISOString(), group: "overture-core", release, shops: uniq }, null, 1) + "\n");
    info(`overture: ${uniq.length} matcha-named places written (${uniq.filter((r) => !r.confirmed_via).length} held)`);
  }
  if (argv.includes("--menus")) {
    const limit = +arg("--limit", 1500);
    const only = arg("--cities") ? new Set(String(arg("--cities")).split(",").map((x) => x.trim().toLowerCase())) : null;
    const box = arg("--bbox") ? String(arg("--bbox")).split(",").map(Number) : null;
    const st = arg("--state");
    const wide = argv.includes("--wide");
    const cands = places.filter((p) => isServesCandidate(p, wide) && (!only || only.has(String(p.city || "").toLowerCase())) && (!box || (p.lng >= box[0] && p.lat >= box[1] && p.lng <= box[2] && p.lat <= box[3])) && (!st || stateOf(p) === st)).sort((a, b) => (PRIORITY[a.tax] ?? 5) - (PRIORITY[b.tax] ?? 5) || (b.conf - a.conf));
    const curFile = `${dir}/menus-cursor${only || box || st ? "-" + arg("--tag", "sel") : ""}.json`;
    // --all: every candidate, no cursor (with --cache-dir the pages come from an earlier run's fetch cache and only PDFs are downloaded);
    // --shard i/n takes every n-th candidate; --held-out file.json lists each held candidate with its reason (for counts per city).
    const everything = argv.includes("--all");
    const [shardI, shardN] = String(arg("--shard", "0/1")).split("/").map(Number);
    const start = everything ? 0 : readJson(curFile, { next: 0 }).next % Math.max(1, cands.length);
    const priorIds = new Set(["data/shops-zz-overture-serves.json", arg("--out", "data/shops-zz-overture-serves.json")].flatMap((f) => readJson(f, { shops: [] }).shops.map((r) => r.overture_id)));
    const onlyIds = arg("--ids") ? new Set(readJson(arg("--ids"), [])) : null;
    const batch = everything ? cands.filter((p, i) => i % shardN === shardI && !priorIds.has(p.id) && (!onlyIds || onlyIds.has(p.id))) : cands.slice(start, start + limit);
    const cacheDir = arg("--cache-dir");
    const f = cacheDir ? createFetcher({ noFetch: true, cacheDir }) : createFetcher({});
    const getPdf = argv.includes("--no-pdf") ? null : createPdfGetter(cacheDir ? createFetcher({}) : f);
    const heldList = [];
    const outFile = arg("--out", "data/shops-zz-overture-serves.json");
    const prev = readJson(outFile, { shops: [] }).shops;
    const rows = new Map(prev.map((r) => [`${r.name}|${r.address}`.toLowerCase(), r]));
    let ok = 0, done = 0, held = {};
    // A small pool: different hosts read in parallel, the fetcher still waits 1 second between requests to the same host.
    const conc = Math.max(1, +arg("--conc", 8));
    let next = 0;
    const work = async () => {
      while (next < batch.length) {
        const p = batch[next++];
        const r = await confirmCandidate(toCandidate(p), (u) => f.get(u), { relaxAddress: true, weakOk: argv.includes("--weak"), getPdf }).catch((e) => ({ held: "error: " + e.message.slice(0, 40) }));
        done++;
        if (r.held) { held[r.held] = (held[r.held] || 0) + 1; if (arg("--held-out")) heldList.push({ id: p.id, name: p.name, city: p.city, state: stateOf(p), website: p.website, reason: r.held, instagram: r.instagram || igHandle(p.socials) || null, matcha_mentions: r.matcha_mentions ?? null }); continue; }
        rows.set(`${r.row.name}|${r.row.address}`.toLowerCase(), { ...r.row, overture_id: p.id, lat: p.lat, lng: p.lng, overture_sources: compactSources(p.sources) });
        ok++;
      }
    };
    await Promise.all(Array.from({ length: conc }, work));
    fs.mkdirSync(dir, { recursive: true });
    if (!everything) fs.writeFileSync(curFile, JSON.stringify({ next: start + batch.length }));
    if (arg("--held-out")) fs.writeFileSync(arg("--held-out"), JSON.stringify(heldList));
    fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), group: "overture-serves", release, shops: [...rows.values()] }, null, 1) + "\n");
    info(`overture menus: ${batch.length} sites read of ${cands.length} candidates (from ${start}); ${ok} serves rows; held ${JSON.stringify(held)}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
