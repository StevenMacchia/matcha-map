// Rung 28: the canonical city list (Census files -> data/cities.json), what derives from it, and the per-city crawl bookkeeping.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { parseSubEst, parseGazetteer, buildCities, stripSuffix, slugOf, csvLine, siteCitiesText, candidateTags, citiesFileText } from "../tools/gen-cities.js";
import { tzForPlace } from "../ingest/lib/tz.js";
import { loadCities, findCity, crawlCities, searchLabels, searchLabel } from "../ingest/lib/cities.js";
import { planCities, loadCrawlState } from "../ingest/lib/crawl-state.js";
import * as common from "../ingest/lib/sites/common.js";
import * as eb from "../ingest/lib/sites/eventbrite.js";
import * as ae from "../ingest/lib/sites/allevents.js";
import * as mu from "../ingest/lib/sites/meetup.js";
import { metroBoxes, overlapShare, boxOf, nextBoxes, radiusKm } from "../ingest/lib/shops/boxes.js";
import { runQuery } from "../ingest/lib/shops/overpass.js";
import { createGeocoder } from "../ingest/lib/geocode.js";

const text = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cities-")), name);
const entry = (name, state, pop, lat, lng, rank_us) => ({ name, state, pop, lat, lng, slug: slugOf(name), rank_in_state: 1, rank_us, tz: "America/New_York" });

// ---- A: the generator ----------------------------------------------------------------------------
test("gen-cities: legal suffixes come off, consolidated governments keep the first name", () => {
  assert.equal(stripSuffix("Raleigh city"), "Raleigh");
  assert.equal(stripSuffix("Nashville-Davidson metropolitan government (balance)"), "Nashville");
  assert.equal(stripSuffix("Louisville/Jefferson County metro government (balance)"), "Louisville");
  assert.equal(stripSuffix("Lexington-Fayette urban county"), "Lexington");
  assert.equal(stripSuffix("Augusta-Richmond County consolidated government (balance)"), "Augusta");
  assert.equal(stripSuffix("Macon-Bibb County"), "Macon");
  assert.equal(stripSuffix("Urban Honolulu CDP"), "Honolulu");
  assert.equal(stripSuffix("Anchorage municipality"), "Anchorage");
  assert.equal(stripSuffix("Juneau city and borough"), "Juneau");
  assert.equal(stripSuffix("Indianapolis city (balance)"), "Indianapolis");
  assert.equal(stripSuffix("Boise City city"), "Boise");
  assert.equal(stripSuffix("Jersey City city"), "Jersey City");
  assert.equal(stripSuffix("Carson City"), "Carson City");
  assert.equal(stripSuffix("Winston-Salem city"), "Winston-Salem");
  assert.equal(slugOf("St. Louis"), "st-louis");
  assert.deepEqual(csvLine('162,12,000,34132,"Islamorada, Village of Islands village",Florida'), ["162", "12", "000", "34132", "Islamorada, Village of Islands village", "Florida"]);
});

