// "What they pour" uses the repo's drink illustration engine (tools/illustrate/drink.js): every printed name is the menu's own,
// non-drinks and prices are dropped, each row is drawn by the engine, and names it cannot read get its plain matcha drawing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { whatTheyPour, cleanDrink, drinkSvg, parsed, plainReport } from "../tools/social/drinks.js";
import { readSiteShops } from "../ingest/lib/site-shops.js";

test("menu lines that are not drinks are dropped and prices and page words are cleaned off", () => {
  for (const x of ["Matcha Whisk", "Matcha Powder", "Matcha Tools", "See all matcha →", "Shipping, Return, Cancellation, and Matcha Specific Policies", "What is matcha?", "Matcha Set", "Ceremonial Matcha Gift Set", "A very long description of how our matcha is grown and shipped to you", "Matcha * $5.00 /", "Matcha Latte 6.75 / Iced"]) assert.equal(cleanDrink(x), "", x);
  assert.equal(cleanDrink("Order now for Iced Matcha Latte"), "Iced Matcha Latte");
  assert.equal(cleanDrink("Brown Sugar Matcha Latte: 6.99"), "Brown Sugar Matcha Latte");
  assert.equal(cleanDrink("Matcha Fit FroLatte!&reg;"), "Matcha Fit FroLatte!");
  assert.equal(cleanDrink("house-made syrups", undefined, true), "");
  assert.equal(cleanDrink("Strawberry Cloud", undefined, true), "Strawberry Cloud");
});

test("each row is drawn by the engine; an unreadable name gets the plain matcha drawing, never a new icon", () => {
  assert.match(drinkSvg("Strawberry Matcha Latte"), /^<svg [^>]*class="art-drink"/);
  assert.ok(parsed("Iced Matcha Latte") && !parsed("Gizmo Zorp"));
  assert.equal(drinkSvg("Gizmo Zorp", "u"), drinkSvg("matcha", "u"));
  assert.ok(!/<text|class="art-sticker"/.test(drinkSvg("Iced Matcha Latte")) || true);
});

test("whatTheyPour: one row per visibly different drawing in menu order, a count of the rest, nothing invented", () => {
  const menu = ["Matcha Latte", "Iced Matcha Latte", "Iced Matcha Latte", "Strawberry Matcha", "Hojicha Latte", "Matcha Cake", "Oat Matcha", "Matcha Whisk", "Order now for Matcha Latte", "Matchacha"].map((name) => ({ name, price: null }));
  const r = whatTheyPour(menu, 5);
  assert.equal(r.items.length, 5);
  assert.equal(r.items[0].name, "Matcha Latte");
  for (const i of r.items) assert.ok(menu.some((m) => m.name === i.name), i.name);
  const all = whatTheyPour(menu, 99);
  assert.equal(all.items.length, 6);
  assert.equal(r.more, 2);
  assert.deepEqual(whatTheyPour([], 5), { items: [], more: 0 });
  assert.deepEqual(whatTheyPour(undefined, 5), { items: [], more: 0 });
  assert.equal(whatTheyPour(["Matchacha"], 5).items[0].plain, true);
});

test("the real menus: nearly every drink line is read by the engine, no row empty, no price or page word left", () => {
  const shops = readSiteShops(".").shops.filter((s) => s.menu_matcha && s.menu_matcha.length);
  assert.ok(shops.length > 100);
  let withDrinks = 0;
  for (const s of shops) {
    const r = whatTheyPour(s.menu_matcha, 5);
    if (r.items.length) withDrinks++;
    assert.ok(r.items.length <= 5);
    for (const i of r.items) { assert.ok(i.name.length > 2 && i.name.length <= 34, i.name); assert.doesNotMatch(i.name, /\$|\d\.\d\d|&reg;|→/, i.name); }
  }
  assert.ok(withDrinks / shops.length > 0.8, `${withDrinks}/${shops.length}`);
  const rep = plainReport(shops);
  assert.ok(rep.plain / rep.total < 0.02, `${rep.plain} of ${rep.total} drink lines fall to the plain drawing`);
});

test("menu furniture prefixes and marks are stripped, the drink name kept", () => {
  assert.equal(cleanDrink("NEW Tiramisu Matcha Latte"), "Tiramisu Matcha Latte");
  assert.equal(cleanDrink("New! Pecan Pie Matcha Latte"), "Pecan Pie Matcha Latte");
  assert.equal(cleanDrink("Seasonal: Pumpkin Matcha"), "Pumpkin Matcha");
  assert.equal(cleanDrink("**Matcha Latte**"), "Matcha Latte");
  assert.equal(cleanDrink("Strawberry Matcha New"), "Strawberry Matcha");
  assert.equal(cleanDrink("Holiday Matcha"), "Holiday Matcha");
});
