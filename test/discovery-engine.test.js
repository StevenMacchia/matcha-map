// Rung N2: the web discovery engine. New crawlers (reddit, mastodon, gnews), key-gated APIs (ticketmaster, yelp events, eventbrite
// API), Bluesky's city rotation, quote-checked LLM extraction, the review folder and its promote step, the quality rules. No network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { judge, matchaSignal, NOISE } from "../ingest/lib/quality.js";
import * as reddit from "../ingest/lib/sites/reddit.js";
import * as mastodon from "../ingest/lib/sites/mastodon.js";
import * as gnews from "../ingest/lib/sites/gnews.js";
import * as bluesky from "../ingest/lib/sites/bluesky.js";
import * as ticketmaster from "../ingest/lib/sites/ticketmaster.js";
import * as yelpEvents from "../ingest/lib/sites/yelp-events.js";
import * as ebApi from "../ingest/lib/sites/eventbrite-api.js";
import { METROS, rotate } from "../ingest/lib/sites/metros.js";
import { SITES, NAMES, REVIEW_ONLY, capConfidence } from "../ingest/lib/sites/index.js";
import { SITE_ORDER } from "../ingest/lib/sites/common.js";
import { verify, mergeLlm, improve, resetCalls } from "../ingest/lib/llm.js";
import { toItem, writeReview, readReview, promote, normStart, sameEvent, unsureTable, toCandidate } from "../ingest/lib/review.js";
import { payFromText, hoursFromText, richFields } from "../ingest/lib/extract.js";
import { keepEvent, mergeEvents } from "../ingest/lib/write.js";
import { braveItems } from "../ingest/lib/discover.js";
import { table, markdown, newRow } from "../ingest/lib/yield.js";
import { findCity } from "../ingest/lib/cities.js";

const now = new Date("2026-11-22T20:00:00Z");
const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const ALLOW = "User-agent: *\nDisallow: /media_proxy/\n";
// A fake fetcher: routes(url) -> {status, text} (robots.txt allows everything unless routed).
const fake = (routes) => {
  const calls = [];
  return { calls, noFetch: false, async get(url) { calls.push(url); const r = routes(url) || (url.endsWith("/robots.txt") ? { status: 200, text: ALLOW } : { status: 404, text: "" }); return { ok: r.status < 400, status: r.status, text: r.text, fromCache: false }; } };
};
const noWait = async () => {};

// ---- quality rules -----------------------------------------------------------------------------
test("quality: hotel, craft-class and generic listings are not matcha pop-ups unless matcha is the point", () => {
  assert.equal(judge({ title: "Pottery with a Purpose", description: "matcha served" }).keep, false);
  assert.equal(judge({ title: "Tempo by Hilton Nashville Downtown", description: "matcha bar in the lobby" }).reason, "hotel");
  assert.equal(judge({ title: "Matcha Bowl Pottery Class - Handbuilding Ceramics Workshop", description: "make a ceramic matcha bowl" }).reason, "craft");
  assert.equal(judge({ title: "Pottery Chicago pop-up", description: "Comment “matcha” for the link!!" }).keep, false);
  assert.equal(judge({ title: "Downtown", description: "matcha" }).reason, "generic");
  assert.deepEqual(judge({ title: "Yoga, Matcha & Holiday Market", venue: "Hotel on Rivington" }), { keep: true, kind: null }, "matcha in the title");
  assert.equal(judge({ title: "Kettl pop-up", venue: "Ace Hotel", description: "a matcha pop-up with hojicha" }).keep, true, "matcha named as the point in the text");
  assert.equal(judge({ title: "Matcha Tasting 101" }).kind, "organizer", "classes and tastings are the schema's organizer (class) kind");
  assert.equal(judge({ title: "Holiday market", description: "a matcha bowl for sale" }).reason, "no-matcha");
  assert.ok(matchaSignal("matcha latte") && !matchaSignal("matcha whisk set"));
  assert.ok(NOISE.every((n) => n.id && n.why && n.re instanceof RegExp && n.on.length), "rules are data");
});
test("quality: keepEvent drops noisy site finds but never judges a real source", () => {
  const e = { source_id: "eventbrite:two-faced-ceramics", title: "Matcha Bowl Pottery Class", description: "create a ceramic matcha bowl", state: "IL", brand: "Two Faced Ceramics" };
  assert.equal(keepEvent(e), false);
  assert.equal(keepEvent({ ...e, source_id: "two-faced-ceramics" }), true);
  assert.equal(mergeEvents([], [{ ...e, start: "2026-12-06T10:00:00-06:00", tz: "America/Chicago", confidence: "likely" }], { now }).stats.cleaned, 1);
});

