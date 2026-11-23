// GET /api/menus: approved owner menus, public, no personal data, memoised in the worker.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as menus, resetMemo } from "../functions/api/menus.js";
import { onRequestPost as approve } from "../functions/api/approve.js";

function fakeKv() {
  const m = new Map(); let lists = 0;
  return { m, get lists() { return lists; }, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, o }); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit }) { lists++; const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; } };
}
const entry = (extra = {}) => JSON.stringify({ items: [{ name: "Latte", price: "$7", note: "oat" }], source_url: "https://sunny.co/menu", kind: "owner", read: "2026-11-23", brand: "Sunny", handle: "sunny", approved_at: "2026-11-23T10:00:00Z", email: "leak@x.co", proof: "https://leak.example", ...extra });

test("empty store: an empty map, cached for five minutes", async () => {
  resetMemo();
  const r = await menus({ env: { INTAKE: fakeKv() } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await r.json(), { menus: {} });
});

test("approved menus come out keyed by shop id or handle, marked from the owner, with no personal data", async () => {
  resetMemo();
  const kv = fakeKv(); kv.m.set("menu-ok:osm:node/13159184974", { v: entry() }); kv.m.set("menu-ok:sunny", { v: entry({ source_url: "javascript:x" }) });
  kv.m.set("claim:0123456789abcdef", { v: entry() }); kv.m.set("menu-ok:broken", { v: "{nope" }); kv.m.set("menu-ok:empty", { v: JSON.stringify({ items: [] }) });
  const j = await (await menus({ env: { INTAKE: kv } })).json();
  assert.deepEqual(Object.keys(j.menus).sort(), ["osm:node/13159184974", "sunny"]);
  const m = j.menus["osm:node/13159184974"];
  assert.deepEqual(m, { items: [{ name: "Latte", price: "$7", note: "oat" }], source_url: "https://sunny.co/menu", kind: "owner", read: "2026-11-23", note: "From the owner" });
  assert.equal(j.menus.sunny.source_url, "");
  const text = JSON.stringify(j);
  for (const bad of ["leak", "email", "proof", "approved_at", "brand", "handle"]) assert.equal(text.includes(bad), false, bad);
});

test("never more than 100 menus and 40 items each, caps re-applied on the way out", async () => {
  resetMemo();
  const kv = fakeKv();
  for (let i = 0; i < 150; i++) kv.m.set(`menu-ok:k${i}`, { v: entry() });
  kv.m.set("menu-ok:big", { v: JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ name: "n".repeat(90) + i, price: "9".repeat(30) })) }) });
  const j = await (await menus({ env: { INTAKE: kv } })).json();
  assert.ok(Object.keys(j.menus).length <= 100);
  resetMemo();
  const kv2 = fakeKv(); kv2.m.set("menu-ok:big", { v: JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ name: "n".repeat(90), price: "9".repeat(30) })) }) });
  const b = (await (await menus({ env: { INTAKE: kv2 } })).json()).menus.big;
  assert.equal(b.items.length, 40); assert.equal(b.items[0].name.length, 40); assert.equal(b.items[0].price.length, 12);
});

test("the in-worker memo: a second read within a minute does not touch KV; no KV is a 503", async () => {
  resetMemo();
  const kv = fakeKv(); kv.m.set("menu-ok:sunny", { v: entry() });
  await menus({ env: { INTAKE: kv } }); await menus({ env: { INTAKE: kv } });
  assert.equal(kv.lists, 1);
  kv.m.set("menu-ok:later", { v: entry() });
  assert.equal(Object.keys((await (await menus({ env: { INTAKE: kv } })).json()).menus).length, 1);
  resetMemo();
  assert.equal((await menus({ env: {} })).status, 503);
});

test("round trip: an approved claim with a menu shows up in the public read", async () => {
  resetMemo();
  const kv = fakeKv(); const ID = "0123456789abcdef";
  kv.m.set(`claim:${ID}`, { v: JSON.stringify({ id: ID, brand: "Sunny", handle: "sunny", email: "o@sunny.co", proof: "https://sunny.co", shop: "brand:labora", menu: { items: [{ name: "Latte", price: "$7" }], source_url: "", kind: "owner", read: "2026-11-23" } }) });
  const r = await approve({ request: new Request("https://x.test/api/approve", { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: JSON.stringify({ id: ID, action: "approve", kind: "claim" }) }), env: { INTAKE: kv, INTAKE_TOKEN: "tok" } });
  assert.equal(r.status, 200);
  const j = await (await menus({ env: { INTAKE: kv } })).json();
  assert.equal(j.menus["brand:labora"].items[0].name, "Latte");
});