test("gen-cities: parsing both Census files, top 20 per state, DC, Hawaii, towns for NH, zones", () => {
  const places = parseSubEst(text("census-sub-est.csv"));
  // State rows, county rows, the whole-government 170/172 rows and an inactive/statistical town are not places.
  assert.ok(!places.some((p) => p.name === "North Carolina" || /Wake County/.test(p.name) || p.geoid === "3300199000"));
  assert.equal(places.filter((p) => p.name === "Nashville-Davidson metropolitan government (balance)").length, 1);
  const gaz = parseGazetteer(text("census-gaz-places.txt"));
  assert.equal(gaz.get("3700000"), undefined);
  assert.deepEqual(gaz.get("4752006"), { lat: 36.1718, lng: -86.7847 });
  const cities = buildCities(places, gaz);
  const of = (st) => cities.filter((c) => c.state === st);

  // North Carolina: 22 incorporated places and a bigger CDP -> exactly 20, no CDP, ranked 1..20, Raleigh first.
  const nc = of("NC");
  assert.equal(nc.length, 20);
  assert.ok(!nc.some((c) => /Bigville/.test(c.name)));
  assert.deepEqual(nc.map((c) => c.rank_in_state), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(nc[0].name, "Raleigh");
  assert.ok(nc.every((c) => !/ (city|town|village)$/.test(c.name)));
  // The list is ordered by population with rank_us counting from 1.
  assert.deepEqual(cities.map((c) => c.rank_us), cities.map((_, i) => i + 1));
  assert.ok(cities.every((c, i) => i === 0 || cities[i - 1].pop >= c.pop));
  assert.equal(cities[0].name, "Houston");
  // Fields and rounding.
  const r = nc[0];
  assert.deepEqual(Object.keys(r).sort(), ["lat", "lng", "name", "pop", "rank_in_state", "rank_us", "slug", "state", "tz"]);
  assert.equal(r.slug, "raleigh");
  assert.ok((String(r.lat).split(".")[1] || "").length <= 4);

  // Consolidated city, urban county, quoted comma, a place with no coordinates.
  assert.equal(of("TN").find((c) => c.pop === 704963).name, "Nashville");
  assert.equal(of("KY")[0].name, "Lexington");
  assert.ok(of("FL").some((c) => c.name.startsWith("Islamorada")));
  assert.ok(!of("FL").some((c) => c.name === "Nowhere"));
  // DC is one entry, named Washington with its own slug; Hawaii has only its one place.
  assert.deepEqual(of("DC").map((c) => [c.name, c.slug, c.rank_in_state]), [["Washington", "washington-dc", 1]]);
  assert.deepEqual(of("HI").map((c) => c.name), ["Honolulu"]);
  assert.equal(of("HI")[0].tz, "Pacific/Honolulu");
  // New Hampshire has two city places; the towns fill it up, and Concord is not listed twice.
  const nh = of("NH").map((c) => c.name);
  assert.deepEqual(nh.sort(), ["Alton", "Concord", "Manchester"]);
  // Zones: the state default and the split states.
  assert.equal(of("TN").find((c) => c.name === "Nashville").tz, "America/Chicago");
  assert.equal(of("TN").find((c) => c.name === "Knoxville").tz, "America/New_York");
  assert.equal(of("TX").find((c) => c.name === "El Paso").tz, "America/Denver");
  assert.equal(of("TX").find((c) => c.name === "Houston").tz, "America/Chicago");
  assert.equal(of("FL").find((c) => c.name === "Pensacola").tz, "America/Chicago");
  assert.equal(of("KY").find((c) => c.name === "Lexington").tz, "America/New_York");
});

test("tz: split states by position", () => {
  assert.equal(tzForPlace("IN", 41.59, -87.34), "America/Chicago"); // Gary
  assert.equal(tzForPlace("IN", 39.77, -86.16), "America/Indiana/Indianapolis");
  assert.equal(tzForPlace("KY", 37.0, -86.44), "America/Chicago"); // Bowling Green
  assert.equal(tzForPlace("ND", 46.88, -102.79), "America/Denver"); // Dickinson
  assert.equal(tzForPlace("ND", 46.81, -100.78), "America/Chicago"); // Bismarck
  assert.equal(tzForPlace("SD", 44.08, -103.23), "America/Denver"); // Rapid City
  assert.equal(tzForPlace("NE", 41.87, -103.66), "America/Denver"); // Scottsbluff
  assert.equal(tzForPlace("ID", 47.68, -116.78), "America/Los_Angeles"); // Coeur d'Alene
  assert.equal(tzForPlace("OR", 44.03, -116.96), "America/Boise"); // Ontario
  assert.equal(tzForPlace("MI", 45.83, -88.07), "America/Chicago"); // Iron Mountain area
  assert.equal(tzForPlace("AZ", 33.4, -112.0), "America/Phoenix");
  assert.equal(tzForPlace("ZZ", 0, 0), null);
});

test("data/cities.json: the real list has its source, 20 per state (DC and Hawaii one), sorted, under 300 KB", () => {
  const raw = fs.readFileSync("data/cities.json", "utf8");
  assert.ok(raw.length < 300 * 1024);
  const j = JSON.parse(raw);
  assert.match(j.source.population, /^https:\/\/www2\.census\.gov\/.+sub-est2024\.csv$/);
  assert.match(j.source.gazetteer, /^https:\/\/www2\.census\.gov\/.+Gaz_place_national\.zip$/);
  assert.match(j.source.vintage, /2024/);
  const by = {};
  for (const c of j.cities) by[c.state] = (by[c.state] || 0) + 1;
  assert.equal(Object.keys(by).length, 51);
  for (const [st, n] of Object.entries(by)) assert.ok(n <= 20 && (n >= 19 || ["DC", "HI"].includes(st)), `${st} has ${n}`);
  assert.equal(by.DC, 1);
  assert.ok(j.cities.length > 950);
  assert.ok(j.cities.every((c, i) => c.rank_us === i + 1 && (i === 0 || j.cities[i - 1].pop >= c.pop)));
  assert.ok(j.cities.every((c) => /^[a-z0-9-]+$/.test(c.slug) && /^[A-Z]{2}$/.test(c.state) && c.tz && Number.isFinite(c.lat) && Number.isFinite(c.lng)));
  assert.ok(!j.cities.some((c) => / (city|town|village|borough|CDP)$|\(balance\)|metropolitan government/.test(c.name)));
  for (const [name, st] of [["Raleigh", "NC"], ["Nashville", "TN"], ["Louisville", "KY"], ["Indianapolis", "IN"], ["Honolulu", "HI"], ["Anchorage", "AK"], ["Providence", "RI"], ["Burlington", "VT"]]) assert.ok(j.cities.some((c) => c.name === name && c.state === st), `${name} ${st}`);
  // Top 20 of North Carolina by size.
  const nc = j.cities.filter((c) => c.state === "NC").map((c) => c.name);
  assert.deepEqual(nc.slice(0, 5), ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem"]);
});

test("gen-cities: the file text and site/cities.js text round-trip and keep the shape the site reads", () => {
  const list = [entry("Raleigh", "NC", 500000, 35.8, -78.6, 1), entry("Cary", "NC", 180000, 35.79, -78.78, 2)];
  assert.deepEqual(JSON.parse(citiesFileText(list, { a: 1 })).cities, list.map((c) => ({ name: c.name, state: c.state, pop: c.pop, lat: c.lat, lng: c.lng, slug: c.slug, rank_in_state: 1, rank_us: c.rank_us, tz: c.tz })));
  const win = {};
  vm.runInNewContext(siteCitiesText(list, { "Bayside|WI": [43.1861, -87.9049], "Raleigh|NC": [0, 0] }), { window: win });
  win.CITIES = JSON.parse(JSON.stringify(win.CITIES)); win.CITY_LIST = JSON.parse(JSON.stringify(win.CITY_LIST)); // out of the vm realm
  assert.deepEqual(win.CITIES["Raleigh|NC"], [35.8, -78.6]); // the list wins over an extra of the same key
  assert.deepEqual(win.CITIES["Bayside|WI"], [43.1861, -87.9049]);
  assert.deepEqual(win.CITY_LIST[1], ["Cary", "NC", 35.79, -78.78, "cary", 180000]);
});

test("site/cities.js: every listed city is there, in the old shape, with the brand home cities kept", () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync("site/cities.js", "utf8"), { window: win });
  win.CITIES = JSON.parse(JSON.stringify(win.CITIES)); win.CITY_LIST = JSON.parse(JSON.stringify(win.CITY_LIST)); // out of the vm realm
  const cities = loadCities();
  assert.equal(win.CITY_LIST.length, cities.length);
  for (const c of cities) { const k = `${c.name}|${c.state}`; assert.deepEqual(win.CITIES[k], [c.lat, c.lng], k); }
  assert.ok(win.CITY_LIST.every((r, i) => r.length === 6 && (i === 0 || win.CITY_LIST[i - 1][5] >= r[5])));
  const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
  for (const s of sources) assert.ok(win.CITIES[`${s.home_city}|${s.home_state}`], `home city ${s.home_city}|${s.home_state}`);
  assert.ok(Object.keys(win.CITIES).every((k) => /\|[A-Z]{2}$/.test(k)));
  assert.ok(fs.statSync("site/cities.js").size < 200 * 1024);
});