// ---- metros ------------------------------------------------------------------------------------
test("metros: 40 listed cities with their subreddits; the rotation walks them", () => {
  assert.equal(METROS.length, 40);
  for (const m of METROS) assert.equal(findCity(m.city, m.state)?.state, m.state, `${m.city}, ${m.state}`);
  assert.ok(METROS.some((m) => m.sub === "nyc") && METROS.some((m) => m.sub === "orangecounty"));
  const a = rotate(METROS, now, 8), b = rotate(METROS, new Date(now.getTime() + 6 * 3600000), 8);
  assert.equal(a.length, 8);
  assert.notDeepEqual(a, b);
});

// ---- reddit ------------------------------------------------------------------------------------
test("reddit: posts -> raws and leads; old, off-topic and question posts are not events", () => {
  const { raws, leads } = reddit.postsToRaw(JSON.parse(fx("n2-reddit-search.json")), "washingtondc", now);
  assert.equal(raws.length, 2, "the pop-up post and the question (filtered later by usable())");
  assert.equal(raws[0].organizer.name, "Cha Cha Matcha");
  assert.equal(raws[0].source_url, "https://www.reddit.com/r/washingtondc/comments/abc/cha_cha_matcha_popup/");
  assert.deepEqual(raws[0].hints, { city: "Washington", state: "DC" });
  assert.equal(raws[1].organizer.name, "r/washingtondc post");
  assert.deepEqual([...new Set(leads.map((l) => l.url))], ["https://www.instagram.com/p/AbC123/"]);
  assert.ok(reddit.searchPath("matcha").startsWith("/r/matcha/search?q=matcha+popup&restrict_sr=1&sort=new&t=month"));
});
test("reddit: robots.txt disallows everything, so without API keys the site is skipped", async () => {
  const f = fake((u) => (u.endsWith("/robots.txt") ? { status: 200, text: "User-agent: *\nDisallow: /\n" } : null));
  const r = await reddit.discover({ fetcher: f, now, env: {}, wait: noWait });
  assert.match(r.stats.skipped, /disallows \/.*REDDIT_CLIENT_ID/);
  assert.equal(f.calls.length, 1, "only robots.txt");
});
test("reddit: with the official API, a dated pop-up post becomes an event", async () => {
  const f = fake((u) => (u.endsWith("/robots.txt") ? { status: 200, text: "User-agent: *\nDisallow: /\n" } : u.includes("oauth.reddit.com/r/washingtondc/") ? { status: 200, text: fx("n2-reddit-search.json") } : u.includes("oauth.reddit.com") ? { status: 200, text: '{"data":{"children":[]}}' } : null));
  const http = async () => ({ ok: true, json: async () => ({ access_token: "t" }) });
  const r = await reddit.discover({ fetcher: f, now, env: { REDDIT_CLIENT_ID: "a", REDDIT_CLIENT_SECRET: "b" }, http, wait: noWait, perRun: 40 });
  assert.equal(r.stats.via, "oauth api");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].source_hint.id, "reddit:cha-cha-matcha");
  assert.ok(r.leads.length >= 1);
});

// ---- mastodon ----------------------------------------------------------------------------------
test("mastodon: HTML stripped, matcha pop-up statuses kept once across instances; a login-only instance is skipped", async () => {
  const list = JSON.parse(fx("n2-mastodon-tag.json"));
  const raws = mastodon.statusesToRaw(list, now);
  assert.equal(raws.length, 1);
  assert.ok(!/<|&ndash;/.test(raws[0].text) && /11am–4pm at Hester Street Fair/.test(raws[0].text));
  const f = fake((u) => (u.includes("hachyderm.io/api") ? { status: 401, text: "{}" } : u.includes("/timelines/tag/") ? { status: 200, text: fx("n2-mastodon-tag.json") } : u.includes("/api/v2/search") ? { status: 200, text: '{"statuses":[]}' } : null));
  const r = await mastodon.discover({ fetcher: f, now });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].source_hint.id, "mastodon:kettlnyc");
  assert.equal(r.items[0].source_hint.brand, "Kettl Tea");
  assert.deepEqual(r.stats.needAuth, ["hachyderm.io"]);
  assert.equal(r.stats.instances, 5);
});

