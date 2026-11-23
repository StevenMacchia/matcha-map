// The "Matcha on the menu" tier (shops.json rows with tier "serves"): the card, the list row, the Show switch and the
// Shops heading's count words. The switch and the words live inside app.js's closure, so the test runs that one block
// of app.js in a sandbox with a stand-in localStorage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { shopCardHtml, servesMenu } from "../site/shopcard.js";

const APP = fs.readFileSync(new URL("../site/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const HTML = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const SERVES = {
  id: "brand:web-leaf-house-nc-raleigh-1-main-st-abc123", name: "Leaf House", tier: "serves", address: "1 Main St", city: "Raleigh", state: "NC", lat: 35.78, lng: -78.64,
  website: "https://leafhouse.example", menu_url: "https://www.leafhouse.example/menu#drinks",
  menu_matcha: [{ name: "Matcha Latte", price: "$6.50" }, { name: "Iced <Matcha>", price: null }, { name: "Matcha Tonic", price: "$7" }],
  note: "Coffee bar with a short matcha list & a patio", image_url: null, image_credit: null,
};

function block() {
  const a = APP.indexOf("  // Storefronts switch"), b = APP.indexOf("  // ---------- what counts");
  assert.ok(a > 0 && b > a, "the switch block is where the test expects it");
  return APP.slice(a, b);
}
function run(saved) {
  const store = { ...saved };
  const ctx = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    state: { shops: [{ serves: false, name: "A" }, { serves: true, name: "B" }, { serves: false, name: "C" }] },
  };
  vm.runInNewContext(block() + "\nthis.out = { visible: visibleShops, words: shopsWords, on: function () { return [shopsOn, servesOn]; }, keys: [SHOPS_KEY, SERVES_KEY] };", ctx);
  const o = ctx.out; // arrays from the sandbox, copied into this realm so deepEqual compares values
  return { words: o.words, keys: [...o.keys], on: () => [...o.on()], visible: () => [...o.visible()] };
}

