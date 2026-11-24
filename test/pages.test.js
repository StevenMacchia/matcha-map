// Rung 33: the static city and brand pages, their JSON-LD, the sitemap, the size guard and the app's query-string parser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildSite, eventLd, weekendKeys, timeText, dayKey, patchIndex, homeHead, LIMITS, isUpcoming, cityIndexable, admitPace, richness, PACE_ADMIT, parseOpeningHours, openingHoursSpec, hoursText, shopLd, loadCities, citiesBlock, CITIES_START, CITIES_END, NEARBY_KM, km as kmBetween, seoAttr, stateIndexable, makeCityLocator } from "../tools/gen-pages.js";
import { buildEventPages } from "../tools/gen-event-pages.js";
import { run as runExtras } from "../tools/gen-sitemap-extras.js";
import { updateRegistry, redirectsText, parseRedirects, parseSitemap, readSitemapRows, REDIRECT_CAP } from "../tools/seo-lib.js";
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

test("cityIndexable: a pop-up, a verified shop, two brands with a picture or pop-ups in three other cities each index a page; nothing does not", () => {
  assert.deepEqual(cityIndexable({ ups: 1 }), { indexable: true, reasons: ["popup"] });
  assert.deepEqual(cityIndexable({ shops: 2 }), { indexable: true, reasons: ["shop"] });
  assert.equal(cityIndexable({ brandsWithPicture: 1 }).indexable, false, "one brand with a picture is not enough");
  assert.deepEqual(cityIndexable({ brandsWithPicture: 2 }), { indexable: true, reasons: ["brands"] });
  assert.equal(cityIndexable({ nearbyCities: 2 }).indexable, false, "pop-ups in two other cities are not enough");
  assert.deepEqual(cityIndexable({ nearbyCities: 3 }), { indexable: true, reasons: ["nearby"] });
  assert.deepEqual(cityIndexable({ ups: [], shops: 0, brandsWithPicture: 0, nearbyCities: 0 }), { indexable: false, reasons: [] });
  assert.deepEqual(cityIndexable(), { indexable: false, reasons: [] });
  assert.equal(seoAttr({ ups: 1, shops: 0, brandsWithPicture: 2, nearbyCities: 3 }), "u1 s0 b2 n3");
  assert.equal(stateIndexable({ ups: 1, shops: 0, cities: 5 }), true);
  assert.equal(stateIndexable({ ups: 3, shops: 2, cities: 4 }), false, "a hub of fewer than 5 cities only repeats its city pages");
  assert.equal(stateIndexable({ ups: 0, shops: 0, cities: 50 }), false);
});