// ---- gnews -------------------------------------------------------------------------------------
test("gnews: Google News RSS stays unread under its robots.txt; GDELT lists articles and local press is followed", async () => {
  const list = gnews.articleList(fx("n2-gdelt-artlist.json"));
  assert.equal(list.length, 2, "titles naming matcha only");
  assert.ok(gnews.looksLocal(list[0].url) && !gnews.looksLocal(list[1].url));
  const raw = gnews.articleToRaw(fx("n2-article.html"), list[0], now);
  assert.equal(raw.organizer.name, "Matcha Mama");
  assert.ok(!/city council/.test(raw.text), "only the matcha paragraphs");
  const f = fake((u) => {
    if (u === "https://news.google.com/robots.txt") return { status: 200, text: "User-agent: *\nDisallow: /\nAllow: /$\nAllow: /topics/\n" };
    if (u.startsWith("https://api.gdeltproject.org/api/")) return { status: 200, text: fx("n2-gdelt-artlist.json") };
    if (u === list[0].url) return { status: 200, text: fx("n2-article.html") };
    return null;
  });
  const r = await gnews.discover({ fetcher: f, now, wait: noWait });
  assert.equal(r.stats.google, "robots.txt disallows /rss/search");
  assert.ok(!f.calls.some((u) => u.includes("news.google.com/rss")));
  assert.equal(r.stats.articlesRead, 1);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].source_hint.id, "gnews:matcha-mama");
});
test("gnews: a GDELT rate-limit reply stops the run", async () => {
  const f = fake((u) => (u.startsWith("https://api.gdeltproject.org/api/") ? { status: 200, text: "Please limit requests to one every 5 seconds" } : null));
  const r = await gnews.discover({ fetcher: f, now, wait: noWait });
  assert.equal(r.stats.stopped, "GDELT rate limit");
  assert.equal(f.calls.filter((u) => u.includes("/api/v2/doc")).length, 1);
});

// ---- bluesky -----------------------------------------------------------------------------------
test("bluesky: per-city queries rotate over the metros; a 403 or an HTML reply is a quiet skip", async () => {
  const q = bluesky.queriesFor(now, 6);
  assert.equal(q.length, bluesky.QUERIES.length + 12);
  assert.ok(q.some((x) => /^matcha pop up /.test(x)) && q.some((x) => /^matcha bar /.test(x)));
  const f403 = fake((u) => (u.includes("searchPosts") ? { status: 403, text: "<html>Forbidden</html>" } : null));
  const r = await bluesky.discover({ fetcher: f403, now });
  assert.match(r.stats.skipped, /HTTP 403; skipped this run/);
  assert.equal(f403.calls.filter((u) => u.includes("searchPosts")).length, 1);
  const fHtml = fake((u) => (u.includes("searchPosts") ? { status: 200, text: "<html>hi</html>" } : null));
  assert.match((await bluesky.discover({ fetcher: fHtml, now })).stats.skipped, /non-JSON/);
});

