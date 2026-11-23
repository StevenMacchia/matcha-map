// The storefront card (site/shopcard.js) and the ?shop= deep link (site/deeplink.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { shopCardHtml, menuSectionHtml, hoursTodayHtml, parseHours, hoursState, menuForBrand } from "../site/shopcard.js";

const SHOPS = JSON.parse(fs.readFileSync(new URL("../data/shops.json", import.meta.url), "utf8")).shops;
const MENUS = JSON.parse(fs.readFileSync(new URL("../site/data/menus.json", import.meta.url), "utf8"));
const byId = (id) => SHOPS.find((s) => s.id === id);
// Wednesday 2026-11-25 at 10:00 in Las Vegas (18:00 UTC)
const WED_10_PT = new Date("2026-11-25T18:00:00Z");

test("shopcard: parseHours reads the simple OSM forms and refuses the rest", () => {
  const w = parseHours("Mo-Fr 07:00-17:00; Sa-Su 08:00-16:00");
  assert.deepEqual(w[1], [[420, 1020]]);
  assert.deepEqual(w[0], [[480, 960]]);
  assert.deepEqual(parseHours("Sa, Su 09:00-19:30")[6], [[540, 1170]]);
  assert.deepEqual(parseHours("Mo-Fr 07:00-18:00, Sa-Su 08:00-18:00")[6], [[480, 1080]], "a comma after a time starts a rule");
  const wm = parseHours("We-Mo 10:00-21:00");
  assert.deepEqual(wm[2], []); // Tuesday closed
  assert.deepEqual(wm[1], [[600, 1260]]);
  assert.deepEqual(parseHours("12:00-22:30")[4], [[720, 1350]], "no days: every day");
  assert.deepEqual(parseHours("Fr-Sa 11:00-00:00")[5], [[660, 1440]], "closes at midnight");
  assert.deepEqual(parseHours("Mo 18:00-02:00")[1], [[1080, 1560]], "closes after midnight");
  assert.equal(parseHours("24/7")[3][0][1], 1440);
  assert.deepEqual(parseHours("Mo-Sa 10:00-17:00; Su off")[0], []);
  for (const bad of ["PH off", "Mo-Fr sunset-22:00", "Jan-Mar Mo 10:00-12:00", "Mo 10:00+", "open daily", ""]) assert.equal(parseHours(bad), null, bad);
});

