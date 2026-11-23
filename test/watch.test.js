import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as wl from "../ingest/lib/watchlist.js";
import { extractMentions, parseSearchUrl, fromBraveResults, fromGraphItems, addAll, citiesForRun, fromMatoHtml, fromLumaData } from "../ingest/lib/discover.js";
import igAdapter, { mapBusinessDiscovery, mapHashtagMedia, mapAccountFacts, createRate, shortcodeOf, creds, runAllowance, HOURLY_LIMIT } from "../ingest/adapters/instagram-graph.js";
import { parseEnv } from "../ingest/lib/env.js";

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const D = 86400000;
const t0 = new Date("2026-11-22T12:00:00Z");
const daysAgo = (n) => new Date(t0 - n * D).toISOString();
const acct = (o = {}) => ({ ...wl.newAccount({ handle: "brand", status: "watching" }, new Date(daysAgo(200))), ...o });

// ---- cadence and status ---------------------------------------------------------------------
test("cadence: 24h with a hit in 30 days, 72h with none, 168h quiet", () => {
  assert.equal(wl.cadenceFor(acct({ last_post_with_popup: daysAgo(10) }), t0), 24);
  assert.equal(wl.cadenceFor(acct({ last_post_with_popup: daysAgo(45) }), t0), 72);
  assert.equal(wl.cadenceFor(acct({ last_post_with_popup: null }), t0), 72);
  assert.equal(wl.cadenceFor(acct({ status: "quiet" }), t0), 168);
  assert.equal(wl.cadenceFor(acct({ status: "candidate" }), t0), 72);
});
test("isDue follows last_checked and cadence", () => {
  assert.ok(wl.isDue(acct({ last_checked: null }), t0));
  assert.ok(wl.isDue(acct({ last_checked: daysAgo(4), cadence_hours: 72 }), t0));
  assert.ok(!wl.isDue(acct({ last_checked: daysAgo(1), cadence_hours: 72 }), t0));
  assert.ok(!wl.isDue(acct({ status: "dropped" }), t0));
});
test("candidate becomes watching on first hit and counts it", () => {
  const a = acct({ status: "candidate", first_seen: daysAgo(3) });
  wl.recordCheck(a, { now: t0, hitCount: 2, popupAt: daysAgo(1) });
  assert.equal(a.status, "watching");
  assert.equal(a.hits, 2);
  assert.equal(a.checks, 1);
  assert.equal(a.last_post_with_popup, daysAgo(1));
  assert.equal(a.cadence_hours, 24);
  assert.equal(a.last_checked, t0.toISOString());
});
test("watching with no hit for 90 days goes quiet; a later hit wakes it", () => {
  const a = acct({ last_post_with_popup: daysAgo(95) });
  wl.recordCheck(a, { now: t0 });
  assert.equal(a.status, "quiet");
  assert.equal(a.cadence_hours, 168);
  wl.recordCheck(a, { now: t0, hitCount: 1 });
  assert.equal(a.status, "watching");
});
test("watching with no hit for 60 days stays watching at 72h", () => {
  const a = acct({ last_post_with_popup: daysAgo(60) });
  wl.recordCheck(a, { now: t0 });
  assert.equal(a.status, "watching");
  assert.equal(a.cadence_hours, 72);
});
test("candidate with no hit for 60 days is dropped; found-but-known counts for status, not hits", () => {
  const a = acct({ status: "candidate", first_seen: daysAgo(61) });
  wl.recordCheck(a, { now: t0 });
  assert.equal(a.status, "dropped");
  const b = acct({ status: "candidate", first_seen: daysAgo(2) });
  wl.recordCheck(b, { now: t0, hitCount: 0, foundCount: 1 });
  assert.equal(b.status, "watching");
  assert.equal(b.hits, 0);
});
test("seed makes watching accounts from sources; addCandidate skips known handles", () => {
  const src = [{ id: "a-b", instagram: "A.B" }, { id: "no-ig", instagram: null }];
  const w = wl.seedFromSources(src, undefined, t0);
  assert.equal(w.accounts.length, 1);
  assert.deepEqual([w.accounts[0].status, w.accounts[0].found_via, w.accounts[0].source_id], ["watching", "seed", "a-b"]);
  assert.equal(wl.addCandidate(w, { handle: "a.b", found_via: "mention" }, t0), null);
  const c = wl.addCandidate(w, { handle: "@newone", found_via: "mention", found_from: "x" }, t0);
  assert.equal(c.status, "candidate");
  assert.equal(c.source_id, null);
  assert.equal(w.accounts.length, 2);
});

