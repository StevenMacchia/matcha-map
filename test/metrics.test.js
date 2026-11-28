// Metrics: the bot classifier, the one-row-per-event counting and rollup, /api/ev validation, /api/metrics shape and its token gate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { visitorClass, pathGroup, deviceOf, regionOf, refHost, countable, recordPageview, recordFeature, dayCounts, rollup, summarize, lastDays, parseDaily, FEATURES } from "../functions/_lib/metrics.js";
import { onRequest } from "../functions/_middleware.js";
import { onRequestPost as ev, clean } from "../functions/api/ev.js";
import { onRequestGet as metrics } from "../functions/api/metrics.js";

// a minimal in-memory KV: put with metadata, get, list with prefix
function fakeKV() {
  const m = new Map();
  return {
    m,
    async put(k, v, o = {}) { m.set(k, { v, md: o.metadata }); },
    async get(k, type) { const r = m.get(k); if (!r) return null; return type === "json" ? JSON.parse(r.v) : r.v; },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { const keys = [...m].filter(([k]) => k.startsWith(prefix)).map(([name, r]) => ({ name, metadata: r.md })); return { keys, list_complete: true }; },
  };
}
const UA = { phone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", desk: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36" };
const req = (url, ua = UA.desk, cf = { country: "US", regionCode: "NC" }, extra = {}) => { const r = new Request(url, { headers: { "user-agent": ua, "cf-connecting-ip": "203.0.113.9", ...extra } }); Object.defineProperty(r, "cf", { value: cf }); return r; };

