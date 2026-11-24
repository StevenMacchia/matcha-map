// Rung 33: the static city and brand pages, their JSON-LD, the sitemap, the size guard and the app's query-string parser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildSite, eventLd, weekendKeys, timeText, dayKey, patchIndex, homeHead, LIMITS, isUpcoming, cityIndexable, parseOpeningHours, openingHoursSpec, hoursText, shopLd, loadCities, citiesBlock, CITIES_START, CITIES_END, NEARBY_KM, km as kmBetween, cityParam } from "../tools/gen-pages.js";
import { weekendWindow, inWindow } from "../tools/gen-weekend.js";
import { slugOf } from "../tools/gen-cities.js";
import { SITE_URL } from "../tools/site-url.js";

const cities = [
  { name: "Raleigh", state: "NC", pop: 500000, lat: 35.8, lng: -78.6, slug: "raleigh", tz: "America/New_York" },
  { name: "Cary", state: "NC", pop: 180000, lat: 35.79, lng: -78.78, slug: "cary", tz: "America/New_York" },
  { name: "Tinyville", state: "NC", pop: 900, lat: 36.9, lng: -80.1, slug: "tinyville", tz: "America/New_York" },
  { name: "Shopburg", state: "NC", pop: 800, lat: 35.2, lng: -80.8, slug: "shopburg", tz: "America/New_York" },
  { name: "Quietton", state: "NC", pop: 700, lat: 34.0, lng: -79.0, slug: "quietton", tz: "America/New_York" },
];
// 2026-11-25 is a Wednesday; the weekend is Nov 28 and 29.
const NOW = new Date("2026-11-25T15:00:00Z");
let n = 0;
const ev = (o) => ({ id: "aaaaaa" + String(++n).padStart(6, "0"), brand: "Moonbee", source_id: "moonbee", handle: "moonbeematcha", title: "Moonbee pop-up", start: "2026-11-28T11:00:00-05:00", end: "2026-11-28T15:00:00-05:00", tz: "America/New_York", all_day: false, venue: "Books & Co", address: "1 Main St", city: "Raleigh", state: "NC", lat: 35.8, lng: -78.6, approx: false, confidence: "likely", status: "upcoming", menu: ["strawberry matcha"], posts: { instagram: "https://www.instagram.com/p/XYZ/" }, ...o });
const data = (events, extra = {}) => ({
  now: NOW, generated: "2026-11-25T14:00:00Z", cities, events,
  sources: [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", home_city: "Tinyville", home_state: "NC", kind: "popup", website: "https://moonbee.example" }],
  shops: [{ id: "s1", name: "Green Cup", lat: 35.21, lng: -80.8, address: "5 Oak St", verified: true, website: "https://green.example" }, { id: "s2", name: "Unverified", lat: 34.0, lng: -79.0, verified: false }],
  watchlist: { accounts: [{ handle: "namedacct", name: "Named Acct", status: "watching", platform: "instagram" }, { handle: "noname", status: "watching" }, { handle: "gone", name: "Gone", status: "dropped" }] },
  ...extra,
});
const page = (out, p) => out.files.get(p);
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));

test("city selection: every listed city gets a page; the index rule decides which are indexed", () => {
  const out = buildSite(data([ev({}), ev({ city: "Cary", lat: 35.79, lng: -78.78 })]));
  const keys = [...out.files.keys()].filter((k) => k.startsWith("city/"));
  for (const c of cities) assert.ok(keys.includes(`city/nc/${c.slug}/index.html`), c.name);
  assert.equal(out.counts.cities, cities.length);
  const many = Array.from({ length: 130 }, (_, i) => ({ name: "C" + i, state: "TX", pop: 1000 - i, lat: 30 + i * 0.5, lng: -100, slug: "c" + i, tz: "America/Chicago" }));
  const o2 = buildSite({ ...data([]), cities: many, shops: [], sources: [], watchlist: { accounts: [] } });
  assert.equal(o2.counts.cities, 130, "no events, no shops: still a page each");
  assert.equal(o2.counts.indexable, 0);
  assert.equal(o2.counts.noindex, 130);
});

test("loadCities: data/cities.json plus the brand home cities site/cities.js carries beyond it", () => {
  const all = loadCities(fileURLToPath(new URL("..", import.meta.url)));
  const base = JSON.parse(fs.readFileSync(new URL("../data/cities.json", import.meta.url), "utf8")).cities;
  assert.ok(all.length > base.length, "extras added");
  assert.ok(all.some((c) => c.name === "Brooklyn" && c.state === "NY" && c.extra && c.slug === "brooklyn" && c.tz));
  assert.equal(new Set(all.map((c) => c.state + "/" + c.slug)).size, all.length, "no slug twice in a state");
});

test("cityIndexable: a pop-up, a pop-up within 40 miles, a verified shop or a brand each index a page; nothing does not", () => {
  assert.deepEqual(cityIndexable({ ups: 1 }), { indexable: true, reasons: ["popup"] });
  assert.deepEqual(cityIndexable({ nearby: [1] }), { indexable: true, reasons: ["nearby"] });
  assert.deepEqual(cityIndexable({ shops: 2 }), { indexable: true, reasons: ["shop"] });
  assert.deepEqual(cityIndexable({ brands: [{}] }), { indexable: true, reasons: ["brand"] });
  assert.deepEqual(cityIndexable({ ups: [], nearby: [], shops: 0, brands: 0 }), { indexable: false, reasons: [] });
  assert.deepEqual(cityIndexable(), { indexable: false, reasons: [] });
});

test("noindex pages: robots meta, out of the sitemap, still a full page; indexable pages carry no robots meta", () => {
  const apex = { name: "Apex", state: "NC", pop: 60000, lat: 35.73, lng: -78.85, slug: "apex", tz: "America/New_York" };
  const out = buildSite(data([ev({}), ev({ city: "Cary", lat: 35.79, lng: -78.78 })], { cities: [...cities, apex] }));
  const sm = page(out, "sitemap.xml");
  const robots = (p) => /<meta name="robots" content="noindex,follow">/.test(page(out, p));
  assert.ok(!robots("city/nc/raleigh/index.html"), "its own pop-up");
  assert.ok(!robots("city/nc/apex/index.html"), "a pop-up within 40 miles");
  assert.ok(!robots("city/nc/shopburg/index.html"), "a verified shop within 25 km");
  assert.ok(!robots("city/nc/tinyville/index.html"), "a brand based there");
  assert.ok(robots("city/nc/quietton/index.html"), "nothing near");
  assert.ok(sm.includes("/city/nc/apex/") && sm.includes("/city/nc/shopburg/") && sm.includes("/city/nc/tinyville/"));
  assert.ok(!sm.includes("/city/nc/quietton/"));
  const q = page(out, "city/nc/quietton/index.html");
  for (const need of ["<h1>Matcha pop-ups in Quietton, NC: this weekend and upcoming</h1>", "pg-faq", 'href="/alerts/?city=quietton-nc"', 'href="/add/?city=quietton-nc"', "<h2>Nearest cities</h2>", 'href="/state/nc/"', 'href="/?city=quietton-nc"', "Seen a pop-up we missed?"]) assert.ok(q.includes(need), need);
  assert.ok(!q.includes('"FAQPage"'), "a noindex page shows the questions without the FAQPage block");
  assert.ok(Buffer.byteLength(q) < 6 * 1024, "thin pages stay under 6 KB: " + Buffer.byteLength(q));
  assert.equal(out.counts.indexable + out.counts.noindex, out.counts.cities);
});