test("candidateTags: top 60 city tags plus nicknames, minus the active ones", () => {
  const cities = loadCities();
  const tags = candidateTags(cities, ["matchapopupchicago"]);
  assert.ok(!tags.includes("matchapopupchicago"));
  assert.ok(tags.includes("matchapopupnewyork") && tags.includes("matchapopupfortworth") && tags.includes("matchapopupoklahomacity"));
  assert.ok(tags.includes("matchapopuppdx") && tags.includes("matchapopupnola") && tags.includes("matchapopupkc"));
  assert.ok(tags.every((t) => /^matchapopup[a-z]+$/.test(t)));
  assert.equal(new Set(tags).size, tags.length);
  const h = JSON.parse(fs.readFileSync("data/hashtags.json", "utf8"));
  assert.ok(Array.isArray(h.candidates) && h.candidates.length > 30);
  assert.equal(h.active.length, 30); // the weekly budget is untouched
  assert.ok(h.candidates.every((t) => !h.active.includes(t)));
});

// ---- B: what derives from the list --------------------------------------------------------------
test("CITY_STATE derives from the file: biggest city keeps a shared name, DC and Brooklyn are there", () => {
  assert.equal(common.CITY_STATE.Columbus, "OH");
  assert.equal(common.CITY_STATE.Portland, "OR");
  assert.equal(common.CITY_STATE["Washington DC"], "DC");
  assert.equal(common.CITY_STATE.Brooklyn, "NY");
  assert.equal(common.CITY_STATE.Raleigh, "NC");
  assert.ok(Object.keys(common.CITY_STATE).length > 850);
  // Free text only matches cities of 100,000 or more, and never the names that are also ordinary words.
  assert.equal(common.TEXT_CITY_STATE.Raleigh, "NC");
  assert.ok(!("Mobile" in common.TEXT_CITY_STATE) && !("Lincoln" in common.TEXT_CITY_STATE) && !("Orange" in common.TEXT_CITY_STATE));
  assert.ok(!("Weymouth" in common.TEXT_CITY_STATE));
  const names = Object.keys(common.TEXT_CITY_STATE);
  assert.ok(names.length > 150 && names.length < 300);
});

