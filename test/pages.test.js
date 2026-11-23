// Rung 33: the static city and brand pages, their JSON-LD, the sitemap, the size guard and the app's query-string parser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildSite, eventLd, weekendKeys, timeText, dayKey, patchIndex, homeHead, LIMITS, isUpcoming } from "../tools/gen-pages.js";
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
  assert.equal(locs[0], SITE_URL + "/");
  assert.equal(locs.length, out.counts.cities + out.counts.brands + 1);
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
  assert.match(h, /<title>Matcha pop-ups in Raleigh, NC this weekend and beyond<\/title>/);
  const desc = /name="description" content="([^"]*)"/.exec(h)[1];
  assert.match(desc, /^3 matcha pop-ups in Raleigh, NC, next on Sat Nov 28: Moonbee, Other Cup and more\./);
  assert.ok(desc.length <= 160);
  assert.match(h, /<p class="pg-intro">3 matcha pop-ups are listed for Raleigh, NC, from 3 brands\. The next one is Moonbee on Sat Nov 28 at Books &amp; Co\./);
  assert.match(page(out, "city/nc/quietton/index.html"), /<title>Matcha pop-ups in Quietton, NC this week \| Matcha Map<\/title>/);
  assert.ok(!/pg-intro/.test(page(out, "city/nc/quietton/index.html")));
  assert.match(page(out, "brand/moonbeematcha/index.html"), /<title>Moonbee matcha pop-ups: dates and places<\/title>/);
});

// ---- SEO rung 3: sitemap lastmod, canonical, social tags ----
test("sitemap lastmod is per page: the newest day its events were seen, never after the data date", () => {
  const out = buildSite(data([ev({ last_seen: "2026-11-20T10:00:00Z" }), ev({ last_seen: "2026-11-22T10:00:00Z" }), ev({ city: "Cary", lat: 35.79, lng: -78.78, last_seen: "2027-01-01T00:00:00Z" })]));
  const sm = page(out, "sitemap.xml");
  const lm = (p) => new RegExp("<loc>[^<]*" + p + "</loc><lastmod>([^<]*)</lastmod>").exec(sm)[1];
  assert.equal(lm("/city/nc/raleigh/"), "2026-11-22");
  assert.equal(lm("/brand/moonbeematcha/"), "2026-11-22", "a future date is ignored");
  assert.equal(lm("/city/nc/quietton/"), "2026-11-25", "no events: the data date");
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