test("pace queue: at most the cap of newly earned city pages is admitted per run, richest first; pages already indexed are never queued", () => {
  assert.equal(PACE_ADMIT, 100);
  const earned = [
    { key: "city/nc/shopburg", score: richness({ shops: 1, pop: 800 }) },
    { key: "city/nc/cary", score: richness({ ups: 1, pop: 180000 }) },
    { key: "city/nc/raleigh", score: richness({ ups: 2, pop: 500000 }) },
    { key: "city/nc/hoursville", score: richness({ shops: 1, richShops: 1, pop: 10 }) },
  ];
  const all = admitPace(earned, null, 1);
  assert.deepEqual([all.admitted.size, all.queued, all.fresh], [4, [], 4], "no state yet: everything earned is admitted");
  const one = admitPace(earned, new Set(["city/nc/shopburg"]), 1);
  assert.deepEqual([...one.admitted].sort(), ["city/nc/raleigh", "city/nc/shopburg"], "the indexed page stays, the richest new one (two pop-ups) is admitted");
  assert.deepEqual(one.queued, ["city/nc/cary", "city/nc/hoursville"], "a pop-up beats a shop with hours; the queue is in richness order");
  assert.deepEqual([one.fresh, one.kept], [1, 1]);
  assert.deepEqual(admitPace(earned, new Set(), 0).admitted.size, 0, "a cap of 0 admits nothing new");
  // through buildSite: Raleigh and Cary have a pop-up, Shopburg a verified shop; Raleigh was indexed by the last passing run
  const cary = ev({ city: "Cary", lat: 35.79, lng: -78.78 });
  const out = buildSite({ ...data([ev({}), cary]), priorIndexable: new Set(["city/nc/raleigh"]), paceCap: 1 });
  const robots = (p) => /<meta name="robots" content="noindex,follow">/.test(page(out, p));
  const seo = (p) => /<html[^>]*data-seo="([^"]*)"/.exec(page(out, p))[1];
  assert.equal(robots("city/nc/raleigh/index.html"), false, "already indexed, never demoted");
  assert.equal(robots("city/nc/cary/index.html"), false, "the one admission goes to the pop-up city");
  assert.equal(robots("city/nc/shopburg/index.html"), true, "the shop city waits");
  assert.equal(seo("city/nc/shopburg/index.html"), "u0 s1 b0 n0 q");
  assert.equal(seo("city/nc/cary/index.html"), "u1 s0 b0 n1", "an admitted page carries no q");
  const locs = [...page(out, "sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes(SITE_URL + "/city/nc/cary/") && !locs.includes(SITE_URL + "/city/nc/shopburg/"), "a queued page is out of the sitemap");
  assert.deepEqual([out.counts.indexable, out.counts.queued, out.counts.admitted, out.counts.queue], [2, 1, 1, ["city/nc/shopburg"]]);
  assert.equal(out.counts.indexable + out.counts.noindex, out.counts.cities, "a queued page counts as noindex");
  const open = buildSite(data([ev({}), cary]));
  assert.deepEqual([open.counts.indexable, open.counts.queued], [3, 0], "no prior state: all three are indexable");
});
test("noindex pages: robots meta, out of the sitemap, still a full page; data-seo carries the counts; indexable pages carry no robots meta", () => {
  const apex = { name: "Apex", state: "NC", pop: 60000, lat: 35.73, lng: -78.85, slug: "apex", tz: "America/New_York" };
  const cary = ev({ city: "Cary", lat: 35.79, lng: -78.78 });
  const out = buildSite(data([ev({}), cary], { cities: [...cities, apex] }));
  const sm = page(out, "sitemap.xml");
  const robots = (o, p) => /<meta name="robots" content="noindex,follow">/.test(page(o, p));
  assert.ok(!robots(out, "city/nc/raleigh/index.html"), "its own pop-up");
  assert.ok(!robots(out, "city/nc/shopburg/index.html"), "a verified shop within 25 km");
  assert.ok(robots(out, "city/nc/apex/index.html"), "pop-ups in two other cities are not enough");
  assert.ok(robots(out, "city/nc/tinyville/index.html"), "a brand based there with no picture is not enough");
  assert.ok(robots(out, "city/nc/quietton/index.html"), "nothing near");
  assert.ok(sm.includes("/city/nc/raleigh/") && sm.includes("/city/nc/shopburg/"));
  assert.ok(!sm.includes("/city/nc/apex/") && !sm.includes("/city/nc/tinyville/") && !sm.includes("/city/nc/quietton/"));
  assert.match(page(out, "city/nc/raleigh/index.html"), /<html lang="en" class="pg" data-seo="u1 s0 b0 n1">/);
  assert.match(page(out, "city/nc/shopburg/index.html"), /data-seo="u0 s1 b0 n0"/);
  // pop-ups in three other cities within 64 km index Apex (Morrisville is not listed: its pop-up belongs to Cary but is a third city for Apex)
  const three = buildSite(data([ev({}), cary, ev({ city: "Morrisville", lat: 35.82, lng: -78.82 })], { cities: [...cities, apex] }));
  assert.ok(!robots(three, "city/nc/apex/index.html"));
  assert.match(page(three, "city/nc/apex/index.html"), /data-seo="u0 s0 b0 n3"/);
  assert.ok(page(three, "sitemap.xml").includes("/city/nc/apex/"));
  // two brands based in Tinyville with a picture index it
  const brandSources = [{ id: "a", brand: "A", instagram: "abrand", home_city: "Tinyville", home_state: "NC", kind: "popup" }, { id: "b", brand: "B", instagram: "bbrand", home_city: "Tinyville", home_state: "NC", kind: "popup" }];
  const pics = buildSite(data([], { sources: brandSources, brandPictures: new Map([["abrand", "https://img.example/a.jpg"], ["bbrand", "https://img.example/b.jpg"]]) }));
  assert.ok(!robots(pics, "city/nc/tinyville/index.html"));
  assert.match(page(pics, "city/nc/tinyville/index.html"), /data-seo="u0 s0 b2 n0"/);
  const q = page(out, "city/nc/quietton/index.html");
  for (const need of ["<h1>Matcha pop-ups in Quietton, NC</h1>", "pg-faq", 'href="/alerts/?city=quietton-nc"', 'href="/add/"', "Nearby cities", 'href="/state/nc/"', 'href="/?city=quietton-nc"']) assert.ok(q.includes(need), need);
  assert.ok(Buffer.byteLength(q) < 6 * 1024, "thin pages stay under 6 KB: " + Buffer.byteLength(q));
  assert.equal(out.counts.indexable + out.counts.noindex, out.counts.cities);
});

