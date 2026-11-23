import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ss from "../ingest/lib/sites/social-search.js";
import { capConfidence, parseFlags, NAMES } from "../ingest/lib/sites/index.js";
import { keepMatoEvent } from "../ingest/lib/write.js";
import { processItems } from "../ingest/lib/pipeline.js";

const now = new Date("2026-11-22T12:00:00Z");
// A TikTok video id whose time is 2026-11-20 (id >> 32 = Unix seconds).
const vid = "7710222210564096123";
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/tavily-social.json", import.meta.url), "utf8"));
const byUrl = Object.fromEntries(fixture.results.map((r) => [r.url, r]));
const oembedFx = { title: "Matcha pop up at 123 Main St, Seattle on Dec 6 from 11am to 4pm #matchapopup", author_name: "Cha Cha Matcha", author_unique_id: "chachamatcha", thumbnail_url: "https://p16.tiktokcdn.com/x.jpg", html: `<blockquote data-video-id="${vid}"></blockquote>` };

test("social-search: URL to handle for both hosts", () => {
  assert.deepEqual(ss.parseSocialUrl("https://www.tiktok.com/@chachamatcha/video/7301234567890123456?lang=en"), { platform: "tiktok", kind: "video", handle: "chachamatcha", id: "7301234567890123456", url: "https://www.tiktok.com/@chachamatcha/video/7301234567890123456" });
  assert.equal(ss.parseSocialUrl("https://vm.tiktok.com/ZMabc123/").kind, "short");
  assert.equal(ss.parseSocialUrl("https://www.tiktok.com/@someone").kind, "profile");
  assert.equal(ss.parseSocialUrl("https://www.tiktok.com/tag/matchapopup"), null);
  assert.equal(ss.parseSocialUrl("https://www.instagram.com/matchamaker/").handle, "matchamaker");
  const reel = ss.parseSocialUrl("https://www.instagram.com/reel/Cabc123/");
  assert.deepEqual([reel.kind, reel.handle], ["post", null]);
  assert.equal(ss.parseSocialUrl("https://www.instagram.com/matchamaker/reel/Cabc123/").handle, "matchamaker");
  assert.equal(ss.parseSocialUrl("https://www.instagram.com/explore/tags/matcha/"), null);
  assert.equal(ss.parseSocialUrl("https://example.com/@x"), null);
  assert.equal(ss.igHandle({ handle: null }, "Matcha Maker (@matchamaker) - Instagram photos and videos", ""), "matchamaker");
  assert.equal(ss.igHandle({ handle: null }, "Matcha Day", "pop up with @tea.and.co this weekend"), "tea.and.co");
  assert.equal(ss.tiktokTime(vid), "2026-11-20T12:00:00.000Z");
});

test("social-search: TikTok oEmbed fixture mapping", () => {
  const m = ss.mapTiktokOembed(oembedFx);
  assert.equal(m.handle, "chachamatcha");
  assert.equal(m.author, "Cha Cha Matcha");
  assert.equal(m.url, `https://www.tiktok.com/@chachamatcha/video/${vid}`);
  assert.match(m.caption, /Dec 6/);
  assert.equal(m.image_url, "https://p16.tiktokcdn.com/x.jpg");
  assert.equal(ss.mapTiktokOembed(null), null);
});

