// site/ownermenus.js: one silent fetch, get(key) by shop id or handle; shell wiring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SITE = new URL("../site/", import.meta.url);
const src = fs.readFileSync(new URL("ownermenus.js", SITE), "utf8");
function boot(fetchImpl) {
  const w = {}, calls = [];
  vm.runInNewContext(src, { window: w, fetch: (u, o) => { calls.push(u); return fetchImpl(u, o); }, Object, Array });
  return { M: w.MatchaOwnerMenus, calls };
}
const ok = (menus) => () => Promise.resolve({ status: 200, json: () => Promise.resolve({ menus }) });
const menu = { items: [{ name: "Latte", price: "$7" }], source_url: "", kind: "owner", read: "2026-11-23", note: "From the owner" };

test("one fetch of /api/menus; get() by shop id or handle after ready; unknown keys and prototype keys give null", async () => {
  const { M, calls } = boot(ok({ "osm:node/1": menu, sunny: menu, empty: { items: [] } }));
  assert.equal(M.get("sunny"), null); // before it arrives
  await M.ready;
  assert.deepEqual(calls, ["/api/menus"]);
  assert.equal(M.get("osm:node/1").items[0].name, "Latte");
  assert.equal(M.get("sunny").note, "From the owner");
  assert.equal(M.get("nope"), null); assert.equal(M.get("empty"), null);
  for (const k of ["constructor", "__proto__", "toString", "", null, 5]) assert.equal(M.get(k), null);
});

test("silent on anything but 200: a 503, a network error, a bad body, no fetch at all", async () => {
  for (const f of [() => Promise.resolve({ status: 503, json: () => Promise.resolve({}) }), () => Promise.reject(new Error("offline")), ok([1, 2]), ok(null), () => Promise.resolve({ status: 200, json: () => Promise.reject(new Error("bad json")) })]) {
    const { M } = boot(f);
    await M.ready;
    assert.equal(M.get("sunny"), null);
  }
  const w = {}; vm.runInNewContext(src, { window: w, Object, Array });
  await w.MatchaOwnerMenus.ready;
  assert.equal(w.MatchaOwnerMenus.get("x"), null);
});

test("shell: loaded after rsvp.js in index.html, precached by the worker, no banned words", () => {
  const idx = fs.readFileSync(new URL("index.html", SITE), "utf8"), sw = fs.readFileSync(new URL("sw.js", SITE), "utf8");
  assert.ok(idx.indexOf("ownermenus.js") > idx.indexOf("rsvp.js"));
  assert.match(sw, /"\/ownermenus\.js"/);
  assert.doesNotMatch(src, /kawaii|uwu|cute|cutesy|girly/i);
});
