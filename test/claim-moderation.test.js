// Claims: approve / reject through /api/approve with kind "claim", the owner menu written on approval, and the review page's panel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { onRequestPost as approve } from "../functions/api/approve.js";
import { onRequestGet as queue } from "../functions/api/queue.js";

function fakeKv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, o }); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; } };
}
const ID = "0123456789abcdef";
const menu = { items: [{ name: "Latte", price: "$7" }], source_url: "https://sunny.co/menu", kind: "owner", read: "2026-11-23" };
const req = (b, tok = "tok") => new Request("https://x.test/api/approve", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(b) });
const seed = (kv, extra = {}) => kv.m.set(`claim:${ID}`, { v: JSON.stringify({ id: ID, at: "2026-11-23T10:00:00Z", brand: "Sunny", handle: "sunny", role: "owner", email: "o@sunny.co", proof: "https://sunny.co", ...extra }) });
const env = (kv) => ({ INTAKE: kv, INTAKE_TOKEN: "tok" });

test("approve: claim:<id> becomes claim-ok:<id> (90 days); a claim without a menu writes no menu", async () => {
  const kv = fakeKv(); seed(kv);
  const r = await approve({ request: req({ id: ID, action: "approve", kind: "claim" }), env: env(kv) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).menu, false);
  assert.equal(kv.m.has(`claim:${ID}`), false);
  assert.equal(kv.m.get(`claim-ok:${ID}`).o.expirationTtl, 90 * 86400);
  assert.equal(JSON.parse(kv.m.get(`claim-ok:${ID}`).v).status, "approved");
  assert.equal([...kv.m.keys()].some((k) => k.startsWith("menu-ok:")), false);
});

test("approve with a menu and a shop writes menu-ok:<shop id>: the menu plus brand, handle, approved_at, and no email or proof", async () => {
  const kv = fakeKv(); seed(kv, { menu, shop: "osm:node/13159184974" });
  assert.equal((await (await approve({ request: req({ id: ID, action: "approve", kind: "claim" }), env: env(kv) })).json()).menu, true);
  const rec = JSON.parse(kv.m.get("menu-ok:osm:node/13159184974").v);
  assert.deepEqual(rec.items, menu.items);
  assert.equal(rec.kind, "owner"); assert.equal(rec.brand, "Sunny"); assert.equal(rec.handle, "sunny"); assert.ok(rec.approved_at);
  assert.equal("email" in rec, false); assert.equal("proof" in rec, false);
});

test("approve with a menu and no shop falls back to the brand handle as the key", async () => {
  const kv = fakeKv(); seed(kv, { menu });
  await approve({ request: req({ id: ID, action: "approve", kind: "claim" }), env: env(kv) });
  assert.ok(kv.m.has("menu-ok:sunny"));
});

test("reject: claim-no:<id> for 30 days, no menu written, the claim is gone", async () => {
  const kv = fakeKv(); seed(kv, { menu, shop: "brand:labora" });
  const r = await approve({ request: req({ id: ID, action: "reject", kind: "claim" }), env: env(kv) });
  assert.equal((await r.json()).status, "claim-no");
  assert.equal(kv.m.get(`claim-no:${ID}`).o.expirationTtl, 30 * 86400);
  assert.equal(kv.m.has(`claim:${ID}`), false);
  assert.equal([...kv.m.keys()].some((k) => k.startsWith("menu-ok:")), false);
});

test("claims need the token, 404 on a missing id, refuse edit and consume, and leave other kinds alone", async () => {
  const kv = fakeKv(); seed(kv, { menu });
  assert.equal((await approve({ request: req({ id: ID, action: "approve", kind: "claim" }, "bad"), env: env(kv) })).status, 401);
  assert.equal((await approve({ request: req({ id: "ffffffffffffffff", action: "approve", kind: "claim" }), env: env(kv) })).status, 404);
  assert.equal((await approve({ request: req({ id: ID, action: "edit", kind: "claim", patch: {} }), env: env(kv) })).status, 400);
  assert.equal((await approve({ request: req({ id: ID, action: "consume", kind: "claim" }), env: env(kv) })).status, 400);
  assert.equal(kv.m.has(`claim:${ID}`), true);
  assert.equal((await approve({ request: req({ id: ID, action: "approve" }), env: env(kv) })).status, 404); // no kind: pending only
});

test("the queue lists claims with their menu", async () => {
  const kv = fakeKv(); seed(kv, { menu });
  const r = await queue({ request: new Request("https://x.test/api/queue?kinds=claim", { headers: { authorization: "Bearer tok" } }), env: env(kv) });
  const j = await r.json();
  assert.equal(j.claim.length, 1);
  assert.equal(j.claim[0].menu.items[0].name, "Latte");
});

test("review page: a Claims panel, its own queue request, approve and reject with kind claim, text set with textContent", () => {
  const html = fs.readFileSync(new URL("../site/add/review.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../site/add/review.js", import.meta.url), "utf8");
  assert.match(html, /<h2>Claims<\/h2><div id="claims"><\/div>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.match(js, /\/api\/queue\?kinds=claim/);
  assert.match(js, /kind: "claim", action: d\[2\]/);
  assert.match(js, /\["Approve", "", "approve"\], \["Reject", "alt", "reject"\]/);
  for (const f of ["item.brand", "item.handle", "item.role", "item.email", "item.proof", "m.items", "x.name"]) assert.ok(js.includes(f), f);
  assert.doesNotMatch(js.slice(js.indexOf("function claimCard"), js.indexOf("function fillFeat")), /innerHTML/);
});