test("the old 40 cities are all still known", () => {
  const old = ["New York", "Brooklyn", "Los Angeles", "San Francisco", "Oakland", "San Diego", "Seattle", "Portland", "Chicago", "Boston", "Philadelphia", "Washington DC", "Atlanta", "Miami", "Austin", "Houston", "Dallas", "Denver", "Phoenix", "Las Vegas", "Minneapolis", "Detroit", "Nashville", "Charlotte", "Raleigh", "Pittsburgh", "Baltimore", "San Jose", "Sacramento", "Salt Lake City", "Orlando", "Tampa", "New Orleans", "Honolulu", "Columbus", "Cleveland", "Kansas City", "St. Louis", "Indianapolis", "Providence"];
  for (const n of old) assert.ok(common.TEXT_CITY_STATE[n], n);
});

test("findCity and crawl order", () => {
  assert.equal(findCity("Raleigh").state, "NC");
  assert.equal(findCity("columbus", "GA").state, "GA");
  assert.equal(findCity("Columbus").state, "OH");
  assert.equal(findCity("Washington DC").state, "DC");
  assert.equal(findCity("Washington, DC").state, "DC");
  assert.equal(findCity("Saint Louis", "MO").name, "St. Louis");
  assert.equal(findCity("Brooklyn", "NY").slug, "brooklyn");
  assert.equal(findCity("Atlantis"), null);
  assert.equal(findCity("Raleigh", "TX"), null);
  const order = crawlCities();
  assert.ok(order.every((c, i) => i === 0 || order[i - 1].pop >= c.pop));
  assert.equal(order[0].name, "New York");
  assert.deepEqual(order.slice(0, 4).map((c) => c.name), ["New York", "Los Angeles", "Brooklyn", "Chicago"]); // Brooklyn sits where its 2.7 million people put it
});

