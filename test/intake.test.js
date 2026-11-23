// Self-serve intake: shared validators, the Pages Functions with a fake KV, and the queue -> data/inbox round trip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSubmission, validateReport, validateClaim, validateAlert, botCheck, sanitizePatch, normHandle, bearerOk, isId } from "../functions/_lib/validate.js";
import { onRequestPost as submit } from "../functions/api/submit.js";
import { onRequestGet as queue } from "../functions/api/queue.js";
import { onRequestPost as approve } from "../functions/api/approve.js";
import { itemToPaste, pullApproved } from "../ingest/lib/intake.js";
import { parsePaste, matchSource } from "../ingest/adapters/manual.js";
import { extract } from "../ingest/lib/extract.js";

const NOW = Date.parse("2026-11-25T15:00:00Z");
const good = { t: NOW - 20000, company: "", brand: "Sunny Books Matcha", handle: "@SunnyBooks", url: "", date: "2026-12-05", start: "11:00", end: "15:00", venue: "Books and Co", address: "123 Main St", city: "Austin, TX", drinks: "Hojicha latte, Strawberry matcha", price: "$6-9", notes: "", email: "a@b.co" };

test("a good submission validates and is cleaned", () => {
  const v = validateSubmission(good, { now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.clean.handle, "sunnybooks");
  assert.equal(v.clean.city, "Austin");
  assert.equal(v.clean.state, "TX");
  assert.deepEqual(v.clean.drinks, ["hojicha latte", "strawberry matcha"]);
});

test("honeypot, too-fast and missing stamp are bots; an old stamp is stale", () => {
  assert.equal(botCheck({ ...good, company: "Acme" }, NOW).bot, true);
  assert.equal(botCheck({ ...good, t: NOW - 1000 }, NOW).bot, true);
  assert.equal(botCheck({ ...good, t: undefined }, NOW).bot, true);
  assert.equal(botCheck({ ...good, t: NOW - 3 * 864e5 }, NOW).stale, true);
  assert.deepEqual(botCheck(good, NOW), {});
  assert.equal(validateSubmission({ ...good, company: "x" }, { now: NOW }).bot, true);
  assert.equal(validateSubmission({ ...good, t: NOW - 3 * 864e5 }, { now: NOW }).ok, false);
});

test("field errors: missing brand, no handle or link, bad date, past date, no state, bad email", () => {
  const e = (o) => validateSubmission({ ...good, ...o }, { now: NOW }).errors;
  assert.ok(e({ brand: "" }).brand);
  assert.ok(e({ handle: "", url: "" }).handle);
  assert.ok(e({ handle: "", url: "ftp://x" }).url);
  assert.ok(e({ date: "2026-02-31" }).date);
  assert.ok(e({ date: "2026-11-01" }).date);
  assert.ok(e({ date: "2030-01-01" }).date);
  assert.ok(e({ city: "Austin" }).city);
  assert.ok(e({ email: "nope" }).email);
  assert.ok(e({ end: "15:00", start: "" }).start);
  assert.equal(validateSubmission({ ...good, handle: "", url: "https://www.instagram.com/p/XYZ/" }, { now: NOW }).ok, true);
  assert.equal(normHandle("https://www.tiktok.com/@Some.Brand?x=1"), "some.brand");
  assert.equal(normHandle("not a handle!"), "");
});

test("report, claim, alert validators", () => {
  assert.equal(validateReport({ t: NOW - 9000, event: "070b20cd9a53", reason: "cancelled" }, { now: NOW }).ok, true);
  assert.ok(validateReport({ t: NOW - 9000, event: "x", reason: "bad" }, { now: NOW }).errors.reason);
  assert.equal(validateClaim({ t: NOW - 9000, brand: "B", handle: "@b", role: "owner", email: "o@b.co", proof: "https://b.co" }, { now: NOW }).ok, true);
  assert.equal(validateAlert({ t: NOW - 9000, email: "a@b.co", city: "raleigh-nc", consent: true }, { now: NOW }).ok, true);
  assert.ok(validateAlert({ t: NOW - 9000, email: "a@b.co", city: "raleigh-nc", consent: false }, { now: NOW }).errors.consent);
});

test("sanitizePatch keeps known fields only, cleaned; bearerOk is exact", () => {
  assert.deepEqual(sanitizePatch({ venue: "  New  Place ", evil: "x", date: "bad" }), { venue: "New Place", date: "" });
  assert.equal(bearerOk("Bearer s3cret", "s3cret"), true);
  assert.equal(bearerOk("Bearer s3cret!", "s3cret"), false);
  assert.equal(bearerOk("s3cret", "s3cret"), false);
  assert.equal(bearerOk("Bearer x", ""), false);
  assert.equal(isId("0123456789abcdef"), true);
});

// ---- the functions, with an in-memory KV ----
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
const post = (url, body, headers = {}) => new Request(`https://x.test${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("submit: stores pending:<id> with a 30 day TTL; honeypot stores nothing; missing KV fails soft", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  const now = Date.now();
  const body = { ...good, t: now - 20000, date: new Date(now + 5 * 864e5).toISOString().slice(0, 10) };
  const r = await submit({ request: post("/api/submit", body), env });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.match(j.id, /^[a-f0-9]{16}$/);
  const rec = kv.m.get(`pending:${j.id}`);
  assert.equal(rec.o.expirationTtl, 30 * 86400);
  assert.equal(JSON.parse(rec.v).fields.handle, "sunnybooks");

  const before = [...kv.m.keys()].filter((k) => k.startsWith("pending:")).length;
  const bot = await submit({ request: post("/api/submit", { ...body, company: "spam" }), env });
  assert.equal((await bot.json()).ok, true);
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith("pending:")).length, before);

  const bad = await submit({ request: post("/api/submit", { ...body, brand: "" }), env });
  assert.equal(bad.status, 422);

  const none = await submit({ request: post("/api/submit", body), env: {} });
  assert.equal(none.status, 503);
  assert.match((await none.json()).error, /napping/);
});

test("submit: 10 a day per IP", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  const now = Date.now();
  const body = { ...good, t: now - 20000, date: new Date(now + 5 * 864e5).toISOString().slice(0, 10) };
  let last;
  for (let i = 0; i < 11; i++) last = await submit({ request: post("/api/submit", body, { "cf-connecting-ip": "1.2.3.4" }), env });
  assert.equal(last.status, 429);
});

test("queue and approve need the token; approve moves pending -> approved; consume -> consumed", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  const id = "0123456789abcdef";
  kv.m.set(`pending:${id}`, { v: JSON.stringify({ id, status: "pending", fields: { brand: "B", venue: "Old" } }) });
  const auth = { authorization: "Bearer tok" };
  assert.equal((await queue({ request: new Request("https://x.test/api/queue"), env })).status, 401);
  assert.equal((await queue({ request: new Request("https://x.test/api/queue"), env: { INTAKE: kv } })).status, 503);
  const q = await (await queue({ request: new Request("https://x.test/api/queue", { headers: auth }), env })).json();
  assert.equal(q.pending.length, 1);
  assert.equal((await approve({ request: post("/api/approve", { id, action: "approve" }), env })).status, 401);
  const ed = await approve({ request: post("/api/approve", { id, action: "edit", patch: { venue: "New Place" } }, auth), env });
  assert.equal(ed.status, 200);
  const ap = await approve({ request: post("/api/approve", { id, action: "approve" }, auth), env });
  assert.equal((await ap.json()).status, "approved");
  assert.equal(kv.m.has(`pending:${id}`), false);
  assert.equal(JSON.parse(kv.m.get(`approved:${id}`).v).fields.venue, "New Place");
  const co = await approve({ request: post("/api/approve", { id, action: "consume" }, auth), env });
  assert.equal((await co.json()).status, "consumed");
  assert.ok(kv.m.has(`consumed:${id}`) && !kv.m.has(`approved:${id}`));
  assert.equal((await approve({ request: post("/api/approve", { id: "bad", action: "approve" }, auth), env })).status, 400);
});

// ---- queue -> data/inbox -> manual adapter ----
const item = { id: "0123456789abcdef", fields: { brand: "Sunny Books Matcha", handle: "sunnybooks", url: "", date: "2026-12-05", start: "11:00", end: "15:00", venue: "Books and Co", address: "123 Main St", city: "Austin", state: "TX", drinks: ["hojicha latte"], price: "$6-9", notes: "", email: "a@b.co" } };
const source = { id: "sunny", brand: "Sunny Books Matcha", instagram: "sunnybooks", home_city: "Austin", home_state: "TX", kind: "popup" };

test("paste file round-trips through the manual parser, brand matcher and extractor", () => {
  const { file, text } = itemToPaste(item);
  assert.match(file, /^austin-sunny-books-matcha-20261205-01234567\.txt$/);
  assert.doesNotMatch(text, /a@b\.co/); // the email never goes into the repo
  const raw = parsePaste(text);
  assert.equal(raw.source_url, "https://www.instagram.com/sunnybooks/");
  const m = matchSource(raw, [source], { file });
  assert.equal(m.handle, "sunnybooks");
  const out = extract(raw, { source, now: new Date("2026-11-25T00:00:00Z") });
  assert.equal(out.length, 1);
  assert.equal(out[0].start, "2026-12-05T11:00:00-06:00");
  assert.equal(out[0].end, "2026-12-05T15:00:00-06:00");
  assert.equal(out[0].address, "123 Main St");
  assert.equal(out[0].confidence, "confirmed");
  // a brand outside sources.json still matches by name through the file name
  assert.ok(matchSource(raw, [{ ...source, instagram: null }], { file }));
});

test("pullApproved writes the paste, then marks consumed; no env means off; errors never throw", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intake-"));
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push([url, opts.method || "GET", opts.headers && opts.headers.authorization]);
    if (url.includes("/api/queue")) return { ok: true, status: 200, json: async () => ({ ok: true, approved: calls.filter((c) => c[0].includes("/api/approve")).length ? [] : [item] }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const r = await pullApproved({ baseUrl: "https://site.test/", token: "tok", dir, fetchFn });
  assert.equal(r.written.length, 1);
  assert.equal(r.consumed, 1);
  assert.ok(fs.existsSync(path.join(dir, r.written[0])));
  assert.equal(calls[0][0], "https://site.test/api/queue?kinds=approved");
  assert.equal(calls[0][2], "Bearer tok");
  assert.deepEqual(await pullApproved({ baseUrl: "", token: "" }), { written: [], consumed: 0, errors: [] });
  const bad = await pullApproved({ baseUrl: "https://site.test", token: "t", dir, fetchFn: async () => { throw new Error("offline"); } });
  assert.deepEqual(bad.errors, ["offline"]);
  const denied = await pullApproved({ baseUrl: "https://site.test", token: "t", dir, fetchFn: async () => ({ ok: false, status: 401 }) });
  assert.deepEqual(denied.errors, ["queue 401"]);
  fs.rmSync(dir, { recursive: true, force: true });
});
