// Owner menus, rung 3: the claim form's optional menu block (validator and handler).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateClaim, parseMenuLines, shopIdOf } from "../functions/_lib/validate.js";
import { onRequestPost as claim } from "../functions/api/claim.js";

const NOW = Date.UTC(2026, 10, 23, 12);
const base = { t: NOW - 9000, brand: "Sunny", handle: "@sunny", role: "owner", email: "o@sunny.co", proof: "https://sunny.co" };
const v = (x) => validateClaim({ ...base, ...x }, { now: NOW });

test("a claim without a menu keeps its old shape", () => {
  const r = v({});
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.clean).sort(), ["brand", "email", "handle", "proof", "role"]);
});

test("menu lines parse into items: name, optional price, optional note; stored as an owner menu with the claim date", () => {
  const r = v({ menu: "Ceremonial latte, $7\nStrawberry matcha, $8.50, with oat milk\r\n\nHojicha\n", menu_url: "https://sunny.co/menu", shop: "https://matchamap-cu7.pages.dev/?shop=osm%3Anode%2F13159184974" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.clean.menu, { items: [{ name: "Ceremonial latte", price: "$7" }, { name: "Strawberry matcha", price: "$8.50", note: "with oat milk" }, { name: "Hojicha" }], source_url: "https://sunny.co/menu", kind: "owner", read: "2026-11-23" });
  assert.equal(r.clean.shop, "osm:node/13159184974");
});

test("bad menu lines are rejected with the line number; caps hold; not-text is refused", () => {
  assert.match(v({ menu: "Latte, $7\n<b>x</b>, 1" }).errors.menu, /^Line 2/);
  assert.match(v({ menu: ", $7" }).errors.menu, /^Line 1/);
  assert.match(v({ menu: "x".repeat(41) + ", $7" }).errors.menu, /name/);
  assert.match(v({ menu: "Latte, " + "9".repeat(13) }).errors.menu, /price/);
  assert.match(v({ menu: "Latte, $7, " + "n".repeat(61) }).errors.menu, /note/);
  assert.equal(v({ menu: "x".repeat(40) + ", " + "9".repeat(12) + ", " + "n".repeat(60) }).ok, true);
  assert.ok(v({ menu: ["Latte, 7"] }).errors.menu);
  assert.ok(v({ menu: { a: 1 } }).errors.menu);
  assert.ok(v({ menu: 5 }).errors.menu);
  assert.equal(v({ menu: Array.from({ length: 40 }, (_, i) => "Drink " + i).join("\n") }).ok, true);
  assert.match(v({ menu: Array.from({ length: 41 }, (_, i) => "Drink " + i).join("\n") }).errors.menu, /40 lines/);
});

test("menu link and shop field: bad ones are errors, a link alone is not a menu", () => {
  assert.ok(v({ menu: "Latte, 7", menu_url: "javascript:alert(1)" }).errors.menu_url);
  assert.ok(v({ menu_url: "https://sunny.co/menu" }).errors.menu);
  assert.ok(v({ menu: "Latte, 7", shop: "not a shop" }).errors.shop);
  assert.equal(v({ menu: "Latte, 7", shop: "brand:labora" }).clean.shop, "brand:labora");
  assert.equal(v({ menu: "Latte, 7" }).clean.menu.source_url, "");
  assert.equal(shopIdOf("https://x.test/?shop=osm:way/12&z=3"), "osm:way/12");
  assert.equal(shopIdOf("https://x.test/?shop=../../x"), "");
  assert.deepEqual(parseMenuLines(""), { items: [] });
});

test("honeypot and timing behave as the other forms", () => {
  assert.equal(validateClaim({ ...base, company: "x", menu: "Latte, 7" }, { now: NOW }).bot, true);
  assert.equal(validateClaim({ ...base, t: NOW - 100, menu: "Latte, 7" }, { now: NOW }).bot, true);
});

function fakeKv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, val, o) { m.set(k, { v: val, o }); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })); return { keys, list_complete: true }; } };
}
const post = (b) => new Request("https://x.test/api/claim", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify(b) });
const fresh = (x) => ({ ...base, t: Date.now() - 9000, ...x });

test("handler: a claim with a menu is stored as claim:<id> with the menu; one without has none", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  const r = await claim({ request: post(fresh({ menu: "Latte, $7", menu_url: "https://sunny.co/menu" })), env });
  assert.equal(r.status, 200);
  const keys = [...kv.m.keys()].filter((k) => k.startsWith("claim:"));
  assert.equal(keys.length, 1);
  const rec = JSON.parse(kv.m.get(keys[0]).v);
  assert.equal(rec.menu.kind, "owner");
  assert.equal(rec.menu.items[0].name, "Latte");
  const r2 = await claim({ request: post(fresh({ brand: "Plain" })), env });
  assert.equal(r2.status, 200);
  const plain = [...kv.m.entries()].filter(([k]) => k.startsWith("claim:")).map(([, x]) => JSON.parse(x.v)).find((x) => x.brand === "Plain");
  assert.equal("menu" in plain, false);
});

test("handler: bad menu is 422 and stores nothing; the daily limit still applies", async () => {
  const kv = fakeKv(), env = { INTAKE: kv };
  const r = await claim({ request: post(fresh({ menu: "<b>x</b>" })), env });
  assert.equal(r.status, 422);
  assert.ok((await r.json()).errors.menu);
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith("claim:")).length, 0);
  for (let i = 0; i < 10; i++) await claim({ request: post(fresh({ menu: "Latte, 7" })), env });
  assert.equal((await claim({ request: post(fresh({ menu: "Latte, 7" })), env })).status, 429);
});

test("claim page: the menu block is in the form and says what happens to it", () => {
  const html = fs.readFileSync(new URL("../site/claim/index.html", import.meta.url), "utf8");
  for (const n of ["menu", "menu_url", "shop"]) assert.match(html, new RegExp(`name="${n}"`));
  assert.match(html, /Shown on your card after we check it, marked as from the owner/);
  assert.match(html, /maxlength="5000"/);
});
