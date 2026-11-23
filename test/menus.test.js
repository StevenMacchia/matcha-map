import { test } from "node:test";
import assert from "node:assert/strict";
import { readSite, toText } from "../ingest/menus.js";
import { attachMenus, hostOf } from "../ingest/lib/shops/menus.js";

const page = (html) => ({ get: async () => ({ ok: true, status: 200, text: html }) });
const run = (mode, html, extra = {}) => readSite(page(html), { host: "x.test", urls: ["https://x.test/menu"], mode, ...extra }, "2026-11-23");

test("toText keeps a price next to its name and drops commented-out prices", () => {
  const t = toText("<div><span>$</span><span>9.00</span></div><p>Latte<!-- <b>$99</b> --></p>");
  assert.deepEqual(t, ["$ 9.00", "Latte"]);
});

test("nameDescPrice: caps name, description, price (Labora)", async () => {
  const m = await run("nameDescPrice", "<p>Drinks</p><p>SALTY 46</p><p>Cheese foam layered between a choice of drip, matcha or espresso</p><p>$ 7.10+</p><p>VIENNA MATCHA</p><p>Matcha latte layered with vanilla foam</p><p>$ 8.35</p>", { start: /^Drinks$/ });
  assert.equal(m.items.length, 2);
  assert.deepEqual(m.items[0], { name: "SALTY 46", price: "$7.10+", note: "Cheese foam layered between a choice of drip, matcha or espresso" });
  assert.equal(m.items[1].price, "$8.35");
  assert.equal(m.kind, "html");
  assert.equal(m.read, "2026-11-23");
});

test("priceBracket: price printed before and after each item (Squarespace)", async () => {
  const m = await run("priceBracket", "<p>Menu</p><p>$ 6.00</p><p>Matcha Americano</p><p>matcha &amp; hot water</p><p>$ 6.00</p><p>$ 7.00</p><p>Matcha Latte</p><p>$ 7.00</p>", { start: /^Menu$/ });
  assert.deepEqual(m.items.map((i) => [i.name, i.price, i.note]), [["Matcha Americano", "$6.00", "matcha & hot water"], ["Matcha Latte", "$7.00", null]]);
});

test("nameThenPrice: sizes and hot/cold lines", async () => {
  const m = await run("nameThenPrice", "<p>Base</p><p>Matcha Latte</p><p>hot / cold</p><p>R $6.75</p><p>L $7.50</p><p>Matcha Frappe</p><p>$8.25</p>", { start: /^Base$/ });
  assert.deepEqual(m.items.map((i) => [i.name, i.price]), [["Matcha Latte", "R $6.75 · L $7.50"], ["Matcha Frappe", "$8.25"]]);
});

test("namePriceDesc: a price inside an HTML comment is not public, and prices can be stripped", async () => {
  const html = "<p>Shaved Ice Selection</p><p>Uji Kintoki(430 Cal.)</p><p>$5.20</p><p>Shaved ice with matcha syrup</p><p>Matcha Latte(200 Cal.)</p><!-- <p>$3.00</p> --><p>Hot milk and matcha</p>";
  const m = await run("namePriceDesc", html, { start: /^Shaved Ice Selection$/ });
  assert.equal(m.items[0].price, "$5.20");
  assert.equal(m.items[1].price, null);
  const s = await run("namePriceDesc", html, { start: /^Shaved Ice Selection$/, stripPrices: true, note: "varies" });
  assert.ok(s.items.every((i) => i.price === null));
  assert.equal(s.note, "varies");
});

test("inlineRange and JSON-LD menus", async () => {
  const r = await run("inlineRange", "<p>Tax included</p><p>Iced Matcha ($6 - $16.25)</p><p>with ice cubes</p>", { start: /^Tax included$/ });
  assert.deepEqual(r.items[0], { name: "Iced Matcha", price: "$6 - $16.25", note: "with ice cubes" });
  const ld = { "@type": "Menu", hasMenuSection: [{ "@type": "MenuSection", hasMenuItem: [{ "@type": "MenuItem", name: "Usucha", description: "Traditional", offers: { price: "7.5" } }] }] };
  const j = await run("jsonld", `<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  assert.deepEqual(j.items[0], { name: "Usucha", price: "$7.50", note: "Traditional" });
});

test("a template placeholder menu or a page without the menu block yields nothing", async () => {
  assert.equal(await run("nameThenPrice", "<p>This Is Your First Item</p><p>Fries $3</p>"), null);
  assert.equal(await run("nameThenPrice", "<p>Hello</p>", { start: /^Menu$/ }), null);
});

test("attachMenus matches a shop by website host, ignoring www, and removes stale menus", () => {
  assert.equal(hostOf("https://www.Example.com/a?b"), "example.com");
  const menus = { "example.com": { items: [{ name: "Latte", price: "$5", note: null }], source_url: "https://example.com/menu", read: "2026-11-23", kind: "html" } };
  const out = attachMenus([
    { id: "a", website: "http://www.example.com/", menu: { items: [] } },
    { id: "b", website: "https://other.test" },
    { id: "c", website: null, menu: { items: [{ name: "stale" }] } },
  ], menus);
  assert.equal(out[0].menu.items[0].name, "Latte");
  assert.equal(out[0].menu.source_url, "https://example.com/menu");
  assert.equal(out[1].menu, undefined);
  assert.equal(out[2].menu, undefined);
});
