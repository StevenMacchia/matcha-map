// Rung N8: the weekend window, the weekend pages on a fixture, brand extras and the idempotent sitemap extras.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { weekendWindow, inWindow, buildWeekend, windowText } from "../tools/gen-weekend.js";
import { mergeSitemap, parseSitemap, extraPaths } from "../tools/gen-sitemap-extras.js";
import { buildExtras, priceRange } from "../tools/gen-brand-extras.js";

const TZ = "America/New_York";
const at = (iso) => Date.parse(iso);
// 2026-11-23 is a Monday; Fri 27, Sat 28, Sun 29.

test("window: Monday to Thursday point at the coming Friday to Sunday", () => {
  for (const d of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]) assert.deepEqual(weekendWindow(at(d + "T15:00:00-05:00"), TZ).keys, ["2026-11-27", "2026-11-28", "2026-11-29"], d);
});
test("window: Friday, Saturday and Sunday daytime show the weekend under way", () => {
  for (const d of ["2026-11-27", "2026-11-28", "2026-11-29"]) assert.deepEqual(weekendWindow(at(d + "T12:00:00-05:00"), TZ).keys, ["2026-11-27", "2026-11-28", "2026-11-29"], d);
  assert.equal(weekendWindow(at("2026-11-29T12:00:00-05:00"), TZ).next, false);
});
test("window: from 8 pm Sunday local time it is the next weekend", () => {
  const w = weekendWindow(at("2026-11-29T20:30:00-05:00"), TZ);
  assert.deepEqual(w.keys, ["2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.equal(w.next, true);
  assert.deepEqual(weekendWindow(at("2026-11-29T19:59:00-05:00"), TZ).keys[0], "2026-11-27");
});
test("window: uses the city's own clock (Sunday 8 pm Pacific is already Monday UTC)", () => {
  const ms = at("2026-11-30T02:00:00Z"); // Sunday 6 pm in Los Angeles, Sunday 9 pm in New York
  assert.equal(weekendWindow(ms, "America/Los_Angeles").keys[0], "2026-11-27");
  assert.equal(weekendWindow(ms, TZ).keys[0], "2026-12-04");
});
test("window: month and year boundaries", () => {
  assert.deepEqual(weekendWindow(at("2026-12-29T12:00:00-05:00"), TZ).keys, ["2027-01-01", "2027-01-02", "2027-01-03"]);
  assert.equal(windowText(["2026-11-27", "2026-11-28", "2026-11-29"]), "Nov 27 to Nov 29");
});
test("inWindow: a Thursday event is out, a Friday one is in, a multi-day run that reaches Friday is in", () => {
  const keys = ["2026-11-27", "2026-11-28", "2026-11-29"];
  assert.equal(inWindow({ start: "2026-11-26T12:00:00-05:00", end: "2026-11-26T15:00:00-05:00" }, keys, TZ), false);
  assert.equal(inWindow({ start: "2026-11-27T12:00:00-05:00" }, keys, TZ), true);
  assert.equal(inWindow({ start: "2026-11-25T12:00:00-05:00", end: "2026-11-28T15:00:00-05:00" }, keys, TZ), true);
  assert.equal(inWindow({ start: "2026-11-30T12:00:00-05:00" }, keys, TZ), false);
});

const cities = [
  { name: "Raleigh", state: "NC", pop: 500000, lat: 35.8, lng: -78.6, slug: "raleigh", tz: TZ },
  { name: "Austin", state: "TX", pop: 900000, lat: 30.2, lng: -97.7, slug: "austin", tz: "America/Chicago" },
];
let n = 0;
const ev = (o) => ({ id: "aaaaaa" + String(++n).padStart(6, "0"), brand: "Moonbee", source_id: "moonbee", handle: "moonbeematcha", title: "Moonbee pop-up", start: "2026-11-28T11:00:00-05:00", end: "2026-11-28T15:00:00-05:00", tz: TZ, all_day: false, venue: "Books & Co", address: "1 Main St", city: "Raleigh", state: "NC", lat: 35.8, lng: -78.6, approx: false, confidence: "likely", status: "upcoming", menu: ["ube latte"], posts: {}, ...o });
const NOW = new Date("2026-11-25T15:00:00Z");
const art = { drinks: { "ube-latte": { text: "ube latte" } }, catalog: [] };
const sources = [{ id: "moonbee", brand: "Moonbee", instagram: "moonbeematcha" }];
const events = [
  ev({}), ev({ start: "2026-11-29T11:00:00-05:00", end: "2026-11-29T13:00:00-05:00" }),
  ev({ start: "2026-12-12T11:00:00-05:00", end: null }), // next-next weekend: not listed
  ev({ city: "Austin", state: "TX", tz: "America/Chicago", start: "2026-11-27T11:00:00-06:00", end: "2026-11-27T14:00:00-06:00", brand: "Texas Whisk" }),
  ev({ status: "cancelled" }), ev({ start: "2026-11-20T11:00:00-05:00", end: "2026-11-20T13:00:00-05:00", status: "past" }),
];

test("weekend pages: one per city with a pop-up in the window, titled with the count", () => {
  const out = buildWeekend({ events, cities, sources, art, now: NOW });
  assert.deepEqual([...out.files.keys()].sort(), ["weekend/austin-tx/index.html", "weekend/index.html", "weekend/raleigh-nc/index.html"]);
  assert.equal(out.counts.events, 3);
  const r = out.files.get("weekend/raleigh-nc/index.html");
  assert.match(r, /<title>This weekend in Raleigh: 2 matcha pop-ups \| Matcha Map<\/title>/);
  assert.match(r, /href="\/feeds\/raleigh-nc\.ics"/);
  assert.match(r, /href="\/\?city=raleigh-nc"/);
  assert.match(r, /href="\/add\/"/);
  assert.match(r, /<link rel="canonical" href="[^"]+\/weekend\/raleigh-nc\/">/);
  assert.match(r, /og:image" content="[^"]+\/og\.png"/); // no card yet: the shared one
  assert.equal((r.match(/"@type":"Event"/g) || []).length, 2);
  assert.match(r, /\/art\/drinks\/ube-latte\.svg/);
  assert.doesNotMatch(r, /Texas Whisk/);
  assert.match(out.files.get("weekend/austin-tx/index.html"), /This weekend in Austin: 1 matcha pop-up</);
  assert.match(out.files.get("weekend/index.html"), /Raleigh, NC<\/a> <span class="pg-dim">2</);
});
test("weekend pages: og image points at the city card once it exists; jobs cover weekend and city cards", () => {
  const out = buildWeekend({ events, cities, sources, art, now: NOW, hasOg: (f) => f === "weekend-raleigh-nc.png" });
  assert.match(out.files.get("weekend/raleigh-nc/index.html"), /og:image" content="[^"]+\/og\/weekend-raleigh-nc\.png"/);
  assert.match(out.files.get("weekend/austin-tx/index.html"), /og:image" content="[^"]+\/og\.png"/);
  const outs = out.ogJobs.map((j) => j.out).sort();
  assert.ok(outs.includes("og/weekend-raleigh-nc.png") && outs.includes("og/city-raleigh-nc.png") && outs.includes("og/city-austin-tx.png"));
});
test("weekend pages: nothing in the window gives no city pages, only an empty index", () => {
  const out = buildWeekend({ events: [events[2]], cities, sources, now: NOW });
  assert.deepEqual([...out.files.keys()], ["weekend/index.html"]);
  assert.match(out.files.get("weekend/index.html"), /Nothing is posted/);
});

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://x.test/</loc><lastmod>2026-11-23</lastmod></url>\n<url><loc>https://x.test/city/nc/raleigh/</loc><lastmod>2026-11-23</lastmod></url>\n<url><loc>https://x.test/e/stale/</loc><lastmod>2026-11-01</lastmod></url>\n</urlset>\n`;
test("sitemap extras: appended, stale ones replaced, and a second run changes nothing", () => {
  const paths = ["/weekend/", "/weekend/raleigh-nc/", "/e/abc123/", "/feeds/all.ics"];
  const once = mergeSitemap(SITEMAP, paths, "2026-11-23");
  const urls = parseSitemap(once).map((u) => new URL(u.loc).pathname);
  assert.deepEqual(urls, ["/", "/city/nc/raleigh/", ...paths]);
  assert.equal(mergeSitemap(once, paths, "2026-11-23"), once);
  assert.equal(mergeSitemap(once, [], "2026-11-23").includes("/weekend/"), false);
});
test("sitemap extras: reads the pages and feeds on disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  for (const p of ["weekend/index.html", "weekend/raleigh-nc/index.html", "e/abc123/index.html", "feeds/all.ics", "feeds/raleigh-nc.ics", "feeds/events/abc123.ics", "feeds/new.xml"]) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), "x"); }
  assert.deepEqual(extraPaths(dir), ["/e/abc123/", "/feeds/all.ics", "/feeds/raleigh-nc.ics", "/weekend/", "/weekend/raleigh-nc/"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("brand extras: upcoming dates, distinct drinks with art, price range", () => {
  const evs = [ev({ price: "$6-9" }), ev({ price: "from $5", menu: ["ube latte", "hojicha"] }), ev({ start: "2026-10-01T11:00:00-04:00", end: "2026-10-01T13:00:00-04:00", status: "past" })];
  const out = buildExtras({ events: evs, sources, brands: [{ handle: "moonbeematcha", bio: "Matcha  and\nmore." }], art, now: NOW });
  const x = out.get("moonbeematcha");
  assert.equal(x.upcoming.length, 2);
  assert.deepEqual(x.drinks.map((d) => d.slug), ["ube-latte", "hojicha"]);
  assert.equal(x.drinks[0].art, "/art/drinks/ube-latte.svg");
  assert.equal(x.drinks[1].art, null);
  assert.deepEqual(x.price, { min: 5, max: 9, text: "$5 to $9" });
  assert.equal(x.story, "Matcha and more.");
  assert.equal(buildExtras({ events: evs, sources, art, now: NOW, hasPage: () => false }).size, 0);
  assert.equal(priceRange(["free"]).text, "Free");
  assert.equal(priceRange(["ask"]), null);
});
