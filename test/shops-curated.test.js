import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRow, curatedShops } from "../ingest/lib/shops/curated.js";
import { legitimate, dedupe } from "../ingest/lib/shops/merge.js";
import { hoursToOsm, readPage } from "../tools/shop-read.js";

const row = { name: "Isshiki Matcha", address: "183 Grand Street", city: "New York", state: "ny", zip: "10013-1234", website: "https://isshikimatcha.com", instagram: "@IsshikiMatcha", opening_hours: "Mo-Su 08:00-18:00", source_url: "https://isshikimatcha.com/pages/locations", read: "2026-11-23", confirmed_via: "own-site" };

test("curated rows need a street address, state, public source and read date; verified comes from confirmed_via", () => {
  const ok = checkRow(row);
  assert.equal(ok.shop.state, "NY");
  assert.equal(ok.shop.zip, "10013");
  assert.equal(ok.shop.instagram, "isshikimatcha");
  assert.equal(ok.shop.verified, true);
  assert.equal(ok.shop.source, "web");
  assert.equal(checkRow({ ...row, address: "Grand Street" }).held, "no street address");
  assert.equal(checkRow({ ...row, source_url: "" }).held, "no public source_url");
  assert.equal(checkRow({ ...row, read: "yesterday" }).held, "no read date");
  assert.equal(checkRow({ ...row, state: "Narnia" }).held, "no state");
  assert.equal(checkRow({ ...row, confirmed_via: "press" }).shop.verified, false);
});

test("curatedShops geocodes through the geocoder and holds rows it cannot place", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shops-"));
  fs.writeFileSync(path.join(dir, "shops-south-test.json"), JSON.stringify({ shops: [row, { ...row, name: "Nowhere Matcha", address: "1 Nowhere Rd" }] }));
  fs.writeFileSync(path.join(dir, "shops-overrides.json"), JSON.stringify({ x: { hide: true } }));
  const geocoder = { geocode: async (ev) => { if (/Nowhere/.test(ev.address)) return; ev.lat = 40.72; ev.lng = -73.99; ev.geocode_source = "nominatim"; } };
  const r = await curatedShops({ geocoder, fetched: "t", dir });
  assert.equal(r.shops.length, 1);
  assert.equal(r.shops[0].lat, 40.72);
  assert.deepEqual(r.held.map((h) => h.why), ["address not geocoded"]);
});

test("a researched row stays verified through legitimate() and fills an OSM row's gaps in dedupe()", () => {
  const web = { ...checkRow(row).shop, lat: 40.7189, lng: -73.9976 };
  const osm = { id: "osm:node/1", name: "Isshiki Matcha", lat: 40.71891, lng: -73.99761, address: "183 Grand St", city: null, state: "NY", source: "osm", website: null, opening_hours: null };
  const { kept } = legitimate([osm, web]);
  assert.equal(kept.find((s) => s.source === "osm").verified, false);
  assert.equal(kept.find((s) => s.source === "web").verified, true);
  const merged = dedupe(kept);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].opening_hours, "Mo-Su 08:00-18:00");
  assert.equal(merged[0].verified, true);
  assert.equal(merged[0].source_url, "https://isshikimatcha.com/pages/locations");
});

test("shop-read turns schema.org hours into OpenStreetMap syntax and never invents a field", () => {
  assert.equal(hoursToOsm({ openingHoursSpecification: [
    { dayOfWeek: ["Monday", "Tuesday", "Wednesday"], opens: "08:00", closes: "17:00" },
    { dayOfWeek: "https://schema.org/Saturday", opens: "09:00:00", closes: "15:00:00" },
  ] }), "Mo-We 08:00-17:00; Sa 09:00-15:00");
  assert.equal(hoursToOsm({ openingHours: ["Mo-Fr 07:00-15:00"] }), "Mo-Fr 07:00-15:00");
  assert.equal(hoursToOsm(null), null);
  const r = readPage("<html><title>Hi</title><body>matcha matcha</body></html>", "https://x.test/");
  assert.equal(r.address, null);
  assert.equal(r.hours_osm, null);
  assert.equal(r.matcha_mentions, 2);
});