test("classifier: crawlers, verified bots and empty user agents are bots; browsers are human", () => {
  for (const ua of ["Googlebot/2.1", "facebookexternalhit/1.1", "python-requests/2.31", "curl/8.4", "Mozilla/5.0 HeadlessChrome/120", "Chrome-Lighthouse", "Slackbot-LinkExpanding", "Mozilla/5.0 (compatible; bingbot/2.0)", "WhatsApp link preview", ""]) assert.equal(visitorClass(req("https://matchamap.app/", ua)), "bot", ua);
  for (const ua of Object.values(UA)) assert.equal(visitorClass(req("https://matchamap.app/", ua)), "human");
  assert.equal(visitorClass(req("https://matchamap.app/", UA.desk, { verifiedBotCategory: "Search Engine Crawler" })), "bot");
});
test("path group, device, region and referrer", () => {
  const g = (p) => pathGroup(p);
  assert.deepEqual(["/", "/city/nc/raleigh/", "/state/nc/", "/brand/x/", "/e/abc123def456/", "/weekend/2026-11-28/", "/privacy/"].map(g), ["home", "city", "state", "brand", "event", "weekend", "other"]);
  assert.equal(deviceOf(UA.phone), "mobile"); assert.equal(deviceOf(UA.desk), "desktop"); assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0)"), "tablet");
  assert.equal(regionOf(req("https://x/", UA.desk, { country: "US", regionCode: "WA" })), "WA");
  assert.equal(regionOf(req("https://x/", UA.desk, { country: "CA", regionCode: "ON" })), "CA");
  assert.equal(regionOf(req("https://x/", UA.desk, {})), "??");
  assert.equal(refHost(req("https://matchamap.app/", UA.desk, {}, { referer: "https://www.google.com/search?q=x" })), "google.com");
  assert.equal(refHost(req("https://matchamap.app/", UA.desk, {}, { referer: "https://matchamap.app/city/" })), "(this site)");
  assert.equal(refHost(req("https://matchamap.app/")), "direct");
});
test("only 200 HTML GETs outside /api and /m count", () => {
  const html = new Response("x", { headers: { "content-type": "text/html; charset=utf-8" } });
  assert.ok(countable(req("https://matchamap.app/city/nc/raleigh/"), html));
  assert.ok(!countable(req("https://matchamap.app/api/rsvp"), html));
  assert.ok(!countable(req("https://matchamap.app/m/"), html));
  assert.ok(!countable(req("https://matchamap.app/app.js"), new Response("x", { headers: { "content-type": "text/javascript" } })));
  assert.ok(!countable(req("https://matchamap.app/"), new Response("x", { status: 404, headers: { "content-type": "text/html" } })));
});
test("every view is its own row, so concurrent counts cannot be lost; a visitor is unique once a day and the address is never stored", async () => {
  const kv = fakeKV(), now = new Date("2026-11-27T15:00:00Z");
  await Promise.all(Array.from({ length: 20 }, () => recordPageview(kv, req("https://matchamap.app/"), {}, now)));
  const rows = (await kv.list({ prefix: "mp:2026-11-27:" })).keys;
  assert.equal(rows.length, 20);
  await recordPageview(kv, req("https://matchamap.app/city/nc/raleigh/", UA.phone, { country: "US", regionCode: "CA" }, { referer: "https://www.instagram.com/" }), {}, now);
  await recordPageview(kv, req("https://matchamap.app/", "Googlebot/2.1"), {}, now);
  const d = rollup((await kv.list({ prefix: "mp:" })).keys, []);
  assert.deepEqual(d.views, { human: 21, bot: 1 });
  assert.equal(d.visitors.human, 2); // the desktop visitor once, the phone visitor once
  assert.equal(d.visitors.bot, 1);
  assert.equal(d.state.NC, 20); assert.equal(d.state.CA, 1); assert.equal(d.ref["instagram.com"], 1); assert.equal(d.device.mobile, 1);
  for (const [k, r] of kv.m) assert.ok(!k.includes("203.0.113") && !JSON.stringify(r).includes("203.0.113"), k);
  assert.ok([...kv.m.keys()].some((k) => /^mv:2026-11-27:[0-9a-f]{24}$/.test(k)));
});
test("feature rows: allowlist, bots left out of the rollup, card opens counted per item", async () => {
  const kv = fakeKV(), now = new Date("2026-11-27T15:00:00Z");
  assert.equal(await recordFeature(kv, "hack", "", "human", now), false);
  await recordFeature(kv, "card_open", "e:abc123def456", "human", now); await recordFeature(kv, "card_open", "e:abc123def456", "human", now); await recordFeature(kv, "going", "", "human", now); await recordFeature(kv, "going", "", "bot", now);
  const d = rollup([], (await kv.list({ prefix: "mf:" })).keys);
  assert.equal(d.feature.card_open, 2); assert.equal(d.feature.going, 1); assert.equal(d.item["e:abc123def456"], 2);
});
test("a finished day is rolled up once into m:<day>:*, today is always counted live", async () => {
  const kv = fakeKV(), old = new Date("2026-11-20T10:00:00Z");
  await recordPageview(kv, req("https://matchamap.app/"), {}, old);
  const a = await dayCounts(kv, "2026-11-20", "2026-11-27");
  assert.equal(a.views.human, 1);
  assert.ok(kv.m.has("m:2026-11-20:all") && kv.m.has("m:2026-11-20:state"));
  for (const k of [...kv.m.keys()].filter((k) => k.startsWith("mp:"))) kv.m.delete(k); // raw rows gone, rollup still answers
  assert.equal((await dayCounts(kv, "2026-11-20", "2026-11-27")).views.human, 1);
  await recordPageview(kv, req("https://matchamap.app/"), {}, new Date("2026-11-27T01:00:00Z"));
  assert.equal((await dayCounts(kv, "2026-11-27", "2026-11-27")).views.human, 1);
  assert.equal(kv.m.has("m:2026-11-27:all"), false);
});
test("middleware counts a human HTML page after answering and never breaks the page", async () => {
  const kv = fakeKV(), jobs = [];
  const next = async () => new Response("<html>", { headers: { "content-type": "text/html" } });
  const res = await onRequest({ request: req("https://matchamap.app/e/abc123def456/"), next, env: { INTAKE: kv }, waitUntil: (p) => jobs.push(p) });
  await Promise.all(jobs);
  assert.equal(res.status, 200);
  assert.equal((await kv.list({ prefix: "mp:" })).keys.length, 1);
  const broken = { put() { throw new Error("kv down"); } };
  const r2 = await onRequest({ request: req("https://matchamap.app/"), next, env: { INTAKE: broken }, waitUntil: (p) => p });
  assert.equal(r2.status, 200);
});
test("/api/ev: allowlist, value shape, bots dropped, always 204", async () => {
  assert.equal(clean({ k: "nope" }), null); assert.equal(clean({ k: "card_open", v: "<script>" }), null);
  assert.deepEqual(clean({ k: "card_open", v: "e:abc123def456" }), { k: "card_open", v: "e:abc123def456" });
  assert.deepEqual(clean({ k: "going", v: "ok" }), { k: "going", v: "ok" });
  const kv = fakeKV(), post = (body, ua = UA.desk) => { const r = new Request("https://matchamap.app/api/ev", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": ua } }); Object.defineProperty(r, "cf", { value: {} }); return ev({ request: r, env: { INTAKE: kv } }); };
  assert.equal((await post({ k: "directions" })).status, 204);
  assert.equal((await post({ k: "bogus" })).status, 204);
  assert.equal((await post({ k: "share" }, "Googlebot/2.1")).status, 204);
  assert.equal((await kv.list({ prefix: "mf:" })).keys.length, 1);
  assert.ok(FEATURES.length >= 17);
});
test("/api/metrics needs the token and returns the documented shape", async () => {
  const kv = fakeKV(), env = { INTAKE: kv, INTAKE_TOKEN: "t".repeat(24), ASSETS: { fetch: async (u) => { const p = new URL(u).pathname; const f = { "/data/events-slim.json": { generated: "x", events: [{ id: "abc123def456", brand: "Mato", city: "Austin", state: "TX", start: "2099-01-01T10:00:00Z" }] }, "/data/shops.json": { shops: [{}, {}] }, "/data/daily-status.json": { outcome: "ok" } }[p]; return f ? Response.json(f) : new Response("", { status: 404 }); } } };
  const call = (auth) => metrics({ request: new Request("https://matchamap.app/api/metrics", { headers: auth ? { authorization: auth } : {} }), env });
  assert.equal((await call()).status, 401); assert.equal((await call("Bearer wrong")).status, 401);
  await recordPageview(kv, req("https://matchamap.app/"), env); await recordFeature(kv, "card_open", "e:abc123def456", "human");
  await kv.put("rsvp:abc123def456:aaaa", JSON.stringify({ at: new Date().toISOString() }));
  const r = await call("Bearer " + env.INTAKE_TOKEN), j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.series.length, 30);
  for (const w of ["7", "30"]) for (const k of ["views", "visitors", "states", "groups", "paths", "referrers", "devices", "features", "clicked", "rsvp"]) assert.ok(k in j.windows[w], w + k);
  assert.equal(j.windows[7].views.human, 1); assert.equal(j.windows[7].clicked[0].label, "Mato, Austin TX (01-01)"); assert.equal(j.windows[30].rsvp.total, 1); assert.equal(j.windows[7].rsvp.top[0].label, "Mato, Austin TX (01-01)");
  assert.deepEqual(j.map, { shops: 2, events: 1, upcoming: 1, dataGenerated: "x" }); assert.equal(j.run.outcome, "ok");
});
test("summarize and helpers", () => {
  assert.equal(lastDays(3, "2026-11-27").join(), "2026-11-25,2026-11-26,2026-11-27");
  const p = parseDaily(fs.readFileSync(new URL("../docs/DAILY.md", import.meta.url), "utf8"));
  assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(p.events > 0);
  const e = rollup([], []);
  assert.equal(summarize([{ day: "2026-11-27", counts: e }]).windows[7].features.length, FEATURES.length);
});
test("the dashboard is noindex, outside the sitemap and robots allow list is untouched; privacy says what is counted", () => {
  const html = fs.readFileSync(new URL("../site/m/index.html", import.meta.url), "utf8");
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.ok(!/\/m\//.test(fs.readFileSync(new URL("../site/sitemap.xml", import.meta.url), "utf8")));
  assert.match(fs.readFileSync(new URL("../site/privacy/index.html", import.meta.url), "utf8"), /Counting visits and taps/);
});

test("states and countries are separate lists: US rows count under their state and under US, other countries only under their country, and Canada is not California", async () => {
  const kv = fakeKV(), now = new Date("2026-11-27T15:00:00Z"), cf = (country, regionCode) => ({ country, regionCode });
  const visit = (c, ip) => recordPageview(kv, req("https://matchamap.app/", UA.desk, c, { "cf-connecting-ip": ip }), {}, now);
  await visit(cf("US", "CA"), "198.51.100.1"); await visit(cf("US", "CA"), "198.51.100.2"); await visit(cf("US", "NC"), "198.51.100.3");
  await visit(cf("CA", "ON"), "198.51.100.4"); await visit(cf("GB", "ENG"), "198.51.100.5"); await visit(cf("SG", ""), "198.51.100.6");
  const d = rollup((await kv.list({ prefix: "mp:" })).keys, []);
  assert.deepEqual(d.state, { CA: 2, NC: 1 });
  assert.deepEqual(d.country, { US: 3, CA: 1, GB: 1, SG: 1 });
  const w = summarize([{ day: "2026-11-27", counts: d }]).windows[7];
  assert.deepEqual(w.states.map((x) => x.name), ["CA", "NC"]);
  assert.equal(w.countries[0].name, "US"); assert.equal(w.countries.length, 4);
  // a rollup stored before countries existed has one mixed map: it is split on the way out
  const old = rollup([], []); old.state = { NC: 5, GB: 2, SG: 1 }; delete old.country;
  const o = summarize([{ day: "2026-11-26", counts: old }]).windows[7];
  assert.deepEqual(o.states.map((x) => x.name), ["NC"]);
  assert.deepEqual(Object.fromEntries(o.countries.map((x) => [x.name, x.count])), { US: 5, GB: 2, SG: 1 });
});
