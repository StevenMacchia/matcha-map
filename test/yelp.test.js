import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createYelp, matchBusiness, placeKey, fillApproxFromYelp, enrich, DAILY_CAP, OFF_LINE } from "../ingest/lib/enrich/yelp.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yelp-")), "cache.json");
const ATL = { lat: 33.749, lng: -84.388 };
const biz = (o = {}) => ({ id: "b1", name: "Octane Coffee", rating: 4.5, review_count: 321, price: "$$", phone: "+14045550100", url: "https://www.yelp.com/biz/octane-atlanta?adjust_creative=x", image_url: "https://s3-media.yelp.com/p.jpg", coordinates: { latitude: 33.78, longitude: -84.41 }, location: { state: "GA" }, is_closed: false, ...o });
function fake(handler) {
  const calls = [];
  const http = async (url, opts) => { calls.push({ url, opts }); const r = handler(url); return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body }; };
  return { http, calls };
}
const okHandler = (businesses) => (url) => url.includes("/businesses/search") ? { body: { businesses } } : { body: { hours: [{ open: [{ day: 0, start: "0700", end: "1800", is_overnight: false }] }] } };

test("matching: name words contained and within 30 km", () => {
  assert.ok(matchBusiness("Octane Coffee", biz(), ATL));
  assert.ok(matchBusiness("Octane", biz({ name: "Octane Coffee - Westside" }), ATL), "venue words contained in the Yelp name");
  assert.ok(!matchBusiness("Octane Coffee", biz({ name: "Starbucks" }), ATL));
  assert.ok(!matchBusiness("Octane Coffee Roasters Lab", biz(), ATL), "extra venue words are not in the Yelp name");
  assert.ok(!matchBusiness("Octane Coffee", biz({ coordinates: { latitude: 34.3, longitude: -84.4 } }), ATL), "more than 30 km away");
  assert.ok(!matchBusiness("Octane Coffee", biz({ coordinates: null }), ATL));
});
test("lookup returns the place, fetches hours, strips tracking from the url and caches for 7 days", async () => {
  const f = fake(okHandler([biz({ name: "Other Place", id: "x" }), biz()]));
  let t = Date.parse("2026-11-22T12:00:00Z");
  const y = createYelp({ env: { YELP_API_KEY: "k" }, http: f.http, cachePath: tmp(), now: () => t });
  const p = await y.lookup({ name: "Octane Coffee", city: "Atlanta", state: "GA" });
  assert.equal(p.key, "octane coffee|atlanta|ga");
  assert.deepEqual([p.rating, p.review_count, p.price, p.url, p.tz, p.yelp_id], [4.5, 321, "$$", "https://www.yelp.com/biz/octane-atlanta", "America/New_York", "b1"]);
  assert.equal(p.hours.length, 1);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.startsWith("https://api.yelp.com/v3/businesses/search?term=Octane%20Coffee&location=Atlanta%2C%20GA&limit=3"));
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer k");
  await y.lookup({ name: "Octane Coffee", city: "Atlanta", state: "GA" });
  assert.equal(f.calls.length, 2, "second lookup is a cache hit");
  t += 6 * 86400000;
  await y.lookup({ name: "Octane Coffee", city: "Atlanta", state: "GA" });
  assert.equal(f.calls.length, 2, "still fresh after 6 days");
  t += 2 * 86400000;
  await y.lookup({ name: "Octane Coffee", city: "Atlanta", state: "GA" });
  assert.equal(f.calls.length, 4, "asked again after 7 days");
});
test("a miss is cached too, and persisted in the cache file", async () => {
  const f = fake(okHandler([biz({ name: "Starbucks" })])), file = tmp();
  const y = createYelp({ env: { YELP_API_KEY: "k" }, http: f.http, cachePath: file });
  assert.equal(await y.lookup({ name: "Octane Coffee", city: "Atlanta", state: "GA" }), null);
  await y.lookup({ name: "Octane Coffee", city: "Atlanta", state: "GA" });
  assert.equal(f.calls.length, 1);
  y.save();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(saved.entries["octane coffee|atlanta|ga"].miss);
  assert.equal(Object.values(saved.days)[0], 1);
});
test("daily cap: no call past 400, counted in the cache file across runs", async () => {
  const f = fake(okHandler([])), file = tmp();
  const day = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file, JSON.stringify({ days: { [day]: DAILY_CAP - 1 }, entries: {} }));
  const y = createYelp({ env: { YELP_API_KEY: "k" }, http: f.http, cachePath: file });
  assert.equal(await y.lookup({ name: "Venue One", city: "Atlanta", state: "GA" }), null);
  assert.equal(f.calls.length, 1);
  assert.equal(await y.lookup({ name: "Venue Two", city: "Atlanta", state: "GA" }), undefined);
  assert.equal(f.calls.length, 1, "cap reached: nothing more is sent");
  assert.ok(y.stopped());
});
test("without a key: one 'Yelp: off' line, no calls, nothing written", async () => {
  const f = fake(okHandler([biz()])), lines = [], orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const y = createYelp({ env: {}, http: f.http, cachePath: tmp() });
    const places = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yelp-")), "places.json");
    const r = await enrich({ events: [{ status: "upcoming", venue: "Octane Coffee", city: "Atlanta", state: "GA" }], yelp: y, placesFile: places });
    await y.lookup({ name: "Again", city: "Atlanta", state: "GA" });
    assert.equal(r.on, false);
    assert.ok(!fs.existsSync(places));
  } finally { console.log = orig; }
  assert.deepEqual(lines, [OFF_LINE]);
  assert.equal(f.calls.length, 0);
});
test("enrich looks up each upcoming venue once, then shops by position, and writes places.json", async () => {
  const f = fake(okHandler([biz()])), places = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yelp-")), "places.json");
  const y = createYelp({ env: { YELP_API_KEY: "k" }, http: f.http, cachePath: tmp() });
  const ev = (o) => ({ status: "upcoming", venue: "Octane Coffee", city: "Atlanta", state: "GA", ...o });
  const r = await enrich({ events: [ev(), ev(), ev({ status: "past", venue: "Old Place" }), ev({ venue: "@handle" })], shops: [{ name: "Octane Coffee", lat: 33.78, lng: -84.41, city: null, state: null }], yelp: y, placesFile: places });
  assert.deepEqual([r.looked, r.matched], [2, 2]);
  const out = JSON.parse(fs.readFileSync(places, "utf8"));
  assert.equal(out.places.length, 2);
  assert.ok(f.calls.some((c) => c.url.includes("latitude=33.78&longitude=-84.41")));
});
test("placeKey is venue|city|state, lowercase and squeezed", () => {
  assert.equal(placeKey("  Octane  Coffee, Inc. ", "Atlanta", "GA"), "octane coffee inc|atlanta|ga");
  assert.equal(placeKey("Shop", null, null, 33.781, -84.409), "shop|33.78,-84.41|");
});
test("an approximate event gets the Yelp coordinates; others are left alone", () => {
  const places = [{ key: "octane coffee|atlanta|ga", lat: 33.78, lng: -84.41 }];
  const base = { venue: "Octane Coffee", city: "Atlanta", state: "GA", address: null, lat: 33.749, lng: -84.388, approx: true, geocode_source: "none", confidence: "unsure" };
  const a = { ...base }, b = { ...base, address: "1 Main St" }, c = { ...base, approx: false, geocode_source: "nominatim" }, d = { ...base, venue: "Else" };
  const moved = fillApproxFromYelp([a, b, c, d], places);
  assert.deepEqual(moved, [a]);
  assert.deepEqual([a.lat, a.lng, a.geocode_source, a.approx], [33.78, -84.41, "yelp", false]);
  assert.deepEqual([b.geocode_source, c.geocode_source, d.geocode_source], ["none", "nominatim", "none"]);
});
