// The remembered place (site/place.js): one valid place in storage, a shared link never replaces it, stale or odd entries
// read as nothing, Forget clears it; the page loads the module before app.js and the worker precaches it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const w = {};
vm.runInNewContext(fs.readFileSync(path.join(SITE, "place.js"), "utf8"), { window: w });
const P = w.MatchaPlace;
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const J = (v) => JSON.parse(JSON.stringify(v));
const NOW = Date.UTC(2026, 10, 23, 12);

test("place: a landing is remembered with its zoom and read back; Forget clears it", () => {
  const s = store();
  assert.equal(P.read(s, NOW), null);
  const p = P.write(s, { lat: 35.7796, lng: -78.6382, zoom: 10.004, label: "Raleigh, NC", how: "city" }, NOW);
  assert.deepEqual(J(p), { lat: 35.7796, lng: -78.6382, zoom: 10, label: "Raleigh, NC", how: "city", at: NOW });
  assert.deepEqual(J(P.read(s, NOW + 1000)), J(p));
  assert.equal(P.describe(P.read(s, NOW)), "Raleigh, NC");
  P.clear(s);
  assert.equal(P.read(s, NOW), null);
  P.clear(null); // nothing to forget, nothing thrown
});

test("place: a shared link stores its view only while nothing is remembered; Near me, a zip, a city or a city page always do", () => {
  const s = store();
  assert.ok(P.write(s, { lat: 40.7, lng: -74, zoom: 13, label: "a shared view", how: "link" }, NOW), "an empty memory takes the link");
  assert.equal(P.read(s, NOW).how, "link");
  assert.ok(P.write(s, { lat: 35.78, lng: -78.64, zoom: 10, label: "Raleigh, NC", how: "zip" }, NOW));
  assert.equal(P.write(s, { lat: 34.05, lng: -118.25, zoom: 12, label: "a friend's plan", how: "link" }, NOW), null, "a link never replaces a remembered place");
  assert.equal(P.read(s, NOW).label, "Raleigh, NC");
  for (const how of ["near", "city", "page"]) {
    assert.ok(P.write(s, { lat: 1, lng: 2, zoom: 9, label: how, how }, NOW));
    assert.equal(P.read(s, NOW).how, how);
  }
  assert.equal(P.describe({ how: "near", label: "" }), "near you");
  assert.equal(P.describe({ how: "link", label: "" }), "your last spot");
});

test("place: stale, odd or hand-edited entries read as nothing and are never written", () => {
  const s = store();
  assert.equal(P.write(s, { lat: "x", lng: 2, zoom: 9, how: "city" }, NOW), null);
  assert.equal(P.write(s, { lat: 1, lng: 2, zoom: 0.5, how: "city" }, NOW), null);
  assert.equal(P.write(s, { lat: 1, lng: 2, zoom: 9, how: "guess" }, NOW), null);
  assert.equal(P.write(null, { lat: 1, lng: 2, zoom: 9, how: "city" }, NOW), null);
  assert.equal(P.read(s, NOW), null);
  s.setItem(P.KEY, "{not json");
  assert.equal(P.read(s, NOW), null);
  s.setItem(P.KEY, JSON.stringify({ lat: 1, lng: 2, zoom: 9, how: "city", at: NOW - P.MAX_AGE - 1 }));
  assert.equal(P.read(s, NOW), null, "older than 180 days");
  s.setItem(P.KEY, JSON.stringify({ lat: 1, lng: 2, zoom: 9, how: "city", at: NOW - 86400000, label: "x".repeat(200) }));
  assert.equal(P.read(s, NOW).label.length, 80);
  const thrower = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(P.read(thrower, NOW), null);
  assert.equal(P.write(thrower, { lat: 1, lng: 2, zoom: 9, how: "city" }, NOW), null);
  P.clear(thrower);
});

test("the page loads place.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8"), sw = fs.readFileSync(path.join(SITE, "sw.js"), "utf8");
  const a = html.indexOf('src="place.js'), b = html.indexOf('src="app.js');
  assert.ok(a > 0 && b > a, "place.js before app.js");
  assert.match(sw, /"\/place\.js"/);
  assert.match(html, /id="whole" class="geo" hidden>Whole map</, "the Whole map button");
  assert.match(html, /id="place-forget"/, "Forget in the Show sheet");
});
