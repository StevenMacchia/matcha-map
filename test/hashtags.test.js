import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attribute, usPlace, postToItem, settle, weekTags, planTags, harvest, isGenericTag, yieldOf, RUN_CALLS, analyze, placeOfTag, homeFromText, pastNote, startWeek, recordYield, markMissing, WEEK_SLOTS, funnelLine } from "../ingest/lib/hashtags.js";
import { findDates } from "../ingest/lib/extract.js";
import { processItems } from "../ingest/lib/pipeline.js";
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
  assert.deepEqual(r.accounts.map((a) => [a.found_via, a.found_from]).sort()[0], ["hashtag", "https://www.instagram.com/p/HAAA111/"], "found_from is the permalink");
  assert.ok(r.accounts.some((a) => a.handle === "shikisandmatcha"), "a brand with no @ reaches the watch list from a post that makes no event");
  assert.match(funnelLine(r.stats.funnel), /^funnel: 5 posts, \d+ matcha, \d+ brand, \d+ place, \d+ dated, 2 kept, \d+ accounts added$/);
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

// ---- rung 29: the fixture, 120 real hashtag posts (#matchapopup, #matchabar, #matchacart) -------
const POSTS = fx("graph-hashtag-sample.json");
const FQ = ["matchapopup", "matchabar", "matchacart"];
const ctx = { queried: FQ };
const find = (re) => POSTS.find((p) => re.test(p.caption || ""));