// ---- key-gated APIs ----------------------------------------------------------------------------
test("ticketmaster and the Eventbrite API are off without their keys; yelp events is off even with one (docs/YELP-TERMS.md)", async () => {
  for (const m of [ticketmaster, ebApi]) {
    const f = fake(() => null);
    const r = await m.discover({ fetcher: f, now, env: {} });
    assert.match(r.stats.skipped, /^off \(set [A-Z_]+/, m.name);
    assert.equal(f.calls.length, 0);
  }
  for (const env of [{}, { YELP_API_KEY: "k" }]) {
    const f = fake(() => null);
    const r = await yelpEvents.discover({ fetcher: f, now, env });
    assert.match(r.stats.skipped, /YELP-TERMS/);
    assert.equal(f.calls.length, 0);
  }
});
test("ticketmaster: Discovery events -> raws with local time, street and US state only", async () => {
  const raws = ticketmaster.eventsToRaw(JSON.parse(fx("n2-ticketmaster.json")));
  assert.equal(raws.length, 2, "Toronto dropped");
  assert.equal(raws[0].hints.start, "2026-12-12T18:00:00-08:00");
  assert.equal(raws[0].hints.address, "700 W 32nd St, Los Angeles, CA 90007");
  assert.equal(raws[0].price_hint, "$10-25");
  const f = fake((u) => (u.includes("discovery/v2/events.json") ? { status: 200, text: fx("n2-ticketmaster.json") } : null));
  const r = await ticketmaster.discover({ fetcher: f, now, env: { TICKETMASTER_API_KEY: "k" } });
  assert.equal(r.items.length, 1, "matcha only");
});
test("yelp events and the Eventbrite API parse their responses", async () => {
  const y = yelpEvents.eventsToRaw(JSON.parse(fx("n2-yelp-events.json")));
  assert.equal(y.length, 1);
  assert.equal(y[0].hints.address, "348 Bowery, New York, NY 10012");
  assert.equal(y[0].price_hint, "$30");
  assert.equal(ebApi.organizerId("https://www.eventbrite.com/o/the-plant-shop-987654321"), "987654321");
  const e = ebApi.eventsToRaw(JSON.parse(fx("n2-eventbrite-api.json")), "The Plant Shop");
  assert.equal(e.length, 1, "online event dropped");
  assert.equal(e[0].hints.start, "2026-12-06T11:00:00-06:00");
  const f = fake((u) => (u.includes("/organizers/987654321/events/") || u.includes("/venues/555/events/") ? { status: 200, text: fx("n2-eventbrite-api.json") } : null));
  const r = await ebApi.discover({ fetcher: f, now, env: { EVENTBRITE_TOKEN: "t" }, sources: [{ id: "plant", brand: "The Plant Shop", schedule_url: "https://www.eventbrite.com/o/the-plant-shop-987654321" }] });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].source_hint.id, "plant", "a known brand keeps its source");
});

// ---- registration ------------------------------------------------------------------------------
test("every new crawler is registered, ranked and capped", () => {
  for (const n of ["reddit", "mastodon", "gnews", "ticketmaster", "eventbrite-api", "yelpevents"]) assert.ok(NAMES.includes(n) && SITES.some((s) => s.name === n), n);
  for (const p of ["reddit", "mastodon", "gnews", "ticketmaster", "yelpevents", "review"]) assert.ok(SITE_ORDER.includes(p), p);
  for (const n of ["reddit", "mastodon", "gnews", "yelpevents"]) assert.ok(REVIEW_ONLY.has(n));
  assert.equal(capConfidence({ source_id: "mastodon:x", confidence: "confirmed" }).confidence, "likely");
  assert.equal(capConfidence({ source_id: "reddit:r-nyc-post", brand: "r/nyc post", confidence: "likely" }).confidence, "unsure");
  assert.equal(capConfidence({ source_id: "ticketmaster:x", confidence: "confirmed" }).confidence, "confirmed");
});
test("brave: post results announcing a matcha pop-up become instagram raws", () => {
  const json = { web: { results: [
    { url: "https://www.instagram.com/p/Xyz/", title: "Matcha Club (@matchaclub) on Instagram", description: "Matcha pop up Saturday Dec 6 at Blue Bottle, Austin, TX", page_age: "2026-11-20T00:00:00" },
    { url: "https://www.instagram.com/matchaclub/", title: "Matcha Club (@matchaclub)", description: "matcha pop up" },
    { url: "https://www.instagram.com/p/Abc/", title: "Someone on Instagram", description: "matcha pop up" },
  ] } };
  const r = braveItems(json, "Austin, TX");
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].handle, r[0].hints.city, r[0].hints.state], ["matchaclub", "Austin", "TX"]);
});

