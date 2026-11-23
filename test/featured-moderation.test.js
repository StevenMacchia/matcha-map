// Featured moderation: approve / reject / mark paid through /api/approve with kind "featured", and the review page's panel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { onRequestPost as approve, weekEnd } from "../functions/api/approve.js";
import { onRequestGet as queue } from "../functions/api/queue.js";

function fakeKv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, o }); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; } };
}
const ID = "0123456789abcdef";
const week = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const req = (b, tok = "tok") => new Request("https://x.test/api/approve", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(b) });
const seed = (kv, extra = {}) => kv.m.set(`featured:${ID}`, { v: JSON.stringify({ id: ID, event: "070b20cd9a53", brand: "Sunny", email: "a@b.co", week, plan: "paid", paid: false, ...extra }) });

test("weekEnd: seven days from the start day, minus a second", () => {
  assert.equal(weekEnd("2026-12-07"), "2026-12-13T23:59:59.000Z");
  assert.equal(weekEnd("nope"), "");
});

test("approve: featured:<id> becomes featured-ok:<id> with approved_at, week, paid, until", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  seed(kv);
  const r = await approve({ request: req({ id: ID, action: "approve", kind: "featured" }), env });
  assert.equal(r.status, 200);
  assert.equal(kv.m.has(`featured:${ID}`), false);
  const rec = JSON.parse(kv.m.get(`featured-ok:${ID}`).v);
  assert.equal(rec.until, weekEnd(week));
  assert.equal(rec.week, week);
  assert.equal(rec.paid, false);
  assert.ok(rec.approved_at);
  assert.ok(kv.m.get(`featured-ok:${ID}`).o.expirationTtl > 86400);
});

test("reject: featured-no:<id> with a 30 day TTL, nothing left under featured:", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  seed(kv);
  await approve({ request: req({ id: ID, action: "reject", kind: "featured" }), env });
  assert.equal(kv.m.get(`featured-no:${ID}`).o.expirationTtl, 30 * 86400);
  assert.equal(kv.m.has(`featured:${ID}`), false);
  assert.equal(kv.m.has(`featured-ok:${ID}`), false);
});

test("edit paid:true on an approved item sets paid and paid_at; a bad patch is 400", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  seed(kv);
  await approve({ request: req({ id: ID, action: "approve", kind: "featured" }), env });
  assert.equal((await approve({ request: req({ id: ID, action: "edit", kind: "featured", patch: { brand: "x" } }), env })).status, 400);
  const r = await approve({ request: req({ id: ID, action: "edit", kind: "featured", patch: { paid: true } }), env });
  assert.equal((await r.json()).paid, true);
  const rec = JSON.parse(kv.m.get(`featured-ok:${ID}`).v);
  assert.equal(rec.paid, true);
  assert.ok(rec.paid_at);
  assert.equal(rec.brand, "Sunny");
});

test("featured moderation needs the token, 404s on a missing id, and leaves event items alone", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  seed(kv);
  assert.equal((await approve({ request: req({ id: ID, action: "approve", kind: "featured" }, "bad"), env })).status, 401);
  assert.equal((await approve({ request: req({ id: "ffffffffffffffff", action: "approve", kind: "featured" }), env })).status, 404);
  assert.equal(kv.m.has(`featured:${ID}`), true);
  // without kind it still looks only at pending:<id>
  assert.equal((await approve({ request: req({ id: ID, action: "approve" }), env })).status, 404);
  kv.m.set(`pending:${ID}`, { v: JSON.stringify({ id: ID, status: "pending", fields: { brand: "E" } }) });
  assert.equal((await approve({ request: req({ id: ID, action: "approve" }), env })).status, 200);
  assert.equal(kv.m.has(`approved:${ID}`), true);
  assert.equal(kv.m.has(`featured:${ID}`), true);
});

test("the queue lists approved featured items", async () => {
  const kv = fakeKv(), env = { INTAKE: kv, INTAKE_TOKEN: "tok" };
  kv.m.set("featured-ok:abc", { v: JSON.stringify({ id: "abc", brand: "B" }) });
  const r = await queue({ request: new Request("https://x.test/api/queue?kinds=featured,featured-ok", { headers: { authorization: "Bearer tok" } }), env });
  const j = await r.json();
  assert.equal(j["featured-ok"].length, 1);
  assert.deepEqual(j.featured, []);
});

test("review page: a Featured panel, CSP-safe, buttons wired to kind featured", () => {
  const html = fs.readFileSync(new URL("../site/add/review.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../site/add/review.js", import.meta.url), "utf8");
  assert.match(html, /id="feat-pending"/);
  assert.match(html, /id="feat-ok"/);
  assert.equal([...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1])).length, 0);
  assert.match(js, /kind: "featured"/);
  assert.match(js, /Mark paid/);
  assert.doesNotMatch(html + js, /kawaii|uwu|cute|cutesy|girly/i);
});