test("shopcard: hours today say open or closed and when that changes", () => {
  const w = parseHours("Mo-Fr 07:00-17:00; Sa-Su 08:00-16:00");
  assert.deepEqual(hoursState(w, { day: 3, min: 600 }), { open: true, text: "Open now, until 5 pm" });
  assert.deepEqual(hoursState(w, { day: 3, min: 360 }), { open: false, text: "Closed, opens 7 am" });
  assert.deepEqual(hoursState(w, { day: 5, min: 1100 }), { open: false, text: "Closed, opens 8 am tomorrow" });
  assert.deepEqual(hoursState(parseHours("Th-Fr 07:00-16:00"), { day: 5, min: 1000 }), { open: false, text: "Closed, opens 7 am Thu" });
  assert.equal(hoursState(parseHours("Mo 18:00-02:30"), { day: 2, min: 60 }).text, "Open now, until 2:30 am", "after midnight belongs to the day before");
  assert.equal(hoursState(parseHours("Fr-Sa 11:00-00:00"), { day: 5, min: 1300 }).text, "Open now, until midnight");
  // the shop's own clock: Nana's in Las Vegas opens at 11 every day; at 10 am there it is closed
  assert.match(hoursTodayHtml(byId("osm:node/13159184974"), WED_10_PT), /Closed, opens 11 am</);
  assert.match(hoursTodayHtml(byId("osm:node/13159184974"), new Date("2026-11-25T21:00:00Z")), /Open now, until 10 pm</);
  // not parsed: shown as written under Hours; none: nothing
  const raw = hoursTodayHtml({ opening_hours: "Mo-Fr 08:00-16:00; PH off", state: "NY" }, WED_10_PT);
  assert.match(raw, /mm-shop-hlabel">Hours</);
  assert.match(raw, /Mo-Fr 08:00-16:00; PH off/);
  assert.equal(hoursTodayHtml({ opening_hours: null }), "");
  assert.equal(hoursTodayHtml({}), "");
});

test("shopcard: the menu section shows eight lines, the caveat, the link and the credit", () => {
  const nana = byId("osm:node/13159184974");
  const h = menuSectionHtml(nana.menu);
  assert.equal((h.match(/class="mm-menu-item"/g) || []).length, 8);
  assert.match(h, /66 items/);
  assert.match(h, /aria-label="First 8 of 66 menu items"/);
  assert.match(h, new RegExp(`href="${nana.menu.source_url.replace(/[.?*+()[\]\\/]/g, "\\$&")}" target="_blank" rel="noopener"`));
  assert.match(h, /See the full menu/);
  assert.match(h, /From nanasgreentealasvegas\.com, read Nov 23, 2026/);
  assert.doesNotMatch(h, /mm-menu-note/);
  const first = nana.menu.items[0];
  if (first.price) assert.ok(h.includes(first.price.replace(/&/g, "&amp;")), "price exactly as the data has it");
  const maiko = menuSectionHtml(byId("osm:node/14121437619").menu);
  assert.match(maiko, /<p class="mm-menu-note">Main menu of the Hawaii store/);
  // a price of null gets no price span; a note gets the lighter second line
  const one = menuSectionHtml({ items: [{ name: "Usucha", price: null, note: "Thin tea" }], source_url: "https://example.com/menu", read: "2026-11-01", kind: "html" });
  assert.doesNotMatch(one, /mm-menu-price/);
  assert.match(one, /mm-menu-desc">Thin tea</);
  assert.doesNotMatch(one, /items<\/span>/, "no count when every item shows");
  for (const none of [null, undefined, {}, { items: [] }, { items: [{ name: "" }] }]) assert.equal(menuSectionHtml(none), "");
});

test("shopcard: the card renders only what the shop has, in order, escaped", () => {
  const kettl = byId("osm:node/2268954021"); // no menu
  const k = shopCardHtml(kettl, { now: WED_10_PT });
  assert.match(k, /^<article class="mm-card mm-shop"/);
  assert.doesNotMatch(k, /mm-menu-sec|coming soon|Menu/i);
  assert.match(k, /mm-shop-go" href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=40\.\d+,-73\.\d+"/);
  assert.match(k, /Website<\/span>/);
  assert.match(k, /data-mm-share data-title="Kettl, matcha shop"/);
  assert.match(k, /href="\?shop=osm%3Anode%2F2268954021"/);
  assert.match(k, /OpenStreetMap/);
  const nana = shopCardHtml(byId("osm:node/13159184974"), { now: WED_10_PT });
  const at = (re) => nana.search(re);
  assert.ok(at(/mm-shop-name/) < at(/mm-shop-addr/) && at(/mm-shop-addr/) < at(/mm-shop-hours/) && at(/mm-shop-hours/) < at(/mm-shop-acts/) && at(/mm-shop-acts/) < at(/mm-menu-sec/), "name, address, hours, actions, menu");
  const bare = shopCardHtml({ id: "osm:node/1", name: "Bare", lat: 1, lng: 2 });
  assert.doesNotMatch(bare, /mm-shop-hours|mm-menu|mm-shop-addr|mm-shop-photo|Website|Instagram/);
  assert.match(shopCardHtml({ id: "osm:node/2", name: "Gram", lat: 1, lng: 2, instagram: "gram.tea" }), /instagram\.com\/gram\.tea\/"[^>]*>.*Instagram/);
  const evil = shopCardHtml({ id: "osm:node/3", name: "<img src=x onerror=alert(1)>", address: "\"><script>", lat: 1, lng: 2, website: "javascript:alert(1)", instagram: "x\" onmouseover=\"y",
    opening_hours: "<b>", menu: { items: [{ name: "<i>n</i>", price: "<p>", note: "\"q\"" }], source_url: "javascript:x", read: "2026-11-23", note: "<u>" } });
  assert.doesNotMatch(evil, /<img src=x|<script>|<i>n|<b>|<u>|<p>|javascript:|onmouseover="/);
  for (const w of ["iiawak", "u" + "wu", "etuc", "lrig"].map((x) => [...x].reverse().join(""))) assert.doesNotMatch(fs.readFileSync(new URL("../site/shopcard.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../site/shopcard.css", import.meta.url), "utf8"), new RegExp(w, "i"));
});

test("shopcard: menuForBrand matches menus.json on the website host", () => {
  assert.equal(menuForBrand({ website: "https://www.laboracafe.com/menu" }, MENUS), MENUS.menus["laboracafe.com"]);
  assert.equal(menuForBrand({ website: "http://laboracafe.com" }, MENUS.menus), MENUS.menus["laboracafe.com"]);
  assert.equal(menuForBrand({ website: "https://nobody.example" }, MENUS), null);
  assert.equal(menuForBrand({ website: "https://toString" }, MENUS), null);
  assert.equal(menuForBrand({}, MENUS), null);
  assert.equal(menuForBrand({ website: "https://laboracafe.com" }, null), null);
});

test("deeplink: ?shop=<id> takes a shops.json id and nothing else", () => {
  const ctx = { window: {}, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(new URL("../site/deeplink.js", import.meta.url), "utf8"), ctx);
  const DL = ctx.window.MatchaDeepLink;
  assert.equal(DL.parse("?shop=osm:node/13159184974").shop, "osm:node/13159184974");
  assert.equal(DL.parse("?shop=osm%3Away%2F421376676").shop, "osm:way/421376676");
  assert.equal(DL.parse("?shop=brand:labora").shop, "brand:labora");
  for (const bad of ["<x>", "osm:node/abc", "brand:", "javascript:alert(1)", ""]) assert.equal(DL.parse("?shop=" + encodeURIComponent(bad)).shop, "", bad);
  assert.equal(DL.parse("?event=abcdef123456").shop, "");
  for (const s of SHOPS) assert.equal(DL.parse("?shop=" + encodeURIComponent(s.id)).shop, s.id, "every shop in the data can be linked");
});

test("cards-app: render draws the storefront card for kind s", async () => {
  globalThis.window = {};
  globalThis.document = { documentElement: {}, addEventListener: () => {} };
  globalThis.fetch = async () => ({ ok: false, json: async () => null });
  await import("../site/cards-app.js?shop=" + Date.now());
  const h = globalThis.window.MatchaCards.render({ kind: "s", key: "s:osm:node/2268954021", data: byId("osm:node/2268954021") }, { phone: true });
  assert.match(h, /mm-card mm-shop/);
});

test("shopcard: an approved owner menu stands in when the shop has none, credited From the owner, never twice", async () => {
  const { ownerMenuFor } = await import("../site/shopcard.js");
  const owner = { items: [{ name: "Matcha Latte", price: "$6", note: null }, { name: "Usucha", price: null, note: "whisked" }], source_url: "https://example.com/menu", kind: "owner", read: "2026-11-23", note: "From the owner" };
  const ctx = { now: WED_10_PT, ownerMenus: { get: (k) => (k === "osm:node/9" ? owner : null) } };
  const html = shopCardHtml({ id: "osm:node/9", name: "Corner Tea", address: "1 Main St", city: "Reno", state: "NV", lat: 39.5, lng: -119.8 }, ctx);
  assert.match(html, /mm-menu-sec/);
  assert.match(html, /Matcha Latte/);
  assert.match(html, /From the owner, menu at example\.com, sent/);
  assert.equal((html.match(/From the owner/g) || []).length, 1, "the public read's note line is not repeated as a caveat");
  assert.doesNotMatch(shopCardHtml({ id: "osm:node/10", name: "No Menu", address: "2 Main St", city: "Reno", state: "NV", lat: 39.5, lng: -119.8 }, ctx), /mm-menu-sec/);
  assert.equal(ownerMenuFor("osm:node/9", { ownerMenus: { get: () => ({ items: [] }) } }), null, "an empty owner menu is nothing");
  assert.equal(ownerMenuFor("", ctx), null);
});

test("shopcard: image_url shows the photo with image_credit under it, escaped; neither without both", () => {
  const base = { id: "brand:web-x", name: "Leaf & Cup", lat: 1, lng: 2 };
  const h = shopCardHtml({ ...base, image_url: "https://example.com/p.png?a=1&b=2", image_credit: "Photo: Leaf & Cup <website>" });
  assert.match(h, /<figure class="mm-shop-fig"><div class="mm-shop-photo"><img src="https:\/\/example\.com\/p\.png\?a=1&amp;b=2" alt="Photo of Leaf &amp; Cup"/);
  assert.match(h, /<figcaption class="mm-shop-cap">Photo: Leaf &amp; Cup &lt;website&gt;<\/figcaption><\/figure>/);
  assert.ok(h.indexOf("mm-shop-photo") < h.indexOf("mm-shop-cap"), "the credit sits under the photo");
  for (const part of [{ image_url: "https://example.com/p.png" }, { image_credit: "Photo: Leaf website" }, { image_url: "javascript:alert(1)", image_credit: "Photo: x" }, { image_url: "https://example.com/p.png", image_credit: "  " }]) {
    assert.doesNotMatch(shopCardHtml({ ...base, ...part }), /mm-shop-photo|mm-shop-cap|Photo:/, JSON.stringify(part));
  }
  assert.match(shopCardHtml({ ...base, image_url: "http://example.com/p.png", image_credit: "Photo: x" }), /<img src="https:\/\/example\.com\/p\.png"/, "http is asked for over https (CSP)");
  const withPic = SHOPS.find((s) => s.image_url && s.image_credit);
  if (withPic) assert.ok(shopCardHtml(withPic).includes(`<figcaption class="mm-shop-cap">${withPic.image_credit.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}</figcaption>`), withPic.name);
});