test("search rotation: a pool of the biggest cities, labels disambiguate shared names", () => {
  const labels = searchLabels();
  assert.equal(labels.length, 100);
  assert.equal(labels[0], "New York");
  assert.ok(labels.includes("Washington DC"));
  const cities = loadCities();
  assert.equal(searchLabel(findCity("Columbus", "GA"), cities), "Columbus, GA");
  assert.equal(searchLabel(findCity("Columbus", "OH"), cities), "Columbus");
  assert.equal(searchLabels(5).length, 5);
});

test("crawler URLs per site from a city entry (fixture of pages read on 2026-11-22)", () => {
  const fxu = JSON.parse(text("crawl-city-urls.json"));
  for (const c of fxu.cases) {
    const city = findCity(c.name, c.state);
    assert.ok(city, `${c.name} ${c.state}`);
    assert.equal(eb.cityUrl(city), c.eventbrite, `eventbrite ${c.name}`);
    assert.equal(ae.cityUrl(city), c.allevents, `allevents ${c.name}`);
    assert.equal(mu.cityUrl(city), c.meetup, `meetup ${c.name}`);
  }
  // A name still works: the biggest listed city of that name.
  assert.equal(eb.cityUrl("New York"), "https://www.eventbrite.com/d/ny--new-york/matcha/");
});

// ---- the cursor and the 7-day skip ---------------------------------------------------------------
const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: `C${i}`, state: "NC", slug: `c${i}`, pop: 1000 - i }));
const t0 = new Date("2026-11-22T12:00:00Z");

test("crawl cursor: successive runs walk the whole list and wrap", () => {
  const file = tmp("crawl.json"), list = mk(10);
  const seen = [];
  for (let run = 0; run < 4; run++) {
    const p = planCities("eventbrite", list, { perRun: 4, file, now: t0 });
    seen.push(p.batch.map((c) => c.name).join(","));
    for (const c of p.batch) p.done(c, "ok");
    p.finish();
  }
  assert.deepEqual(seen, ["C0,C1,C2,C3", "C4,C5,C6,C7", "C8,C9,C0,C1", "C2,C3,C4,C5"]);
  // Another site has its own cursor.
  assert.equal(planCities("allevents", list, { perRun: 2, file, now: t0 }).batch[0].name, "C0");
});

test("crawl cursor: a run that stops early moves the cursor only past the cities asked", () => {
  const file = tmp("crawl.json"), list = mk(10);
  const p = planCities("meetup", list, { perRun: 5, file, now: t0 });
  p.done(p.batch[0], "ok"); p.done(p.batch[1], "error"); // stopped after two
  p.finish();
  assert.equal(planCities("meetup", list, { perRun: 5, file, now: t0 }).batch[0].name, "C2");
});

test("crawl skip: a 404 or an empty result skips a city for 7 days, an ok result or an error does not", () => {
  const file = tmp("crawl.json"), list = mk(6);
  const p = planCities("eventbrite", list, { perRun: 6, file, now: t0 });
  const out = ["404", "empty", "ok", "error", "ok", "ok"];
  p.batch.forEach((c, i) => p.done(c, out[i]));
  const f = p.finish();
  assert.equal(f.skipped, 2);
  const day = (d) => new Date(t0.getTime() + d * 86400000);
  const names = (now, perRun = 6) => planCities("eventbrite", list, { perRun, file, now, persist: false }).batch.map((c) => c.name);
  // The cursor wrapped to the start; C0 and C1 are passed over, the other four come up.
  assert.deepEqual(names(day(1)), ["C2", "C3", "C4", "C5"]);
  assert.deepEqual(names(day(6.9)), ["C2", "C3", "C4", "C5"]);
  assert.deepEqual(names(day(7.1)), ["C0", "C1", "C2", "C3", "C4", "C5"]); // the week is over
  assert.equal(Object.keys(loadCrawlState(file, day(1)).skip).length, 2);
  assert.equal(Object.keys(loadCrawlState(file, day(8)).skip).length, 0);
  // Skips are per site.
  assert.equal(planCities("allevents", list, { perRun: 6, file, now: day(1), persist: false }).batch.length, 6);
});

