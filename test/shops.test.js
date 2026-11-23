import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildQuery, parseElements, runQuery, isClosed } from "../ingest/lib/shops/overpass.js";
import { metroBoxes } from "../ingest/lib/shops/boxes.js";
import { extractAddress } from "../ingest/lib/shops/brandsites.js";
import { dedupe, applyOverrides, fillState, stateFromZip, legitimate } from "../ingest/lib/shops/merge.js";

const fx = JSON.parse(fs.readFileSync("test/fixtures/overpass-shops.json", "utf8"));
const rec = () => parseElements(fx.elements, "2026-11-22T00:00:00Z");

const BOX = [40.3, -74.4, 41.0, -73.5];
test("buildQuery: timeout 60, matcha on name and brand, curated chains, no cuisine/description matches, out center", () => {
  const q = buildQuery(BOX);
  assert.ok(q.startsWith("[out:json][timeout:60];"));
  assert.ok(q.includes('["name"~"matcha",i]') && q.includes('["brand"~"matcha",i]'));
  assert.ok(!q.includes('"cuisine"') && !q.includes('"description"'));
  assert.ok(q.includes("Cha Cha Matcha") && q.includes("Nana's Green Tea"));
  assert.ok(/out center tags;$/.test(q));
});

test("metroBoxes: one box per listed city, sized by population (more in test/cities.test.js)", () => {
  const mk = (name, pop, lat, lng, rank_us) => ({ name, state: "TX", pop, lat, lng, slug: name.toLowerCase(), rank_in_state: 1, rank_us, tz: "America/Chicago" });
  const boxes = metroBoxes([mk("Austin", 960000, 30.27, -97.74, 2), mk("Waco", 140000, 31.55, -97.15, 3), mk("Marfa", 1700, 30.31, -104.02, 4), mk("Houston", 2300000, 29.76, -95.37, 1)]);
  assert.deepEqual(boxes.map((b) => b.name), ["Houston", "Austin", "Waco", "Marfa"]);
  const span = (b) => Math.round((b.bbox[2] - b.bbox[0]) * 111.32);
  assert.deepEqual(boxes.map(span), [24, 24, 16, 10]);
});

test("legitimate: drops closed, no address, no name; sets verified from website, hours or phone", () => {
  const base = { id: "x", name: "Matcha A", lat: 1, lng: 1, address: "1 Main St", source: "osm" };
  const { kept, dropped } = legitimate([
    { ...base, id: "a", website: "https://a.example" }, { ...base, id: "b" }, { ...base, id: "c", phone: "+1 555" },
    { ...base, id: "d", closed: true }, { ...base, id: "e", address: null }, { ...base, id: "f", name: " " },
    { ...base, id: "g", opening_hours: "Mo-Su 09:00-17:00" }, { ...base, id: "h", source: "brand" },
  ]);
  assert.deepEqual(kept.map((s) => s.id), ["a", "b", "c", "g", "h"]);
  assert.deepEqual(kept.map((s) => s.verified), [true, false, true, true, true]);
  assert.deepEqual(dropped, { closed: 1, noAddress: 1, noName: 1 });
  assert.ok(kept.every((s) => !("closed" in s)));
});

test("isClosed: disused, abandoned, off hours, closed tag, past end_date; open and future end_date stay", () => {
  const now = new Date("2026-11-22");
  assert.ok(isClosed({ "disused:amenity": "cafe" }, now) && isClosed({ "abandoned:shop": "tea" }, now));
  assert.ok(isClosed({ opening_hours: "off" }, now) && isClosed({ closed: "yes" }, now));
  assert.ok(isClosed({ end_date: "2024-05-01" }, now) && isClosed({ end_date: "2025" }, now));
  assert.ok(!isClosed({ end_date: "2027-01-01" }, now) && !isClosed({ opening_hours: "Mo-Fr 08:00-18:00" }, now) && !isClosed({}, now));
});