test("an event in a suburb that is not listed lands on the nearest listed city within 25 km", () => {
  const out = buildSite(data([ev({ city: "Morrisville", lat: 35.82, lng: -78.82 })]));
  assert.match(page(out, "city/nc/cary/index.html"), /Moonbee/);
});

test("events are grouped by day in the event's own time zone, with the weekend count in the lead", () => {
  const out = buildSite(data([ev({}), ev({ title: "Later", start: "2026-12-05T10:00:00-05:00", end: "2026-12-05T12:00:00-05:00" }), ev({ start: "2026-11-28T18:00:00-05:00", end: null })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<h1>Matcha pop-ups in Raleigh, NC<\/h1>/);
  assert.match(h, /<p class="pg-lead">3 upcoming matcha pop-ups in Raleigh, NC, updated Nov 25, 2026\.<\/p>/);
  assert.match(h, /<h2>This weekend in Raleigh<\/h2>\s*<p>2 matcha pop-ups are listed for Nov 27 to Nov 29: Moonbee on Sat Nov 28 and Moonbee on Sat Nov 28\. <a href="\/weekend\/raleigh-nc\/">/);
  assert.ok(h.indexOf("This weekend in Raleigh") < h.indexOf("Upcoming pop-ups"));
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
  assert.match(h, /<p class="pg-lead">No matcha pop-up is listed within 40 miles of Quietton, NC right now\. No matcha shop is listed either\.<\/p>/);
  assert.match(h, /href="\/\?city=quietton-nc"/);
  assert.match(h, /Nearby cities/);
  assert.ok(!/\b0 (matcha|upcoming)/.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), "zero never prints as a number in prose");
  const near = buildSite(data([ev({})]));
  assert.match(page(near, "city/nc/tinyville/index.html"), /No matcha pop-up is listed within 40 miles of Tinyville/);
  const cary = buildSite(data([ev({})], { cities: [...cities, { name: "Apex", state: "NC", pop: 60000, lat: 35.73, lng: -78.85, slug: "apex", tz: "America/New_York" }] }));
  assert.match(page(cary, "city/nc/apex/index.html"), /<p class="pg-lead">No matcha pop-up is listed in Apex, NC right now\. The nearest is in Raleigh, NC, \d+ miles? away \(Moonbee, Sat Nov 28\)\./);
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
  assert.equal(desc, "3 upcoming matcha pop-ups in Raleigh, NC, updated Nov 25, 2026.");
  assert.ok(desc.length <= 158);
  assert.match(h, /<p class="pg-intro">The next one is Moonbee on Sat Nov 28 at Books &amp; Co\./);
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
  assert.equal(lm("/city/nc/shopburg/"), "2026-11-25", "no events: the data date");
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
    const thin = /<meta name="robots" content="noindex/.test(h); // a noindex page keeps twitter:card only (the other tags fall back to Open Graph), to stay under 6 KB
    if (!thin) assert.equal(get(h, /<meta name="twitter:title" content="([^"]*)"/), t, where);
    if (!thin) assert.equal(get(h, /<meta name="twitter:description" content="([^"]*)"/), d, where);
    assert.equal(get(h, /<meta name="description" content="([^"]*)"/), d, where + " description");
    const oi = get(h, /<meta property="og:image" content="([^"]*)"/);
    assert.match(oi || "", /^https:[/][/]/, where + " og:image absolute");
    if (!thin) assert.equal(get(h, /<meta name="twitter:image" content="([^"]*)"/), oi, where);
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
  assert.match(h, /Hours: Mon-Fri 8 AM-5 PM; Sat 9 AM-3 PM/);
  assert.match(h, /Hours: Mo-Fr 08:00-17:00; PH off/, "the raw text is printed when it does not parse");
  assert.match(h, /<h2>Matcha cafes and shops in Raleigh<\/h2>/);
  assert.ok(!/rating|review|aggregateRating|yelp/i.test(JSON.stringify(ld)), "no rating or review field");
  assert.equal(shopLd(shopRow({ verified: false })), null);
  assert.equal(shopLd(shopRow({ address: "" })), null);
});