test("serves: the card says Cafe and Matcha on the menu, never the core Matcha shop kind", () => {
  const h = shopCardHtml(SERVES);
  assert.doesNotMatch(h, /Matcha shop/);
  assert.match(h, /<div class="mm-shop-kinds"><p class="mm-shop-kind">Cafe<\/p><p class="mm-shop-sv">Matcha on the menu<\/p><\/div>/);
  assert.match(h, /data-title="Leaf House, matcha on the menu"/);
  assert.match(h, /<p class="mm-shop-addr">1 Main St, Raleigh, NC<\/p><p class="mm-shop-note">Coffee bar with a short matcha list &amp; a patio<\/p>/);
  // the core shop keeps its kind and gets no serves line
  const core = shopCardHtml({ ...SERVES, tier: "shop", note: null });
  assert.match(core, /mm-shop-kind">Matcha shop</);
  assert.doesNotMatch(core, /mm-shop-sv|mm-shop-note|Matcha on the menu/);
  assert.doesNotMatch(shopCardHtml({ ...SERVES, tier: undefined }), /Matcha on the menu/, "no tier is a core shop");
});

test("serves: the Menu section reads menu_matcha as written, links menu_url, credits its host", () => {
  const h = shopCardHtml(SERVES);
  assert.equal((h.match(/class="mm-menu-item"/g) || []).length, 3);
  assert.match(h, /<span class="mm-menu-name">Matcha Latte<\/span><span class="mm-menu-price">\$6\.50<\/span>/);
  assert.match(h, /<span class="mm-menu-name">Iced &lt;Matcha&gt;<\/span><\/li>/, "a null price gets no price slot");
  assert.match(h, /<a class="mm-menu-full" href="https:\/\/www\.leafhouse\.example\/menu#drinks" target="_blank" rel="noopener"><span>See the full menu<\/span>/);
  assert.match(h, /<p class="mm-menu-credit">From leafhouse\.example<\/p>/);
  // the shop's own menu object wins, and an owner menu too
  const own = shopCardHtml({ ...SERVES, menu: { items: [{ name: "House Usucha", price: "$5" }], source_url: "https://other.example/m", read: "2026-11-01" } });
  assert.match(own, /House Usucha/);
  assert.doesNotMatch(own, /Matcha Tonic|From leafhouse/);
  const owner = shopCardHtml(SERVES, { ownerMenus: { get: () => ({ items: [{ name: "Owner Matcha", price: "$6" }], source_url: "https://owner.example/m" }) } });
  assert.match(owner, /Owner Matcha/);
  assert.doesNotMatch(owner, /Matcha Tonic/);
  // nothing to show, no section; a bad menu_url, no link and no credit
  assert.equal(servesMenu({ ...SERVES, menu_matcha: [] }), null);
  assert.equal(servesMenu({ ...SERVES, menu_matcha: [{ name: "" }] }), null);
  const bad = shopCardHtml({ ...SERVES, menu_url: "javascript:alert(1)" });
  assert.doesNotMatch(bad, /mm-menu-full|mm-menu-credit|javascript:/);
});

test("serves: every serves row in the site data renders without the core kind", () => {
  const SHOPS = JSON.parse(fs.readFileSync(new URL("../site/data/shops.json", import.meta.url), "utf8")).shops;
  const sv = SHOPS.filter((s) => s.tier === "serves");
  if (!sv.length) return; // the site layer holds none until the Population lane flips SHOPS_SERVES on
  for (const s of sv) {
    const h = shopCardHtml(s);
    assert.doesNotMatch(h, /Matcha shop/, s.name);
    assert.match(h, /Matcha on the menu/, s.name);
    if (Array.isArray(s.menu_matcha) && s.menu_matcha.length && !s.menu) assert.match(h, /mm-menu-sec/, s.name);
  }
});

test("serves: the list row says Matcha on the menu where the row shows its kind, and the pin gets the lighter class", () => {
  assert.match(APP, /<span class=\\"kindword\\">" \+ \(it\.serves \? "Matcha on the menu" : "Shop"\) \+ "<\/span>/);
  assert.match(APP, /"mk-sh" \+ \(it\.serves \? " mk-sv" : ""\)/);
  assert.match(APP, /serves: s\.tier === "serves"/);
  assert.match(APP, /\(s\.tier === "serves" \? "Matcha on the menu" : "Matcha shop"\)/, "the built-in card too");
  const css = fs.readFileSync(new URL("../site/style.css", import.meta.url), "utf8");
  assert.match(css, /\.mk-sv \.m-o, \.mk-sv \.m-l \{ stroke: var\(--sv-o\); stroke-width: 1\.4; \}/);
});

test("serves: the Show switch sits under Storefronts, is on by default and is saved on its own key", () => {
  const i = HTML.indexOf('id="show-shops"'), j = HTML.indexOf('id="show-serves"');
  assert.ok(i > 0 && j > i, "under the Storefronts switch");
  assert.match(HTML, /<label class="sw"><input type="checkbox" id="show-serves" role="switch"><span>Matcha on the menu<\/span><\/label>/);
  const fresh = run({});
  assert.deepEqual(fresh.keys, ["matchamap.shops", "matchamap.serves"]);
  assert.deepEqual(fresh.on(), [true, true], "both on by default");
  assert.equal(fresh.visible().length, 3);
  const off = run({ "matchamap.serves": "0" });
  assert.deepEqual(off.on(), [true, false]);
  assert.deepEqual(off.visible().map((x) => x.name), ["A", "C"], "serves pins and rows go");
  assert.deepEqual(run({ "matchamap.shops": "0" }).visible().map((x) => x.name), ["B"], "Storefronts off leaves the serves shops");
  assert.deepEqual(run({ "matchamap.shops": "0", "matchamap.serves": "0" }).visible().length, 0);
  assert.deepEqual(run({ "matchamap.serves": "1" }).on(), [true, true]);
  // the change handler writes it, Reset turns it back on, and the badge counts it
  assert.match(APP, /if \(t\.id === "show-serves"\) \{ servesOn = t\.checked; try \{ localStorage\.setItem\(SERVES_KEY, servesOn \? "1" : "0"\); \}/);
  assert.match(APP, /shopsOn = true; servesOn = true;/);
  assert.match(APP, /localStorage\.setItem\(SERVES_KEY, "1"\)/);
  assert.match(APP, /\(servesOn \? 0 : 1\)/);
  assert.match(APP, /\$\("show-serves"\)\.checked = servesOn;/);
});

test("serves: the Shops heading counts both kinds in plain words", () => {
  const w = run({}).words;
  const S = (n, sv) => Array.from({ length: n }, (_, k) => ({ serves: k < sv }));
  assert.equal(w(S(5, 2)), "3 matcha shops · 2 with matcha on the menu");
  assert.equal(w(S(2, 1)), "1 matcha shop · 1 with matcha on the menu");
  assert.equal(w(S(4, 0)), "4 matcha shops");
  assert.equal(w(S(1, 0)), "1 matcha shop");
  assert.equal(w(S(3, 3)), "3 with matcha on the menu");
  assert.equal(w([]), "");
  assert.match(APP, /headHTML\(shopsWords\(shopsIn\), 0, "shophead"\)/);
  for (const bad of ["iiawak", "u" + "wu", "etuc", "lrig"].map((x) => [...x].reverse().join(""))) assert.doesNotMatch(block() + HTML, new RegExp("\\b" + bad, "i"));
});