test("parseElements: loose matches are dropped, addr:full counts, closed tags flagged", () => {
  const els = [
    { type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Green Cup", cuisine: "matcha" } },
    { type: "node", id: 2, lat: 1, lon: 1, tags: { name: "Kettl", "addr:full": "1 A St, NYC", "disused:amenity": "cafe" } },
    { type: "node", id: 3, lat: 1, lon: 1, tags: { name: "Leaf", brand: "Best Matcha Co", "addr:full": "9 B St" } },
  ];
  const r = parseElements(els, "t");
  assert.deepEqual(r.map((s) => s.id), ["osm:node/2", "osm:node/3"]);
  assert.equal(r[0].closed, true);
  assert.equal(r[1].address, "9 B St");
});

test("parseElements: ids, ways use center, address, instagram, website, hours; drops unnamed or pointless", () => {
  const r = rec();
  assert.ok(r.length >= 3);
  const a = r.find((s) => s.id === "osm:node/101");
  assert.equal(a.address, "12 Orchard St");
  assert.equal(a.state, "NY");
  assert.equal(a.instagram, "matchatest");
  assert.equal(a.website, "https://matchatest.example");
  assert.equal(a.opening_hours, "Mo-Fr 08:00-18:00; Sa 09:00-17:00");
  assert.equal(a.osm_url, "https://www.openstreetmap.org/node/101");
  const w = r.find((s) => s.id === "osm:way/202");
  assert.equal(w.lat, 34.0522);
  assert.equal(w.instagram, "chachamatcha");
  assert.equal(w.website, null);
  assert.equal(w.source, "osm");
});

test("dedupe merges same name within 150 m and keeps the first id", () => {
  const out = dedupe(rec());
  assert.equal(out.filter((s) => s.name === "Matcha Test House").length, 1);
  assert.equal(out.length, 2);
  assert.equal(out.find((s) => s.name === "Matcha Test House").id, "osm:node/101");
});

test("applyOverrides hides and edits by id", () => {
  const out = applyOverrides(rec(), { "osm:node/101": { hide: true }, "osm:way/202": { name: "Cha Cha Matcha (Silver Lake)", lat: 34.1, lng: -118.26 } });
  assert.ok(!out.some((s) => s.id === "osm:node/101"));
  const w = out.find((s) => s.id === "osm:way/202");
  assert.equal(w.name, "Cha Cha Matcha (Silver Lake)");
  assert.equal(w.lat, 34.1);
});

test("fillState: tag, zip prefix, then nearest known city", () => {
  assert.equal(fillState({ state: "New York", lat: 1, lng: 1 }).state, "NY");
  assert.equal(stateFromZip("10002"), "NY");
  assert.equal(fillState({ zip: "90012", lat: 1, lng: 1 }).state, "CA");
  assert.equal(fillState({ lat: 21.31, lng: -157.86 }, { "Honolulu|HI": [21.3069, -157.8583] }).state, "HI");
  assert.equal(fillState({ lat: 60, lng: -100 }, { "Honolulu|HI": [21.3, -157.8] }).state, null);
});

test("extractAddress reads JSON-LD, then a footer line, and invents nothing", () => {
  const ld = `<script type="application/ld+json">{"@type":"CafeOrCoffeeShop","name":"X","address":{"streetAddress":"5 Main St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"}}</script>`;
  assert.deepEqual({ ...extractAddress(ld) }.address, "5 Main St");
  const foot = `<footer><p>Visit us at 77 Elm Street, Raleigh, NC 27601</p></footer>`;
  const f = extractAddress(foot);
  assert.equal(f.address, "77 Elm Street");
  assert.equal(f.state, "NC");
  assert.equal(extractAddress("<p>Matcha is great. Order online.</p>"), null);
});

test("runQuery falls through to the next mirror on 429, then caches the response", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovp-"));
  let calls = 0;
  const fetchImpl = async () => { calls++; return calls === 1 ? { ok: false, status: 429, text: async () => "" } : { ok: true, status: 200, text: async () => JSON.stringify(fx) }; };
  const j = await runQuery("[out:json];x", { cacheDir: dir, waitMs: 0, endpoints: ["https://a.example", "https://b.example"], gapMs: 0, fetchImpl });
  assert.equal(j.elements.length, 5);
  assert.equal(calls, 2);
  const again = await runQuery("[out:json];x", { cacheDir: dir, waitMs: 0, endpoints: ["https://a.example", "https://b.example"], gapMs: 0, fetchImpl });
  assert.equal(again.elements.length, 5);
  assert.equal(calls, 2); // cache hit
});

test("data/shops.json, when present, has the attribution and valid points", () => {
  if (!fs.existsSync("data/shops.json")) return;
  const d = JSON.parse(fs.readFileSync("data/shops.json", "utf8"));
  assert.match(d.attribution, /OpenStreetMap/);
  assert.ok(d.shops.every((s) => s.id && s.name && isFinite(s.lat) && isFinite(s.lng)));
});

// Shops at every zoom (2026-11-23, the Triangle check, then the national tier): below zoom 10 every shop is in its city's
// pin (ntColl), from 10 each stands on its own; both Shops switches are on by default; Littlefoot Matcha is at 234 Fayetteville St.
test("shops draw at every zoom with the switches on by default, and Littlefoot Raleigh is placed downtown", () => {
  const app = fs.readFileSync(path.resolve("site", "app.js"), "utf8");
  assert.match(app, /function mapShops\(\) \{ return map\.getZoom\(\) < DENSE_Z \? \[\] : visibleShops\(\); \}/);
  assert.match(app, /visibleShops\(\)\.forEach\(function \(it\) \{ add\(it, it\.data\.city, it\.data\.state\); \}\);/, "the national tier holds every shop");
  assert.match(app, /shopsOn = true, SERVES_KEY = "matchamap\.serves", servesOn = true;/);
  const shops = JSON.parse(fs.readFileSync(path.resolve("site", "data", "shops.json"), "utf8")).shops;
  const lf = shops.find((s) => /littlefoot/i.test(s.name) && s.city === "Raleigh");
  assert.ok(lf, "Littlefoot Matcha, Raleigh");
  assert.match(lf.address, /^234 Fayetteville/);
  assert.ok(Math.abs(lf.lat - 35.7771) < 0.005 && Math.abs(lf.lng - -78.6396) < 0.005, "at 234 Fayetteville St");
});
