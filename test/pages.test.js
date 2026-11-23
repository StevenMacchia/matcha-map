// Rung 33: the static city and brand pages, their JSON-LD, the sitemap, the size guard and the app's query-string parser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildSite, eventLd, weekendKeys, timeText, dayKey, patchIndex, homeHead, LIMITS, isUpcoming } from "../tools/gen-pages.js";
import { slugOf } from "../tools/gen-cities.js";

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

test("city selection: events, a brand's upcoming pop-up, a verified shop within 25 km, and the top 100 by population", () => {
  const out = buildSite(data([ev({}), ev({ city: "Cary", lat: 35.79, lng: -78.78 })]));
  const keys = [...out.files.keys()].filter((k) => k.startsWith("city/"));
  assert.ok(keys.includes("city/nc/raleigh/index.html"));
  assert.ok(keys.includes("city/nc/cary/index.html"));
  assert.ok(keys.includes("city/nc/shopburg/index.html"), "verified shop within 25 km");
  assert.ok(keys.includes("city/nc/tinyville/index.html"), "home city of a brand with a pop-up coming");
  assert.ok(keys.includes("city/nc/quietton/index.html"), "top 100 by population still gets a page");
  const many = Array.from({ length: 130 }, (_, i) => ({ name: "C" + i, state: "TX", pop: 1000 - i, lat: 30 + i * 0.5, lng: -100, slug: "c" + i, tz: "America/Chicago" }));
  const o2 = buildSite({ ...data([]), cities: many, shops: [], sources: [], watchlist: { accounts: [] } });
  assert.equal(o2.counts.cities, 100, "no events, no shops: only the top 100");
});

test("an event in a suburb that is not listed lands on the nearest listed city within 25 km", () => {
  const out = buildSite(data([ev({ city: "Morrisville", lat: 35.82, lng: -78.82 })]));
  assert.match(page(out, "city/nc/cary/index.html"), /Moonbee/);
});

test("events are grouped by day in the event's own time zone, with the weekend count in the lead", () => {
  const out = buildSite(data([ev({}), ev({ title: "Later", start: "2026-12-05T10:00:00-05:00", end: "2026-12-05T12:00:00-05:00" }), ev({ start: "2026-11-28T18:00:00-05:00", end: null })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<h1>Matcha pop-ups in Raleigh, NC<\/h1>/);
  assert.match(h, /2 this weekend, 3 in the next 30 days\./);
  assert.equal((h.match(/class="pg-day"/g) || []).length, 2);
  assert.ok(h.indexOf("Saturday, Nov 28") < h.indexOf("Saturday, Dec 5"));
  assert.match(h, /11 AM\u20133 PM/);
  assert.match(h, /href="\/\?event=/);
  assert.match(h, /href="https:\/\/www\.instagram\.com\/p\/XYZ\/"/);
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
  assert.match(h, /No matcha pop-ups are posted for Quietton right now/);
  assert.match(h, /href="\/\?city=quietton-nc"/);
  assert.match(h, /Nearby cities/);
});

test("Event JSON-LD carries schema.org's required fields (name, startDate, location) and the rest of what we know", () => {
  const out = buildSite(data([ev({ image: { local: "img/events/x.jpg" } })]));
  const docs = ldOf(page(out, "city/nc/raleigh/index.html"));
  const crumb = docs.find((x) => x["@type"] === "BreadcrumbList");
  assert.equal(crumb.itemListElement.length, 2);
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
  assert.match(h, /Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
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
  assert.equal(locs[0], "https://matchamap-cu7.pages.dev/");
  assert.equal(locs.length, out.counts.cities + out.counts.brands + 1);
  assert.ok(locs.includes("https://matchamap-cu7.pages.dev/city/nc/raleigh/"));
  assert.ok(locs.includes("https://matchamap-cu7.pages.dev/brand/moonbeematcha/"));
  assert.match(sm, /<lastmod>2026-11-25<\/lastmod>/);
  assert.match(page(out, "robots.txt"), /User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/matchamap-cu7\.pages\.dev\/sitemap\.xml/);
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
  assert.match(head, /rel="canonical" href="https:\/\/matchamap-cu7\.pages\.dev\/"/);
  assert.match(head, /og:image" content="https:\/\/matchamap-cu7\.pages\.dev\/og\.png"/);
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
  assert.deepEqual({ ...DL.parse("?q=Raleigh%2C%20NC") }, { q: "Raleigh, NC", city: "", event: "", brand: "" });
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
