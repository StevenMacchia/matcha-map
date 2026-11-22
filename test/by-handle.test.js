import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as ss from "../ingest/lib/sites/social-search.js";
import { parsePostText, parseEnDate } from "../ingest/lib/sites/ig-caption.js";
import { extract } from "../ingest/lib/extract.js";
import * as wl from "../ingest/lib/watchlist.js";
import ms, { parseMarkets, parseEventLinks, parseEvent } from "../ingest/adapters/marketspread.js";

const now = new Date("2026-11-22T12:00:00Z"); // a Sunday
const P = (t) => parsePostText(t, { now });

test("og:description: five shapes, with and without a date, and non-English months rejected", () => {
  const a = P('1,234 likes, 56 comments - newberyst on November 18, 2026: "Matcha pop-up this Saturday at 135 Wythe Ave"');
  assert.deepEqual([a.handle, a.published, a.likes, a.comments, a.shape], ["newberyst", "2026-11-18T12:00:00.000Z", 1234, 56, "counts"]);
  assert.equal(a.caption, "Matcha pop-up this Saturday at 135 Wythe Ave");
  const b = P("Come get a matcha latte at our cart - @saylessmatcha on November 6, 2026.");
  assert.deepEqual([b.handle, b.published, b.shape], ["saylessmatcha", "2026-11-06T12:00:00.000Z", "tail"]);
  const c = P("Video by Newbery Street Coffee Roasters on Nov 14, 2026.");
  assert.deepEqual([c.handle, c.published], [null, "2026-11-14T12:00:00.000Z"]);
  const d = P("- Author: @dezmatcha (dez matcha) - Posted: 2026-11-07T18:35:45+00:00 - Type: clips");
  assert.deepEqual([d.handle, d.published], ["dezmatcha", "2026-11-07T18:35:45.000Z"]);
  const e = P('12 likes - foo.bar: "pop up soon, no date in this caption"'); // no date at all
  assert.deepEqual([e.handle, e.published, e.nonEnglishMonth], ["foo.bar", null, false]);
  const f = P('45 likes, 3 comments - cafe_uno on 18 de noviembre de 2026: "hoy abrimos"'); // Spanish month: not read
  assert.deepEqual([f.handle, f.published, f.nonEnglishMonth], ["cafe_uno", null, true]);
  assert.equal(P("Posté le 3 janvier 2026").nonEnglishMonth, true);
  assert.equal(P("Beitrag vom 5 Dezember 2026").nonEnglishMonth, true);
  assert.equal(P('9 likes - a_b on December 30, 2026: "from the future"').published, null); // a post cannot be dated after today
  assert.equal(parseEnDate("February 30, 2026"), null);
  const t = P("TikTok video from dima (@dimamatcha): “Matcha pop up Saturday”");
  assert.deepEqual([t.handle, t.shape], ["dimamatcha", "tiktok"]);
});

test("relative dates resolve against the post date, and past ones are dropped", () => {
  const src = { brand: "Brand", home_city: "Austin", home_state: "TX", instagram: "brand" };
  const run = (text, published_at, extra = {}) => extract({ text, published_at, source_url: "u", hints: { city: "Austin", state: "TX" }, ...extra }, { source: src, now });
  // posted Saturday Nov 21: "tomorrow" is Sunday Nov 22 (today), kept
  assert.equal(run("Matcha pop up tomorrow 10am-2pm at 500 Congress Ave", "2026-11-21T17:00:00Z")[0].start.slice(0, 10), "2026-11-22");
  // posted Friday Nov 13: "this Saturday" is Nov 14, past: nothing
  assert.equal(run("Matcha pop up this Saturday 10am at 500 Congress Ave", "2026-11-13T17:00:00Z").length, 0);
  // posted Friday Nov 20: "this Saturday" is Nov 21, still past on Sunday Nov 22
  assert.equal(run("Matcha pop up this Saturday 10am", "2026-11-20T17:00:00Z").length, 0);
  // posted Sunday Nov 22: "this weekend" is today
  assert.equal(run("Matcha cart this weekend 10am-2pm at 500 Congress Ave", "2026-11-22T10:00:00Z").length, 1);
  // no trusted post date: a relative word is never resolved against "now"
  assert.equal(run("Matcha pop up tomorrow 10am at 500 Congress Ave", null, { noRelative: true }).length, 0);
  // an explicit date does not need the post date
  assert.equal(run("Matcha pop up December 6 11am at 500 Congress Ave", null, { noRelative: true }).length, 1);
});

