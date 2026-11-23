import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attribute, usPlace, postToItem, settle, weekTags, planTags, harvest, isGenericTag, yieldOf, RUN_CALLS } from "../ingest/lib/hashtags.js";
import { createRate, shortcodeOf } from "../ingest/adapters/instagram-graph.js";

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const now = new Date("2026-11-22T12:00:00Z");
const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ht-")), n);
const Q = ["matchapopup", "matchapopups", "matchaevent"];

// ---- brand attribution -------------------------------------------------------------------------
test("attribution: a mention on the watch list or in sources wins over an earlier unknown one", () => {
  const known = new Set(["sunnybooks"]);
  const a = attribute("pop-up with @random.guy and @SunnyBooks Sunday", { known, queried: Q });
  assert.deepEqual([a.handle, a.how], ["SunnyBooks", "known mention"]);
});
test("attribution: otherwise the first @mention, brand named after its account name when we have one", () => {
  const a = attribute("matcha at @bujimatcha and @other", { queried: Q });
  assert.deepEqual([a.handle, a.brand, a.how], ["bujimatcha", "Buji Matcha", "mention"]);
  const named = attribute("matcha at @bujimatcha", { queried: Q, names: new Map([["bujimatcha", "Buji Matcha Co"]]) });
  assert.equal(named.brand, "Buji Matcha Co");
});
test("attribution: a brand-looking hashtag when there is no mention; generic and queried tags never count", () => {
  const a = attribute("Thank you Gallup for showing up for our Sunday pop-up #shikisandmatcha #matchapopup #foodie", { queried: Q });
  assert.deepEqual([a.handle, a.how], [null, "hashtag"]);
  assert.match(a.brand, /matcha/i);
  assert.equal(attribute("fun day #matchapopup #matcha #foodie #matchaevent #coffee #explorepage #nyc", { queried: Q }), null);
  assert.ok(isGenericTag("matchapopupchicago", Q) && isGenericTag("fyp") && isGenericTag("Chicago") && !isGenericTag("lunecafe"));
});
test("attribution: a capitalised name directly before pop-up, then nothing", () => {
  assert.deepEqual(attribute("Join Hidden Leaf Pop-Up this weekend", { queried: Q }).brand, "Hidden Leaf");
  assert.equal(attribute("Matcha pop up this weekend in Chicago", { queried: Q }), null);
  assert.equal(attribute("this weekend popup", { queried: Q }), null);
});

// ---- US filter ---------------------------------------------------------------------------------
test("US filter: an address, City ST, a known city or a city tag; Winnipeg, Manila and Paris match nothing", () => {
  assert.equal(usPlace("at Sunny Books, 123 Main St, Los Angeles, CA 90012").from, "address");
  assert.deepEqual(usPlace("popping up in Plano, TX").state, "TX");
  assert.deepEqual([usPlace("Dec 6 in Brooklyn").city, usPlace("Dec 6 in Brooklyn").state], ["Brooklyn", "NY"]);
  assert.deepEqual([usPlace("see you Sunday NYC").city, usPlace("see you Sunday NYC").state], ["New York", "NY"]);
  for (const t of ["in Winnipeg, MB", "Manila this weekend", "pop up in Paris", "Toronto, ON next week"]) assert.equal(usPlace(t, "matchapopup"), null, t);
  assert.equal(usPlace("this weekend", "matchapopupchicago").from, "tag");
  assert.equal(usPlace("this weekend", "matchapopupchicago").state, "IL");
});
test("a post becomes an item only with matcha, a brand and a US place", () => {
  const posts = fx("graph-hashtag-harvest.json").data;
  const ok = postToItem(posts[0], "matchapopup", { queried: Q });
  assert.equal(ok.source.id, "hashtag:sunnybooks");
  assert.equal(ok.raw.handle, "sunnybooks");
  assert.equal(ok.raw.hashtag, "matchapopup");
  assert.equal(postToItem(posts[1], "matchapopup", { queried: Q }), null, "Winnipeg");
  assert.equal(postToItem(posts[2], "matchapopup", { queried: Q }), null, "no brand");
  assert.equal(postToItem({ ...posts[0], caption: "Pop-up Dec 6 at 123 Main St, Los Angeles, CA w/ @sunnybooks" }, "x", { queried: Q }), null, "no matcha word");
});
test("settle: past dates are dropped; likely with a venue or address, unsure without; never confirmed", () => {
  const c = (o) => ({ title: "X matcha pop-up", tz: "America/Los_Angeles", start: "2026-12-06T11:00:00-08:00", venue: "", address: "", confidence: "confirmed", ...o });
  assert.deepEqual(settle([c({ start: "2026-11-21T11:00:00-08:00" })], { now }), []);
  assert.equal(settle([c({ venue: "Sunny Books" })], { now })[0].confidence, "likely");
  assert.equal(settle([c({ address: "1 Main St" })], { now })[0].confidence, "likely");
  assert.equal(settle([c()], { now })[0].confidence, "unsure");
  assert.equal(settle([c({ venue: "Sunny Books" })], { now, placeFrom: "tag" })[0].confidence, "unsure");
  assert.equal(settle([c({ title: "X pop-up" })], { now })[0].title, "X matcha pop-up");
});

