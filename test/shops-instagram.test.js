import test from "node:test";
import assert from "node:assert/strict";
import { drinksFromCaption, drinksFromPosts, rowFromPosts } from "../ingest/lib/shops/instagram-menus.js";
import { checkRow } from "../ingest/lib/shops/curated.js";
import { mediaOf, postsUrl } from "../ingest/shops-instagram.js";
import { isServesCandidate, wideCategory } from "../ingest/shops-overture.js";

const place = { name: "Bar Test", address: "12 Main St", city: "Raleigh", state: "NC", zip: "27601", website: "https://bartest.example", phone: null };
const post = (caption, i) => ({ caption, permalink: `https://www.instagram.com/p/AAA${i}/`, timestamp: `2026-11-${String(20 - i).padStart(2, "0")}T12:00:00+0000` });

test("instagram menus: a caption names its matcha drinks, not the bare word", () => {
  assert.deepEqual(drinksFromCaption("new: strawberry matcha latte, rose matcha soda + a hojicha latte! come by at 8am"), ["strawberry matcha latte", "rose matcha soda"]);
  assert.deepEqual(drinksFromCaption("we love a good matcha. open daily"), []);
  assert.deepEqual(drinksFromCaption("Iced matcha latte and a matcha latte, all day"), ["matcha latte"], "iced and plain are one drink");
  assert.deepEqual(drinksFromCaption("no tea today"), []);
});

test("instagram menus: three distinct names across posts make a serves row with the newest post as source", () => {
  const s = drinksFromPosts([post("ube matcha latte is back", 3), post("matcha tonic season", 2), post("lavender matcha latte, ube matcha latte", 1), post("closed monday", 0)]);
  assert.equal(s.posts, 4);
  assert.equal(s.with_matcha, 3);
  assert.deepEqual(s.drinks.map((d) => d.name).sort(), ["Lavender Matcha Latte", "Matcha Tonic", "Ube Matcha Latte"]);
  const row = rowFromPosts(place, s, { instagram: "bartest", read: "2026-11-25" });
  assert.equal(row.confirmed_via, "instagram-posts");
  assert.equal(row.note, undefined, "three drinks need no weak note");
  assert.match(row.source_url, /instagram\.com\/p\/AAA1\//, "newest post that names a drink: post 1 is the newest by date");
  const c = checkRow(row);
  assert.ok(!c.held, c.held);
  assert.equal(c.shop.tier, "serves");
  assert.equal(c.shop.verified, true);
});

test("instagram menus: fewer than three names is a 'Menu mentions matcha' row, none is no row", () => {
  const one = drinksFromPosts([post("yuzu matcha soda today", 1)]);
  const row = rowFromPosts(place, one, { instagram: "bartest" });
  assert.match(row.note, /^Menu mentions matcha/);
  assert.ok(row.note.length <= 120);
  assert.ok(!checkRow(row).held);
  assert.equal(rowFromPosts(place, drinksFromPosts([post("hello", 1)]), { instagram: "bartest" }), null);
});

test("instagram menus: the Graph call asks for 30 posts and the shape maps to captions", () => {
  assert.match(decodeURIComponent(postsUrl({ id: "1", token: "t" }, "bartest")), /business_discovery\.username\(bartest\)\{media\.limit\(30\)\{caption,permalink,timestamp/);
  assert.deepEqual(mediaOf({ business_discovery: { media: { data: [{ caption: "a", permalink: "p", timestamp: "t" }] } } }), [{ caption: "a", permalink: "p", timestamp: "t" }]);
  assert.deepEqual(mediaOf({}), []);
});

test("overture wide: restaurants and bars are candidates only with --wide", () => {
  const p = { id: "x", name: "Test Bistro", tax: "american_restaurant", conf: 0.9, status: "open", street: "1 Main St", city: "Raleigh", state: "NC", country: "US", website: "https://bistro.example" };
  assert.ok(wideCategory(p) && wideCategory({ ...p, tax: "cocktail_bar" }) && wideCategory({ ...p, tax: "breakfast_and_brunch_restaurant" }));
  assert.ok(!wideCategory({ ...p, tax: "hair_salon" }));
  assert.ok(!isServesCandidate(p));
  assert.ok(isServesCandidate(p, true));
  assert.ok(!isServesCandidate({ ...p, name: "Chick-fil-A" }, true), "chains are not read");
});

test("curated: a weak note may add words after 'Menu mentions matcha'", () => {
  const row = { name: "Songbird", address: "1020 E Whitaker Mill Rd", city: "Raleigh", state: "NC", source_url: "https://songbird.bar/", read: "2026-11-25", tier: "serves", menu_url: "https://songbird.bar/morning-menu", menu_matcha: [{ name: "Matcha Latte", price: "$7" }], note: "Menu mentions matcha: made with Frame Matcha", confirmed_via: "own-site" };
  assert.ok(!checkRow(row).held);
  assert.ok(checkRow({ ...row, note: "Frame matcha" }).held, "without the prefix three drinks are required");
});