// ---- LLM, quote-checked ------------------------------------------------------------------------
const POST = "Kettl pop-up this weekend! Saturday Dec 6, 11am to 3pm at Hester Street Fair in New York, NY. Cash and Venmo. Hojicha lattes.";
test("llm: fields survive only with a quote from the post that supports them", () => {
  const ans = {
    brand: { value: "Kettl", quote: "Kettl pop-up" },
    date: { value: "2026-12-06", quote: "Saturday Dec 6" },
    start_time: { value: "11:00", quote: "11am to 3pm" }, end_time: { value: "15:00", quote: "11am to 3pm" },
    venue: { value: "Hester Street Fair", quote: "at Hester Street Fair" },
    city: { value: "New York", quote: "in New York, NY" }, state: { value: "NY", quote: "New York, NY" },
    menu: { value: ["hojicha lattes", "yuzu soda"], quote: "Hojicha lattes" }, pay: { value: "Cash and Venmo", quote: "Cash and Venmo" },
    address: { value: "135 Hester St", quote: "135 Hester St" },
  };
  const v = verify(ans, POST, { now });
  assert.equal(v.start, "2026-12-06T11:00:00-05:00");
  assert.equal(v.end, "2026-12-06T15:00:00-05:00");
  assert.deepEqual([v.venue, v.city, v.state, v.pay, v.brand], ["Hester Street Fair", "New York", "NY", "Cash and Venmo", "Kettl"]);
  assert.deepEqual(v.menu, ["hojicha lattes"], "an item the post never names is dropped");
  assert.equal(v.address, undefined, "an invented street is dropped");
  assert.equal(verify({ date: { value: "2026-12-07", quote: "Saturday Dec 6" } }, POST, { now }).start, undefined, "a date the quote does not say");
  assert.equal(verify({ date: { value: "2026-12-06", quote: "Dec 6 brunch" } }, POST, { now }).start, undefined, "a quote not in the post");
});
test("llm: improve() runs only for unsure readings, fills blanks and is likely with a checked place", async () => {
  resetCalls();
  const reply = { brand: { value: "Kettl", quote: "Kettl pop-up" }, date: { value: "2026-12-06", quote: "Saturday Dec 6" }, start_time: { value: "11:00", quote: "11am to 3pm" }, venue: { value: "Hester Street Fair", quote: "at Hester Street Fair" }, city: { value: "New York", quote: "in New York, NY" }, state: { value: "NY", quote: "New York, NY" } };
  let sent = null;
  const fetchFn = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(reply) }] }) }; };
  const unsure = [{ title: "Kettl pop-up", start: "2026-12-06T00:00:00-05:00", all_day: true, tz: "America/New_York", venue: "", address: "", city: "Brooklyn", state: "NY", cityInferred: true, confidence: "unsure", extracted_by: "rule" }];
  const out = await improve(unsure, { text: POST }, { env: { CLAUDE_API_KEY: "k" }, now, fetchFn });
  assert.equal(sent.model, "claude-sonnet-5-5");
  assert.equal(sent.max_tokens, 800);
  assert.deepEqual([out[0].start, out[0].venue, out[0].city, out[0].extracted_by, out[0].confidence], ["2026-12-06T11:00:00-05:00", "Hester Street Fair", "New York", "llm", "likely"]);
  sent = null;
  await improve([{ ...unsure[0], confidence: "likely" }], { text: POST }, { env: { CLAUDE_API_KEY: "k" }, now, fetchFn });
  assert.equal(sent, null, "a likely reading is not sent");
  assert.deepEqual(mergeLlm(unsure, {}), unsure);
});

// ---- rich fields -------------------------------------------------------------------------------
test("pay, hours and evidence are read from the text", () => {
  assert.equal(payFromText("Cash only!"), "cash only");
  assert.equal(payFromText("We take Venmo, Zelle and credit cards"), "card, Venmo, Zelle");
  assert.equal(payFromText("Cash App accepted"), "Cash App");
  assert.equal(payFromText("see you there"), null);
  assert.equal(hoursFromText("Hours: 10am - 2pm"), "10am - 2pm");
  assert.equal(hoursFromText("open until sold out"), "until sold out");
  assert.equal(hoursFromText("Saturday 10am"), null);
  const r = richFields({ source_url: "https://a.example/p", text: "Venmo only... hours: 9-1", evidence: ["https://b.example/x", "nope"] });
  assert.deepEqual(r.evidence, ["https://a.example/p", "https://b.example/x"]);
  assert.equal(r.hours, "9-1");
});