const igRes = (o) => ({ url: "https://www.instagram.com/p/Cabc123/", title: "", content: "", ...o });
test("an Instagram result: the post date from the og:description turns 'this Saturday' into a day", () => {
  const res = igRes({ content: '88 likes, 4 comments - matchamaker on November 22, 2026: "Matcha pop up this Saturday 11am-3pm at 200 Main St, Dallas"' });
  // posted Sunday Nov 22: "this Saturday" is Nov 28, upcoming
  const r = ss.resultToItem(res, { now, sources: [] });
  assert.equal(r.reason, "ok");
  assert.equal(r.raw.published_at, "2026-11-22T12:00:00.000Z");
  assert.equal(r.raw.source_hint.id, "instagram:matchamaker");
  // posted a week earlier: the same words point at a past Saturday, so no event
  const old = ss.resultToItem(igRes({ content: res.content.replace("November 22", "November 14") }), { now, sources: [] });
  assert.notEqual(old.reason, "ok");
  // no post date and no calendar date: nothing
  const nodate = ss.resultToItem(igRes({ content: "Matcha pop up this Saturday 11am at 200 Main St, Dallas" }), { now, sources: [] });
  assert.equal(nodate.raw, null);
  // raw_content's Posted line gives the date when the snippet has none
  const viaRaw = ss.resultToItem(igRes({ content: "Matcha pop up tomorrow 11am at 200 Main St, Dallas", raw_content: "- Author: @dezmatcha - Posted: 2026-11-21T18:35:45+00:00 - Type: clips" }), { now, sources: [] });
  assert.equal(viaRaw.reason, "ok");
  assert.equal(viaRaw.raw.hints.city, "Dallas");
});

test("neighbourhood: a post that names Williamsburg is filed under Brooklyn", () => {
  assert.deepEqual(ss.cityIn("matcha pop up in Williamsburg this weekend"), { city: "Brooklyn", state: "NY" });
  assert.deepEqual(ss.cityIn("matcha in Pasadena"), { city: "Pasadena", state: "CA" });
  assert.deepEqual(ss.cityIn("Silver Lake matcha, Los Angeles"), { city: "Los Angeles", state: "CA" });
  assert.equal(ss.cityIn("#Williamsburg"), null);
});

test("by-handle priority: hit first, then watching, then candidates, oldest check first; the cap picks the head", () => {
  const a = (handle, o) => ({ handle, platform: "instagram", status: "candidate", hits: 0, last_checked: null, ...o });
  const list = [
    a("cand_old", { last_checked: "2026-11-01T00:00:00Z" }), a("watch_new", { status: "watching", last_checked: "2026-11-20T00:00:00Z" }),
    a("hit_new", { status: "watching", hits: 2, last_checked: "2026-11-21T00:00:00Z" }), a("watch_old", { status: "watching", last_checked: "2026-11-02T00:00:00Z" }),
    a("hit_old", { status: "quiet", hits: 1, last_checked: "2026-10-01T00:00:00Z" }), a("never", {}), a("tt", { platform: "tiktok", hits: 5 }),
  ];
  assert.deepEqual(wl.pickForSearch(list, "instagram", 99).map((x) => x.handle), ["hit_old", "hit_new", "watch_old", "watch_new", "never", "cand_old"]);
  assert.deepEqual(wl.pickForSearch(list, "instagram", 3).map((x) => x.handle), ["hit_old", "hit_new", "watch_old"]);
  assert.deepEqual(wl.pickForSearch(list, "tiktok", 0), []);
});

