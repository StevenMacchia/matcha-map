// The matcha drink types for the social graphics: every type has a glyph, names map as the data file says, page furniture is
// dropped, unknown names fall to the plain matcha glyph, and nothing is invented (every printed name comes from the menu).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { whatTheyPour, cleanDrink, drinkType, TYPE_IDS } from "../tools/social/drinks.js";
import { glyphSvg, GLYPH_IDS } from "../tools/social/glyphs.js";

test("every drink type in the data file has a drawn glyph, and every glyph is a type", () => {
  assert.deepEqual([...TYPE_IDS()].sort(), [...GLYPH_IDS].sort());
  for (const id of GLYPH_IDS) assert.match(glyphSvg(id), /^<svg [^>]*viewBox="0 0 64 64"/);
});

test("names map to their type", () => {
  const want = { "Matcha Latte": "latte", "Iced Matcha Latte": "iced", "Strawberry Matcha Latte": "strawberry", "Iced Strawberry Matcha": "strawberry", "Hojicha Latte": "hojicha",
    "Matcha Soft Serve": "dessert", "Strawberry Matcha Cake": "dessert", "Ceremonial Matcha": "bowl", "Usucha": "bowl", "Oat Milk Matcha": "plantmilk", "Matcha": "matcha", "Matcha Colada": "latte", "Matcha Lemonade": "iced" };
  for (const [n, t] of Object.entries(want)) assert.equal(drinkType(n), t, n);
  assert.equal(drinkType("Gizmo Zorp"), "matcha");
});

test("menu lines that are not drinks are dropped and prices and page words are cleaned off", () => {
  for (const x of ["Matcha Whisk", "Matcha Powder", "Matcha Tools", "See all matcha →", "Shipping, Return, Cancellation, and Matcha Specific Policies", "What is matcha?", "Matcha Set", "Ceremonial Matcha Gift Set", "A very long description of how our matcha is grown and shipped to you"]) assert.equal(cleanDrink(x), "", x);
  assert.equal(cleanDrink("Order now for Iced Matcha Latte"), "Iced Matcha Latte");
  assert.equal(cleanDrink("Brown Sugar Matcha Latte: 6.99"), "Brown Sugar Matcha Latte");
  assert.equal(cleanDrink("Matcha Fit FroLatte!&reg;"), "Matcha Fit FroLatte!");
});

test("whatTheyPour: one row per type in menu order, a count of the rest, nothing invented", () => {
  const menu = ["Matcha Latte", "Iced Matcha Latte", "Iced Matcha Latte", "Strawberry Matcha", "Hojicha Latte", "Matcha Cake", "Oat Matcha", "Ceremonial Matcha", "Matcha Whisk", "Order now for Matcha Latte"].map((name) => ({ name, price: null }));
  const r = whatTheyPour(menu, 5);
  assert.deepEqual(r.items.map((i) => i.type), ["latte", "iced", "strawberry", "hojicha", "dessert"]);
  assert.equal(r.more, 2);
  for (const i of r.items) assert.ok(menu.some((m) => m.name === i.name), i.name);
  assert.deepEqual(whatTheyPour([], 5), { items: [], more: 0 });
  assert.deepEqual(whatTheyPour(undefined, 5), { items: [], more: 0 });
});

test("the real menus: every shop's rows read, no row empty, no price or page word left", () => {
  const shops = JSON.parse(fs.readFileSync(new URL("../site/data/shops.json", import.meta.url), "utf8")).shops.filter((s) => s.menu_matcha && s.menu_matcha.length);
  assert.ok(shops.length > 100);
  let withDrinks = 0;
  for (const s of shops) {
    const r = whatTheyPour(s.menu_matcha, 5);
    if (r.items.length) withDrinks++;
    assert.ok(r.items.length <= 5);
    for (const i of r.items) { assert.ok(i.name.length > 2 && i.name.length <= 34, i.name); assert.doesNotMatch(i.name, /\$|\d\.\d\d|&reg;|→/, i.name); assert.ok(GLYPH_IDS.includes(i.type)); }
  }
  assert.ok(withDrinks / shops.length > 0.8, `${withDrinks}/${shops.length}`);
});