test("crawlers: one run asks CRAWL_CITIES_PER_RUN cities, records 404 and empty pages, and the next run continues", async () => {
  const file = tmp("crawl.json");
  const list = mk(5).map((c, i) => ({ ...c, name: ["Raleigh", "Durham", "Cary", "Garner", "Apex"][i], slug: ["raleigh", "durham", "cary", "garner", "apex"][i] }));
  const asked = [];
  const fetcher = { noFetch: false, get: async (u) => { asked.push(u); const status = /robots|durham/.test(u) ? 404 : 200; return { ok: status < 400, status, text: status === 200 ? "<html></html>" : "" }; } };
  const run = () => eb.discover({ fetcher, now: t0, sources: [], cities: list, perRun: 3, crawlFile: file });
  const r1 = await run();
  assert.equal(r1.stats.cities, 3);
  assert.deepEqual(asked.filter((u) => !/robots/.test(u)).map((u) => u.split("--")[1]), ["raleigh/matcha/", "durham/matcha/", "cary/matcha/"]);
  asked.length = 0;
  const r2 = await run();
  // Raleigh and Cary (a page with no matcha events) and Durham (404) are skipped for a week, so the run goes on to the next two.
  assert.deepEqual(asked.filter((u) => !/robots/.test(u)).map((u) => u.split("--")[1]), ["garner/matcha/", "apex/matcha/"]);
  assert.equal(r2.stats.cities, 2);
  assert.equal(r2.stats.skippedCities, 5);
});

// ---- boxes ---------------------------------------------------------------------------------------
test("boxes: radius by population, one box per city in rank order, 60 percent overlap with a bigger box drops the smaller", () => {
  assert.equal(radiusKm(8e6), 12);
  assert.equal(radiusKm(500001), 12);
  assert.equal(radiusKm(500000), 8);
  assert.equal(radiusKm(100001), 8);
  assert.equal(radiusKm(100000), 5);
  const big = entry("Big", "NC", 600000, 35.0, -80.0, 1), near = entry("Near", "NC", 150000, 35.05, -80.05, 2), far = entry("Far", "NC", 90000, 36.5, -80.0, 3), edge = entry("Edge", "NC", 90000, 35.0, -79.84, 4);
  const b = boxOf(big);
  assert.ok(Math.abs((b[2] - b[0]) - 2 * 12 / 111.32) < 1e-3);
  assert.ok(Math.abs((b[3] - b[1]) * Math.cos(35 * Math.PI / 180) - 2 * 12 / 111.32) < 1e-3);
  const boxes = metroBoxes([far, edge, near, big]); // any input order
  assert.deepEqual(boxes.map((x) => x.name), ["Big", "Far", "Edge"]); // Edge overlaps Big by about a quarter: kept
  assert.ok(!boxes.some((x) => x.name === "Near")); // its 8 km box lies almost wholly inside Big's 12 km one
  assert.ok(boxes.every((x) => x.bbox[0] < x.bbox[2] && x.bbox[1] < x.bbox[3]));
  assert.equal(overlapShare([0, 0, 1, 1], [2, 2, 3, 3]), 0);
  assert.equal(overlapShare([0, 0, 1, 1], [0, 0, 2, 2]), 1);
  assert.equal(overlapShare([0, 0, 2, 2], [0, 0, 1, 2]), 0.5);
  // The real list gives a box for nearly every city, biggest first.
  const real = metroBoxes();
  assert.ok(real.length > 900 && real.length <= loadCities().length);
  assert.equal(real[0].name, "New York");
});

