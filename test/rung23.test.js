// Rung 23: permits, markets, feeds, bluesky, embed captions. Offline: fake fetchers and small fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as permits from "../ingest/lib/sites/permits.js";
import * as markets from "../ingest/lib/sites/markets.js";
import * as feeds from "../ingest/lib/sites/feeds.js";
import * as bsky from "../ingest/lib/sites/bluesky.js";
import { parseFeed } from "../ingest/lib/feed-xml.js";
import { embedTarget, isInboxPaste, parseEmbed, fetchEmbed, enrichFromEmbed, newEmbedState, MAX_PER_RUN } from "../ingest/lib/embed-captions.js";
import { NAMES } from "../ingest/lib/sites/index.js";
import { extract } from "../ingest/lib/extract.js";

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const now = new Date("2026-11-22T12:00:00Z");
const fake = (pages, { status = {} } = {}) => {
  const seen = [];
  return { seen, noFetch: false, get: async (u) => { seen.push(u); const k = [...Object.keys(status), ...Object.keys(pages)].find((x) => u === x || (x.endsWith("*") && u.startsWith(x.slice(0, -1)))); if (k in status) return { ok: false, status: status[k], text: "" }; return k ? { ok: true, status: 200, text: pages[k] } : { ok: false, status: 404, text: "" }; } };
};

test("rung 23: the four sites are registered after the event sites", () => {
  for (const n of ["permits", "markets", "feeds", "bluesky"]) assert.ok(NAMES.includes(n), n);
});

// ---- permits ---------------------------------------------------------------------------------------
test("permits: a short matcha permit becomes an all-day likely event with the permit description", () => {
  const ds = permits.DATASETS.find((d) => d.id === "chicago-licenses");
  const raw = permits.permitToRaw(ds.row({ id: "1-2026", doing_business_as_name: "MATCHA MOON", address: "1 W Madison St", city: "CHICAGO", state: "IL", zip_code: "60602", license_start_date: "2026-12-10T00:00:00.000", expiration_date: "2026-12-11T00:00:00.000" }), ds, { now });
  assert.equal(raw.organizer.name, "MATCHA MOON");
  assert.equal(raw.description, "Temporary food permit on file");
  assert.equal(raw.hints.all_day, true);
  assert.match(raw.hints.start, /^2026-12-10T00:00:00-06:00$/);
  assert.equal(raw.hints.address, "1 W Madison St, Chicago, IL 60602");
  const c = extract(raw, { source: { brand: "MATCHA MOON" }, now });
  assert.equal(c[0].confidence, "likely");
  assert.equal(c[0].all_day, true);
});

test("permits: a long licence that already started, a past permit and a non-matcha name are dropped", () => {
  const ds = permits.DATASETS.find((d) => d.id === "chicago-licenses");
  const row = (o) => ds.row({ id: "x", doing_business_as_name: "Matcha Moon", address: "1 W Madison St", city: "CHICAGO", state: "IL", ...o });
  assert.equal(permits.permitToRaw(row({ license_start_date: "2026-04-01", expiration_date: "2026-12-02" }), ds, { now }), null, "long licence already started");
  assert.equal(permits.permitToRaw(row({ license_start_date: "2026-11-01", expiration_date: "2026-11-10" }), ds, { now }), null, "ended");
  assert.equal(permits.permitToRaw(ds.row({ id: "y", doing_business_as_name: "Tacos Uno", license_start_date: "2026-12-01", expiration_date: "2026-12-02" }), ds, { now }), null, "no matcha word");
  assert.ok(permits.permitToRaw(row({ license_start_date: "2026-12-20", expiration_date: "2027-06-01" }), ds, { now }), "a long licence that starts in the future keeps its start day");
});