// ---- budget order and rotation -----------------------------------------------------------------
const cfg = (o = {}) => ({ active: ["a", "b", "c", "d"], rotation: [], ids: {}, stats: {}, ...o });
test("budget order: tags are read in the active order and stop where the 30-per-week budget is full", () => {
  const file = tmp("rate.json");
  const rate = createRate({ file, now: () => now.getTime() });
  const active = Array.from({ length: 34 }, (_, i) => `t${i}`);
  for (let i = 0; i < 8; i++) rate.hashtagUsed(`t${i}`); // the first eight already count this week
  const plan = planTags(cfg({ active }), rate, now);
  assert.equal(plan.length, 30);
  assert.deepEqual(plan.slice(0, 10), active.slice(0, 10));
  assert.ok(!plan.includes("t30") && !plan.includes("t33"));
  for (let i = 8; i < 30; i++) rate.hashtagUsed(`t${i}`);
  assert.deepEqual(planTags(cfg({ active }), rate, now), active.slice(0, 30), "tags already counted still fit");
});
test("rotation: next week swaps in the new tags for the lowest-yield city tags", () => {
  const c = cfg({
    active: ["core", "cityA", "cityB", "cityC"], rotation: [["cityA", "cityB", "cityC"], ["newX", "newY"]],
    stats: { cityA: { runs: 4, kept: 8 }, cityB: { runs: 4, kept: 0 }, cityC: { runs: 4, kept: 2 } },
  });
  assert.deepEqual(weekTags(c, new Date("2026-11-22T12:00:00Z")), c.active, "this week as it is");
  assert.deepEqual(weekTags(c, new Date("2026-11-24T12:00:00Z")), ["core", "cityA", "newX", "newY"]);
  assert.equal(yieldOf(c, "cityA"), 2);
  assert.equal(yieldOf(c, "never"), 0);
});

// ---- the harvest end to end, no network --------------------------------------------------------
function fakeGraph(pages = {}) {
  const calls = [];
  const http = async (u) => {
    calls.push(u);
    const j = (o) => ({ ok: true, status: 200, json: async () => o });
    if (/ig_hashtag_search/.test(u)) return j({ data: [{ id: "H1" }] });
    if (/\/H1\/recent_media/.test(u)) return j(fx("graph-hashtag-harvest.json"));
    if (/\/H1\/top_media/.test(u)) return j({ data: [fx("graph-hashtag-harvest.json").data[0]] }); // the same post again
    return j({ data: [] });
  };
  return { http, calls };
}
const env = { INSTAGRAM_TOKEN: "T", INSTAGRAM_BUSINESS_ID: "99" };