test("boxes: a run takes SHOP_BOXES_PER_RUN boxes from a saved cursor, wraps, and moves only as far as it got", () => {
  const file = tmp("shops-cursor.json"), boxes = Array.from({ length: 7 }, (_, i) => ({ name: `B${i}` }));
  const a = nextBoxes(boxes, { perRun: 3, file });
  assert.deepEqual(a.batch.map((b) => b.name), ["B0", "B1", "B2"]);
  a.commit();
  const b = nextBoxes(boxes, { perRun: 3, file });
  assert.deepEqual(b.batch.map((x) => x.name), ["B3", "B4", "B5"]);
  b.commit(2); // stopped after two
  const c = nextBoxes(boxes, { perRun: 3, file });
  assert.deepEqual(c.batch.map((x) => x.name), ["B5", "B6", "B0"]);
  c.commit();
  assert.deepEqual(nextBoxes(boxes, { perRun: 20, file }).batch.length, 7);
});

test("overpass: a 429 or 504 backs off (doubling) before the next mirror, then fails over", async () => {
  const dir = path.dirname(tmp("x"));
  const waits = [];
  const calls = [];
  const fetchImpl = async (ep) => { calls.push(ep); if (calls.length < 3) return { ok: false, status: calls.length === 1 ? 429 : 504, text: async () => "" }; return { ok: true, status: 200, text: async () => JSON.stringify({ elements: [{ id: 1 }] }) }; };
  const t = Date.now();
  const j = await runQuery("[out:json];", { cacheDir: dir, endpoints: ["https://a.test", "https://b.test", "https://c.test"], fetchImpl, gapMs: 0, backoffMs: 20 });
  waits.push(Date.now() - t);
  assert.deepEqual(j.elements, [{ id: 1 }]);
  assert.deepEqual(calls, ["https://a.test", "https://b.test", "https://c.test"]);
  assert.ok(waits[0] >= 55, `backed off 20 + 40 ms, took ${waits[0]}`);
  // Every mirror failing is reported, not retried forever.
  const bad = async () => ({ ok: false, status: 429, text: async () => "" });
  await assert.rejects(runQuery("[out:json];[bad];", { cacheDir: dir, endpoints: ["https://a.test", "https://b.test"], fetchImpl: bad, gapMs: 0, backoffMs: 1 }), (e) => e.allFailed === true);
});

// ---- geocode: a listed city needs no Nominatim call -------------------------------------------------
test("geocode: a listing that names only a listed city and its state resolves from the file", async () => {
  const dir = path.dirname(tmp("x"));
  const g = createGeocoder({ noFetch: false, cachePath: path.join(dir, "gc.json"), overridesPath: path.join(dir, "ov.json"), env: {} });
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("no network in tests"); };
  try {
    const ev = await g.geocode({ id: "e1", city: "Raleigh", state: "NC", confidence: "confirmed" });
    const raleigh = findCity("Raleigh", "NC");
    assert.deepEqual([ev.lat, ev.lng, ev.geocode_source, ev.confidence], [raleigh.lat, raleigh.lng, "none", "unsure"]);
    assert.equal(calls, 0);
    // An address still goes to the geocoder; one that cannot be found falls back to the file's city centre.
    const ev2 = await g.geocode({ id: "e2", address: "1 Fake St", city: "Raleigh", state: "NC", confidence: "confirmed" });
    assert.ok(calls >= 1);
    assert.equal(ev2.lat, raleigh.lat);
    // A city that is not listed still asks (and here fails, so no coordinates).
    const before = calls;
    const ev3 = await g.geocode({ id: "e3", city: "Ballwin", state: "MO", confidence: "confirmed" });
    assert.ok(calls > before);
    assert.equal(ev3.lat, null);
  } finally { globalThis.fetch = realFetch; }
});

test("cities.json has no leftover discover list and every part reads the one file", () => {
  assert.ok(!fs.existsSync("data/cities-discover.json"));
  for (const f of ["ingest/lib/discover.js", "ingest/lib/sites/common.js", "ingest/lib/shops/boxes.js"]) assert.ok(!/cities-discover/.test(fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")), f);
  assert.equal(loadCities().length, JSON.parse(fs.readFileSync("data/cities.json", "utf8")).cities.length);
});