test("permits: NYC rows keep their times and the borough; discover dedupes against existing events and stops cleanly", async () => {
  const nyc = JSON.stringify([{ event_id: "99", event_name: "Matcha Market at Domino Park", start_date_time: "2026-12-06T11:00:00.000", end_date_time: "2026-12-06T17:00:00.000", event_location: "Domino Park, Kent Ave", event_borough: "Brooklyn" }]);
  const f = fake({ "https://data.cityofnewyork.us/robots.txt": "User-agent: *\nCrawl-delay: 1\n", "https://data.cityofnewyork.us/resource/tvpp-9vvx.json*": nyc });
  const r = await permits.discover({ fetcher: f, now, sources: [], existing: [] });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].hints.city, "Brooklyn");
  assert.equal(r.items[0].hints.all_day, false);
  assert.match(r.items[0].hints.start, /^2026-12-06T11:00:00-05:00$/);
  assert.equal(r.items[0].source_hint.id, "permits:matcha-market-at-domino-park");
  assert.equal(r.candidates[0].found_via, "search");
  assert.equal(r.candidates[0].found_from, "permits");
  // an existing event for the same brand and day wins
  const dupe = await permits.discover({ fetcher: f, now, sources: [], existing: [{ brand: "Matcha Market at Domino Park", start: "2026-12-06T11:00:00-05:00" }] });
  assert.equal(dupe.items.length, 0);
  // a 403 stops the run
  const stop = await permits.discover({ fetcher: fake({ "https://data.cityofnewyork.us/robots.txt": "" }, { status: { "https://data.cityofnewyork.us/resource/tvpp-9vvx.json*": 403 } }), now, sources: [], existing: [] });
  assert.equal(stop.stats.stopped, 403);
});

test("permits: a host whose robots.txt answers 403 is skipped and recorded", async () => {
  const r = await permits.discover({ fetcher: fake({}, { status: { "https://data.cityofnewyork.us/robots.txt": 403 } }), now, sources: [], existing: [] });
  assert.ok(r.stats.skippedHosts.some((s) => /data\.cityofnewyork\.us.*403/.test(s)));
});

// ---- markets ---------------------------------------------------------------------------------------
test("markets: roster lines keep vendor-like names only; date lines read market days and hours", () => {
  const lines = ["matcha", "burgers | tacos | matcha | sushi", "Cha Cha Matcha", "Matcha is our favorite thing to drink every day.", "Kyoto Matcha Bar & Sweets", "Open Fri-Sun 11am-8pm, Nov 27 - Dec 24", "Copyright 2019 Nov 3"];
  assert.deepEqual(markets.rosterVendors(lines), ["Cha Cha Matcha", "Kyoto Matcha Bar & Sweets"]);
  const d = markets.marketDates(lines, now);
  assert.ok(d.length >= 2 && d.every((x) => x.y === 2026));
  assert.ok(d[0].time && d[0].time.start.h === 11);
});

test("markets: a vendor on a dated page becomes an event per date; a roster without dates is only a candidate", async () => {
  const dated = `<html><body><ul><li>Open Sat Dec 5 and Dec 12, 11am-6pm</li></ul><ul><li>Kyoto Matcha Bar</li><li>Burger Barn</li></ul></body></html>`;
  const roster = `<html><body><ul><li>Cha Cha Matcha Cart</li></ul></body></html>`;
  const f = fake({ "https://a.test/robots.txt": "", "https://a.test/": dated, "https://b.test/robots.txt": "", "https://b.test/": roster });
  const ms = [
    { id: "a", name: "A Market", city: "Chicago", state: "IL", address: "1 Main St, Chicago, IL 60601", pages: ["https://a.test/"] },
    { id: "b", name: "B Market", city: "Dallas", state: "TX", address: "", pages: ["https://b.test/"] },
  ];
  const r = await markets.discover({ fetcher: f, now, sources: [], markets: ms, existing: [] });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].hints.title, "Kyoto Matcha Bar at A Market");
  assert.equal(r.items[0].hints.address, "1 Main St, Chicago, IL 60601");
  assert.match(r.items[0].hints.start, /^2026-12-05T11:00:00-06:00$/);
  assert.equal(r.items[0].source_hint.id, "markets:kyoto-matcha-bar");
  assert.equal(r.stats.rosterOnly, 1);
  assert.ok(r.candidates.some((c) => /Cha Cha Matcha Cart/.test(c.evidence)));
  assert.ok(!r.items.some((i) => /Cha Cha/.test(i.hints.title)), "no dates, no event");
});

