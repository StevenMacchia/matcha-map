// Social wave: the RSVP function (one row per device per pop-up, counts are rows), the going strip on the card,
// the invite, the ?plan= deep link and the shell wiring. Functions are called as plain handlers with a fake KV,
// like test/intake.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { onRequestGet, onRequestPost, onRequest, DAILY_TOGGLES, MAX_EVENTS } from "../functions/api/rsvp.js";
import { cardHtml } from "../site/cards.js";

const SITE = path.resolve("site");
function fakeKv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async put(k, v, o) { m.set(k, { v, o }); },
    async delete(k) { m.delete(k); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; },
  };
}
const ME_A = "a".repeat(32), ME_B = "0123456789abcdef0123456789abcdef";
const post = (body, ip = "1.2.3.4") => new Request("https://x.test/api/rsvp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
const get = (q) => new Request("https://x.test/api/rsvp" + q);

test("rsvp: without KV every call fails soft with 503, and the wrong method is 405", async () => {
  assert.equal((await onRequestGet({ request: get("?events=abc123"), env: {} })).status, 503);
  assert.equal((await onRequestPost({ request: post({ event: "abc123", me: ME_A, going: true }), env: {} })).status, 503);
  const r = onRequest(); assert.equal(r.status, 405); assert.equal(r.headers.get("allow"), "GET, POST");
});

test("rsvp: a toggle is one row per device, the count is the number of rows, and off removes the row", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  let r = await onRequestPost({ request: post({ event: "b6b0697a0973", me: ME_A, going: true }), env });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, going: true, count: 1 });
  const rows = () => [...kv.m.keys()].filter((k) => k.startsWith("rsvp:b6b0697a0973:"));
  assert.equal(rows().length, 1);
  assert.doesNotMatch(rows()[0], new RegExp(ME_A), "the device id is hashed, never a key");
  assert.equal(kv.m.get(rows()[0]).o.expirationTtl, 120 * 86400);
  // the same device again is still one row
  r = await onRequestPost({ request: post({ event: "b6b0697a0973", me: ME_A, going: true }), env });
  assert.equal((await r.json()).count, 1);
  // a second device makes two
  r = await onRequestPost({ request: post({ event: "b6b0697a0973", me: ME_B, going: true }, "5.6.7.8"), env });
  assert.equal((await r.json()).count, 2);
  // counts read back, cached a minute, unknown pop-ups are 0, bad ids are dropped
  r = await onRequestGet({ request: get("?events=b6b0697a0973,zzzzzz999999,not%20an%20id"), env });
  assert.equal(r.headers.get("cache-control"), "public, max-age=60");
  assert.deepEqual(await r.json(), { counts: { b6b0697a0973: 2, zzzzzz999999: 0 } });
  // off removes the row and answers the count without it
  r = await onRequestPost({ request: post({ event: "b6b0697a0973", me: ME_A, going: false }), env });
  assert.deepEqual(await r.json(), { ok: true, going: false, count: 1 });
  assert.equal(rows().length, 1);
});

test("rsvp: bad input is 400, the daily toggle limit is 429, and the GET caps the number of ids", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  assert.equal((await onRequestPost({ request: post({ event: "../x", me: ME_A, going: true }), env })).status, 400);
  assert.equal((await onRequestPost({ request: post({ event: "b6b0697a0973", me: "short", going: true }), env })).status, 400);
  assert.equal((await onRequestPost({ request: new Request("https://x.test/api/rsvp", { method: "POST", body: "nope" }), env })).status, 400);
  for (let i = 0; i < DAILY_TOGGLES; i++) assert.equal((await onRequestPost({ request: post({ event: "b6b0697a0973", me: ME_A, going: i % 2 === 0 }, "9.9.9.9"), env })).status, 200);
  assert.equal((await onRequestPost({ request: post({ event: "b6b0697a0973", me: ME_A, going: true }, "9.9.9.9"), env })).status, 429);
  const many = Array.from({ length: MAX_EVENTS + 10 }, (_, i) => "ev" + String(i).padStart(6, "0")).join(",");
  const r = await onRequestGet({ request: get("?events=" + many), env });
  assert.equal(Object.keys((await r.json()).counts).length, MAX_EVENTS);
});

const NOW = new Date("2026-11-20T18:00:00-05:00");
const ev = (o = {}) => ({ id: "aaaaaa000001", brand: "Moonbee", handle: "moonbee", start: "2026-11-22T11:00:00-05:00", end: "2026-11-22T15:00:00-05:00", venue: "Pine Street Market", address: "1 Pine St", city: "Brooklyn", state: "NY", lat: 40.7, lng: -73.95, status: "confirmed", ...o });