// ---- mentions ---------------------------------------------------------------------------------
const H = (t, o) => extractMentions(t, o).map((m) => m.handle);
test("mentions: w/ @brand", () => assert.deepEqual(H("Matcha pop up this Sat w/ @brand_one"), ["brand_one"]));
test("mentions: x @brand", () => assert.deepEqual(H("matcha cart x @cafe.lune Sunday"), ["cafe.lune"]));
test("mentions: @brand_la takeover", () => assert.deepEqual(H("@brand_la takeover this weekend"), ["brand_la"]));
test("mentions: collab and market", () => {
  assert.deepEqual(H("big collab with @alpha_x and @beta_matcha at the farmers market"), ["alpha_x", "beta_matcha"]);
});
test("mentions: needs a pop-up word nearby", () => assert.deepEqual(H("Thanks for the lunch @friendsname"), []));
test("mentions: far from the word does not count", () => assert.deepEqual(H("hello @someone " + "x".repeat(200) + " pop up"), []));
test("mentions: skips email, self, short and duplicate handles", () => {
  assert.deepEqual(H("pop up info: hello@mail.com"), []);
  assert.deepEqual(H("matcha pop up by @me_self w/ @other_one", { self: "ME_self" }), ["other_one"]);
  assert.deepEqual(H("pop up @ab"), []);
  assert.deepEqual(H("pop up @dupe_acct and @Dupe_acct"), ["dupe_acct"]);
});
test("mentions: trailing dot trimmed, digits-only rejected", () => {
  assert.deepEqual(H("matcha pop up with @cool.cafe."), ["cool.cafe"]);
  assert.deepEqual(H("matcha pop up @12345"), []);
});
test("mentions: pop-up spellings", () => {
  assert.deepEqual(H("Popup with @aa_bb"), ["aa_bb"]);
  assert.deepEqual(H("pop-up w/ @cc_dd"), ["cc_dd"]);
  assert.deepEqual(H("matcha takeover at @ee_ff"), ["ee_ff"]);
});
test("mentions: evidence carries the surrounding text", () => {
  const m = extractMentions("Matcha pop up w/ @brand_one Saturday")[0];
  assert.match(m.evidence, /Saturday/);
});

// ---- Brave -----------------------------------------------------------------------------------
test("parseSearchUrl: handle, post, reel, reserved, other hosts", () => {
  assert.deepEqual(parseSearchUrl("https://www.instagram.com/matchacart/"), { type: "handle", handle: "matchacart" });
  assert.deepEqual(parseSearchUrl("https://instagram.com/p/Abc_1-2/"), { type: "post", shortcode: "Abc_1-2", handle: null });
  assert.deepEqual(parseSearchUrl("https://www.instagram.com/some.one/reel/XyZ/"), { type: "post", shortcode: "XyZ", handle: "some.one" });
  assert.equal(parseSearchUrl("https://www.instagram.com/explore/tags/x/"), null);
  assert.equal(parseSearchUrl("https://example.com/matchacart/"), null);
  assert.equal(parseSearchUrl("not a url"), null);
});
test("brave results -> candidates and leads", () => {
  const { candidates, leads } = fromBraveResults(fx("brave-results.json"), "New York");
  assert.deepEqual(candidates.map((c) => c.handle), ["matchacartnyc", "cafelune", "greenroom.la"]);
  assert.ok(candidates.every((c) => c.found_via === "search" && c.evidence));
  assert.equal(leads.length, 1);
  assert.match(leads[0].url, /CxYz123/);
});