// ---- feeds -----------------------------------------------------------------------------------------
test("feeds: parseFeed reads Atom and RSS", () => {
  const a = parseFeed(fx("rung23-eater.xml"));
  assert.equal(a.items.length, 3);
  assert.equal(a.items[0].link, "https://ny.eater.com/news/1/cha-cha");
  assert.equal(a.items[0].published, "2026-11-20T19:38:17.000Z");
  const r = parseFeed(`<rss><channel><title>T</title><item><title>X &amp; Y</title><link>https://x.test/1</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Hi <b>there</b></p>]]></description></item></channel></rss>`);
  assert.equal(r.items[0].title, "X & Y");
  assert.equal(r.items[0].summary, "Hi there");
});

test("feeds: brand from the headline, matcha plus pop-up word, age limit, and the extractor finds the date", async () => {
  assert.equal(feeds.brandFromTitle("Cha Cha Matcha's Holiday Pop-Up Lands in Williamsburg"), "Cha Cha Matcha");
  assert.equal(feeds.brandFromTitle("The Best Matcha Pop-Ups This Week"), null);
  assert.equal(feeds.realLink("https://www.google.com/url?rct=j&url=https://a.test/post&ct=ga"), "https://a.test/post");
  const items = feeds.feedItems(fx("rung23-eater.xml"), { name: "Eater NY", city: "New York", state: "NY", url: "https://ny.eater.com/rss/index.xml" }, now);
  assert.equal(items.length, 1, "pizza has no matcha, the January post is older than 60 days");
  const f = fake({ "https://ny.eater.com/robots.txt": "", "https://ny.eater.com/rss/index.xml": fx("rung23-eater.xml") });
  const r = await feeds.discover({ fetcher: f, now, sources: [], feeds: [{ name: "Eater NY", city: "New York", state: "NY", url: "https://ny.eater.com/rss/index.xml" }] });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].source_hint.id, "feeds:cha-cha-matcha");
  assert.equal(r.items[0].source_hint.kind, "popup");
  assert.equal(r.items[0].published_at, "2026-11-20T19:38:17.000Z");
  const c = extract(r.items[0], { source: r.items[0].source_hint, now });
  assert.ok(c.some((x) => x.start.startsWith("2026-12-05T11:00") && x.city === "Brooklyn"), JSON.stringify(c.map((x) => [x.start, x.city])));
  assert.equal(r.candidates[0].found_from, "feeds");
});