test("fixture funnel: at least 100 of 120 posts get a brand and at least 45 a US place", () => {
  const all = POSTS.map((p) => analyze(p, p.tag, ctx));
  assert.equal(POSTS.length, 120);
  assert.ok(all.filter((a) => a.who).length >= 100, "brands");
  assert.ok(all.filter((a) => a.place).length >= 45, "US places");
  assert.ok(all.filter((a) => a.matcha).length >= 115, "a matcha hashtag counts as matcha");
});
test("fixture: Cagayan de Oro, Manila and Winnipeg posts get no place", () => {
  for (const re of [/Cagayan de Oro|CAGAYAN DE ORO/, /manila matcha fest/i, /Winnipeg/, /Bangalore|bengaluru/i, /AMK Hub/, /Rotterdam/]) {
    const p = find(re);
    assert.ok(p, String(re));
    assert.equal(analyze(p, p.tag, ctx).place, null, String(re));
  }
});
test("bare mentions: Meta strips the @, so a token on a list, a brand hashtag or a handle in a pop-up slot is the brand", () => {
  const a = analyze(find(/fanniakbakery/), "matchapopup", ctx).who;
  assert.deepEqual([a.how, a.candidate.handle], ["bare", "fanniakbakery"]);
  const sh = analyze(find(/#shikisandmatcha/), "matchapopup", ctx).who;
  assert.deepEqual([sh.how, sh.handle, sh.candidate], ["hashtag", null, { handle: "shikisandmatcha", guess: false }]);
  assert.equal(attribute("A little banana with my matcha from ochabrotea", { queried: FQ }).candidate.handle, "ochabrotea");
  assert.equal(attribute("i had the honor of trying the matcha at the unitymatcha popup", { queried: FQ }).candidate.handle, "unitymatcha");
  // on the watch list: found even without a brand word, and then it is the account
  const k = attribute("loved the latte at lunecoffeehouse yesterday", { known: new Set(["lunecoffeehouse"]), queried: FQ });
  assert.deepEqual([k.how, k.handle], ["bare", "lunecoffeehouse"]);
  // the same token as a brand hashtag in the caption
  assert.equal(attribute("thank you hazelhaus ! #hazelhaus #matchapopup", { queried: FQ }).candidate.handle, "hazelhaus");
  // ordinary words are not handles
  assert.equal(attribute("this weekend we are serving coffee and tea at the market, come hungry", { queried: FQ }), null);
});
test("a name written as words becomes its letters run together, marked guess; place and generic tags are never brands", () => {
  const n = attribute("Join Hidden Leaf Pop-Up this weekend", { queried: FQ });
  assert.deepEqual(n.candidate, { handle: "hiddenleaf", guess: true });
  for (const t of ["madisonwi", "austinmatcha", "matchalatte", "matchagirl", "foodie", "smallbusiness", "texas", "nycmatcha", "matchaaddict", "houstonfoodie"]) assert.ok(isGenericTag(t, FQ), t);
  assert.ok(!isGenericTag("shikisandmatcha", FQ));
});
test("place hashtags: city, city plus state, city with a matcha or food word, nicknames, state names", () => {
  const at = (t) => { const p = placeOfTag(t); return p && [p.city, p.state, p.kind].join("|"); };
  assert.equal(at("madisonwi"), "Madison|WI|city");
  assert.equal(at("austinmatcha"), "Austin|TX|city");
  assert.equal(at("matchaatl"), "Atlanta|GA|city");
  assert.equal(at("nycmatcha"), "New York|NY|city");
  assert.equal(at("houstonfoodie"), "Houston|TX|city");
  assert.equal(at("chicagoeats"), "Chicago|IL|city");
  assert.equal(at("matchapopupchicago"), "Chicago|IL|city");
  assert.equal(at("oahu"), "Honolulu|HI|city");
  assert.equal(at("vegas"), "Las Vegas|NV|city");
  assert.equal(at("htx"), "Houston|TX|city");
  assert.equal(at("littlerockarkansas"), "Little Rock|AR|city");
  assert.equal(at("texas"), "|TX|state");
  assert.equal(at("tx"), "|TX|state");
  assert.equal(at("springfield"), null, "a name two cities share needs its state");
  for (const t of ["paris", "vancouvermatcha", "melbournematcha", "matcha", "foodie", "in", "me", "bradford"]) assert.equal(placeOfTag(t), null, t);
  const m = usPlace("see you Sunday #madisonwi", "matchapopup");
  assert.deepEqual([m.city, m.state, m.from], ["Madison", "WI", "tag"]);
  const a = usPlace("pop-up this weekend #austinmatcha");
  assert.deepEqual([a.city, a.state], ["Austin", "TX"]);
  const s = usPlace("pop-up this weekend #california");
  assert.deepEqual([s.city, s.state, s.from], ["", "CA", "tag-state"]);
});
test("place from the account: its home city in sources or from its biography when the caption has none", () => {
  assert.equal(usPlace("matcha this weekend, 11 to 3"), null);
  const p = usPlace("matcha this weekend, 11 to 3", "matchapopup", { city: "Omaha", state: "NE" });
  assert.deepEqual([p.city, p.state, p.from], ["Omaha", "NE", "home"]);
  assert.deepEqual(homeFromText("Matcha pop-ups | Omaha, NE | DM to book"), { city: "Omaha", state: "NE" });
  assert.equal(homeFromText("Ceremonial matcha, made with care"), null);
  const home = (h) => (h === "lunecafe" ? { city: "Portland", state: "OR" } : null);
  const a = analyze({ caption: "Matcha pop-up this Saturday with @lunecafe 11am to 3pm", permalink: "https://www.instagram.com/p/XYZ1/", timestamp: "2026-11-22T10:00:00+0000" }, "matchapopup", { queried: FQ, home });
  assert.deepEqual([a.place.city, a.place.from, a.item.placeFrom], ["Portland", "home", "home"]);
  const c = { title: "x matcha pop-up", tz: "America/Los_Angeles", start: "2026-12-06T11:00:00-08:00", venue: "Lune", address: "", confidence: "likely" };
  assert.equal(settle([c], { now, placeFrom: "home" })[0].confidence, "unsure");
});
test("a brand with no place still counts as a brand and makes no event", () => {
  const a = analyze({ caption: "Matcha pop-up Sunday Dec 6 with @brandnoplace", permalink: "https://www.instagram.com/p/XYZ2/", timestamp: "2026-11-22T10:00:00+0000" }, "matchapopup", ctx);
  assert.equal(a.who.handle, "brandnoplace");
  assert.equal(a.item, null);
});

// ---- dates: what the sample's drops say -----------------------------------------------------------
test("dates: TOMORROW, SUNDAY reads as a date although 'every single time' is in the caption; every Sunday and a thank-you note do not", async () => {
  const p = find(/TOMORROW, SUNDAY/);
  const a = analyze(p, p.tag, ctx);
  const { candidates } = await processItems([a.item.raw], a.item.source, { now, handle: null });
  const good = settle(candidates, { now, placeFrom: a.item.placeFrom });
  assert.ok(good.length >= 1 && good.every((c) => String(c.start).startsWith("2026-11-22")), "Anchorage, Sunday Nov 22");
  const ref = { y: 2026, mo: 11, d: 22 };
  assert.equal(findDates("Join us every Sunday at the market", ref).length, 0);
  assert.equal(findDates("Matcha pop-up each Saturday, weekly", ref).length, 0);
  assert.equal(findDates("every single time it sells out, see you tomorrow", ref).length, 1);
  const thanks = find(/Thank you Gallup/);
  assert.ok(pastNote(thanks.caption));
  assert.equal(analyze(thanks, thanks.tag, ctx).item, null, "a thank-you note is not an event");
  assert.ok(analyze(thanks, thanks.tag, ctx).who, "but its brand still counts");
  assert.ok(!pastNote("Thank you all! See you tomorrow at 11am #matcha"), "a word that points ahead keeps it");
  assert.ok(!pastNote("Thanks for coming! Next one is Dec 6 in Austin"));
  const wrap = find(/A weekend of fresh sets/);
  const w = analyze(wrap, wrap.tag, ctx);
  const r = w.item ? await processItems([w.item.raw], w.item.source, { now, handle: null }) : { candidates: [] };
  assert.equal(settle(r.candidates, { now, placeFrom: w.item?.placeFrom }).length, 0, "a recap of a weekend that is over");
});

// ---- rotation, missing tags, yield, budget ------------------------------------------------------------
const GEN = ["matchapopup", "matchapopups", "matchacart", "matchaevent", "matchabar", "popupmatcha", "matchafest", "matchamarket"];
const cityTags = (n) => Array.from({ length: n }, (_, i) => `c${i}matcha`);
const rcfg = (o = {}) => ({ general: GEN, cities: cityTags(60), cursor: 0, missing: [], ids: {}, stats: {}, ...o });
test("rotation: 8 general tags every week, the other 22 slots walk the city tags from where the last week stopped", () => {
  const c = rcfg();
  const w0 = new Date("2026-11-16T12:00:00Z"), w1 = new Date("2026-11-23T12:00:00Z"), w2 = new Date("2026-11-30T12:00:00Z");
  assert.equal(WEEK_SLOTS, 30);
  const t0 = startWeek(c, w0);
  assert.deepEqual(t0.slice(0, 8), GEN);
  assert.deepEqual(t0.slice(8), cityTags(22));
  assert.equal(c.cursor, 22);
  assert.deepEqual(startWeek(c, w0), t0, "the same week is stable and does not advance again");
  assert.deepEqual(weekTags(c, w0), t0);
  const t1 = startWeek(c, w1);
  assert.deepEqual(t1.slice(8), cityTags(44).slice(22));
  const t2 = startWeek(c, w2);
  assert.deepEqual(t2.slice(8), [...cityTags(60).slice(44), ...cityTags(6)], "wraps after about three weeks: every one of the 60 is read");
  assert.equal(new Set([...t0, ...t1, ...t2]).size - 8, 60);
});
test("rotation: a missing tag is never asked again; a city tag with zero yield twice goes to the back", () => {
  const c = rcfg({ missing: ["c1matcha"] });
  assert.ok(!startWeek(c, new Date("2026-11-16T12:00:00Z")).includes("c1matcha"));
  recordYield(c, "c5matcha", { kept: 0, accounts: 0 });
  assert.equal(c.cities[5], "c5matcha", "once is not enough");
  recordYield(c, "c5matcha", { kept: 0, accounts: 0 });
  assert.equal(c.cities.at(-1), "c5matcha");
  assert.equal(c.cities.length, 60);
  recordYield(c, "c6matcha", { kept: 0, accounts: 0 });
  recordYield(c, "c6matcha", { kept: 0, accounts: 2 });
  recordYield(c, "c6matcha", { kept: 0, accounts: 0 });
  assert.equal(c.cities[5], "c6matcha", "a yield resets the count");
  assert.equal(yieldOf({ stats: { t: { runs: 2, kept: 1, accounts: 3 } } }, "t"), 2);
  const m = rcfg();
  markMissing(m, "xmatcha"); markMissing(m, "xmatcha");
  assert.deepEqual(m.missing, ["xmatcha"]);
});
test("budget: planTags spends only the free slots of the 30 per 7 days, and never a missing tag", () => {
  const rate = createRate({ file: tmp("rate.json"), now: () => now.getTime() });
  const used = [...GEN, ...cityTags(10)];
  for (const t of used) rate.hashtagUsed(t); // 18 used this week, as today
  const plan = planTags(rcfg({ missing: ["c12matcha"] }), rate, now);
  assert.ok(!plan.includes("c12matcha"));
  assert.equal(plan.filter((t) => !used.includes(t)).length, 12, "18 used leaves 12 new tags");
  assert.equal(plan.length, 30);
});
test("harvest: a tag Instagram does not have is recorded missing, counts toward the budget and is never searched again", async () => {
  const file = tmp("hashtags.json");
  fs.writeFileSync(file, JSON.stringify(rcfg({ general: ["gone1"], cities: ["gone2matcha"] })));
  const rate = createRate({ file: tmp("rate.json"), now: () => now.getTime() });
  let searches = 0;
  const http = async (u) => { if (/ig_hashtag_search/.test(u)) searches++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
  await harvest({ now, env, http, rate, file, wl: { accounts: [] }, sources: [] });
  assert.equal(searches, 2);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(saved.missing.sort(), ["gone1", "gone2matcha"]);
  assert.equal(rate.hashtagsCounted().length, 2, "a miss counts until a live run shows otherwise");
  await harvest({ now: new Date(now.getTime() + 8 * 24 * 3600000), env, http, rate, file, wl: { accounts: [] }, sources: [] });
  assert.equal(searches, 2, "no second search for a missing tag");
});
test("harvest: the funnel and every brand to the watch list (hashtag, bare, name), yield per tag; the walk resumes after the last tag read", async () => {
  const file = tmp("hashtags.json");
  fs.writeFileSync(file, JSON.stringify(rcfg({ general: ["matchapopup"], cities: cityTags(40) })));
  const rate = createRate({ file: tmp("rate.json"), now: () => now.getTime() });
  for (let i = 0; i < 25; i++) rate.hashtagUsed(`old${i}`); // 25 of 30 used: 5 new tags fit
  const posts = POSTS.slice(0, 60).map((p) => ({ caption: p.caption, permalink: p.permalink, timestamp: p.timestamp, media_type: p.media_type }));
  const http = async (u) => {
    const j = (o) => ({ ok: true, status: 200, json: async () => o });
    if (/ig_hashtag_search/.test(u)) return j({ data: [{ id: "H" + (u.match(/q=([^&]+)/)?.[1] || "x") }] });
    if (/recent_media/.test(u)) return j({ data: posts });
    return j({ data: [] });
  };
  const r = await harvest({ now, env, http, rate, file, wl: { accounts: [] }, sources: [] });
  const f = r.stats.funnel;
  assert.equal(r.stats.tags, 5, "only the free slots are spent");
  assert.equal(f.posts, 60, "the same posts under every tag count once");
  assert.ok(f.brand >= 45 && f.place >= 20 && f.accounts >= 30, JSON.stringify(f));
  assert.equal(r.accounts.length, f.accounts);
  assert.ok(r.accounts.every((a) => a.found_via === "hashtag" && /^https:\/\/www\.instagram\.com\//.test(a.found_from)));
  assert.ok(r.accounts.some((a) => a.guess === true), "name guesses are marked");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.stats.matchapopup.accounts, f.accounts, "the first tag gets the accounts");
  assert.equal(saved.cursor, saved.cities.indexOf("c3matcha") + 1, "the walk resumes right after the last tag read");
  assert.ok(!saved.week.tags.includes("c4matcha"));
});