// ---- Graph shapes ----------------------------------------------------------------------------
test("business_discovery maps captioned media to RawItems", () => {
  const items = mapBusinessDiscovery(fx("graph-business-discovery.json"), "brandhandle");
  assert.equal(items.length, 2);
  assert.deepEqual(Object.keys(items[0]).slice(0, 4), ["source_url", "text", "published_at", "handle"]);
  assert.equal(items[0].source_url, "https://www.instagram.com/p/DAAA111/");
  assert.equal(items[0].handle, "brandhandle");
  assert.equal(items[1].media_type, "VIDEO");
  assert.deepEqual(mapBusinessDiscovery({}, "x"), []);
});
test("hashtag media maps with shortcode, null handle unless username returned", () => {
  const items = mapHashtagMedia(fx("graph-hashtag-recent.json"), "matchapopup");
  assert.equal(items.length, 3);
  assert.equal(items[0].shortcode, "DBBB111");
  assert.equal(items[0].handle, null);
  assert.equal(items[1].shortcode, "DBBB222");
  assert.equal(items[2].handle, "someone.matcha");
  assert.equal(shortcodeOf("https://www.instagram.com/reel/AbC/"), "AbC");
});
test("graph items -> candidates: mention in caption and username owner", () => {
  const found = fromGraphItems(mapHashtagMedia(fx("graph-hashtag-recent.json"), "matchapopup"));
  const by = Object.fromEntries(found.map((f) => [f.handle, f]));
  assert.ok(by.cartclub_la);
  assert.equal(by["someone.matcha"].found_via, "hashtag");
  assert.equal(by["someone.matcha"].found_from, "#matchapopup");
});
test("adapter is off without keys, returning []", async () => {
  assert.equal(creds({}), null);
  assert.deepEqual(await igAdapter.fetch({ instagram: "x" }, { env: {} }), []);
});
test("adapter fetch with a stubbed http uses business_discovery and maps items", async () => {
  const urls = [];
  const http = async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => fx("graph-business-discovery.json") }; };
  const rate = createRate({ file: path.join(os.tmpdir(), `ig-rate-${process.pid}-a.json`) });
  const items = await igAdapter.fetch({ instagram: "brandhandle" }, { env: { INSTAGRAM_TOKEN: "T", INSTAGRAM_BUSINESS_ID: "99" }, http, rate, fetcher: {} });
  assert.equal(items.length, 2);
  assert.deepEqual(items.facts, { name: "Brand Handle", website: "https://brand.example", profile_picture_url: "https://scontent.cdninstagram.com/pp.jpg", followers_count: 1200, biography: "matcha, pop-ups" });
  assert.match(decodeURIComponent(urls[0]), /\/99\?fields=business_discovery\.username\(brandhandle\)\{name,profile_picture_url,website,biography,followers_count,media\.limit\(25\)\{caption,permalink,timestamp,media_type,media_url,thumbnail_url\}\}/);
});
test("rate counter stops at 200 calls per hour and expires after an hour", () => {
  let t = 1_000_000;
  const file = path.join(os.tmpdir(), `ig-rate-${process.pid}-b.json`);
  fs.rmSync(file, { force: true });
  const r = createRate({ file, now: () => t });
  for (let i = 0; i < 200; i++) assert.ok(r.take());
  assert.ok(!r.take());
  t += 3600001;
  assert.ok(r.take());
  fs.rmSync(file, { force: true });
});
test("hashtag counter allows 30 unique per 7 days", () => {
  let t = 5_000_000;
  const file = path.join(os.tmpdir(), `ig-rate-${process.pid}-c.json`);
  fs.rmSync(file, { force: true });
  const r = createRate({ file, now: () => t });
  for (let i = 0; i < 30; i++) { assert.ok(r.hashtagOk(`t${i}`)); r.hashtagUsed(`t${i}`); }
  assert.ok(!r.hashtagOk("t30"));
  assert.ok(r.hashtagOk("t3"));
  t += 7 * 86400000 + 1;
  assert.ok(r.hashtagOk("t30"));
  fs.rmSync(file, { force: true });
});