test("harvest: one event per post, deduped by shortcode, brand to the watch list, ids cached, yield recorded", async () => {
  const file = tmp("hashtags.json");
  fs.writeFileSync(file, JSON.stringify({ active: ["matchapopup"], rotation: [], ids: {}, stats: {} }));
  const { http, calls } = fakeGraph();
  const rate = createRate({ file: tmp("rate.json"), now: () => now.getTime() });
  const r = await harvest({ now, env, http, rate, file, wl: { accounts: [] }, sources: [] });
  const brands = r.candidates.map((c) => c.handle).sort();
  assert.deepEqual(brands, ["cafe.lune", "sunnybooks"], "Winnipeg and the anonymous Chicago post are out");
  const sunny = r.candidates.find((c) => c.handle === "sunnybooks");
  assert.equal(sunny.source_id, "hashtag:sunnybooks");
  assert.equal(sunny.confidence, "likely");
  assert.equal(sunny.image_url, "https://scontent-lax3-1.cdninstagram.com/v/aaa.jpg");
  assert.equal(r.candidates.find((c) => c.handle === "cafe.lune").image_url, "https://scontent.cdninstagram.com/v/child.jpg", "carousel: first child");
  assert.deepEqual(r.accounts.map((a) => [a.found_via, a.found_from]).sort()[0], ["hashtag", "#matchapopup"]);
  // calls: search (1) + recent (1 page) + top (1) = 3; top_media repeats one post and is not a second event
  assert.equal(calls.length, 3);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.ids.matchapopup, "H1");
  assert.deepEqual([saved.stats.matchapopup.runs, saved.stats.matchapopup.posts, saved.stats.matchapopup.kept], [1, 6, 2]);
  // a second run within the gap reads nothing; with the id cached a fresh tag costs no search call
  const again = fakeGraph();
  const r2 = await harvest({ now: new Date(now.getTime() + 3600000), env, http: again.http, rate, file, wl: { accounts: [] }, sources: [] });
  assert.equal(again.calls.length, 0);
  assert.equal(r2.stats.skipped, 1);
  const later = fakeGraph();
  await harvest({ now: new Date(now.getTime() + 7 * 3600000), env, http: later.http, rate, file, wl: { accounts: [] }, sources: [] });
  assert.equal(later.calls.length, 1, "recent_media only: id cached, top_media once a day");
});
test("harvest: a post already on a brand-read event is not duplicated", async () => {
  const file = tmp("hashtags.json");
  fs.writeFileSync(file, JSON.stringify({ active: ["matchapopup"], rotation: [], ids: { matchapopup: "H1" }, stats: {} }));
  const rate = createRate({ file: tmp("rate.json"), now: () => now.getTime() });
  const events = [{ source_id: "sunny-books", posts: { instagram: "https://www.instagram.com/p/HAAA111/" } }];
  assert.equal(shortcodeOf(events[0].posts.instagram), "HAAA111");
  const r = await harvest({ now, env, http: fakeGraph().http, rate, file, wl: { accounts: [] }, sources: [], events });
  assert.deepEqual(r.candidates.map((c) => c.handle), ["cafe.lune"]);
});
test("harvest: stops when the run's call budget is spent and on a Meta rate limit", async () => {
  const file = tmp("hashtags.json");
  fs.writeFileSync(file, JSON.stringify({ active: ["a1", "a2", "a3"], rotation: [], ids: {}, stats: {} }));
  const rate = createRate({ file: tmp("rate.json"), now: () => now.getTime() });
  let n = 0;
  const { http } = fakeGraph();
  const room = () => n < 2;
  const counted = { ...rate, take() { const ok = rate.take(); if (ok) n++; return ok; } };
  await harvest({ now, env, http, rate: counted, room, file, wl: { accounts: [] }, sources: [] });
  assert.ok(n <= 2, `spent ${n}`);
  const limited = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 4, message: "limit" } }) });
  const r = await harvest({ now, env, http: limited, rate: createRate({ file: tmp("r2.json"), now: () => now.getTime() }), file: file, wl: { accounts: [] }, sources: [] });
  assert.equal(r.stats.stopped, true);
  assert.ok(RUN_CALLS < 200 - 20);
});