test("intro numbers equal the counted lists, and zero never reads as '0'", () => {
  const out = buildSite(data([ev({}), ev({ start: "2026-12-05T10:00:00-05:00", end: null }), ev({ start: "2026-12-06T10:00:00-05:00", end: null })], { shops: [shopRow({ id: "a" }), shopRow({ id: "b", name: "Second", lat: 35.82 })], sources: [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", home_city: "Raleigh", home_state: "NC", kind: "popup" }] }));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<p class="pg-lead">3 upcoming matcha pop-ups in Raleigh, NC, 2 matcha shops and 1 brand based here, updated Nov 25, 2026\.<\/p>/);
  assert.equal((h.match(/class="pg-ev"/g) || []).length, 3);
  assert.equal((/<ul class="pg-list pg-shops">([\s\S]*?)<\/ul>/.exec(h)[1].match(/<li>/g) || []).length, 2);
  assert.ok(h.includes("<h2>Brands based in Raleigh</h2>"));
  const only = page(buildSite(data([ev({})])), "city/nc/raleigh/index.html");
  assert.match(only, /<p class="pg-lead">1 upcoming matcha pop-up in Raleigh, NC, updated Nov 25, 2026\.<\/p>/);
});

test("this weekend block: names the dates and count and links the weekend page, only when the window has a pop-up", () => {
  const out = buildSite(data([ev({}), ev({ start: "2026-12-05T10:00:00-05:00", end: null })]));
  const h = page(out, "city/nc/raleigh/index.html");
  assert.match(h, /<h2>This weekend in Raleigh<\/h2>\s*<p>1 matcha pop-up is listed for Nov 27 to Nov 29: Moonbee on Sat Nov 28\. <a href="\/weekend\/raleigh-nc\/">/);
  const later = page(buildSite(data([ev({ start: "2026-12-05T10:00:00-05:00", end: null })])), "city/nc/raleigh/index.html");
  assert.ok(!later.includes("This weekend in Raleigh") && !later.includes("/weekend/raleigh-nc/"));
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
  const h = page(out, "city/nc/apex/index.html");
  assert.match(h, /<h2>Pop-ups near Apex<\/h2>/);
  const sect = /<h2>Pop-ups near Apex<\/h2>([\s\S]*?)<\/section>/.exec(h)[1];
  const rows = [...sect.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2, "Raleigh's and Cary's pop-ups, not the one 170 km away");
  assert.match(rows[0], /Cary Cup[\s\S]*Cary, NC · \d+ miles?[\s\S]*href="\/e\/aaaaaa/);
  assert.match(rows[1], /Moonbee[\s\S]*Raleigh, NC/);
  assert.ok(!sect.includes("Far away") && !sect.includes("Tinyville"));
  // the city's own pop-ups are not repeated in its Nearby section
  const r = page(out, "city/nc/raleigh/index.html");
  const nr = /<h2>Pop-ups near Raleigh<\/h2>([\s\S]*?)<\/section>/.exec(r)[1];
  assert.ok(nr.includes("Cary Cup") && !nr.includes("Moonbee"), "own pop-ups stay out of Nearby");
  // distance cut and the cap of 12
  const crowd = Array.from({ length: 15 }, (_, i) => ev({ city: "Cary", lat: 35.79 + i * 0.01, lng: -78.78, title: "n" + i }));
  const inList = (h) => (/<h2>Pop-ups near Apex<\/h2>([\s\S]*?)<\/section>/.exec(h)[1].match(/<li>/g) || []).length;
  assert.equal(inList(page(buildSite(data(crowd, { cities: [...cities, apex], shops: [shopRow({ id: "x", lat: 35.73, lng: -78.85, city: "Apex" })] })), "city/nc/apex/index.html")), 12, "an indexed page lists up to 12");
  assert.equal(inList(page(buildSite(data(crowd, { cities: [...cities, apex] })), "city/nc/apex/index.html")), 3, "a noindex page lists three, to stay light");
  const km1 = kmBetween(apex, { lat: 35.79, lng: -78.78 });
  assert.ok(km1 > 0 && km1 < NEARBY_KM);
});

test("three nearby cities and the state hub link on every city page", () => {
  const out = buildSite(data([ev({})]));
  const h = page(out, "city/nc/raleigh/index.html");
  const sect = /<h2>Nearby cities<\/h2>([\s\S]*?)<\/section>/.exec(h)[1];
  assert.equal((sect.match(/<li><a href="\/city\//g) || []).length, 3);
  assert.match(sect, /href="\/city\/nc\/cary\/"/);
  assert.match(sect, /href="\/state\/nc\/">All matcha pop-ups in North Carolina</);
  assert.match(sect, /^\s*<ul class="pg-chips">\s*<li><a href="\/city\/nc\/cary\/">/, "nearest first");
  assert.ok(!sect.includes("/city/nc/raleigh/"), "never itself");
});

test("FAQ: four questions (a fifth on an indexed page), FAQPage JSON-LD only where the page is indexed, with the page's own answer text", () => {
  const items = (h) => [...h.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map((m) => [un(m[1]), un(m[2])]);
  for (const events of [[ev({})], [ev({ start: "2026-12-05T10:00:00-05:00", end: null })], []]) {
    const out = buildSite(data(events));
    for (const slug of ["raleigh", "quietton"]) {
      const h = page(out, `city/nc/${slug}/index.html`);
      const indexed = !/<meta name="robots" content="noindex/.test(h);
      const list = items(h);
      assert.equal(list.length, indexed ? 5 : 4);
      const faq = ldOf(h).find((x) => x["@type"] === "FAQPage");
      if (indexed) {
        assert.deepEqual(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), list);
        assert.ok(faq.mainEntity.every((q) => q["@type"] === "Question" && q.acceptedAnswer["@type"] === "Answer"));
      } else assert.equal(faq, undefined, "a noindex page keeps the questions and drops the markup");
      const city = slug === "raleigh" ? "Raleigh" : "Quietton";
      const qs = [`Is there a matcha pop-up in ${city} this weekend?`, `How many matcha shops are in ${city}?`, `How do I get alerts for ${city}?`, `How do I list my pop-up in ${city}?`];
      if (indexed) qs.push(`Where else can I look near ${city}?`);
      assert.deepEqual(list.map((x) => x[0]), qs);
    }
  }
  const yes = items(page(buildSite(data([ev({})])), "city/nc/raleigh/index.html"));
  assert.match(yes[0][1], /^Yes\. 1 matcha pop-up is listed in Raleigh, NC this weekend \(Nov 27 to Nov 29\): Moonbee on Sat Nov 28\.$/);
  assert.match(yes[4][1], /^The closest listed cities to Raleigh, NC are Cary, NC \(\d+ miles?\), .*\. 0 pop-ups|^The closest listed cities to Raleigh, NC are Cary, NC \(\d+ miles?\)/);
  const no = items(page(buildSite(data([ev({})])), "city/nc/cary/index.html"));
  assert.match(no[0][1], /^No\. Nothing is listed in Cary, NC for this weekend \(Nov 27 to Nov 29\)\. The nearest pop-up is Moonbee in Raleigh, NC, \d+ miles? away, on Sat Nov 28\.$/);
  const shops = items(page(buildSite(data([], { shops: [shopRow({ id: "a" }), shopRow({ id: "b", name: "Second", lat: 35.82 })] })), "city/nc/raleigh/index.html"));
  assert.match(shops[1][1], /^2 verified matcha cafes and shops are listed within 15 miles of Raleigh, NC\. The closest is Green Cup\.$/);
});

test("calls to action: alerts for the city (slug-st) and the add page", () => {
  const h = page(buildSite(data([ev({})])), "city/nc/raleigh/index.html");
  assert.match(h, /<a class="pg-btn" href="\/alerts\/\?city=raleigh-nc">Get alerts for Raleigh<\/a>/);
  assert.match(h, /<a class="pg-btn" href="\/add\/">Add your pop-up<\/a>/);
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
  assert.equal(prev["city/nc/raleigh"][2].length, 6, "one sub-hash per section, for the gate's reasons");
  assert.ok(prev["brand/moonbeematcha"] && prev["state/nc"] && prev["state"], "brand and state pages are stamped too");
  assert.ok(JSON.parse(page(a, "data/pages.json")).cities.length && !("lm" in JSON.parse(page(a, "data/pages.json"))), "the app's city list stays and carries no lm");
  const lmOf = (o, p) => new RegExp("<loc>[^<]*" + p + "</loc><lastmod>([^<]*)</lastmod>").exec(page(o, "sitemap.xml"))[1];
  // same data a day later: the data date differs, the body does not, so lastmod holds
  const later = buildSite({ ...d1, generated: "2026-11-26T09:00:00Z", prevPages: prev });
  assert.equal(lmOf(later, "/city/nc/raleigh/"), "2026-11-20");
  assert.equal(lmOf(later, "/city/nc/shopburg/"), "2026-11-25", "a page with no events keeps its first date, not today's");
  assert.equal(lmOf(later, "/brand/moonbeematcha/"), "2026-11-20");
  assert.deepEqual(later.lastmods["city/nc/raleigh"], prev["city/nc/raleigh"]);
  // a new pop-up changes the body and moves lastmod to its day
  const moved = buildSite({ ...d1, generated: "2026-11-26T09:00:00Z", events: [...d1.events, ev({ title: "New one", last_seen: "2026-11-26T08:00:00Z" })], prevPages: prev });
  assert.equal(lmOf(moved, "/city/nc/raleigh/"), "2026-11-26");
  assert.equal(lmOf(moved, "/city/nc/shopburg/"), "2026-11-25");
  // without a previous hash the page takes the computed day
  assert.equal(lmOf(buildSite(d1), "/city/nc/raleigh/"), "2026-11-20");
});

test("the Updated line prints the page's own lastmod, not the data date, and a rolling weekend window does not move it", () => {
  const d1 = data([ev({ start: "2026-12-19T11:00:00-05:00", end: "2026-12-19T15:00:00-05:00", last_seen: "2026-11-20T10:00:00Z" })]);
  const a = buildSite(d1);
  const shop = (o) => page(o, "city/nc/shopburg/index.html");
  assert.match(shop(a), /Updated Nov 25, 2026\./, "no events: the first date");
  assert.match(page(a, "city/nc/raleigh/index.html"), /<p class="pg-lead">1 upcoming matcha pop-up in Raleigh, NC, updated Nov 20, 2026\./);
  // eight days later, the window now reads Dec 4 to Dec 6: the pages do not change, so neither does anything they print
  const later = buildSite({ ...d1, now: new Date("2026-12-03T15:00:00Z"), generated: "2026-12-03T14:00:00Z", prevPages: a.lastmods });
  assert.match(shop(later), /Updated Nov 25, 2026\./);
  assert.match(page(later, "city/nc/raleigh/index.html"), /updated Nov 20, 2026\./);
  assert.match(page(later, "city/nc/raleigh/index.html"), /for this weekend \(Dec 4 to Dec 6\)/, "the window itself is current");
  assert.deepEqual(later.lastmods["city/nc/raleigh"], a.lastmods["city/nc/raleigh"]);
  assert.deepEqual(later.lastmods["city/nc/shopburg"], a.lastmods["city/nc/shopburg"]);
  const lm = (o) => new RegExp("<loc>[^<]*/city/nc/raleigh/</loc><lastmod>([^<]*)</lastmod>").exec(page(o, "sitemap.xml"))[1];
  assert.equal(lm(later), "2026-11-20");
});

test("FAQ answers differ by city: no answer string repeats across the indexed pages", () => {
  const many = Array.from({ length: 24 }, (_, i) => ({ name: "Town" + i, state: "TX", pop: 1000 - i, lat: 31 + i * 0.7, lng: -99, slug: "town" + i, tz: "America/Chicago" }));
  const shops = many.map((c, i) => ({ id: "s" + i, name: "Shop " + i, lat: c.lat, lng: c.lng, address: i + " Oak St", verified: true }));
  const out = buildSite({ ...data([]), cities: many, shops, sources: [], watchlist: { accounts: [] } });
  const seen = new Map();
  let pages = 0;
  for (const [p, h] of out.files) {
    if (!p.startsWith("city/") || /<meta name="robots" content="noindex/.test(h)) continue;
    pages++;
    for (const m of h.matchAll(/<details><summary>.*?<\/summary><p>(.*?)<\/p>/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  assert.equal(pages, 24);
  assert.equal(seen.size, 24 * 5);
  assert.ok([...seen.values()].every((n) => n === 1), "every answer carries the city's own name and numbers");
});

test("sitemap: past the split a sitemap index lists sitemap-1.xml, sitemap-2.xml...; sitemap-extras keeps the split", () => {
  const out = buildSite({ ...data([ev({})]), sitemap: { split: 3, chunk: 2 } });
  const idx = page(out, "sitemap.xml");
  assert.match(idx, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const parts = [...out.files.keys()].filter((k) => /^sitemap-\d+\.xml$/.test(k)).sort();
  assert.ok(parts.length >= 2 && parts[0] === "sitemap-1.xml");
  for (const p of parts) { assert.ok(idx.includes(`<loc>${SITE_URL}/${p}</loc>`)); assert.ok(parseSitemap(page(out, p)).length <= 2, p + " holds at most the chunk"); }
  assert.equal(parts.flatMap((p) => parseSitemap(page(out, p))).length, out.urls.length, "every url is in exactly one file");
  // under the split: one urlset, no parts
  const one = buildSite(data([ev({})]));
  assert.ok(!/<sitemapindex/.test(page(one, "sitemap.xml")) && ![...one.files.keys()].some((k) => /^sitemap-\d/.test(k)));
  // gen-sitemap-extras on a tree: reads the index, adds the extra pages, writes the parts again; a smaller set removes stale parts
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mm-sm-"));
  try {
    const site = path.join(root, "site");
    fs.mkdirSync(path.join(site, "e", "abc123def456"), { recursive: true });
    fs.writeFileSync(path.join(site, "e", "abc123def456", "index.html"), "<html></html>");
    for (const [n, x] of out.files) if (/^sitemap(-\d+)?\.xml$/.test(n)) fs.writeFileSync(path.join(site, n), x);
    const r = runExtras({ root, split: 3, chunk: 2 });
    assert.equal(r.added, 1);
    const rows = readSitemapRows(site).rows;
    assert.equal(rows.length, out.urls.length + 1);
    assert.ok(rows.some((u) => u.loc === `${SITE_URL}/e/abc123def456/`));
    assert.ok(fs.readdirSync(site).filter((n) => /^sitemap-\d+\.xml$/.test(n)).length >= 2);
    assert.equal(runExtras({ root, split: 3, chunk: 2 }).total, rows.length, "idempotent");
    runExtras({ root, split: 1000, chunk: 1000 });
    assert.deepEqual(fs.readdirSync(site).filter((n) => /^sitemap/.test(n)), ["sitemap.xml"], "back under the split: one file, no stale parts");
    assert.ok(!/<sitemapindex/.test(fs.readFileSync(path.join(site, "sitemap.xml"), "utf8")));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("_redirects: a page published before and not generated now keeps its address with a 301; a page that returns loses its line", () => {
  const s = {};
  updateRegistry(s, "events", { aaa111: "nc/raleigh", bbb222: "" });
  assert.deepEqual(s.gone, {}, "nothing was published before");
  updateRegistry(s, "events", { ccc333: "nc/cary" });
  assert.deepEqual(s.gone, { "/e/aaa111/": "/city/nc/raleigh/", "/e/bbb222/": "/" }, "the city page when known, else the home page");
  updateRegistry(s, "brands", { moon: "nc/raleigh", lone: "" });
  updateRegistry(s, "brands", {});
  assert.equal(s.gone["/brand/moon/"], "/city/nc/raleigh/");
  assert.equal(s.gone["/brand/lone/"], "/");
  updateRegistry(s, "events", { aaa111: "nc/raleigh" });
  assert.ok(!("/e/aaa111/" in s.gone), "a live page never keeps a 301");
  const text = redirectsText(s.gone);
  assert.match(text, /^# Written by tools\/gen-pages\.js and tools\/gen-event-pages\.js/);
  assert.ok(text.includes("/e/bbb222/ / 301\n") && text.includes("/brand/moon/ /city/nc/raleigh/ 301\n"));
  assert.deepEqual([...parseRedirects(text)].sort(), Object.entries(s.gone).sort(), "the file reads back as the map");
  // pages already on disk when the registry is empty count as published
  const t = {};
  updateRegistry(t, "events", {}, ["old111"]);
  assert.equal(t.gone["/e/old111/"], "/");
  // Cloudflare Pages allows 2,000 static redirects: the oldest event lines go first
  const big = {};
  updateRegistry(big, "events", Object.fromEntries(Array.from({ length: REDIRECT_CAP + 50 }, (_, i) => ["e" + String(i).padStart(5, "0"), ""])));
  updateRegistry(big, "brands", { keep: "" });
  updateRegistry(big, "events", {});
  updateRegistry(big, "brands", {});
  assert.equal(Object.keys(big.gone).length, REDIRECT_CAP);
  assert.ok(!("/e/e00000/" in big.gone) && "/e/e00099/" in big.gone && "/brand/keep/" in big.gone, "oldest events dropped, brands kept");
  // the event page generator reports its registry: each page's city page when it exists
  const known = { cities: new Set(["nc/raleigh"]), brands: new Set(), locate: makeCityLocator(cities) };
  const eo = buildEventPages({ events: [ev({}), ev({ city: "Cary", lat: 35.79, lng: -78.78 })], sources: [], now: NOW, known, cap: "2026-11-25" });
  assert.deepEqual(Object.values(eo.registry.events).sort(), ["", "nc/raleigh"], "Cary has no page in this tree: the home page");
  assert.equal(Object.keys(eo.stamps).length, 2);
  // two pages with one title and one description get apart
  const twin = buildEventPages({ events: [ev({ venue: "Books & Co" }), ev({ venue: "Corner Cafe" }), ev({})], sources: [], now: NOW });
  const titles = [...twin.files.values()].map((h) => /<title>(.*?)<\/title>/.exec(h)[1]);
  assert.equal(new Set(titles).size, 3);
  assert.equal(new Set([...twin.files.values()].map((h) => /<meta name="description" content="(.*?)">/.exec(h)[1])).size, 3);
});

test("home page: the cities marker is filled with the 50 biggest cities; no markers, no change", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: "City" + i, state: "TX", pop: 1000 - i, lat: 30, lng: -100, slug: "city" + i, tz: "America/Chicago" })).concat([{ name: "Brooklyn", state: "NY", pop: 0, extra: true, lat: 40, lng: -74, slug: "brooklyn", tz: "America/New_York" }]);
  const html = `<head><title>x</title>\n<meta name="description" content="y"></head><body>${CITIES_START}\nold\n${CITIES_END}</body>`;
  const out = patchIndex(html, many);
  assert.equal((out.match(/<li><a href="\/city\/tx\/city\d+\/"/g) || []).length, 50);
  assert.ok(out.includes('href="/city/tx/city0/"') && !out.includes("city50/") && !out.includes("brooklyn") && !out.includes("old"));
  assert.equal(patchIndex(out, many), out, "idempotent");
  const none = '<head><title>x</title>\n<meta name="description" content="y"></head><body>nothing</body>';
  assert.ok(!patchIndex(none, many).includes("pg-chips"));
  assert.equal(citiesBlock(many, 3).match(/<li>/g).length, 3);
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
  const sources = [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha", home_city: "Raleigh", home_state: "NC", kind: "popup" }, { id: "bare", brand: "Bare Brand", instagram: "barebrand", home_city: "Raleigh", home_state: "NC", kind: "popup" }, { id: "pic2", brand: "Second Brand", instagram: "secondbrand", home_city: "Raleigh", home_state: "NC", kind: "popup" }];
  const watchlist = { accounts: [{ handle: "moonbeematcha", name: "Moonbee", status: "watching", platform: "instagram", followers_count: 12400, profile_picture_url: "https://img.example/wl.jpg" }, { handle: "secondbrand", name: "Second Brand", status: "watching", platform: "instagram", profile_picture_url: "https://img.example/s.jpg" }] };
  const h = page(buildSite(data([], { sources, watchlist, brandPictures: new Map([["moonbeematcha", "https://img.example/m.jpg"]]) })), "city/nc/raleigh/index.html");
  const li = (n) => new RegExp("<li>[^\\n]*" + n + "[^\\n]*</li>").exec(h)[0];
  assert.match(li("Moonbee"), /<img src="https:\/\/img\.example\/m\.jpg" alt="" width="32" height="32" loading="lazy">/);
  assert.match(li("Moonbee"), /12\.4k followers/);
  assert.ok(!/<img|followers/.test(li("Bare Brand")));
  const wl = page(buildSite(data([], { sources, watchlist })), "city/nc/raleigh/index.html");
  assert.match(wl, /<img src="https:\/\/img\.example\/wl\.jpg"/, "the watch-list avatar when the brand has no picture");
  // one brand with a picture is not an earned index: the page is noindex and carries no image
  const one = page(buildSite(data([], { sources, watchlist: { accounts: [watchlist.accounts[0]] }, brandPictures: new Map([["moonbeematcha", "https://img.example/m.jpg"]]) })), "city/nc/raleigh/index.html");
  assert.match(one, /<meta name="robots" content="noindex/);
  assert.ok(!one.includes("<img src="));
});

test("Nearby stays with a line when nothing is within 40 miles; the disclaimer sits under Upcoming and on empty cities; report link", () => {
  const out = buildSite(data([ev({})]));
  const q = page(out, "city/nc/quietton/index.html");
  assert.match(q, /<h2>Pop-ups near Quietton<\/h2><p data-boiler>Nothing listed yet within 40 miles\.<\/p>/);
  const disc = "Dates come from each brand's own posts, so check the post before you go.";
  assert.equal(q.split(disc).length - 1, 1, "once on an empty city");
  assert.match(q, new RegExp("pg-lead[\\s\\S]*" + disc.replace(/[.']/g, "\\$&")));
  const r = page(out, "city/nc/raleigh/index.html");
  assert.match(r, /<h2>Upcoming pop-ups<\/h2>\s*<p class="pg-dim" data-boiler>Dates come from each brand's own posts, so check the post before you go\.<\/p>/);
  assert.equal(r.split(disc).length - 1, 1, "once, under Upcoming");
  for (const p of [r, q]) assert.match(p, /<a class="pg-btn" href="\/add\/\?city=raleigh-nc|<a class="pg-btn" href="\/add\/\?city=quietton-nc">Report a pop-up we missed<\/a>/);
  assert.match(r, /href="\/add\/\?city=raleigh-nc">Report a pop-up we missed<\/a>/);
  assert.ok(Buffer.byteLength(q) < 6 * 1024);
});
