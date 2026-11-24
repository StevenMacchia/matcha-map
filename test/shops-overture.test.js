import test from "node:test";
import assert from "node:assert/strict";
import { ownSite, usable, isMatchaNamed, coreRow, isServesCandidate, toCandidate } from "../ingest/shops-overture.js";
import { checkRow } from "../ingest/lib/shops/curated.js";

const place = (o) => ({ id: "08f1", name: "Matcha Haus", tax: "cafe", conf: 0.9, status: "open", street: "12 Main St", city: "Durham", state: "NC", zip: "27701", country: "US", website: "https://matchahaus.example", socials: ["https://www.instagram.com/matchahaus/", "https://facebook.com/x"], phone: "+19195550100", lat: 36, lng: -78.9, sources: '[{"dataset":"meta","license":"CDLA-Permissive-2.0","record_id":"1"},{"dataset":"foursquare","license":"Apache-2.0","record_id":"2"}]', ...o });

test("overture: usable needs a US state, a street number, confidence 0.6 and not closed", () => {
  assert.ok(usable(place({})));
  assert.ok(usable(place({ state: "US-HI" })), "ISO region form");
  assert.ok(!usable(place({ state: "ON", country: "CA" })));
  assert.ok(!usable(place({ street: "Main St" })));
  assert.ok(!usable(place({ conf: 0.4 })));
  assert.ok(!usable(place({ status: "permanently_closed" })));
});

test("overture: a matcha-named food or drink place becomes a shown, unverified core row that keeps its id and per-source licenses", () => {
  const p = place({});
  assert.ok(isMatchaNamed(p));
  assert.ok(!isMatchaNamed(place({ name: "Matcha Hair Salon", tax: "hair_salon" })));
  assert.ok(isMatchaNamed(place({ name: "抹茶カフェ", tax: "cafe" })));
  const row = coreRow(p, "2026-11-24");
  assert.equal(row.confirmed_via, "overture");
  assert.equal(row.instagram, "matchahaus");
  assert.equal(row.overture_id, "08f1");
  assert.deepEqual(row.overture_sources.map((s) => s.license), ["CDLA-Permissive-2.0", "Apache-2.0"]);
  const c = checkRow(row).shop;
  assert.equal(c.verified, false, "unverified until its own site confirms");
  assert.equal(c.confirmed_via, "overture");
  assert.equal(c.overture_id, "08f1");
  assert.equal(c.tier, "shop");
});

test("overture: Matcha Cafe Maiko stays held, with no evidence field", () => {
  const row = coreRow(place({ name: "Matcha Cafe Maiko" }), "2026-11-24");
  assert.equal(row.confirmed_via, undefined);
  assert.match(row.notes, /^Held/);
  assert.equal(checkRow(row).shop.confirmed_via, null);
});

test("overture: serves candidates are cafes and tea rooms with a website that are not matcha-named or big chains", () => {
  assert.ok(isServesCandidate(place({ name: "Perennial Coffee", tax: "coffee_shop" })));
  assert.ok(!isServesCandidate(place({ name: "Perennial Coffee", tax: "coffee_shop", website: null })));
  assert.ok(!isServesCandidate(place({ name: "Starbucks", tax: "coffee_shop" })));
  assert.ok(!isServesCandidate(place({})), "matcha-named places go the core route");
  const c = toCandidate(place({ name: "Perennial Coffee", tax: "coffee_shop" }));
  assert.equal(c.provider, "overture");
  assert.equal(c.instagram, "matchahaus");
  assert.equal(c.address, "12 Main St");
});

test("overture: a listing or social site is not the shop's own website and never reaches a row", () => {
  assert.equal(ownSite("https://m.yelp.com/biz/matcha-x"), null);
  assert.equal(ownSite("https://www.facebook.com/x"), null);
  assert.equal(ownSite("https://matchahaus.example/menu"), "https://matchahaus.example/menu");
  const row = coreRow(place({ website: "https://www.yelp.com/biz/x" }), "2026-11-24");
  assert.equal(row.website, null);
  assert.doesNotMatch(row.source_url, /yelp/);
});