test("social-search: Tavily fixture to RawItems, with posts, thumbnail and pseudo-source", () => {
  const tt = ss.resultToItem(byUrl[`https://www.tiktok.com/@chachamatcha/video/${vid}`], { oembed: ss.mapTiktokOembed(oembedFx), now, sources: [] });
  assert.equal(tt.reason, "ok");
  assert.equal(tt.raw.posts.tiktok, `https://www.tiktok.com/@chachamatcha/video/${vid}`);
  assert.equal(tt.raw.image_url, "https://p16.tiktokcdn.com/x.jpg");
  assert.equal(tt.raw.source_hint.id, "tiktok:chachamatcha");
  assert.equal(tt.raw.source_hint.brand, "Cha Cha Matcha");
  assert.equal(tt.raw.hints.city, "Seattle");
  const ig = ss.resultToItem(byUrl["https://www.instagram.com/matchamaker/p/Cabc123/"], { now, sources: [] });
  assert.equal(ig.reason, "ok");
  assert.equal(ig.raw.posts.instagram, "https://www.instagram.com/p/Cabc123/");
  assert.equal(ig.raw.source_hint.id, "instagram:matchamaker");
  // a real source that owns the handle takes the event
  const real = { id: "matchamaker-co", brand: "Matcha Maker", instagram: "matchamaker", home_city: "Austin", home_state: "TX", kind: "popup", category: "matcha" };
  assert.equal(ss.resultToItem(byUrl["https://www.instagram.com/matchamaker/p/Cabc123/"], { now, sources: [real] }).raw.source_hint.id, "matchamaker-co");
  // no date: no event but still a watch-list account; a hashtag alone never gives a place
  const nodate = ss.resultToItem(byUrl["https://www.instagram.com/p/Cnodate1/"], { now, sources: [] });
  assert.equal(nodate.raw, null);
  assert.equal(nodate.reason, "no date");
  assert.equal(nodate.who.handle, "teaco");
  assert.equal(ss.resultToItem(byUrl["https://www.instagram.com/tagonly/p/Ctag1/"], { now, sources: [] }).reason, "no city");
  assert.equal(ss.resultToItem(byUrl["https://www.tiktok.com/@oldie/video/7000000000000000000"], { now }).reason, "old");
});

test("social-search: events go through the extractor and are capped at likely or unsure", async () => {
  const r = ss.resultToItem(byUrl[`https://www.tiktok.com/@chachamatcha/video/${vid}`], { oembed: ss.mapTiktokOembed(oembedFx), now, sources: [] });
  const { candidates } = await processItems([r.raw], r.raw.source_hint, { now });
  assert.ok(candidates.length >= 1);
  const c = capConfidence(candidates[0]);
  assert.ok(["likely", "unsure"].includes(c.confidence));
  assert.equal(c.posts.tiktok, `https://www.tiktok.com/@chachamatcha/video/${vid}`);
  assert.equal(c.brand, "Cha Cha Matcha");
  assert.match(c.description, /matcha/i); // keeps the event past the matcha-word rule for pseudo-sources
  assert.ok(keepMatoEvent({ ...c, source_id: "tiktok:chachamatcha" }));
  assert.equal(capConfidence({ source_id: "x", source_url: "https://www.instagram.com/p/a/", confidence: "confirmed", timed: false, hasAddress: true }).confidence, "unsure");
});

test("social-search: noise filter", () => {
  assert.equal(ss.noise("Best coffee shops in Austin Dec 6").drop, true);
  assert.equal(ss.noise("how to make iced matcha latte at home").reason, "recipe/review/ranking");
  assert.equal(ss.noise("my honest matcha review of the best matcha in Seattle").drop, true);
  assert.equal(ss.noise("matcha tier list ranking, then I visited the pop up on Dec 6 at 123 Main St Seattle").drop, false);
  assert.equal(ss.noise("matcha pop up in Seattle on Dec 6").drop, false);
  assert.equal(ss.cityIn("#matchapopupnyc is back"), null);
  assert.equal(ss.cityIn("matcha in Brooklyn this week").state, "NY");
});