// ---- other discovery bits --------------------------------------------------------------------
test("cities rotate 10 per run", () => {
  const cities = Array.from({ length: 40 }, (_, i) => `c${i}`);
  const a = citiesForRun(cities, new Date("2026-11-22T00:00:00Z"));
  const b = citiesForRun(cities, new Date("2026-11-22T06:00:00Z"));
  assert.equal(a.length, 10);
  assert.notDeepEqual(a, b);
});
test("MATO html: matcha venue and event slugs", () => {
  const html = `<a href="/venue/matcha.house">x</a><a href="/venue/dominopark">y</a><a href="/event/matcha-pop-up-14-dec-2026">z</a><a href="/events/new-york">c</a>`;
  assert.deepEqual(fromMatoHtml(html), { venues: ["matcha.house"], events: ["matcha-pop-up-14-dec-2026"], cities: ["new-york"] });
});
test("Luma data: matcha event with host instagram handle", () => {
  const data = { a: [{ name: "Matcha Pop Up Social", url: "matcha-social", hosts: [{ instagram: "hostmatcha" }] }, { name: "Yoga", hosts: [{ instagram: "yoga" }] }] };
  assert.deepEqual(fromLumaData(data).candidates.map((c) => c.handle), ["hostmatcha"]);
});
test("addAll adds only unknown handles", () => {
  const w = { accounts: [] };
  const added = addAll(w, [{ handle: "one", found_via: "mention", found_from: "u" }, { handle: "ONE", found_via: "search", found_from: "v" }], t0);
  assert.equal(added.length, 1);
  assert.equal(w.accounts[0].found_via, "mention");
});
test(".env parser", () => {
  assert.deepEqual(parseEnv(`# c\nA=1\nexport B="two words"\nC=3 # note\n\nbad line`), { A: "1", B: "two words", C: "3" });
});

// ---- promotion -------------------------------------------------------------------------------
test("promote writes source records for watching accounts with hits and no source_id", () => {
  const sources = [{ id: "existing", instagram: "existing", brand: "E" }, { id: "dupe", instagram: "other.dupe" }];
  const w = { accounts: [
    acct({ handle: "New.Brand", status: "watching", hits: 2, source_id: null, found_via: "mention", found_from: "other" }),
    acct({ handle: "cand", status: "candidate", hits: 0 }),
    acct({ handle: "existing", status: "watching", hits: 1, source_id: "existing" }),
    acct({ handle: "dupe", status: "watching", hits: 1, source_id: null }),
  ] };
  const copy = JSON.parse(JSON.stringify(sources));
  const r = wl.promote(w, sources, { now: t0, graphOn: false });
  assert.deepEqual(r.promoted.sort(), ["New.Brand", "dupe"]);
  const n = r.sources.find((s) => s.instagram === "New.Brand");
  assert.equal(n.id, "new-brand");
  assert.equal(n.brand, "New.Brand");
  assert.equal(n.adapter, "manual");
  assert.equal(n.schedule_kind, "manual");
  assert.equal(n.added, "2026-11-22");
  assert.equal(w.accounts[0].source_id, "new-brand");
  assert.equal(r.sources.find((s) => s.instagram === "dupe").id, "dupe-ig");
  assert.deepEqual(sources, copy);
  const on = wl.promote({ accounts: [acct({ handle: "zed", hits: 1 })] }, [], { now: t0, graphOn: true });
  assert.equal(on.sources[0].adapter, "instagram-graph");
});

