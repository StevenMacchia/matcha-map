// GET /api/featured: only approved, unexpired picks; no emails or request ids; cached; capped at 50.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequest, resetMemo } from "../functions/api/featured.js";

function fakeKv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v) { m.set(k, { v }); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; } };
}
const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
const put = (kv, id, o) => kv.m.set(`featured-ok:${id}`, { v: JSON.stringify({ id, email: "secret@x.co", notes: "private", ...o }) });
const get = (kv) => onRequestGet({ env: { INTAKE: kv } });

test("returns approved, unexpired picks only, with no emails, notes or request ids", async () => {
  resetMemo();
  const kv = fakeKv();
  put(kv, "aaaaaaaaaaaaaaa1", { event: "070b20cd9a53", brand: "Sunny", until: day(3), paid: true });
  put(kv, "aaaaaaaaaaaaaaa2", { event: "111111111111", brand: "Old", until: day(-1), paid: false });
  put(kv, "aaaaaaaaaaaaaaa3", { event: "not-an-id", brand: "Bad", until: day(3) });
  kv.m.set("featured:aaaaaaaaaaaaaaa4", { v: JSON.stringify({ event: "222222222222", brand: "Pending", until: day(3) }) });
  const r = await get(kv);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  const text = await r.text();
  const j = JSON.parse(text);
  assert.deepEqual(j.picks.map((p) => p.event), ["070b20cd9a53"]);
  assert.deepEqual(Object.keys(j.picks[0]).sort(), ["brand", "event", "paid", "until"]);
  assert.doesNotMatch(text, /secret|private|aaaaaaaa/);
});

test("capped at 50, soonest ending first; GET routes through onRequest; no KV is 503; other methods 405", async () => {
  resetMemo();
  const kv = fakeKv();
  for (let i = 0; i < 60; i++) put(kv, String(i).padStart(16, "0"), { event: String(i).padStart(12, "a"), brand: "B" + i, until: day(1 + i) });
  const j = await (await get(kv)).json();
  assert.ok(j.picks.length <= 50);
  assert.ok(Date.parse(j.picks[0].until) <= Date.parse(j.picks[1].until));
  resetMemo();
  assert.equal((await onRequest({ request: new Request("https://x.test/api/featured"), env: { INTAKE: kv } })).status, 200);
  resetMemo();
  assert.equal((await onRequestGet({ env: {} })).status, 503);
  assert.equal((await onRequest({ request: new Request("https://x.test/api/featured", { method: "DELETE" }), env: { INTAKE: kv } })).status, 405);
});