// ---- review folder -----------------------------------------------------------------------------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mm-review-"));
const cand = (o = {}) => ({ brand: "Kettl", source_id: "mastodon:kettlnyc", kind: "popup", title: "Kettl pop-up", start: "2026-12-07T11:00:00-05:00", end: null, tz: "America/New_York", all_day: false, venue: "Hester Street Fair", address: "", city: "New York", state: "NY", lat: 40.716, lng: -73.99, approx: false, source_url: "https://mastodon.social/@kettlnyc/1", confidence: "likely", extracted_by: "rule", menu: ["hojicha latte"], posts: { instagram: null, tiktok: null, other: null }, evidence: [], ...o });
test("review: candidates are written to data/review/<day>.json, merged by key, read back from every file", () => {
  const dir = tmp();
  const a = writeReview([toItem(cand(), "mastodon")], { now, dir });
  assert.equal(path.basename(a.file), "2026-11-22.json");
  writeReview([toItem(cand({ confidence: "unsure" }), "mastodon"), toItem(cand({ brand: "Other", venue: "Elsewhere" }), "reddit")], { now, dir });
  const j = JSON.parse(fs.readFileSync(a.file, "utf8"));
  assert.ok(j.generated && j.items.length === 2, "same key replaced");
  const it = j.items.find((i) => i.brand === "Kettl");
  assert.deepEqual(it.evidence, ["https://mastodon.social/@kettlnyc/1"]);
  assert.match(it.notes, /found by mastodon/);
  assert.equal(it.posts, undefined, "empty fields left out");
  fs.writeFileSync(path.join(dir, "sweep-west.json"), JSON.stringify({ generated: now.toISOString(), items: [{ brand: "X" }] }));
  fs.writeFileSync(path.join(dir, "broken.json"), "{");
  fs.writeFileSync(path.join(dir, "2026-10-01.json"), JSON.stringify({ items: [] }));
  writeReview([], { now, dir });
  assert.ok(!fs.existsSync(path.join(dir, "2026-10-01.json")), "old run files pruned");
  const all = readReview(dir);
  assert.equal(all.length, 3);
  assert.ok(all.some((i) => i._file === "sweep-west.json"));
});
test("review: normStart reads dates with or without a time or an offset", () => {
  assert.deepEqual(normStart("2026-12-06", "America/Chicago"), { start: "2026-12-06T00:00:00-06:00", all_day: true });
  assert.deepEqual(normStart("2026-12-06T09:30", "America/Chicago"), { start: "2026-12-06T09:30:00-06:00", all_day: false });
  assert.equal(normStart("2026-12-06T09:30:00-08:00", "America/Chicago").start, "2026-12-06T09:30:00-08:00");
  assert.equal(normStart("next Saturday", "America/Chicago"), null);
});
test("promote: confirmed and likely only; hedged notes stay; missing fields tolerated; sweep items marked", () => {
  const items = [
    { ...toItem(cand()), _file: "2026-11-22.json" },
    { ...toItem(cand({ brand: "Unsure Co", confidence: "unsure" })), _file: "2026-11-22.json" },
    { brand: "Central Matcha", start: "2026-12-06", city: "Austin", state: "TX", address: "2209 S 1st St", confidence: "likely", evidence: ["https://centralmatcha.com/pages/find-us"], notes: "Saturday farmers market", _file: "sweep-texas.json" },
    { brand: "Weekly Co", start: "2026-12-06T09:00", city: "Austin", state: "TX", confidence: "likely", evidence: ["https://x.example"], notes: "sample date of a weekly residency", _file: "sweep-texas.json" },
    { brand: "Class Co", title: "Matcha Whisking Class", start: "2026-12-06T09:00", city: "Austin", state: "TX", confidence: "confirmed", evidence: ["https://y.example"], _file: "sweep-texas.json" },
    { brand: "No State", start: "2026-12-06", confidence: "likely", evidence: ["https://z.example"], _file: "sweep-texas.json" },
    { brand: "Hotel Co", title: "Tempo by Hilton Nashville Downtown", start: "2026-12-06", city: "Nashville", state: "TN", confidence: "likely", evidence: ["https://h.example"], _file: "sweep-x.json" },
  ];
  const { candidates, stats } = promote(items, [], { now });
  assert.equal(stats.promoted, 3);
  assert.equal(stats.unsure, 2);
  assert.equal(stats.hedged, 1);
  assert.deepEqual(stats.dropped, { "no state": 1, hotel: 1 });
  const cm = candidates.find((c) => c.brand === "Central Matcha");
  assert.deepEqual([cm.extracted_by, cm.all_day, cm.lat, cm.keepCoords, cm.source_id], ["sweep", true, null, false, "review:central-matcha"], "geocoded later by finalize: an address without lat/lng");
  assert.deepEqual(cm.evidence, ["https://centralmatcha.com/pages/find-us"]);
  assert.equal(candidates.find((c) => c.brand === "Class Co").kind, "organizer");
  assert.equal(candidates.find((c) => c.brand === "Kettl").keepCoords, true);
  assert.equal(toCandidate({ brand: "A", state: "TX", start: "2026-12-06" }).drop, "no source url");
  const set = promote([{ ...toItem({ ...cand(), drop: "better source has it" }, "eventbrite"), _file: "2026-11-22.json" }], [], { now });
  assert.deepEqual([set.stats.promoted, set.stats.dropped], [0, { "better source has it": 1 }], "an item the crawler set aside is not promoted");
});
test("promote: the same brand, day and venue (or within 300 m) merges into the event held, richer value kept", () => {
  const held = { id: "held1", brand: "Kettl", source_id: "kettl", title: "Kettl pop-up", start: "2026-12-07T00:00:00-05:00", all_day: true, venue: "Hester St. Fair", address: "", city: "New York", state: "NY", lat: 40.7162, lng: -73.9905, approx: false, confidence: "likely", menu: [], description: null, evidence: [] };
  assert.ok(sameEvent(held, cand()), "within 300 m");
  assert.ok(!sameEvent({ ...held, lat: 40.75 }, cand()), "1.5 km away and a different venue spelling");
  assert.ok(!sameEvent(held, cand({ start: "2026-12-08T11:00:00-05:00" })), "another day");
  const { candidates, stats } = promote([{ ...toItem(cand({ description: "Hojicha and matcha lattes at the fair", pay: "cash" })), _file: "sweep-northeast.json" }], [held], { now });
  assert.equal(stats.merged, 1);
  const m = candidates[0];
  assert.deepEqual([m.id, m.source_id, m.venue, m.start, m.all_day], ["held1", "kettl", "Hester St. Fair", "2026-12-07T11:00:00-05:00", false], "id inputs kept, the time added");
  assert.deepEqual([m.description, m.pay, m.menu], ["Hojicha and matcha lattes at the fair", "cash", ["hojicha latte"]]);
  assert.deepEqual(m.evidence, ["https://mastodon.social/@kettlnyc/1"]);
  const twice = promote([{ ...toItem(cand()), _file: "a.json" }, { ...toItem(cand({ price: "$7" })), _file: "sweep-b.json" }], [], { now });
  assert.deepEqual([twice.stats.promoted, twice.stats.duplicates, twice.candidates[0].price], [1, 1, "$7"]);
});
test("review: the unsure table lists what a human must check", () => {
  const { rows, text } = unsureTable([{ ...toItem(cand({ confidence: "unsure" })), _file: "2026-11-22.json" }, { ...toItem(cand()), _file: "x.json" }, { ...toItem(cand({ brand: "Hedge" })), notes: "time is a placeholder", _file: "sweep-y.json" }]);
  assert.equal(rows.length, 2);
  assert.match(text.split("\n")[0], /^date\s+brand\s+title\s+where\s+file\s+evidence$/);
  assert.match(text, /mastodon\.social\/@kettlnyc\/1/);
});
test("write: events carry hours, pay and evidence", () => {
  const r = mergeEvents([], [{ ...cand({ source_id: "kettl", pay: "cash", hours: "11-3", evidence: ["https://a.example", "bad"] }) }], { now });
  assert.deepEqual([r.events[0].pay, r.events[0].hours, r.events[0].evidence], ["cash", "11-3", ["https://a.example"]]);
});

// ---- yield report ------------------------------------------------------------------------------
test("yield: the per-source table and the markdown carry every column, zeros included", () => {
  const rows = [{ ...newRow("reddit", 1, "robots"), dropped: {} }, { ...newRow("mastodon", 25), candidates: 3, dated: 2, geocoded: 1, promoted: 1, dropped: { hotel: 1 } }];
  const t = table(rows);
  assert.match(t.split("\n")[0], /^source\s+fetched\s+candidates\s+dated\s+geocoded\s+promoted\s+dropped$/);
  assert.match(t, /mastodon\s+25\s+3\s+2\s+1\s+1\s+hotel 1/);
  const md = markdown(rows, { now, totals: { fetched: 26 } });
  assert.match(md, /\| reddit \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \| robots \|/);
  assert.match(md, /- fetched: 26/);
});
