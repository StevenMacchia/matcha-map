// City pages in the approved mock's shape (qa/mocks/2026-11-23/city on lane/design-mocks2): counts line, intro, shop rows,
// brand cards, nearby, state hubs, the home footer index, and the committed pages on disk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildSite, cityCountsLine, cityIntro, hoursWords, parseOpeningHours, followersText, cityParam } from "../tools/gen-pages.js";

const cities = [
  { name: "Raleigh", state: "NC", pop: 500000, lat: 35.8, lng: -78.6, slug: "raleigh", tz: "America/New_York" },
  { name: "Cary", state: "NC", pop: 180000, lat: 35.79, lng: -78.78, slug: "cary", tz: "America/New_York" },
  { name: "Quietton", state: "NC", pop: 700, lat: 34.0, lng: -79.0, slug: "quietton", tz: "America/New_York" },
  { name: "Smallburg", state: "NC", pop: 300, lat: 34.3, lng: -79.4, slug: "smallburg", tz: "America/New_York" },
];
const NOW = new Date("2026-11-25T15:00:00Z");
let n = 0;
const ev = (o) => ({ id: "bbbbbb" + String(++n).padStart(6, "0"), brand: "Moonbee", source_id: "moonbee", handle: "moonbeematcha", start: "2026-11-28T11:00:00-05:00", end: "2026-11-28T15:00:00-05:00", tz: "America/New_York", venue: "Books & Co", address: "1 Main St", city: "Raleigh", state: "NC", lat: 35.8, lng: -78.6, status: "upcoming", ...o });
const shop = (o) => ({ id: "s", name: "Green Cup", lat: 35.81, lng: -78.61, address: "5 Oak St", city: "Raleigh", state: "NC", verified: true, ...o });
const data = (events, extra = {}) => ({ now: NOW, generated: "2026-11-25T14:00:00Z", cities, events, sources: [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", home_city: "Raleigh", home_state: "NC", kind: "popup" }], shops: [], watchlist: { accounts: [] }, ...extra });
const page = (out, p) => out.files.get(p);
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

test("the counts line: this weekend and the next 30 days, never a bare zero", () => {
  assert.equal(cityCountsLine({ wk: 2, m30: 2, ups: 2 }), "2 this weekend, 2 in the next 30 days.");
  assert.equal(cityCountsLine({ wk: 0, m30: 3, ups: 4 }), "Nothing this weekend, 3 in the next 30 days.");
  assert.equal(cityCountsLine({ wk: 0, m30: 0, ups: 2 }), "Nothing this weekend, nothing in the next 30 days. 2 pop-ups are listed after that.");
});

test("the intro paragraph matches the mock's wording and counts, shops and cafes with matcha on the menu apart", () => {
  const c = cities[0], it = (o = {}) => ({ brand: "Saikō Matcha House", e: ev(o) });
  const ups = [it({ venue: "MODE at The Village District", start: "2026-11-27T10:00:00-05:00" }), it({ start: "2026-11-28T11:00:00-05:00" })];
  assert.equal(cityIntro(c, { ups, core: 1, serves: 1, brands: 7, tz: c.tz }), "2 matcha pop-ups are listed for Raleigh, NC, from 1 brand, and 1 matcha shop and 1 cafe with matcha on its menu. 7 brands are based here. The next pop-up is Saikō Matcha House on Fri, Nov 27 at MODE at The Village District, with 1 more date after it. Dates come from each brand's own posts, so check the post before you go.");
  assert.equal(cityIntro(c, { ups: [], core: 2, serves: 0, brands: 1, tz: c.tz }), "2 matcha shops are listed within 15 miles of Raleigh, NC. 1 brand is based here.");
  assert.equal(cityIntro(c, { ups: [], core: 0, serves: 0, brands: 0, tz: c.tz }), "");
});

test("shop rows: picture or drawn art, kind, address with the town when it is not the page's city, hours or 'Hours not listed'", () => {
  const shops = [shop({ id: "a", image_url: "https://img.example/a.jpg", opening_hours: "Mo-Fr 10:00-16:00", tier: "shop" }), shop({ id: "b", name: "Corner Cafe", tier: "serves", city: "Cary", lat: 35.79, lng: -78.7, image_url: "http://insecure.example/b.jpg" })];
  const h = page(buildSite(data([], { shops })), "city/nc/raleigh/index.html");
  assert.match(h, /<h2>Matcha shops in Raleigh<\/h2>\s*<p class="pg-dim">1 matcha shop and 1 with matcha on the menu\.<\/p>/);
  const rows = [.../<ul class="pg-list pg-shops">([\s\S]*?)<\/ul>/.exec(h)[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /<img class="pg-pic" src="https:\/\/img\.example\/a\.jpg" alt="" width="56" height="56" loading="lazy"/);
  assert.match(rows[0], /<span class="pg-dim">Matcha shop<\/span><br>5 Oak St<br><span class="pg-when">Hours: Mon to Fri 10 AM to 4 PM<\/span>/);
  assert.match(rows[1], /<svg class="pg-pic pg-art"[^>]*><use href="\/characters\.svg#s-shop"\/><\/svg>/, "no https picture: drawn art");
  assert.match(rows[1], /Matcha on the menu<\/span><br>5 Oak St, Cary<br><span class="pg-when">Hours not listed<\/span>/);
  assert.equal(hoursWords(parseOpeningHours("Mo-Su 08:00-17:00")), "Every day 8 AM to 5 PM");
  assert.equal(hoursWords(parseOpeningHours("Mo-Fr 07:30-18:00; Sa,Su 09:00-15:00")), "Mon to Fri 7:30 AM to 6 PM; Sat, Sun 9 AM to 3 PM");
  assert.equal(hoursWords(parseOpeningHours("Mo off; Tu-Su 11:00-16:00")), "Mon closed; Tue to Sun 11 AM to 4 PM");
});

test("brand cards: picture or initial, followers, @handle, most followed first", () => {
  const sources = [
    { id: "a", brand: "Iris Coffee Lab", instagram: "iriscoffeelab", home_city: "Raleigh", home_state: "NC" },
    { id: "b", brand: "amato", instagram: "amatosweetlover", home_city: "Raleigh", home_state: "NC" },
    { id: "c", brand: "HabibTea", instagram: "habibtea", home_city: "Raleigh", home_state: "NC" },
  ];
  const out = buildSite(data([], { sources, brandPictures: new Map([["iriscoffeelab", "https://img.example/iris.jpg"]]), brandFollowers: new Map([["iriscoffeelab", 11000], ["amatosweetlover", 1500]]) }));
  const h = page(out, "city/nc/raleigh/index.html");
  const cards = [.../<ul class="pg-cards pg-brandr">([\s\S]*?)<\/ul>/.exec(h)[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(cards.map((c) => /<h3><a href="\/brand\/([^/]+)\/">/.exec(c)[1]), ["iriscoffeelab", "amatosweetlover", "habibtea"]);
  assert.match(cards[0], /<img class="pg-pic" src="https:\/\/img\.example\/iris\.jpg"[\s\S]*<p class="pg-dim">11k followers<\/p><a class="pg-dim" href="https:\/\/www\.instagram\.com\/iriscoffeelab\/" rel="noopener">@iriscoffeelab<\/a>/);
  assert.match(cards[1], /<span class="pg-pic pg-pic0" aria-hidden="true">A<\/span>[\s\S]*1\.5k followers/);
  assert.ok(!/followers/.test(cards[2]), "no count, no followers line");
  assert.deepEqual([805, 1500, 11000, 10950, 2400000, 0, null].map(followersText), ["805", "1.5k", "11k", "11k", "2.4M", "", ""]);
});

test("noindex rule: a city with nothing within 40 miles keeps Nearby and the calls to action; every indexed page carries local content or Nearby", () => {
  const out = buildSite(data([ev({})]));
  const q = page(out, "city/nc/quietton/index.html");
  assert.match(q, /<meta name="robots" content="noindex,follow">/);
  assert.ok(!page(out, "sitemap.xml").includes("/city/nc/quietton/"));
  for (const need of ['class="pg-near"', 'href="/alerts/?city=quietton-nc"', 'href="/add/?city=quietton-nc"', 'class="pg-report"']) assert.ok(q.includes(need), need);
  const r = page(out, "city/nc/raleigh/index.html"), c = page(out, "city/nc/cary/index.html");
  for (const h of [r, c]) assert.ok(!/name="robots"/.test(h) && h.includes('class="pg-near"'));
  assert.match(c, /Pop-ups within 40 miles/, "Cary is indexed on a pop-up within 40 miles, and shows it");
  for (const [p, h] of out.files) if (p.startsWith("city/") && !/name="robots"/.test(h)) assert.ok(/class="pg-ev"|pg-shops|pg-brandr|pg-nearh/.test(h), p + " is indexed with nothing local");
});

test("state hubs: Home crumb, every city linked, cities with nothing listed biggest first", () => {
  const out = buildSite(data([ev({})]));
  const h = page(out, "state/nc/index.html");
  assert.match(h, /<nav class="pg-crumb" aria-label="Breadcrumb"><a href="\/">Home<\/a> <span aria-hidden="true">›<\/span> <span>NC<\/span><\/nav>/);
  assert.match(h, /<body class="pg pg-wide">/);
  const rest = /<h2>Every other city in North Carolina<\/h2>([\s\S]*?)<\/section>/.exec(h)[1];
  assert.deepEqual([...rest.matchAll(/href="\/city\/nc\/([^/]+)\/"/g)].map((m) => m[1]), ["cary", "quietton", "smallburg"]);
});

test("no banned words and no inline handlers in the generated city and state pages", () => {
  const out = buildSite(data([ev({})], { shops: [shop({})] }));
  for (const [p, h] of out.files) {
    if (!/^(city|state)\//.test(p)) continue;
    assert.ok(!/\b(kawaii|uwu|cute|cutesy|girly)\b/i.test(text(h)), p);
    assert.ok(!/\son[a-z]+=/i.test(h) && !/javascript:/i.test(h), p);
    assert.ok(!/<script(?![^>]*(type="application\/ld\+json"|src=))/.test(h), p + ": only JSON-LD and external scripts");
  }
});

test("the committed pages: an indexable dense page and a noindex page out of the sitemap", () => {
  const read = (p) => fs.readFileSync(new URL("../site/" + p, import.meta.url), "utf8");
  const sm = read("sitemap.xml");
  const r = read("city/nc/raleigh/index.html");
  assert.ok(!/name="robots"/.test(r) && sm.includes("/city/nc/raleigh/"));
  assert.match(r, /<p class="pg-lead">/);
  assert.match(r, /class="pg-ctas"/);
  assert.match(r, /"@type":"FAQPage"/);
  let noindex = 0;
  for (const st of fs.readdirSync(new URL("../site/city/", import.meta.url))) for (const c of fs.readdirSync(new URL(`../site/city/${st}/`, import.meta.url))) {
    const h = read(`city/${st}/${c}/index.html`);
    if (!/name="robots" content="noindex,follow"/.test(h)) continue;
    noindex++;
    assert.ok(!sm.includes(`/city/${st}/${c}/`), `${st}/${c} is noindex and in the sitemap`);
  }
  assert.ok(noindex > 0);
});

test("add.js: ?city= from a city page fills the add form as 'City, ST' and the alerts picker with any listed city", () => {
  const src = fs.readFileSync(new URL("../site/add/add.js", import.meta.url), "utf8");
  const mk = (tag, name, attrs = {}) => {
    const el = { tagName: tag, name, type: tag === "SELECT" ? "select-one" : "text", value: "", options: [], children: [], attrs,
      hasAttribute(a) { return a in this.attrs; }, appendChild(o) { this.options.push(o); }, insertBefore(o) { this.options.splice(1, 0, o); },
      querySelector(sel) { const m = /value="([^"]*)"/.exec(sel); return this.options.find((o) => o.value === m[1]) || null; } };
    if (tag === "SELECT") Object.defineProperty(el, "value", { get() { return this._v || ""; }, set(v) { this._v = this.options.some((o) => o.value === v) ? v : ""; } });
    return el;
  };
  const run = (field, search) => {
    const form = { id: field.tagName === "SELECT" ? "alerts-form" : "add-form", elements: { city: field }, querySelector: (s) => (s.startsWith("select") && field.tagName === "SELECT" ? field : s.includes("submit") ? {} : null), addEventListener() {} };
    const ctx = { window: { CITY_LIST: [["New York", "NY", 0, 0, 9], ["Washington", "DC", 0, 0, 8], ["Winston-Salem", "NC", 0, 0, 1]] }, document: { querySelector: () => form, getElementById: () => null, createElement: () => ({}) }, location: { search }, URLSearchParams, Date };
    ctx.window.CITY_LIST.slice = function (a, b) { return Array.prototype.slice.call(this, a, b === 120 ? 2 : b); }; // only the first two count as "top" here
    vm.runInNewContext(src, ctx);
    return field;
  };
  assert.equal(run(mk("INPUT", "city"), "?city=winston-salem-nc").value, "Winston-Salem, NC");
  assert.equal(run(mk("INPUT", "city"), "?city=fort-worth-tx").value, "Fort Worth, TX", "a slug not in the list still reads as a city");
  assert.equal(run(mk("INPUT", "city"), "?city=Austin%2C%20TX").value, "Austin, TX", "typed text is left alone");
  const sel = run(mk("SELECT", "city", { "data-cities": "" }), "?city=winston-salem-nc");
  assert.equal(sel.value, "winston-salem-nc", "a city past the top list is added and chosen");
  assert.equal(run(mk("SELECT", "city", { "data-cities": "" }), "?city=washington-dc").value, "washington-dc");
  assert.equal(cityParam({ slug: "winston-salem", state: "NC" }), "winston-salem-nc");
});
