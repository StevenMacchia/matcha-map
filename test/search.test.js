// Rung N8: instant search (site/search.js): matching, grouping, drink slug lookup, filters, query parsing.
import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex, search, drinkLookup, drinkSlug, filterByDrink, filterByBrand, parseQuery, normalize, slugify } from "../site/search.js";

const NOW = Date.parse("2026-11-25T15:00:00Z");
const art = {
  drinks: { "ube-latte": { text: "ube latte" }, "iced-matcha-latte": { text: "iced matcha latte" }, "strawberry-matcha": { text: "strawberry matcha" } },
  catalog: [{ slug: "iced-matcha-latte", name: "Iced matcha latte", aliases: ["iced matcha", "matcha latte"] }, { slug: "ube-latte", name: "Ube latte", aliases: [] }],
};
const ev = (o) => ({ id: "e" + Math.random().toString(16).slice(2, 10), brand: "Moonbee", source_id: "moonbee", handle: "moonbeematcha", title: "Moonbee pop-up", start: "2026-11-28T11:00:00-05:00", end: "2026-11-28T15:00:00-05:00", tz: "America/New_York", venue: "Books & Co", city: "Raleigh", state: "NC", status: "upcoming", menu: ["strawberry matcha"], ...o });
const events = [
  ev({ id: "aaa111" }),
  ev({ id: "bbb222", brand: "Ube Society", handle: "ubesociety", source_id: "ubesoc", city: "Chicago", state: "IL", menu: ["ube latte", "iced matcha"] }),
  ev({ id: "ccc333", brand: "Old Brand", handle: "oldbrand", start: "2026-10-01T11:00:00-04:00", end: "2026-10-01T15:00:00-04:00", status: "past" }),
  ev({ id: "ddd444", brand: "Gone", handle: "gone", status: "cancelled" }),
];
const sources = [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", active: true, home_city: "Raleigh", home_state: "NC" }, { id: "ubesoc", brand: "Ube Society", instagram: "@ubesociety", active: true }, { id: "idle", brand: "Idle Tea", instagram: "idletea", active: true, home_city: "Austin", home_state: "TX" }];
const index = buildIndex({ events, sources, art, cities: [["Raleigh", "NC", 35.8, -78.6, 500000], ["Austin", "TX", 30.2, -97.7, 900000]], now: NOW });
const types = (g) => g.map((x) => x.type);

test("normalize and slugify", () => {
  assert.equal(normalize("  Café @Moon-Bee! "), "cafe moon bee");
  assert.equal(slugify("Ube Latte!"), "ube-latte");
});

test("index holds live pop-ups only: past and cancelled are left out", () => {
  const ids = index.event.map((x) => x.id);
  assert.deepEqual(ids.sort(), ["aaa111", "bbb222"]);
});

test("brand name and handle both match, and a brand with no pop-up still appears", () => {
  assert.equal(search(index, "moonbee").find((g) => g.type === "brand").items[0].id, "moonbeematcha");
  assert.equal(search(index, "@ubesoc").find((g) => g.type === "brand").items[0].id, "ubesociety");
  assert.equal(search(index, "idle").find((g) => g.type === "brand").items[0].id, "idletea");
});

test("results come grouped in order: pop-ups, brands, drinks, cities", () => {
  const g = search(index, "ube");
  assert.deepEqual(types(g), ["event", "brand", "drink"]);
  assert.equal(g[2].items[0].id, "ube-latte");
  assert.equal(g[2].items[0].art, "ube-latte");
  assert.deepEqual(types(search(index, "raleigh")), ["event", "city"]);
  assert.equal(search(index, "raleigh").find((g) => g.type === "city").items[0].id, "raleigh-nc");
});

test("multiple tokens must all match; prefix beats a mid-word hit; empty and junk queries give nothing", () => {
  assert.ok(search(index, "iced matcha").find((g) => g.type === "drink").items[0].id === "iced-matcha-latte");
  assert.deepEqual(search(index, "ube zzzz"), []);
  assert.deepEqual(search(index, "   "), []);
  assert.deepEqual(search(index, "qqqq"), []);
  const g = search(index, "matcha").find((x) => x.type === "drink");
  assert.ok(g.items.length <= 4);
});

test("a drink counts the pop-ups that serve it, by alias too", () => {
  const d = index.drink.find((x) => x.id === "iced-matcha-latte");
  assert.equal(d.n, 1);
  assert.equal(index.drink.find((x) => x.id === "strawberry-matcha").n, 1);
});

test("drink slug lookup: names, aliases, a brand prefix, and unknown text", () => {
  const lk = drinkLookup(art);
  assert.equal(drinkSlug("Iced Matcha", lk), "iced-matcha-latte");
  assert.equal(drinkSlug("matcha latte", lk), "iced-matcha-latte");
  assert.equal(drinkSlug("himori cafe — ube latte", lk), "ube-latte");
  assert.equal(drinkSlug("Black Sesame!", lk), "black-sesame");
  assert.equal(drinkSlug("", lk), "");
});

test("filterByDrink and filterByBrand", () => {
  assert.deepEqual(filterByDrink(events, "ube-latte", art).map((e) => e.id), ["bbb222"]);
  assert.deepEqual(filterByDrink(events, "iced-matcha-latte", art).map((e) => e.id), ["bbb222"]);
  assert.deepEqual(filterByDrink(events, "strawberry-matcha").map((e) => e.id).sort(), ["aaa111", "ccc333", "ddd444"]);
  assert.deepEqual(filterByDrink(events, ""), []);
  assert.deepEqual(filterByBrand(events, "ubesociety").map((e) => e.id), ["bbb222"]);
  assert.equal(filterByBrand(events, "@MoonbeeMatcha").length, 1);
  assert.deepEqual(filterByBrand(events, "nobody"), []);
});

test("parseQuery reads ?q= and ?drink=", () => {
  assert.deepEqual(parseQuery("?q=%20Raleigh%20&drink=Ube%20Latte"), { q: "Raleigh", drink: "ube-latte" });
  assert.deepEqual(parseQuery(""), { q: "", drink: "" });
  assert.equal(parseQuery("?q=" + "x".repeat(300)).q.length, 80);
  assert.equal(parseQuery("?drink=%3Cscript%3E").drink, "script");
});
