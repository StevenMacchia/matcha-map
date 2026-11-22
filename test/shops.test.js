import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildQuery, parseElements, runQuery } from "../ingest/lib/shops/overpass.js";
import { BOXES } from "../ingest/lib/shops/boxes.js";
import { extractAddress } from "../ingest/lib/shops/brandsites.js";
import { dedupe, applyOverrides, fillState, stateFromZip } from "../ingest/lib/shops/merge.js";

const fx = JSON.parse(fs.readFileSync("test/fixtures/overpass-shops.json", "utf8"));
const rec = () => parseElements(fx.elements, "2026-11-22T00:00:00Z");

test("buildQuery: timeout 180, matcha regex on four keys, curated chains, out center", () => {
  const q = buildQuery(BOXES[0].bbox);
  assert.match(q, /^\[out:json\]\[timeout:180\];/);
  for (const k of ["name", "brand", "cuisine", "description"]) assert.ok(q.includes(`["${k}"~"matcha",i]`));
  assert.ok(q.includes("Cha Cha Matcha") && q.includes("Nana's Green Tea"));
  assert.ok(/out center tags;$/.test(q));
});

test("boxes cover the contiguous US, Alaska and Hawaii", () => {
  const names = BOXES.map((b) => b.name);
  assert.ok(names.includes("alaska") && names.includes("hawaii"));
  assert.ok(BOXES.every((b) => b.bbox[0] < b.bbox[2] && b.bbox[1] < b.bbox[3]));
});

test("parseElements: ids, ways use center, address, instagram, website, hours; drops unnamed or pointless", () => {
  const r = rec();
  assert.equal(r.length, 4);
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
  assert.equal(out.length, 3);
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

test("runQuery waits and retries once on 429, then caches the response", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovp-"));
  let calls = 0;
  const fetchImpl = async () => { calls++; return calls === 1 ? { ok: false, status: 429, text: async () => "" } : { ok: true, status: 200, text: async () => JSON.stringify(fx) }; };
  const j = await runQuery("[out:json];x", { cacheDir: dir, waitMs: 0, endpoints: ["https://a.example"], fetchImpl });
  assert.equal(j.elements.length, 5);
  assert.equal(calls, 2);
  const again = await runQuery("[out:json];x", { cacheDir: dir, waitMs: 0, endpoints: ["https://a.example"], fetchImpl });
  assert.equal(again.elements.length, 5);
  assert.equal(calls, 2); // cache hit
});

test("data/shops.json, when present, has the attribution and valid points", () => {
  if (!fs.existsSync("data/shops.json")) return;
  const d = JSON.parse(fs.readFileSync("data/shops.json", "utf8"));
  assert.match(d.attribution, /OpenStreetMap/);
  assert.ok(d.shops.every((s) => s.id && s.name && isFinite(s.lat) && isFinite(s.lng)));
});