test("an event in a suburb that is not listed lands on the nearest listed city within 25 km", () => {
  const out = buildSite(data([ev({ city: "Morrisville", lat: 35.82, lng: -78.82 })]));
  assert.match(page(out, "city/nc/cary/index.html"), /Moonbee/);
});

test("upcoming pop-ups are cards with a day pill in the event's own time zone; the weekend and 30-day counts lead", () => {
  const out = buildSite(data([ev({}), ev({ title: "Later", start: "2026-12-05T10:00:00-05:00", end: "2026-12-05T12:00:00-05:00" }), ev({ start: "2026-11-28T18:00:00-05:00", end: null })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<h1>Matcha pop-ups in Raleigh, NC: this weekend and upcoming<\/h1>/);
  assert.match(h, /<p class="pg-lead">2 this weekend, 3 in the next 30 days\. <a href="\/weekend\/raleigh-nc\/">See this weekend<\/a><\/p>/);
  const pills = [...h.matchAll(/<span class="pg-day2">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(pills, ["Sat, Nov 28", "Sat, Nov 28", "Sat, Dec 5"]);
  assert.match(h, /<p class="pg-when">11 AM to 3 PM<\/p>/);
  assert.match(h, /<p class="pg-where">Books &amp; Co · 1 Main St<\/p>/);
  assert.match(h, /<h3><a href="\/brand\/moonbeematcha\/">Moonbee<\/a><\/h3>/);
  assert.match(h, /<a href="\/e\/aaaaaa\d{6}\/">Details<\/a><a class="pg-btn" href="\/\?event=aaaaaa\d{6}">See on the map<\/a>/);
  assert.deepEqual(weekendKeys("2026-11-25"), ["2026-11-28", "2026-11-29"]);
  assert.deepEqual(weekendKeys("2026-11-29"), ["2026-11-28", "2026-11-29"]);
  assert.equal(dayKey(Date.parse("2026-11-29T03:00:00Z"), "America/Los_Angeles"), "2026-11-28");
});

test("approximate events say the place is not posted and never print an address", () => {
  const out = buildSite(data([ev({ approx: true, venue: "", address: "", geocode_source: "none", confidence: "unsure" })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /Place not posted yet/);
  assert.match(h, /not confirmed/);
  const ld = ldOf(h).find((x) => x["@type"] === "Event");
  assert.equal(ld.location.name, "Raleigh, NC");
  assert.equal(ld.location.address.streetAddress, undefined);
});

test("an empty city says so honestly and still links the map", () => {
  const out = buildSite(data([]));
  const h = page(out, "city/nc/quietton/index.html");
  assert.match(h, /<p class="pg-lead">No matcha pop-up is listed within 40 miles of Quietton right now\. No matcha shop is listed either\.<\/p>/);
  assert.match(h, /href="\/\?city=quietton-nc"/);
  assert.match(h, /<h2>Nearest cities<\/h2>/);
  assert.ok(!/\b0 (matcha|upcoming|pop-up|shop|brand|cit)/.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), "zero never prints as a number in prose");
  const near = buildSite(data([ev({})]));
  assert.match(page(near, "city/nc/tinyville/index.html"), /No matcha pop-up is listed within 40 miles of Tinyville/);
  const cary = buildSite(data([ev({})], { cities: [...cities, { name: "Apex", state: "NC", pop: 60000, lat: 35.73, lng: -78.85, slug: "apex", tz: "America/New_York" }] }));
  assert.match(page(cary, "city/nc/apex/index.html"), /<p class="pg-lead">No matcha pop-up is listed in Apex right now\. The nearest is in Raleigh, NC, \d+ miles? away \(Moonbee, Sat, Nov 28\)\./);
});

test("Event JSON-LD carries schema.org's required fields (name, startDate, location) and the rest of what we know", () => {
  const out = buildSite(data([ev({ image: { local: "img/events/x.jpg" } })]));
  const docs = ldOf(page(out, "city/nc/raleigh/index.html"));
  const crumb = docs.find((x) => x["@type"] === "BreadcrumbList");
  assert.equal(crumb.itemListElement.length, 3);
  assert.deepEqual(crumb.itemListElement.map((x) => x.name), ["Matcha Map", "North Carolina", "Raleigh, NC"]);
  assert.equal(crumb.itemListElement[1].item, SITE_URL + "/state/nc/");
  const e = docs.find((x) => x["@type"] === "Event");
  assert.equal(e["@context"], "https://schema.org");
  assert.ok(e.name && e.startDate && e.location);
  assert.equal(e.location["@type"], "Place");
  assert.ok(e.location.name && e.location.address.addressRegion === "NC");
  assert.match(e.startDate, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/, "offset kept");
  assert.equal(e.endDate, "2026-11-28T15:00:00-05:00");
  assert.equal(e.eventStatus, "https://schema.org/EventScheduled");
  assert.equal(e.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
  assert.equal(e.organizer.url, "https://www.instagram.com/moonbeematcha/");
  assert.match(e.image[0], /^https:\/\/.+\/img\/events\/x\.jpg$/);
  assert.equal(e.offers, undefined);
  const allDay = eventLd(ev({ all_day: true, start: "2026-11-28T00:00:00-05:00", end: null }), { brand: "Moonbee" });
  assert.equal(allDay.startDate, "2026-11-28");
});

test("markup in data is escaped, past and cancelled events are left off, the CSP is strict", () => {
  const out = buildSite(data([ev({ brand: "<script>x</script>", title: "<b>t</b>" }), ev({ start: "2026-11-01T11:00:00-05:00", end: "2026-11-01T15:00:00-05:00" }), ev({ status: "cancelled" })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.ok(!h.includes("<script>x"));
  assert.match(h, /Content-Security-Policy" content="default-src 'none'; script-src 'self' https:\/\/static\.cloudflareinsights\.com;/);
  assert.equal(isUpcoming(ev({ status: "cancelled" }), NOW.getTime()), false);
  assert.equal((h.match(/class="pg-ev"/g) || []).length, 1);
  assert.equal(timeText(ev({ start: "2026-11-28T00:00:00-05:00", end: null }), "America/New_York"), "Time not posted");
});

test("brand pages: sources and named watch-list accounts, past events kept, no handle-less or dropped accounts", () => {
  const out = buildSite(data([ev({}), ev({ start: "2026-10-01T11:00:00-04:00", end: "2026-10-01T15:00:00-04:00", title: "Old one" })]));
  const b = page(out, "brand/moonbeematcha/index.html");
  assert.match(b, /<h1>Moonbee<\/h1>/);
  assert.match(b, /Past pop-ups kept on file/);
  assert.match(b, /Old one/);
  assert.match(b, /href="\/\?brand=moonbeematcha"/);
  assert.ok(page(out, "brand/namedacct/index.html"));
  assert.ok(!page(out, "brand/noname/index.html"));
  assert.ok(!page(out, "brand/gone/index.html"));
});

test("sitemap lists the home page, every city and brand page, with lastmod from the data; robots allows all", () => {
  const out = buildSite(data([ev({})]));
  const sm = page(out, "sitemap.xml");
  const locs = [...sm.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs[0], SITE_URL + "/");
  assert.equal(locs.length, out.counts.indexable + out.counts.brands + out.counts.states + 2, "home, indexable cities, brands, state hubs and the /state/ index");
  assert.ok(locs.includes(SITE_URL + "/city/nc/raleigh/"));
  assert.ok(locs.includes(SITE_URL + "/brand/moonbeematcha/"));
  assert.match(sm, /<lastmod>2026-11-25<\/lastmod>/);
  assert.equal(page(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

test("size guard: thin brand pages go first near a limit, and an over-limit set throws", () => {
  const d = data([ev({})], { sources: [], watchlist: { accounts: [{ handle: "thin", name: "Thin", status: "watching" }] } });
  const base = buildSite(d);
  assert.ok(base.files.has("brand/thin/index.html"));
  const o = buildSite({ ...d, limits: { files: base.files.size + 3, bytes: 50 * 1024 * 1024 } });
  assert.ok(!o.files.has("brand/thin/index.html"), "dropped near the limit");
  assert.throws(() => buildSite({ ...d, limits: { files: 3, bytes: 1e9 } }), /too large/);
  assert.equal(LIMITS.files, 20000);
});

test("the home head: canonical, Open Graph, Twitter card, WebSite SearchAction with ?q=; patching is idempotent", () => {
  const head = homeHead();
  assert.match(head, /<title>Matcha Map: matcha pop-ups across America, by day<\/title>/);
  const desc = /name="description" content="([^"]*)"/.exec(head)[1];
  assert.ok(desc.length < 155, `${desc.length}`);
  assert.ok(head.includes(`rel="canonical" href="${SITE_URL}/"`));
  assert.ok(head.includes(`og:image" content="${SITE_URL}/og.png"`));
  assert.match(head, /twitter:card" content="summary_large_image"/);
  const ld = ldOf(head)[0];
  assert.equal(ld["@type"], "WebSite");
  assert.equal(ld.potentialAction["@type"], "SearchAction");
  assert.match(ld.potentialAction.target.urlTemplate, /\?q=\{search_term_string\}$/);
  const once = patchIndex('<head><title>Matcha Map</title>\n<meta name="description" content="x"></head>');
  assert.equal(patchIndex(once), once);
});

// the app's query string
const DL = (() => { const ctx = { window: {}, URLSearchParams }; vm.runInNewContext(fs.readFileSync(new URL("../site/deeplink.js", import.meta.url), "utf8"), ctx); return ctx.window.MatchaDeepLink; })();
test("deep links: ?q, ?city, ?event and ?brand parse and reject junk", () => {
  const { plan, ...rest } = DL.parse("?q=Raleigh%2C%20NC"); // plan is tested in social.test.js (vm arrays are not deep-equal to ours)
  assert.deepEqual(rest, { q: "Raleigh, NC", city: "", event: "", shop: "", brand: "" });
  assert.equal(plan.length, 0);
  assert.equal(DL.parse("?city=Raleigh-NC").city, "raleigh-nc");
  assert.equal(DL.parse("?event=06792c4f00f5").event, "06792c4f00f5");
  assert.equal(DL.parse("?event=../../x").event, "");
  assert.equal(DL.parse("?brand=@MoonBee").brand, "moonbee");
  assert.equal(DL.parse("").q, "");
});
test("deep links: city slugs resolve to the biggest listed city, DC included, and match the pages' slugs", () => {
  const list = [["Washington", "DC", 38.9, -77, 700000], ["Raleigh", "NC", 35.8, -78.6, 500000], ["St. Louis", "MO", 38.6, -90.2, 300000], ["Raleigh", "WV", 37.7, -81.2, 3000]];
  assert.equal(DL.findCityBySlug(list, "raleigh-nc")[1], "NC");
  assert.equal(DL.findCityBySlug(list, "washington-dc")[0], "Washington");
  assert.equal(DL.findCityBySlug(list, "st-louis-mo")[0], "St. Louis");
  assert.equal(DL.findCityBySlug(list, "nowhere-nc"), null);
  const all = JSON.parse(fs.readFileSync(new URL("../data/cities.json", import.meta.url), "utf8")).cities;
  for (const c of all) if (c.state !== "DC") assert.equal(slugOf(c.name), c.slug, c.name);
});

// ---- SEO rung 1: JSON-LD shape ----
const ISO = /^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\d([+-]\d\d:\d\d|Z))?$/;
function checkShape(node, where) {
  const walk = (v, p) => {
    assert.ok(v !== undefined, `${where}: undefined at ${p}`);
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${where}: NaN at ${p}`);
    if (typeof v === "string") assert.ok(!/undefined|NaN|\[object/.test(v), `${where}: bad text at ${p}: ${v}`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p + "." + k);
  };
  walk(node, "$");
  if (node["@type"] === "Event") {
    for (const k of ["name", "startDate", "location", "eventStatus", "eventAttendanceMode", "organizer"]) assert.ok(node[k], `${where}: Event.${k}`);
    assert.match(node.startDate, ISO);
    if (node.endDate) assert.match(node.endDate, ISO);
    assert.ok(node.location.name && node.location.address, `${where}: location`);
  }
  if (node["@type"] === "Organization") assert.ok(node.name && /^https?:\/\//.test(node.url), `${where}: Organization`);
}

test("Event JSON-LD: postal code, geo, free offers only when the data says free, cancelled status, approx stays city-level", () => {
  const e = eventLd(ev({ zip: "27601", price: "Free entry" }), { brand: "Moonbee", insta: "https://www.instagram.com/moonbeematcha/" });
  assert.equal(e.location.address.postalCode, "27601");
  assert.deepEqual(e.location.geo, { "@type": "GeoCoordinates", latitude: 35.8, longitude: -78.6 });
  assert.equal(e.offers.price, "0");
  assert.equal(e.offers.availability, "https://schema.org/InStock");
  assert.equal(eventLd(ev({ price: "$15" }), { brand: "M" }).offers, undefined, "no invented prices");
  assert.equal(eventLd(ev({ price: null }), { brand: "M" }).offers, undefined);
  assert.equal(eventLd(ev({ status: "cancelled" }), { brand: "M" }).eventStatus, "https://schema.org/EventCancelled");
  const ap = eventLd(ev({ approx: true, venue: "", address: "", zip: "27601", geocode_source: "none" }), { brand: "M" });
  assert.equal(ap.location.geo, undefined);
  assert.equal(ap.location.address.postalCode, undefined);
  assert.equal(ap.location.address.streetAddress, undefined);
});

test("city pages carry an ItemList of upcoming events; brand pages carry an Organization; every block is well formed", () => {
  const out = buildSite(data([ev({}), ev({ start: "2026-12-05T10:00:00-05:00", end: null, price: "free" })], { brandPictures: new Map([["moonbeematcha", "https://img.example/m.jpg"]]) }));
  const c = ldOf(page(out, "city/nc/raleigh/index.html"));
  const list = c.find((x) => x["@type"] === "ItemList");
  assert.equal(list.numberOfItems, 2);
  assert.equal(list.itemListElement[0].item["@type"], "Event");
  assert.equal(list.itemListElement[0].url, undefined, "Google: a ListItem has url or item, not both");
  assert.match(list.itemListElement[0].item.image, /^https:\/\//);
  assert.match(list.itemListElement[0].item.url, /^https:\/\/.+\/e\/aaaaaa\d{6}\/$/);
  assert.equal(list.itemListElement[0].item.location.address.addressLocality, "Raleigh");
  const b = ldOf(page(out, "brand/moonbeematcha/index.html"));
  const org = b.find((x) => x["@type"] === "Organization");
  assert.equal(org.url, SITE_URL + "/brand/moonbeematcha/");
  assert.ok(org.sameAs.includes("https://www.instagram.com/moonbeematcha/") && org.sameAs.includes("https://moonbee.example"));
  assert.equal(org.logo, "https://img.example/m.jpg");
  for (const [p, html] of out.files) if (p.endsWith(".html")) for (const n of ldOf(html)) checkShape(n, p);
});

test("the committed pages' JSON-LD is well formed (no undefined, NaN, bad dates)", async () => {
  const dir = new URL("../site/e/", import.meta.url);
  let n = 0;
  for (const d of fs.readdirSync(dir).slice(0, 400)) {
    const f = new URL(`${d}/index.html`, dir);
    if (!fs.existsSync(f)) continue;
    for (const node of ldOf(fs.readFileSync(f, "utf8"))) { checkShape(node, d); n++; }
  }
  assert.ok(n > 0);
});

// ---- SEO rung 2: titles and copy ----
test("city, event and brand titles; the city intro and description come from the data; empty cities keep the honest copy", () => {
  const out = buildSite(data([ev({}), ev({ brand: "Other Cup", handle: "othercup", source_id: "other", start: "2026-12-05T10:00:00-05:00", end: null }), ev({ brand: "Third", handle: "third", source_id: "third", start: "2026-12-06T10:00:00-05:00", end: null })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<title>Matcha pop-ups in Raleigh, NC: this weekend and upcoming<\/title>/);
  const desc = /name="description" content="([^"]*)"/.exec(h)[1];
  assert.equal(desc, "3 matcha pop-ups in Raleigh, NC, next on Sat, Nov 28: Moonbee. Times and places.");
  assert.ok(desc.length <= 158);
  assert.match(h, /<p class="pg-intro">3 matcha pop-ups are listed for Raleigh, NC, from 3 brands\. The next pop-up is Moonbee on Sat, Nov 28 at Books &amp; Co, with 2 more dates after it\. Dates come from each brand&#39;s own posts/);
  const q = page(out, "city/nc/quietton/index.html");
  assert.match(q, /<title>Matcha pop-ups in Quietton, NC: this weekend and upcoming<\/title>/, "the title is stable for empty cities");
  assert.ok(!/pg-intro/.test(q));
  assert.ok(/name="description" content="([^"]*)"/.exec(q)[1].length <= 158);
  assert.match(page(out, "brand/moonbeematcha/index.html"), /<title>Moonbee matcha pop-ups: dates and places<\/title>/);
});

// ---- SEO rung 3: sitemap lastmod, canonical, social tags ----
test("sitemap lastmod is per page: the newest day its events were seen, never after the data date", () => {
  const out = buildSite(data([ev({ last_seen: "2026-11-20T10:00:00Z" }), ev({ last_seen: "2026-11-22T10:00:00Z" }), ev({ city: "Cary", lat: 35.79, lng: -78.78, last_seen: "2027-01-01T00:00:00Z" })]));
  const sm = page(out, "sitemap.xml");
  const lm = (p) => new RegExp("<loc>[^<]*" + p + "</loc><lastmod>([^<]*)</lastmod>").exec(sm)[1];
  assert.equal(lm("/city/nc/raleigh/"), "2026-11-22");
  assert.equal(lm("/brand/moonbeematcha/"), "2026-11-22", "a future date is ignored");
  assert.equal(lm("/city/nc/tinyville/"), "2026-11-25", "no events: the data date");
  assert.ok(!sm.includes("<url><loc>") || [...sm.matchAll(/<url>(.*?)<\/url>/g)].every((m) => m[1].includes("<lastmod>")));
});

test("every committed generated page has a canonical, Open Graph and Twitter tags with an absolute image and matching title and description", () => {
  const site = new URL("../site/", import.meta.url);
  const files = [];
  const walk = (d) => { for (const x of fs.readdirSync(d, { withFileTypes: true })) { const p = new URL(x.name + (x.isDirectory() ? "/" : ""), d); if (x.isDirectory()) walk(p); else if (x.name === "index.html") files.push(p); } };
  for (const dir of ["city/", "brand/", "e/", "weekend/"]) { const d = new URL(dir, site); if (fs.existsSync(d)) walk(d); }
  assert.ok(files.length > 10);
  const get = (h, re) => { const m = re.exec(h); return m ? m[1] : null; };
  for (const f of files.slice(0, 1500)) {
    const h = fs.readFileSync(f, "utf8");
    const where = f.pathname.slice(-40);
    const canon = get(h, /<link rel="canonical" href="([^"]*)"/);
    assert.match(canon || "", /^https:[/][/]/, where + " canonical");
    const t = get(h, /<meta property="og:title" content="([^"]*)"/), d = get(h, /<meta property="og:description" content="([^"]*)"/);
    assert.ok(t && d, where + " og text");
    assert.equal(get(h, /<meta name="twitter:title" content="([^"]*)"/), t, where);
    assert.equal(get(h, /<meta name="twitter:description" content="([^"]*)"/), d, where);
    assert.equal(get(h, /<meta name="description" content="([^"]*)"/), d, where + " description");
    const oi = get(h, /<meta property="og:image" content="([^"]*)"/);
    assert.match(oi || "", /^https:[/][/]/, where + " og:image absolute");
    assert.equal(get(h, /<meta name="twitter:image" content="([^"]*)"/), oi, where);
    assert.equal(get(h, /<meta name="twitter:card" content="([^"]*)"/), "summary_large_image", where);
  }
});

test("robots allows everything and names the sitemap", () => {
  const r = fs.readFileSync(new URL("../site/robots.txt", import.meta.url), "utf8");
  assert.match(r, /User-agent: [*]/);
  assert.doesNotMatch(r, /Disallow: *[^ \r\n]/);
  assert.match(r, /Sitemap: https:[/][/][^ \r\n]+[/]sitemap[.]xml/);
});

test("timeText: a zero-length or backwards range shows one time, an all-day event says all day", () => {
  const tz = "America/New_York";
  assert.equal(timeText(ev({ start: "2026-12-14T11:00:00-05:00", end: "2026-12-14T11:00:00-05:00" }), tz), "11 AM");
  assert.equal(timeText(ev({ start: "2026-12-14T11:00:00-05:00", end: "2026-12-14T10:00:00-05:00" }), tz), "11 AM");
  assert.equal(timeText(ev({ start: "2026-12-14T11:00:00-05:00", end: "2026-12-14T14:30:00-05:00" }), tz), "11 AM–2:30 PM");
  assert.equal(timeText(ev({ start: "2026-12-14T09:00:00-05:00", end: "2026-12-14T11:00:00-05:00", all_day: true }), tz), "All day");
  const same = ev({ start: "2026-12-14T11:00:00-05:00", end: "2026-12-14T11:00:00-05:00" });
  const h = page(buildSite(data([same])), "e/" + same.id + "/index.html");
  assert.ok(!/\b11–11\b/.test(h));
});

// ---- SEO city pages (docs/SEO-CITY-PAGES.md) ----
const un = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const shopRow = (o) => ({ id: "s", name: "Green Cup", lat: 35.81, lng: -78.61, address: "5 Oak St", city: "Raleigh", state: "NC", zip: "27601", verified: true, website: "https://green.example", instagram: "greencup", opening_hours: "Mo-Fr 08:00-17:00; Sa 09:00-15:00", ...o });

test("parseOpeningHours: the plain OSM forms parse; everything else is text only", () => {
  const r = parseOpeningHours("Mo-Fr 08:00-17:00; Sa 09:00-15:00");
  assert.deepEqual(r, [{ days: [0, 1, 2, 3, 4], times: [["08:00", "17:00"]] }, { days: [5], times: [["09:00", "15:00"]] }]);
  assert.deepEqual(parseOpeningHours("Su,Mo,We 12:00-20:00; Fr,Sa 12:00-21:00").map((x) => x.days), [[6, 0, 2], [4, 5]]);
  assert.deepEqual(parseOpeningHours("Sa-Mo 10:00-18:00")[0].days, [5, 6, 0], "a range may wrap the week");
  assert.deepEqual(parseOpeningHours("Mo-Su 07:30-12:00,13:00-24:00")[0].times, [["07:30", "12:00"], ["13:00", "24:00"]]);
  assert.deepEqual(parseOpeningHours("Mo off; Tu-Su 11:30-16:00"), [{ days: [0], times: [] }, { days: [1, 2, 3, 4, 5, 6], times: [["11:30", "16:00"]] }]);
  assert.ok(parseOpeningHours("Mo-Fr 08:00-17:00;"), "a trailing semicolon is fine");
  for (const bad of ["24/7", "", null, undefined, 5, "Mo-Fr 8am-5pm", "08:00-17:00", "Mo-Fr 08:00-17:00; PH off", "Mo-Fr 22:00-02:00", "Mo-Su 08:00-17:00; Sa 09:00-15:00", "Jan-Mar Mo-Fr 08:00-17:00", "Mo-Fr 08:00-17:00 open", "Mo-Fr sunrise-sunset", "Xx 08:00-17:00", "Mo 25:00-26:00", "Mo 09:00-09:00"]) assert.equal(parseOpeningHours(bad), null, String(bad));
  const spec = openingHoursSpec(parseOpeningHours("Mo-Tu 08:00-17:00; Fr 09:00-24:00; We off"));
  assert.deepEqual(spec[0], { "@type": "OpeningHoursSpecification", dayOfWeek: ["https://schema.org/Monday", "https://schema.org/Tuesday"], opens: "08:00", closes: "17:00" });
  assert.equal(spec.length, 2, "an off day gets no spec");
  assert.equal(spec[1].closes, "23:59");
  assert.equal(hoursText(parseOpeningHours("Mo-Fr 08:00-17:00; Sa 09:00-15:30; Su off")), "Mon-Fri 8 AM-5 PM; Sat 9 AM-3:30 PM; Sun closed");
});

test("shop JSON-LD: CafeOrCoffeeShop only for verified shops with an address, hours schema only when they parse, never a rating", () => {
  const shops = [shopRow({ id: "a" }), shopRow({ id: "b", name: "Odd Hours", opening_hours: "Mo-Fr 08:00-17:00; PH off", instagram: "", website: "" }), shopRow({ id: "c", name: "No Address", address: "" }), shopRow({ id: "d", name: "Unverified", verified: false }), shopRow({ id: "e", name: "Rated", rating: 4.8, review_count: 12, stars: 5 })];
  const out = buildSite(data([ev({})], { shops }));
  const h = page(out, "city/nc/raleigh/index.html");
  const ld = ldOf(h).filter((x) => x["@type"] === "CafeOrCoffeeShop");
  assert.deepEqual(ld.map((x) => x.name).sort(), ["Green Cup", "Odd Hours", "Rated"]);
  const g = ld.find((x) => x.name === "Green Cup");
  assert.equal(g["@context"], "https://schema.org");
  assert.deepEqual(g.address, { "@type": "PostalAddress", streetAddress: "5 Oak St", addressLocality: "Raleigh", addressRegion: "NC", addressCountry: "US", postalCode: "27601" });
  assert.deepEqual(g.geo, { "@type": "GeoCoordinates", latitude: 35.81, longitude: -78.61 });
  assert.equal(g.url, "https://green.example");
  assert.deepEqual(g.sameAs, ["https://www.instagram.com/greencup/"]);
  assert.equal(g.openingHoursSpecification.length, 2);
  const odd = ld.find((x) => x.name === "Odd Hours");
  assert.equal(odd.openingHoursSpecification, undefined, "unparseable hours: text only");
  assert.equal(odd.url, undefined);
  assert.equal(odd.sameAs, undefined);
  assert.match(h, /Hours: Mon to Fri 8 AM to 5 PM; Sat 9 AM to 3 PM/);
  assert.match(h, /Hours: Mo-Fr 08:00-17:00; PH off/, "the raw text is printed when it does not parse");
  assert.match(h, /<h2>Matcha shops in Raleigh<\/h2>/);
  assert.ok(!/rating|review|aggregateRating|yelp/i.test(JSON.stringify(ld)), "no rating or review field");
  assert.equal(shopLd(shopRow({ verified: false })), null);
  assert.equal(shopLd(shopRow({ address: "" })), null);
});

test("intro numbers equal the counted lists, and zero never reads as '0'", () => {
  const out = buildSite(data([ev({}), ev({ start: "2026-12-05T10:00:00-05:00", end: null }), ev({ start: "2026-12-06T10:00:00-05:00", end: null })], { shops: [shopRow({ id: "a" }), shopRow({ id: "b", name: "Second", lat: 35.82 })], sources: [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", home_city: "Raleigh", home_state: "NC", kind: "popup" }] }));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<p class="pg-lead">1 this weekend, 3 in the next 30 days\./);
  assert.match(h, /<p class="pg-intro">3 matcha pop-ups are listed for Raleigh, NC, from 1 brand, and 2 matcha shops\. 1 brand is based here\. The next pop-up is Moonbee on Sat, Nov 28 at Books &amp; Co, with 2 more dates after it\./);
  assert.equal((h.match(/class="pg-ev"/g) || []).length, 3);
  assert.match(h, /<p class="pg-dim">2 matcha shops\.<\/p>/);
  assert.equal((/<ul class="pg-list pg-shops">([\s\S]*?)<\/ul>/.exec(h)[1].match(/<li>/g) || []).length, 2);
  assert.ok(h.includes("<h2>Brands based in Raleigh</h2>"));
  const only = page(buildSite(data([ev({})])), "city/nc/raleigh/index.html");
  assert.match(only, /<p class="pg-lead">1 this weekend, 1 in the next 30 days\./);
  assert.match(only, /<p class="pg-intro">1 matcha pop-up is listed for Raleigh, NC, from 1 brand\. The next pop-up is Moonbee on Sat, Nov 28 at Books &amp; Co\. Dates/);
});

test("this weekend: the lead counts it and links the weekend page, only when the window has a pop-up", () => {
  const h = page(buildSite(data([ev({}), ev({ start: "2026-12-05T10:00:00-05:00", end: null })])), "city/nc/raleigh/index.html");
  assert.match(h, /<p class="pg-lead">1 this weekend, 2 in the next 30 days\. <a href="\/weekend\/raleigh-nc\/">See this weekend<\/a><\/p>/);
  const later = page(buildSite(data([ev({ start: "2026-12-05T10:00:00-05:00", end: null })])), "city/nc/raleigh/index.html");
  assert.match(later, /<p class="pg-lead">Nothing this weekend, 1 in the next 30 days\.<\/p>/);
  assert.ok(!later.includes("/weekend/raleigh-nc/"));
  const far = page(buildSite(data([ev({ start: "2027-02-05T10:00:00-05:00", end: null })])), "city/nc/raleigh/index.html");
  assert.match(far, /<p class="pg-lead">Nothing this weekend, nothing in the next 30 days\. 1 pop-up is listed after that\.<\/p>/);
  // the window rule is one function, shared with gen-weekend
  const win = weekendWindow(NOW.getTime(), "America/New_York");
  assert.deepEqual(win.keys, ["2026-11-27", "2026-11-28", "2026-11-29"]);
  assert.ok(inWindow(ev({}), win.keys, "America/New_York"));
});

test("Nearby: pop-ups outside the city's own list within 64 km, nearest first, at most 12, with city and miles", () => {
  assert.equal(NEARBY_KM, 64);
  const apex = { name: "Apex", state: "NC", pop: 60000, lat: 35.73, lng: -78.85, slug: "apex", tz: "America/New_York" };
  const far = ev({ city: "Tinyville", lat: 36.9, lng: -80.1, title: "Far away" });
  const near = ev({ city: "Cary", lat: 35.79, lng: -78.78, title: "In Cary", brand: "Cary Cup", source_id: "cary", handle: "carycup" });
  const out = buildSite(data([ev({}), near, far], { cities: [...cities, apex] }));
  const nearList = (h) => { const m = /<h3 class="pg-nearh">Pop-ups within 40 miles<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/.exec(h); return m ? m[1] : ""; };
  const sect = nearList(page(out, "city/nc/apex/index.html"));
  const rows = [...sect.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2, "Raleigh's and Cary's pop-ups, not the one 170 km away");
  assert.match(rows[0], /Cary Cup[\s\S]*Cary, NC · \d+ miles?[\s\S]*href="\/e\/aaaaaa/);
  assert.match(rows[1], /Moonbee[\s\S]*Raleigh, NC/);
  assert.ok(!sect.includes("Far away") && !sect.includes("Tinyville"));
  // the city's own pop-ups are not repeated in its Nearby section
  const nr = nearList(page(out, "city/nc/raleigh/index.html"));
  assert.ok(nr.includes("Cary Cup") && !nr.includes("Moonbee"), "own pop-ups stay out of Nearby");
  // distance cut and the cap of 12
  const crowd = Array.from({ length: 15 }, (_, i) => ev({ city: "Cary", lat: 35.79 + i * 0.01, lng: -78.78, title: "n" + i }));
  const big = nearList(page(buildSite(data(crowd, { cities: [...cities, apex] })), "city/nc/apex/index.html"));
  assert.equal((big.match(/<li>/g) || []).length, 12);
  const km1 = kmBetween(apex, { lat: 35.79, lng: -78.78 });
  assert.ok(km1 > 0 && km1 < NEARBY_KM);
});

test("Nearby within 40 miles: up to three nearest cities with their own count, how many lie within reach, the state hub", () => {
  const apex = { name: "Apex", state: "NC", pop: 60000, lat: 35.73, lng: -78.85, slug: "apex", tz: "America/New_York" };
  const holly = { name: "Holly Springs", state: "NC", pop: 40000, lat: 35.65, lng: -78.83, slug: "holly-springs", tz: "America/New_York" };
  const garner = { name: "Garner", state: "NC", pop: 30000, lat: 35.71, lng: -78.61, slug: "garner", tz: "America/New_York" };
  const out = buildSite(data([ev({}), ev({ city: "Cary", lat: 35.79, lng: -78.78 })], { cities: [...cities, apex, holly, garner] }));
  const sect = (h) => /<section class="pg-near">([\s\S]*?)<\/section>/.exec(h)[1];
  const r = sect(page(out, "city/nc/raleigh/index.html"));
  assert.match(r, /^<h2>Nearby within 40 miles<\/h2>/);
  const chips = [...r.matchAll(/<li><a href="(\/city\/[^"]+)">([^<]+)<\/a> <span class="pg-dim">([^<]+)<\/span><\/li>/g)].map((m) => [m[1], m[3]]);
  assert.equal(chips.length, 3);
  assert.deepEqual(chips.map((c) => c[0]), ["/city/nc/garner/", "/city/nc/cary/", "/city/nc/apex/"], "nearest first");
  assert.match(chips[1][1], /^\d+ mi · 1 pop-up$/);
  assert.match(chips[0][1], /^\d+ mi · nothing listed yet$/);
  assert.match(r, /4 cities in the data lie within 40 miles of Raleigh; three are shown here\. <a href="\/state\/nc\/">All of North Carolina<\/a>/);
  assert.ok(!r.includes("/city/nc/raleigh/"), "never itself");
  // nothing within reach: the nearest three, said plainly
  const q = sect(page(out, "city/nc/quietton/index.html"));
  assert.match(q, /^<h2>Nearest cities<\/h2>/);
  assert.equal((q.match(/<li><a href="\/city\//g) || []).length, 3);
  assert.match(q, /No other city in the data lies within 40 miles of Quietton; the nearest are shown\./);
  // every city page links its state hub twice: the breadcrumb and the Updated line
  const h = page(out, "city/nc/tinyville/index.html");
  assert.match(h, /<nav class="pg-crumb" aria-label="Breadcrumb"><a href="\/">Home<\/a> <span aria-hidden="true">›<\/span> <a href="\/state\/nc\/">NC<\/a> <span aria-hidden="true">›<\/span> <span>Tinyville<\/span><\/nav>/);
  assert.match(h, /<p class="pg-sub">Updated Nov 25, 2026\. State page: <a href="\/state\/nc\/">All of North Carolina<\/a><\/p>/);
});

test("FAQ: three questions answered from the data, open on the page, FAQPage JSON-LD with the same text on indexed pages", () => {
  for (const events of [[ev({})], [ev({ start: "2026-12-05T10:00:00-05:00", end: null })], [ev({}), ev({ venue: "Park", address: "2 Elm St", start: "2026-12-05T10:00:00-05:00", end: null }), ev({ start: "2026-12-06T10:00:00-05:00", end: null })]]) {
    const out = buildSite(data(events));
    for (const slug of ["raleigh", "cary", "quietton"]) {
      const h = page(out, `city/nc/${slug}/index.html`);
      const items = [...h.matchAll(/<details open><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map((m) => [un(m[1]), un(m[2])]);
      assert.equal(items.length, 3);
      const city = slug.charAt(0).toUpperCase() + slug.slice(1);
      assert.deepEqual(items.map((x) => x[0]), [`When is the next matcha pop-up in ${city}?`, `Where do matcha pop-ups happen in ${city}?`, `How do I get alerts for new pop-ups in ${city}?`]);
      const faq = ldOf(h).find((x) => x["@type"] === "FAQPage");
      if (slug === "quietton") { assert.equal(faq, undefined, "noindex: no FAQPage block"); continue; }
      assert.deepEqual(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), items);
      assert.ok(faq.mainEntity.every((q) => q["@type"] === "Question" && q.acceptedAnswer["@type"] === "Answer"));
    }
  }
  const ans = (out, slug) => ldOf(page(out, `city/nc/${slug}/index.html`)).find((x) => x["@type"] === "FAQPage").mainEntity.map((q) => q.acceptedAnswer.text);
  const one = ans(buildSite(data([ev({})])), "raleigh");
  assert.equal(one[0], "Moonbee is next, on Saturday, Nov 28, 11 AM to 3 PM at Books & Co, 1 Main St.");
  assert.equal(one[1], "The listed date is at Books & Co (1 Main St).");
  assert.match(one[2], /^Choose Get alerts, pick Raleigh and give your email\./);
  const three = ans(buildSite(data([ev({}), ev({ venue: "Park", address: "2 Elm St", start: "2026-12-05T10:00:00-05:00", end: null }), ev({ start: "2026-12-06T10:00:00-05:00", end: null })])), "raleigh");
  assert.match(three[0], /^Moonbee is next, on Saturday, Nov 28, 11 AM to 3 PM at Books & Co, 1 Main St\. After it: Moonbee on Saturday, Dec 5, 10 AM at Park, and 1 more date on this page\.$/);
  assert.equal(three[1], "The listed dates are at Books & Co (1 Main St) and Park (2 Elm St).");
  const near = ans(buildSite(data([ev({})])), "cary");
  assert.match(near[0], /^Nothing is listed in Cary yet\. The nearest is Moonbee in Raleigh, NC, \d+ miles? away, on Saturday, Nov 28\.$/);
  const shops = ans(buildSite(data([], { shops: [shopRow({ id: "a" }), shopRow({ id: "b", name: "Second", lat: 35.82 })] })), "raleigh");
  assert.equal(shops[1], "No pop-up is listed in Raleigh right now. For matcha any day, the shops on this page: Green Cup and Second.");
  const loose = ans(buildSite(data([ev({ approx: true, venue: "", address: "", geocode_source: "none" })])), "raleigh");
  assert.match(loose[0], /The place is not posted yet\.$/);
  assert.equal(loose[1], "None of the listed dates in Raleigh has a place posted yet.");
});

test("calls to action: alerts, add and the map for the city (slug-st), and the missed-pop-up box", () => {
  const h = page(buildSite(data([ev({})])), "city/nc/raleigh/index.html");
  assert.match(h, /<div class="pg-ctas"><a class="pg-btn pri" href="\/alerts\/\?city=raleigh-nc">Get alerts<\/a><a class="pg-btn" href="\/add\/\?city=raleigh-nc">Add your pop-up<\/a><a class="pg-btn" href="\/\?city=raleigh-nc">Open Raleigh on the map<\/a><\/div>/);
  assert.match(h, /<div class="pg-report"><strong>Seen a pop-up we missed\?<\/strong> <a class="pg-btn" href="\/add\/\?city=raleigh-nc">Report a pop-up we missed<\/a><\/div>/);
  assert.equal(cityParam({ slug: "washington-dc", state: "DC" }), "washington-dc", "DC's slug already carries its state");
  assert.equal(cityParam({ slug: "st-louis", state: "MO" }), "st-louis-mo");
});

test("state hubs: every city of the state in three lists, breadcrumb Home > State, index rule, /state/ index", () => {
  const tx = [{ name: "Austin", state: "TX", pop: 900000, lat: 30.27, lng: -97.74, slug: "austin", tz: "America/Chicago" }];
  const out = buildSite(data([ev({}), ev({ city: "Cary", lat: 35.79, lng: -78.78 })], { cities: [...cities, ...tx], shops: [shopRow({ id: "a", lat: 35.2, lng: -80.8, city: "Shopburg" })] }));
  const h = page(out, "state/nc/index.html");
  assert.match(h, /<title>Matcha pop-ups in North Carolina: cities, this weekend and upcoming<\/title>/);
  assert.match(h, /<h1>Matcha pop-ups in North Carolina<\/h1>/);
  assert.match(h, /<p class="pg-lead">2 upcoming matcha pop-ups in North Carolina, across 2 cities\. 1 matcha shop is listed too\.<\/p>/);
  for (const c of cities) assert.ok(h.includes(`href="/city/nc/${c.slug}/"`), c.name);
  assert.ok(!h.includes("/city/tx/austin/"));
  assert.match(h, /<h2>Cities with upcoming pop-ups<\/h2>[\s\S]*Raleigh<\/a> <span class="pg-dim">1 · next Sat Nov 28/);
  assert.match(h, /<h2>Cities with matcha shops<\/h2>[\s\S]*Shopburg/);
  assert.match(h, /<h2>Every other city in North Carolina<\/h2>[\s\S]*Quietton/);
  const crumb = ldOf(h).find((x) => x["@type"] === "BreadcrumbList");
  assert.deepEqual(crumb.itemListElement.map((x) => x.name), ["Matcha Map", "North Carolina"]);
  assert.ok(!/name="robots"/.test(h));
  const t = page(out, "state/tx/index.html");
  assert.match(t, /name="robots" content="noindex,follow"/, "no pop-up and no shop in the state");
  assert.match(t, /href="\/city\/tx\/austin\/"/);
  const sm = page(out, "sitemap.xml");
  assert.ok(sm.includes(SITE_URL + "/state/nc/") && !sm.includes("/state/tx/") && sm.includes(SITE_URL + "/state/</loc>"));
  assert.ok(page(out, "state/index.html").includes('href="/state/tx/"'));
  assert.equal(out.counts.states, 2);
});

test("lastmod moves only when a page's body does (hash kept in data/pages-lastmod.json, not in the app's pages.json)", () => {
  const d1 = data([ev({ last_seen: "2026-11-20T10:00:00Z" })]);
  const a = buildSite(d1);
  const prev = a.lastmods;
  assert.ok(prev["city/nc/raleigh"] && prev["city/nc/raleigh"][0].length === 12 && prev["city/nc/raleigh"][1] === "2026-11-20");
  assert.ok(JSON.parse(page(a, "data/pages.json")).cities.length && !("lm" in JSON.parse(page(a, "data/pages.json"))), "the app's city list stays and carries no lm");
  const lmOf = (o, p) => new RegExp("<loc>[^<]*" + p + "</loc><lastmod>([^<]*)</lastmod>").exec(page(o, "sitemap.xml"))[1];
  // same data a day later: the "updated" date differs, the body does not, so lastmod holds
  const later = buildSite({ ...d1, generated: "2026-11-26T09:00:00Z", prevPages: prev });
  assert.equal(lmOf(later, "/city/nc/raleigh/"), "2026-11-20");
  assert.equal(lmOf(later, "/city/nc/tinyville/"), "2026-11-25", "a page with no events keeps its first date, not today's");
  assert.deepEqual(later.lastmods["city/nc/raleigh"], prev["city/nc/raleigh"]);
  // a new pop-up changes the body and moves lastmod to its day
  const moved = buildSite({ ...d1, generated: "2026-11-26T09:00:00Z", events: [...d1.events, ev({ title: "New one", last_seen: "2026-11-26T08:00:00Z" })], prevPages: prev });
  assert.equal(lmOf(moved, "/city/nc/raleigh/"), "2026-11-26");
  assert.equal(moved.lastmods["city/nc/quietton"][1], "2026-11-26", "a neighbour's count in Nearby changed its body, so it moves too");
  // without a previous hash the page takes the computed day
  assert.equal(lmOf(buildSite(d1), "/city/nc/raleigh/"), "2026-11-20");
});

test("home page: the cities marker is filled with the 50 biggest cities and every state hub; no markers, no change", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: "City" + i, state: i % 2 ? "TX" : "NC", pop: 1000 - i, lat: 30, lng: -100, slug: "city" + i, tz: "America/Chicago" })).concat([{ name: "Brooklyn", state: "NY", pop: 0, extra: true, lat: 40, lng: -74, slug: "brooklyn", tz: "America/New_York" }]);
  const html = `<head><title>x</title>\n<meta name="description" content="y"></head><body>${CITIES_START}\nold\n${CITIES_END}</body>`;
  const out = patchIndex(html, many);
  assert.equal((out.match(/<li><a href="\/city\/(tx|nc)\/city\d+\/"/g) || []).length, 50);
  assert.ok(out.includes('href="/city/nc/city0/"') && !out.includes("city50/") && !out.includes("brooklyn") && !out.includes("old"));
  assert.deepEqual([...out.matchAll(/<li><a href="(\/state\/[a-z]*\/?)"/g)].map((m) => m[1]), ["/state/ny/", "/state/nc/", "/state/tx/", "/state/"], "state hubs by name, then the index");
  assert.equal(patchIndex(out, many), out, "idempotent");
  const none = '<head><title>x</title>\n<meta name="description" content="y"></head><body>nothing</body>';
  assert.ok(!patchIndex(none, many).includes('class="hix"'));
  assert.equal(citiesBlock(many, 3).match(/<li><a href="\/city\//g).length, 3);
});

// ---- city page shape approved from the mock (2026-11-23) ----
test("shops are grouped by tier as it appears in the rows, rows without a tier last under Other; hours and schema stay", () => {
  const shops = [shopRow({ id: "a", tier: "shop" }), shopRow({ id: "b", name: "Plain Row", lat: 35.82 }), shopRow({ id: "c", name: "Cafe Row", tier: "cafe", lat: 35.83 })];
  const h = page(buildSite(data([ev({})], { shops })), "city/nc/raleigh/index.html");
  const sect = /<h2>Matcha cafes and shops in Raleigh<\/h2>([\s\S]*?)<\/section>/.exec(h)[1];
  assert.deepEqual([...sect.matchAll(/<h3 class="pg-day">(.*?)<\/h3>/g)].map((m) => m[1]), ["Cafe", "Shop", "Other"]);
  assert.match(sect, /Cafe<\/h3>[\s\S]*Cafe Row[\s\S]*Shop<\/h3>[\s\S]*Green Cup[\s\S]*Other<\/h3>[\s\S]*Plain Row/);
  assert.match(sect, /Hours: Mon-Fri 8 AM-5 PM/);
  assert.equal(ldOf(h).filter((x) => x["@type"] === "CafeOrCoffeeShop").length, 3);
});

test("brands based in the city show their picture and followers when known, nothing when not", () => {
  const sources = [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", home_city: "Raleigh", home_state: "NC", kind: "popup" }, { id: "bare", brand: "Bare Brand", instagram: "barebrand", home_city: "Raleigh", home_state: "NC", kind: "popup" }];
  const watchlist = { accounts: [{ handle: "moonbeematcha", name: "Moonbee", status: "watching", platform: "instagram", followers_count: 12400, profile_picture_url: "https://img.example/wl.jpg" }] };
  const h = page(buildSite(data([], { sources, watchlist, brandPictures: new Map([["moonbeematcha", "https://img.example/m.jpg"]]) })), "city/nc/raleigh/index.html");
  const li = (n) => new RegExp("<li>[^\\n]*" + n + "[^\\n]*</li>").exec(h)[0];
  assert.match(li("Moonbee"), /<img src="https:\/\/img\.example\/m\.jpg" alt="" width="32" height="32" loading="lazy">/);
  assert.match(li("Moonbee"), /12\.4k followers/);
  assert.ok(!/<img|followers/.test(li("Bare Brand")));
  const wl = page(buildSite(data([], { sources, watchlist })), "city/nc/raleigh/index.html");
  assert.match(wl, /<img src="https:\/\/img\.example\/wl\.jpg"/, "the watch-list avatar when the brand has no picture");
});

test("Nearby stays with a line when nothing is within 40 miles; the disclaimer sits under Upcoming and on empty cities; report link", () => {
  const out = buildSite(data([ev({})]));
  const q = page(out, "city/nc/quietton/index.html");
  assert.match(q, /<h2>Pop-ups near Quietton<\/h2><p>Nothing listed yet within 40 miles\.<\/p>/);
  const disc = "Dates come from each brand's own posts, so check the post before you go.";
  assert.equal(q.split(disc).length - 1, 1, "once on an empty city");
  assert.match(q, new RegExp("pg-lead[\\s\\S]*" + disc.replace(/[.']/g, "\\$&")));
  const r = page(out, "city/nc/raleigh/index.html");
  assert.match(r, /<h2>Upcoming pop-ups<\/h2>\s*<p class="pg-dim">Dates come from each brand's own posts, so check the post before you go\.<\/p>/);
  assert.equal(r.split(disc).length - 1, 1, "once, under Upcoming");
  for (const p of [r, q]) assert.match(p, /<a class="pg-btn" href="\/add\/\?city=raleigh-nc|<a class="pg-btn" href="\/add\/\?city=quietton-nc">Report a pop-up we missed<\/a>/);
  assert.match(r, /href="\/add\/\?city=raleigh-nc">Report a pop-up we missed<\/a>/);
  assert.ok(Buffer.byteLength(q) < 6 * 1024);
});
