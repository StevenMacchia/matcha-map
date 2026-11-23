// Featured request: validator, the function with a fake KV, queue support, and the page's CSP.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateFeatured, eventIdOf } from "../functions/_lib/validate.js";
import { onRequestPost as featured } from "../functions/api/featured.js";
import { onRequestGet as queue } from "../functions/api/queue.js";

const NOW = Date.parse("2026-11-25T15:00:00Z");
const good = { t: NOW - 20000, company: "", event: "https://matchamap.app/?event=070b20cd9a53", brand: "Sunny Books Matcha", email: "a@b.co", week: "2026-12-07", plan: "paid", notes: "" };

function fakeKv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, o }); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; } };
}
const post = (body, headers = {}) => new Request("https://x.test/api/featured", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("eventIdOf reads an id from a link, a share page or a bare id", () => {
  assert.equal(eventIdOf("https://x.pages.dev/?event=070B20CD9A53"), "070b20cd9a53");
  assert.equal(eventIdOf("https://x.pages.dev/e/070b20cd9a53/"), "070b20cd9a53");
  assert.equal(eventIdOf("070b20cd9a53"), "070b20cd9a53");
  assert.equal(eventIdOf("hello"), "");
});

test("a good request validates, is cleaned, and always starts unpaid", () => {
  const v = validateFeatured({ ...good, paid: true }, { now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.clean.event, "070b20cd9a53");
  assert.equal(v.clean.paid, false);
  assert.equal(v.clean.plan, "paid");
});

test("field errors and bots", () => {
  const e = (o) => validateFeatured({ ...good, ...o }, { now: NOW }).errors;
  assert.ok(e({ event: "nope" }).event);
  assert.ok(e({ brand: "" }).brand);
  assert.ok(e({ email: "x" }).email);
  assert.ok(e({ week: "" }).week);
  assert.ok(e({ week: "2026-01-05" }).week);
  assert.ok(e({ week: "2027-06-07" }).week);
  assert.ok(e({ plan: "gold" }).plan);
  assert.equal(validateFeatured({ ...good, company: "x" }, { now: NOW }).bot, true);
  assert.equal(validateFeatured({ ...good, t: NOW - 500 }, { now: NOW }).bot, true);
  assert.ok(validateFeatured({ ...good, t: NOW - 3 * 864e5 }, { now: NOW }).errors.form);
});

test("featured: stores featured:<id> with paid false and a 90 day TTL; honeypot stores nothing; no KV is 503", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  const now = Date.now();
  const body = { ...good, t: now - 20000, week: new Date(now + 7 * 864e5).toISOString().slice(0, 10) };
  const r = await featured({ request: post(body), env });
  const j = await r.json();
  assert.equal(r.status, 200);
  const rec = kv.m.get(`featured:${j.id}`);
  assert.equal(rec.o.expirationTtl, 90 * 86400);
  assert.equal(JSON.parse(rec.v).paid, false);

  const before = kv.m.size;
  const bot = await featured({ request: post({ ...body, company: "spam" }), env });
  assert.equal((await bot.json()).ok, true);
  assert.equal(kv.m.size, before);

  assert.equal((await featured({ request: post({ ...body, brand: "" }), env })).status, 422);
  const none = await featured({ request: post(body), env: {} });
  assert.equal(none.status, 503);
  assert.match((await none.json()).error, /napping/);
});

test("featured: 10 a day per IP", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  const now = Date.now();
  const body = { ...good, t: now - 20000, week: new Date(now + 7 * 864e5).toISOString().slice(0, 10) };
  let last;
  for (let i = 0; i < 11; i++) last = await featured({ request: post(body, { "cf-connecting-ip": "1.2.3.4" }), env });
  assert.equal(last.status, 429);
});

test("the queue lists featured requests for the moderator", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  kv.m.set("featured:abc", { v: JSON.stringify({ id: "abc", brand: "B", paid: false }) });
  const r = await queue({ request: new Request("https://x.test/api/queue?kinds=featured", { headers: { authorization: "Bearer tok" } }), env });
  assert.equal((await r.json()).featured.length, 1);
  assert.equal((await queue({ request: new Request("https://x.test/api/queue?kinds=featured"), env })).status, 401);
});

test("the page: same CSP as /add/, no inline script, plain price, disabled Pay, banned words absent", () => {
  const html = fs.readFileSync(new URL("../site/featured/index.html", import.meta.url), "utf8");
  const add = fs.readFileSync(new URL("../site/add/index.html", import.meta.url), "utf8");
  const csp = (h) => /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
  assert.equal(csp(html), csp(add));
  assert.match(csp(html), /script-src 'self' https:\/\/static\.cloudflareinsights\.com;/);
  assert.equal([...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1])).length, 0);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /\$25/);
  assert.match(html, /\$60/);
  assert.match(html, /<button[^>]*disabled[^>]*>Pay<\/button>/);
  assert.match(html, /Payments open once Stripe is connected\./);
  assert.doesNotMatch(html, /kawaii|uwu|cute|cutesy|girly/i);
});