test("card: the going strip renders hidden on an upcoming pop-up with the invite link, and not on past ones or pages", () => {
  const html = cardHtml(ev(), { now: NOW, phone: false });
  assert.match(html, /<div class="mm-go" data-mm-go="aaaaaa000001" hidden>/);
  assert.match(html, /<button type="button" class="mm-going" data-mm-going="aaaaaa000001" aria-pressed="false">/);
  assert.match(html, /class="mm-invite" href="\?event=aaaaaa000001&amp;via=friend" data-mm-share data-title="Moonbee matcha pop-up" data-text="Moonbee, [^"]*Pine Street Market\. Come with me:"/);
  assert.match(html, /<span class="mm-gcount" aria-live="polite"><\/span>/);
  // the pop-up: after When and Where, before the buttons; the sheet: pinned with the buttons, right above them
  assert.ok(html.indexOf("mm-boxes") < html.indexOf("mm-go") && html.indexOf("mm-go") < html.indexOf("mm-dock"));
  const sheet = cardHtml(ev(), { now: NOW, phone: true });
  assert.ok(sheet.indexOf('class="mm-dock"') < sheet.indexOf('class="mm-go"') && sheet.indexOf('class="mm-go"') < sheet.indexOf('class="mm-acts"'));
  assert.doesNotMatch(cardHtml(ev({ start: "2026-11-01T11:00:00-05:00", end: "2026-11-01T15:00:00-05:00" }), { now: NOW }), /mm-go/, "past");
  assert.doesNotMatch(cardHtml(ev({ status: "cancelled" }), { now: NOW }), /mm-go/, "cancelled");
  assert.doesNotMatch(cardHtml(ev(), { now: NOW, page: true }), /mm-go/, "static pages cannot call the API");
  assert.match(cardHtml(ev(), { now: NOW, phone: true }), /mm-go/, "the phone sheet has it");
});

test("rsvp.js: the words stay true to the count, the device id is 32 hex and private, and nothing throws without storage", () => {
  const log = [];
  const w = { addEventListener() {}, crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i * 7; } } };
  const doc = { addEventListener(t) { log.push(t); }, querySelectorAll() { return []; }, dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, "rsvp.js"), "utf8"), { window: w, document: doc, crypto: w.crypto, Uint8Array, Array, JSON, Math, setTimeout, CustomEvent: class {} });
  const R = w.MatchaRsvp;
  assert.deepEqual(log, ["click"]);
  assert.equal(R.label(0, false), "Be the first to say you're going");
  assert.equal(R.label(1, false), "1 going");
  assert.equal(R.label(1, true), "You're going");
  assert.equal(R.label(2, true), "You and 1 other going");
  assert.equal(R.label(5, true), "You and 4 others going");
  assert.equal(R.label(undefined, false), "");
  assert.equal(R.label(undefined, true), "You're going");
  // list rows: nothing at zero, a count from one, this device first
  assert.equal(R.rowLabel(0, false), "");
  assert.equal(R.rowLabel(1, false), "1 going");
  assert.equal(R.rowLabel(1, true), "You're going");
  assert.equal(R.rowLabel(3, true), "You and 2 more going");
  assert.equal(typeof R.hydrateRows, "function");
  assert.deepEqual(Array.from(R.going()), []);
  assert.equal(R.isGoing("x"), false);
  R.forget();
});

test("deep link: ?plan= is a list of ids, cleaned, deduplicated and capped at 12", () => {
  const ctx = { window: {}, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, "deeplink.js"), "utf8"), ctx);
  const DL = ctx.window.MatchaDeepLink;
  assert.deepEqual(Array.from(DL.parse("?plan=aaaaaa000001,bbbbbb000002,aaaaaa000001,../x,").plan), ["aaaaaa000001", "bbbbbb000002"]);
  assert.deepEqual(Array.from(DL.parse("?event=aaaaaa000001").plan), []);
  assert.equal(DL.parse("?plan=" + Array.from({ length: 20 }, (_, i) => "id" + String(i).padStart(6, "0")).join(",")).plan.length, 12);
});

test("shell: rsvp.js is loaded and precached, the worker never caches /api/, and the app opens a plan and hydrates both card homes", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  assert.ok(html.indexOf('src="rsvp.js') > 0 && html.indexOf('src="rsvp.js') < html.indexOf('src="app.js'));
  const sw = fs.readFileSync(path.join(SITE, "sw.js"), "utf8");
  assert.match(sw, /"\/rsvp\.js"/);
  // the gate: the strip only calls the API once data/social.json says so (flipped when KV is bound)
  const flag = JSON.parse(fs.readFileSync(path.join(SITE, "data", "social.json"), "utf8"));
  assert.equal(typeof flag.rsvp, "boolean");
  assert.match(fs.readFileSync(path.join(SITE, "rsvp.js"), "utf8"), /data\/social\.json/);
  assert.match(sw, /url\.pathname\.indexOf\("\/api\/"\) === 0\) return;/);
  const app = fs.readFileSync(path.join(SITE, "app.js"), "utf8");
  assert.equal((app.match(/MatchaRsvp\.hydrate\(/g) || []).length, 2);
  assert.equal((app.match(/MatchaRsvp\.hydrateRows\(list\)/g) || []).length, 2, "both list renders paint the row counts");
  assert.match(fs.readFileSync(path.join(SITE, "cards.css"), "utf8"), /\.mm-rgo \{/);
  assert.match(app, /dl\.plan && dl\.plan\.length/);
  assert.match(app, /function startTourWith\(keys, shared\)/);
  assert.match(app, /tb-share/);
  assert.match(fs.readFileSync("tools/smoke.js", "utf8"), /\/\?plan=/);
});