test("feeds: data/feeds.json is valid, every url is https and the Eater cities are in it", () => {
  const list = feeds.loadFeeds();
  assert.ok(list.length >= 25);
  assert.ok(list.every((x) => /^https:\/\//.test(x.url) && x.city && x.state));
  for (const c of ["ny", "la", "sf", "seattle", "chicago", "austin", "dallas", "houston", "miami", "atlanta", "dc"]) assert.ok(list.some((x) => x.url === `https://${c}.eater.com/rss/index.xml`), c);
});

// ---- bluesky ---------------------------------------------------------------------------------------
test("bluesky: posts need matcha, a pop-up word, recency, and a US place with a future date", async () => {
  const j = JSON.parse(fx("rung23-bsky.json"));
  assert.equal(bsky.postsToRaw(j, now).length, 2, "old post and plain post dropped");
  assert.deepEqual(bsky.cityFromText("see you in Brooklyn"), { city: "Brooklyn", state: "NY" });
  assert.deepEqual(bsky.cityFromText("Austin, TX friends"), { city: "Austin", state: "TX" });
  const f = fake({ "https://api.bsky.app/robots.txt": "User-agent: *\nAllow: /\n", "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts*": JSON.stringify(j) });
  const r = await bsky.discover({ fetcher: f, now, sources: [], queries: ["matcha pop up"] });
  assert.equal(r.items.length, 1, "the Kuala Lumpur post has no US place");
  const it = r.items[0];
  assert.equal(it.source_hint.id, "bluesky:leafandwhisk-bsky-social");
  assert.equal(it.source_hint.brand, "Leaf & Whisk");
  assert.equal(it.source_url, "https://bsky.app/profile/leafandwhisk.bsky.social/post/3abc");
  assert.match(it.image_url, /cdn\.bsky\.app/);
  const c = extract(it, { source: it.source_hint, now });
  assert.ok(c.some((x) => x.start.startsWith("2026-12-05T11:00")));
});

test("bluesky: 403 on the search stops the site quietly (skipped this run, not an error)", async () => {
  const f = fake({ "https://api.bsky.app/robots.txt": "" }, { status: { "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts*": 403 } });
  const r = await bsky.discover({ fetcher: f, now, sources: [], queries: ["a", "b"] });
  assert.match(r.stats.skipped, /HTTP 403; skipped this run/);
  assert.equal(f.seen.filter((u) => u.includes("searchPosts")).length, 1);
});

// ---- embed captions --------------------------------------------------------------------------------
const inbox = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-")); return d; };

test("embed: only the two embed paths are built, and only from a post url", () => {
  assert.equal(embedTarget("https://www.instagram.com/p/ABCDE12345/").embedUrl, "https://www.instagram.com/p/ABCDE12345/embed/captioned/");
  assert.equal(embedTarget("https://www.tiktok.com/@a.b/video/7300000000000000000").embedUrl, "https://www.tiktok.com/embed/v2/7300000000000000000");
  assert.equal(embedTarget("https://www.instagram.com/somebrand/"), null);
  assert.equal(embedTarget("https://www.instagram.com/explore/tags/matcha/"), null);
});

test("embed: the caller must be the inbox path (a file whose first line is the url)", async () => {
  const dir = inbox();
  fs.writeFileSync(path.join(dir, "a.txt"), "https://www.instagram.com/p/ABCDE12345/\n");
  const url = "https://www.instagram.com/p/ABCDE12345/";
  assert.ok(isInboxPaste("a.txt", url, dir));
  assert.ok(!isInboxPaste("a.txt", "https://www.instagram.com/p/OTHER99999/", dir));
  const f = fake({});
  await assert.rejects(() => fetchEmbed(url, { fetcher: f, caller: "search", file: "a.txt", dir }), /pasted into data\/inbox/);
  await assert.rejects(() => fetchEmbed(url, { fetcher: f, caller: "inbox", file: "nope.txt", dir }), /pasted into data\/inbox/);
  assert.equal(f.seen.length, 0, "nothing was requested");
});

test("embed: robots.txt that disallows the embed path means no request to it (what both hosts say today)", async () => {
  const dir = inbox();
  const ig = "https://www.instagram.com/p/ABCDE12345/", tt = "https://www.tiktok.com/@a/video/7300000000000000000";
  fs.writeFileSync(path.join(dir, "a.txt"), ig + "\n"); fs.writeFileSync(path.join(dir, "b.txt"), tt + "\n");
  const f = fake({ "https://www.instagram.com/robots.txt": "User-agent: *\nDisallow: /\n", "https://www.tiktok.com/robots.txt": "User-agent: *\nDisallow: /embed/v2\n" });
  const a = await fetchEmbed(ig, { fetcher: f, caller: "inbox", file: "a.txt", dir });
  const b = await fetchEmbed(tt, { fetcher: f, caller: "inbox", file: "b.txt", dir });
  assert.match(a.reason, /disallows/); assert.match(b.reason, /disallows/);
  assert.ok(!f.seen.some((u) => /embed/.test(u)));
});

test("embed: when a host allows the path, the caption is read; a login page gives up; the cap is 30", async () => {
  const dir = inbox();
  const ig = "https://www.instagram.com/p/ABCDE12345/";
  fs.writeFileSync(path.join(dir, "a.txt"), ig + "\n");
  const page = `<div class="Embed"><img class="EmbeddedMediaImage" src="https://scontent.test/p.jpg"><div class="Caption"><a class="CaptionUsername">leafandwhisk</a><br/>Pop-up Sat Dec 5 11am at 55 Spring St, Brooklyn, NY &amp; more</div></div>`;
  const ok = fake({ "https://www.instagram.com/robots.txt": "User-agent: *\nAllow: /\n", "https://www.instagram.com/p/ABCDE12345/embed/captioned/": page });
  const r = await fetchEmbed(ig, { fetcher: ok, caller: "inbox", file: "a.txt", dir });
  assert.ok(r.ok); assert.match(r.caption, /Pop-up Sat Dec 5 11am at 55 Spring St, Brooklyn, NY & more/); assert.equal(r.image, "https://scontent.test/p.jpg");
  const raw = await enrichFromEmbed({ source_url: ig, text: "" }, { fetcher: ok, file: "a.txt", dir });
  assert.match(raw.text, /Pop-up/);
  const keep = await enrichFromEmbed({ source_url: ig, text: "A caption the person pasted, long enough to win." }, { fetcher: ok, file: "a.txt", dir });
  assert.match(keep.text, /person pasted/);
  const login = fake({ "https://www.instagram.com/robots.txt": "", "https://www.instagram.com/p/ABCDE12345/embed/captioned/": `<html><body><a href="/accounts/login/">Log in to Instagram</a></body></html>` });
  assert.equal((await fetchEmbed(ig, { fetcher: login, caller: "inbox", file: "a.txt", dir })).reason, "login or challenge page");
  assert.equal(login.seen.filter((u) => u.includes("embed")).length, 1, "no retry");
  assert.equal(parseEmbed("<html>nothing</html>", "instagram"), null);
  const state = newEmbedState(); state.used = MAX_PER_RUN;
  assert.match((await fetchEmbed(ig, { fetcher: ok, caller: "inbox", file: "a.txt", dir, state })).reason, /cap of 30/);
});

// ---- markets: Renegade event page ------------------------------------------------------------------
test("markets: a Renegade fair page gives its own city, dated rows and matcha vendors; roster dates stay on their own page", async () => {
  const page = `<html><head><title>Renegade Craft — Seattle Winter</title></head><body><p>November 20 &ndash; 22</p>
<div>11/21/2026 11:00 am</div><div>11/21/2026 5:00 pm</div><div>America/Los_Angeles</div>
<div>12/05/2026 11:00 am</div><div>12/05/2026 5:00 pm</div>
<p>Renegade Craft @,</p><p>Hangar 30 @ Magnuson Park,</p><p>6310 NE 74th St.,</p><p>Seattle, WA 98115</p>
<div class="grid-item vendor"><h4 class="artist-title">MOONBEE MATCHA</h4></div><div class="grid-item vendor"><h4 class="artist-title">Moorea Seal</h4></div></body></html>`;
  const p = markets.parseRenegadeEvent(page);
  assert.equal(p.city, "Seattle"); assert.equal(p.state, "WA"); assert.equal(p.street, "6310 NE 74th St.");
  assert.equal(p.days.length, 2); assert.deepEqual(p.days[1], { y: 2026, mo: 12, d: 5, start: { h: 11, mi: 0 }, end: { h: 17, mi: 0 } });
  assert.deepEqual(p.vendors, ["MOONBEE MATCHA", "Moorea Seal"]);
  const f = fake({ "https://www.renegadecraft.com/robots.txt": "", "https://www.renegadecraft.com/": `<a href="https://www.renegadecraft.com/event/seattle-winter/">x</a>`, "https://www.renegadecraft.com/event/seattle-winter/": page });
  const r = await markets.discover({ fetcher: f, now, sources: [], existing: [], markets: [{ id: "renegade", name: "Renegade Craft Fair", city: "Chicago", state: "IL", address: "", pages: ["https://www.renegadecraft.com/"] }] });
  assert.equal(r.items.length, 1, "Nov 21 is before the run day, Dec 5 stays");
  assert.equal(r.items[0].hints.city, "Seattle");
  assert.match(r.items[0].hints.start, /^2026-12-05T11:00:00-08:00$/);
  assert.equal(r.items[0].source_hint.id, "markets:moonbee-matcha");
});