test("recheckInstagram: one credit per account, own posts only, stops at the cap", async () => {
  let calls = 0, body = null;
  const http = async (url, opts) => {
    calls++; body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ results: [
      { url: "https://www.instagram.com/p/Cmine1/", title: "x", content: '9 likes, 1 comments - matchamaker on November 21, 2026: "Matcha pop up tomorrow 11am-3pm at 200 Main St, Dallas"' },
      { url: "https://www.instagram.com/p/Cother/", title: "y", content: '9 likes, 1 comments - somebodyelse on November 21, 2026: "Matcha pop up tomorrow 11am at 5 Elm St, Dallas"' },
      { url: "https://www.instagram.com/popular/matcha/", title: "z", content: "matcha" },
    ] }) };
  };
  const budget = { ...ss.loadBudget("nope.json", now), per_run: 2 };
  const ctx = { now, env: { TAVILY_API_KEY: "k" }, http, budget };
  const r1 = await ss.recheckInstagram({ handle: "matchamaker", platform: "instagram" }, ctx);
  assert.equal(r1.seen, 1);
  assert.equal(r1.length, 1);
  assert.equal(r1[0].posts.instagram, "https://www.instagram.com/p/Cmine1/");
  assert.equal(r1[0].source_hint.id, "instagram:matchamaker");
  assert.equal(r1[0].published_at, "2026-11-21T12:00:00.000Z");
  assert.equal(body.query, '"matchamaker" matcha');
  assert.deepEqual(body.include_domains, ["instagram.com"]);
  assert.equal(body.max_results, 10);
  assert.equal(body.time_range, "month");
  assert.ok(await ss.recheckInstagram({ handle: "second", platform: "instagram" }, ctx));
  assert.equal(await ss.recheckInstagram({ handle: "third", platform: "instagram" }, ctx), null); // per-run cap of 2
  assert.equal(calls, 2);
  assert.equal(budget.used_run, 2);
  assert.equal(await ss.recheckInstagram({ handle: "x", platform: "instagram" }, { now, env: {}, http }), null); // no key
});

test("MarketSpread: vendor markets, event links, and an event only when the day's list names the vendor", async () => {
  const fx = (n) => fs.readFileSync(new URL(`./fixtures/marketspread/${n}`, import.meta.url), "utf8");
  const markets = parseMarkets(fx("vendor.html"));
  assert.equal(markets.length, 1);
  assert.deepEqual([markets[0].id, markets[0].name], ["9399", "Piedmont Triad Farmers Market"]);
  assert.match(markets[0].address, /Colfax, NC 27235/);
  assert.equal(parseEventLinks(fx("market.html")).length, 3);
  const tent = parseEvent(fx("event-tentative.html"));
  assert.deepEqual([tent.tentative, tent.attending.length, tent.date], [true, 0, { y: 2026, mo: 11, d: 23 }]);
  const conf = parseEvent(fx("event-confirmed.html"));
  assert.ok(conf.attending.includes("166649"));
  const pages = {
    "https://marketspread.com/vendor/166649/matcha-mamas/": "vendor.html", "https://marketspread.com/market/9399/piedmont-triad-farmers-market/": "market.html",
    "https://marketspread.com/market/9399/piedmont-triad-farmers-market/events/79600/": "event-tentative.html",
    "https://marketspread.com/market/9399/piedmont-triad-farmers-market/events/79601/": "event-confirmed.html",
    "https://marketspread.com/market/9399/piedmont-triad-farmers-market/events/79602/": "event-tentative.html",
  };
  const fetcher = { get: async (u) => (pages[u] ? { ok: true, status: 200, text: fx(pages[u]) } : { ok: false, status: 404, text: "" }) };
  const source = { id: "matcha-mamas", brand: "Matcha Mamas", instagram: "matchamamas", home_city: "Greensboro", home_state: "NC", schedule_url: "https://marketspread.com/vendor/166649/matcha-mamas/" };
  assert.ok(ms.matches(source));
  const items = await ms.fetch(source, { fetcher, now });
  assert.equal(items.length, 1); // the two tentative days are not claimed
  assert.equal(items[0].hints.start, "2026-11-23T07:00:00-05:00");
  assert.equal(items[0].hints.venue, "Piedmont Triad Farmers Market");
  assert.equal(items[0].hints.state, "NC");
  assert.equal(items[0].handle, "matchamamas");
});