// ---- pacing (rung 27) ---------------------------------------------------------------------------
test("a watch run's Graph allowance is HOURLY_LIMIT - 20 less what the hour already used", () => {
  assert.equal(runAllowance(0), HOURLY_LIMIT - 20);
  assert.equal(runAllowance(150), 30);
  assert.equal(runAllowance(190), 0);
});
test("rate Stop: fetch returns [] and flags ctx.rateStopped so the caller leaves the account unchecked", async () => {
  const http = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 4, message: "limit" } }) });
  const rate = createRate({ file: path.join(os.tmpdir(), `ig-rate-${process.pid}-d.json`) });
  const ctx = { env: { INSTAGRAM_TOKEN: "T", INSTAGRAM_BUSINESS_ID: "99" }, http, rate, fetcher: {} };
  assert.deepEqual(await igAdapter.fetch({ instagram: "x" }, ctx), []);
  assert.equal(ctx.rateStopped, true);
});
test("a Graph error for one account throws with api set, so the watcher can park it for a week", async () => {
  const http = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 110, message: "Invalid user id" } }) });
  const rate = createRate({ file: path.join(os.tmpdir(), `ig-rate-${process.pid}-e.json`) });
  const ctx = { env: { INSTAGRAM_TOKEN: "T", INSTAGRAM_BUSINESS_ID: "99" }, http, rate, fetcher: {} };
  await assert.rejects(igAdapter.fetch({ instagram: "personal" }, ctx), (e) => e.api === true && !ctx.rateStopped);
});
test("an Instagram account Graph never read is due whatever its cadence; a graph_error parks it for 7 days", () => {
  const read = acct({ last_checked: daysAgo(0), cadence_hours: 72, graph_checked_at: daysAgo(0) });
  const unread = acct({ last_checked: daysAgo(0), cadence_hours: 72 });
  assert.ok(!wl.isDue(unread, t0), "without graph the cadence rules");
  assert.ok(wl.isDue(unread, t0, { graphOn: true }));
  assert.ok(!wl.isDue(read, t0, { graphOn: true }));
  const bad = wl.recordGraphError(acct({ last_checked: daysAgo(0), cadence_hours: 72 }), "Invalid user id", t0);
  assert.ok(wl.graphSkipped(bad, new Date(t0 - 0 + 6 * D)));
  assert.ok(!wl.graphSkipped(bad, new Date(t0.getTime() + 8 * D)));
  assert.ok(!wl.isDue(bad, t0, { graphOn: true }));
  assert.ok(!wl.isDue(acct({ platform: "tiktok", last_checked: daysAgo(0), cadence_hours: 72 }), t0, { graphOn: true }));
});
test("recordGraph keeps the account's facts and clears an old error; picks the name for a handle-shaped source", () => {
  const a = wl.recordGraphError(acct(), "x", t0);
  wl.recordGraph(a, mapAccountFacts(fx("graph-business-discovery.json")), t0);
  assert.deepEqual([a.name, a.followers_count, a.graph_error, a.graph_checked_at], ["Brand Handle", 1200, undefined, t0.toISOString()]);
  assert.equal(a.profile_picture_url, "https://scontent.cdninstagram.com/pp.jpg");
  const src = { brand: "brandhandle", instagram: "brandhandle" };
  assert.ok(wl.setAutoName(src, a));
  assert.deepEqual([src.brand, src.auto_name], ["brandhandle", "Brand Handle"]);
  const written = { brand: "Brand Handle Matcha", instagram: "brandhandle" };
  assert.ok(!wl.setAutoName(written, a), "a hand-written brand gets no auto_name");
  assert.equal(wl.pseudoSource(a).brand, "Brand Handle");
});
test("a candidate with no matcha in its last 25 posts is dropped after a Graph read", () => {
  const has = (t) => /matcha/i.test(t);
  const c = acct({ status: "candidate" });
  assert.ok(!wl.dropIfNoMatcha(c, [], has, t0), "nothing read: no verdict");
  assert.ok(!wl.dropIfNoMatcha(acct({ status: "candidate" }), [{ text: "Matcha latte" }], has, t0));
  assert.ok(!wl.dropIfNoMatcha(acct({ status: "watching" }), [{ text: "lunch" }], has, t0), "only candidates");
  assert.ok(wl.dropIfNoMatcha(c, [{ text: "lunch" }, { text: "dinner" }], has, t0));
  assert.deepEqual([c.status, c.notes], ["dropped", "no matcha in last 25 posts"]);
});
