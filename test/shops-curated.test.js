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
  assert.match(ok.shop.id, /^brand:web-[a-z0-9-]{1,55}$/);
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

test("dedupe merges a researched branch name into the plain OSM row at the same spot, and keeps different shops apart", () => {
  const osm = { id: "osm:node/9", name: "Cha Cha Matcha", lat: 40.74, lng: -73.99, address: "1158 Broadway", state: "NY", source: "osm", website: null };
  const web = { id: "web:cha-cha-matcha-nomad", name: "Cha Cha Matcha NoMad", lat: 40.74001, lng: -73.99001, address: "1158 Broadway", state: "NY", source: "web", verified: true, opening_hours: "Mo-Su 08:00-20:00", source_url: "https://x.test/" };
  const other = { id: "web:isshiki", name: "Isshiki Matcha at Ace Hotel", lat: 40.7405, lng: -73.9898, address: "20 W 29th", state: "NY", source: "web", verified: true };
  const out = dedupe([osm, web, other]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "osm:node/9");
  assert.equal(out[0].name, "Cha Cha Matcha NoMad");
  assert.equal(out[0].opening_hours, "Mo-Su 08:00-20:00");
  // the shop's own hours replace OpenStreetMap's
  const osm2 = { ...osm, id: "osm:node/10", opening_hours: "Mo-Sa 10:00-17:00" };
  assert.equal(dedupe([osm2, web])[0].opening_hours, "Mo-Su 08:00-20:00");
});

test("serves tier: a coffee or tea shop needs a menu page and at least three distinct matcha drinks; shop rows are the default", () => {
  assert.equal(checkRow(row).shop.tier, "shop");
  const serves = { ...row, name: "Heirloom Brewshop", tier: "serves", menu_url: "https://x.test/menu", menu_matcha: [{ name: "Matcha latte", price: "$6" }, { name: "Iced matcha", price: null }, { name: "Ceremonial matcha", price: "$8" }, { name: "Matcha latte", price: "$6" }] };
  const ok = checkRow(serves).shop;
  assert.equal(ok.tier, "serves");
  assert.deepEqual(ok.menu_matcha.map((x) => x.name), ["Matcha latte", "Iced matcha", "Ceremonial matcha"]);
  assert.match(checkRow({ ...serves, menu_matcha: serves.menu_matcha.slice(0, 2) }).held, /at least 3/);
  assert.match(checkRow({ ...serves, menu_url: null }).held, /menu_url/);
  assert.equal(checkRow({ ...row, note: "Pop-up window at Maison Neue" }).shop.note, "Pop-up window at Maison Neue");
});

test("public-page rows are kept and shown but are not verified; unknown evidence is held back from the map", () => {
  const pp = checkRow({ ...row, confirmed_via: "public-page", website: null }).shop;
  assert.equal(pp.confirmed_via, "public-page");
  assert.equal(pp.verified, false);
  assert.equal(checkRow({ ...row, confirmed_via: "yelp" }).shop.confirmed_via, null);
});

test("shop places: an ALL-CAPS or lower-case city is title-cased, odd names keep their capitals, the state is two upper-case letters", async () => {
  const { normPlace } = await import("../ingest/lib/shops/merge.js");
  assert.equal(normPlace({ city: "CARY", state: "nc" }).city, "Cary");
  assert.equal(normPlace({ city: "CARY", state: "nc" }).state, "NC");
  assert.equal(normPlace({ city: "st. louis" }).city, "St. Louis");
  assert.equal(normPlace({ city: "MCLEAN" }).city, "McLean");
  assert.equal(normPlace({ city: "LA JOLLA" }).city, "La Jolla");
  assert.equal(normPlace({ city: "McLean" }).city, "McLean", "mixed case is left alone");
  assert.equal(normPlace({ city: "Winston-Salem" }).city, "Winston-Salem");
  assert.equal(normPlace({ city: null }).city, null);
});

test("the shop data carries no all-caps or all-lower-case city and no state that is not two upper-case letters", async () => {
  const fs = await import("node:fs");
  const shops = JSON.parse(fs.readFileSync(new URL("../data/shops.json", import.meta.url), "utf8")).shops;
  const bad = shops.filter((s) => (s.city && (s.city === s.city.toUpperCase() || s.city === s.city.toLowerCase()) && /[A-Za-z]{3,}/.test(s.city)) || (s.state && !/^[A-Z]{2}$/.test(s.state)));
  assert.deepEqual(bad.map((s) => `${s.name}|${s.city}|${s.state}`).slice(0, 5), []);
});

test("a full state name, a name-led address and a missing city suffix are repaired instead of held", () => {
  const base = { name: "Mad Coffee & More", address: "Mad Coffee & More, 8049 US Highway 83", city: "Abilene", state: "TEXAS", zip: "79602", source_url: "https://madcoffeemore.com/", read: "2026-11-24" };
  const a = checkRow(base);
  assert.equal(a.shop.state, "TX");
  assert.equal(a.shop.address, "8049 US Highway 83");
  assert.equal(checkRow({ ...base, state: "Arizona" }).shop.state, "AZ");
  const k = checkRow({ ...base, name: "Kyuramen - Cherry Hill", address: "1871 NJ-70", city: null, state: "NJ" });
  assert.equal(k.shop.city, "Cherry Hill");
  assert.ok(checkRow({ ...base, state: "Narnia" }).held);
  assert.equal(checkRow({ ...base, address: "123 Main St, Suite 4" }).shop.address, "123 Main St, Suite 4");
});

test("a row with no city field takes it from its own address line when the state matches", () => {
  const row = { name: "Blank Street Coffee", state: "NY", source_url: "https://blankstreet.com/", read: "2026-11-24" };
  assert.equal(checkRow({ ...row, address: "63 Spring Street, New York, NY, 10012" }).shop.city, "New York");
  assert.equal(checkRow({ ...row, address: "63 Spring Street, Boston, MA, 02116" }).held, "no city");
  assert.equal(checkRow({ ...row, address: "3010 NJ-27" }).held, "no city");
});

test("a suite in the middle of the address line does not hide its city, and a state field with an address tail still gives the state", () => {
  const row = { name: "Blank Street Coffee", state: "DC", source_url: "https://blankstreet.com/", read: "2026-11-25" };
  assert.equal(checkRow({ ...row, address: "2200 Pennsylvania Ave NW, Suite 160E, Washington, DC, 20052" }).shop.city, "Washington");
  assert.equal(checkRow({ name: "Holy Roly", city: "Los Angeles", state: "STE 109A, LOS ANGELES, CA", address: "3450 W. 6th St", source_url: "https://holyroly.com/", read: "2026-11-25" }).shop.state, "CA");
});