test("social-search: budget counter and queries", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ss-")), "b.json");
  const b = ss.loadBudget(f, now);
  assert.deepEqual([b.per_run_config, b.per_month, b.used_month, b.used_run], [120, 900, 0, 0]);
  assert.equal(b.per_run, ss.paceCap(120, 900, 0, now)); // spread over the runs left in the month
  b.per_run = 120;
  for (let i = 0; i < 120; i++) { assert.equal(ss.canSpend(b), null); ss.spend(b); }
  assert.equal(ss.canSpend(b), "per-run cap");
  ss.saveBudget(b, f, now);
  const b2 = ss.loadBudget(f, now);
  assert.equal(b2.used_month, 120);
  assert.equal(b2.used_run, 0);
  b2.used_month = 900;
  assert.equal(ss.canSpend(b2), "monthly cap");
  assert.equal(ss.loadBudget(f, new Date("2026-12-02T00:00:00Z")).used_month, 0); // a new month resets
  const cities = Array.from({ length: 40 }, (_, i) => `C${i}`);
  const qs = ss.buildQueries(cities, now);
  assert.equal(qs.length, ss.CITIES_PER_RUN * 3 + ss.HOODS_PER_RUN + ss.TAGS_PER_RUN + ss.TAG_CITIES_PER_RUN);
  const all = new Set(); for (let h = 0; h < 24 * 8; h += 6) for (const q of ss.buildQueries(cities, new Date(now.getTime() + h * 3600000))) all.add(q.q);
  for (const t of ss.TAG_QUERIES) assert.ok(all.has(t), `tag ${t} comes up in the rotation`);
  for (const h of ss.HOODS) assert.ok(all.has(`matcha pop up ${h[0]}`), `neighbourhood ${h[0]} comes up in the rotation`);
  assert.ok(NAMES.includes("social-search"));
  assert.ok(parseFlags(["--no-social-search"]).off.has("social-search"));
});

test("social-search: the crawler stops at the per-run cap and only calls the Tavily endpoint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const budgetFile = path.join(dir, "b.json");
  fs.writeFileSync(budgetFile, JSON.stringify({ per_run: 3, per_month: 900, month: "2026-11", used_month: 0 }));
  const calls = [];
  const http = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ results: [] }) }; };
  const r = await ss.discover({ env: { TAVILY_API_KEY: "test" }, now, http, wait: async () => {}, budgetFile, searchCities: ["Seattle", "Austin"], noSeen: true, sources: [] });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((u) => u === "https://api.tavily.com/search"));
  assert.equal(r.stats.credits, 3);
  assert.equal(r.stats.hitCap, true);
  assert.equal(JSON.parse(fs.readFileSync(budgetFile, "utf8")).used_month, 3);
  assert.match((await ss.discover({ env: {}, now })).stats.skipped, /TAVILY_API_KEY/);
});

test("pacing: per_run is min(configured, left / runs left), floored at 5, and the configured cap is saved back", () => {
  const nov22 = new Date("2026-11-22T12:00:00Z"); // 8.5 days left, 4 discover runs a day = 34 runs
  assert.equal(ss.paceCap(120, 900, 634, nov22), 7);                 // 266 left / 34 runs
  assert.equal(ss.paceCap(120, 900, 0, new Date("2026-11-01T00:00:00Z")), 7); // a fresh month: 900 / 120 runs
  assert.equal(ss.paceCap(120, 900, 899, nov22), 5);                 // never below 5
  assert.equal(ss.paceCap(120, 900, 900, nov22), 5);
  assert.equal(ss.paceCap(3, 900, 0, nov22), 3);                     // never above the configured cap
  assert.equal(ss.paceCap(120, 900, 0, new Date("2026-11-30T23:00:00Z")), 120); // last hour: all of it
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ss-")), "b.json");
  fs.writeFileSync(f, JSON.stringify({ per_run: 120, per_month: 900, month: "2026-11", used_month: 634 }));
  const b = ss.loadBudget(f, nov22);
  assert.deepEqual([b.per_run, b.per_run_config], [7, 120]);
  b.used_run = 6; b.used_month = 640;
  assert.equal(ss.budgetLine(b), "Tavily: 6 this run, 260 left this month");
  ss.saveBudget(b, f, nov22);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).per_run, 120);
});
