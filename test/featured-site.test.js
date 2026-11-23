// site/featured.js: loads silently, paints a one-word pill on picked rows and cards, never on others; shell wiring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SITE = new URL("../site/", import.meta.url);
const src = fs.readFileSync(new URL("featured.js", SITE), "utf8");

// A tiny DOM: elements with attrs, children and querySelector(All) for the few selectors the module uses.
function el(cls, attrs = {}, kids = []) {
  const e = { cls, attrs, kids, parent: null, text: "", className: cls,
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    appendChild(c) { c.parent = e; kids.push(c); return c; },
    querySelectorAll(sel) { return walk(e, sel); },
    querySelector(sel) { return walk(e, sel)[0] || null; } };
  kids.forEach((k) => { k.parent = e; });
  return e;
}
function matches(n, sel) {
  const m = /^\.([\w-]+)(?:\[([\w-]+)\])?$/.exec(sel);
  const has = (n.className || "").split(/\s+/).includes(m[1]);
  return has && (!m[2] || m[2] in n.attrs);
}
function walk(root, sel) { const out = []; (function go(n) { for (const k of n.kids) { if (matches(k, sel)) out.push(k); go(k); } })(root); return out; }
const row = (id) => el("mm-row", { "data-event": id }, [el("mm-rt", {}, [el("mm-rn", {}, [el("mm-rname")])])]);
const card = (id) => el("mm-card", { "data-id": id }, [el("mm-brandrow", {}, [el("mm-bname")])]);

function boot(fetchImpl) {
  const w = {};
  const doc = { createElement: () => el(""), querySelectorAll() { return []; } };
  const calls = [];
  const ctx = { window: w, document: doc, fetch: (u) => { calls.push(u); return fetchImpl(u); }, Array, JSON };
  vm.runInNewContext(src, ctx);
  return { F: w.MatchaFeatured, calls, doc };
}
const ok = (picks) => () => Promise.resolve({ status: 200, json: () => Promise.resolve({ picks }) });
const tick = () => new Promise((r) => setTimeout(r, 5));

test("loads once with one fetch, paints picked rows and cards with a one-word pill, leaves the rest", async () => {
  const { F, calls, doc } = boot(ok([{ event: "070b20cd9a53", brand: "Sunny", until: "x", paid: true }, { event: "111111111111", paid: false }]));
  const list = el("list", {}, [row("070b20cd9a53"), row("999999999999")]);
  const box = el("box", {}, [card("111111111111"), card("999999999999")]);
  doc.querySelectorAll = () => [];
  F.paint(list); // before the picks arrive: nothing
  assert.equal(list.querySelectorAll(".mm-feat").length, 0);
  await tick();
  assert.deepEqual(calls, ["/api/featured"]);
  F.paint(list); F.paint(list); F.paint(box);
  const pills = list.querySelectorAll(".mm-feat");
  assert.equal(pills.length, 1);
  assert.equal(pills[0].textContent, "Featured");
  assert.equal(pills[0].parent.className, "mm-rn");
  assert.equal(list.kids[0].querySelectorAll(".mm-feat").length, 1);
  assert.equal(list.kids[1].querySelectorAll(".mm-feat").length, 0);
  assert.equal(box.kids[0].querySelectorAll(".mm-feat").length, 1);
  assert.equal(box.kids[1].querySelectorAll(".mm-feat").length, 0);
  assert.equal(box.querySelector(".mm-feat").parent.className, "mm-bname");
});

test("any answer but 200, a rejected fetch, or an empty list: nothing painted, no retry, nothing thrown", async () => {
  for (const f of [() => Promise.resolve({ status: 404, json: () => Promise.reject(new Error("x")) }), () => Promise.resolve({ status: 503, json: () => Promise.resolve({}) }), () => Promise.reject(new Error("offline")), ok([]), ok([{ event: "bad" }])]) {
    const { F, calls } = boot(f);
    await tick();
    const list = el("list", {}, [row("070b20cd9a53")]);
    F.paint(list);
    assert.equal(list.querySelectorAll(".mm-feat").length, 0);
    assert.equal(calls.length, 1);
  }
  const w = {}; // no fetch at all
  vm.runInNewContext(src, { window: w, document: {}, Array, JSON });
  w.MatchaFeatured.paint(null);
});

test("shell: the script follows rsvp.js and precedes app.js, is precached, the pill is styled, app.js hooks are in place, no banned words", () => {
  const html = fs.readFileSync(new URL("index.html", SITE), "utf8");
  const i = html.indexOf('src="featured.js');
  assert.ok(i > html.indexOf('src="rsvp.js') && i < html.indexOf('src="app.js'));
  assert.match(fs.readFileSync(new URL("sw.js", SITE), "utf8"), /"\/featured\.js"/);
  assert.match(fs.readFileSync(new URL("cards.css", SITE), "utf8"), /\.mm-feat \{/);
  const app = fs.readFileSync(new URL("app.js", SITE), "utf8");
  assert.equal((app.match(/MatchaFeatured\.paint\(/g) || []).length, 4);
  assert.doesNotMatch(src, /kawaii|uwu|cute|cutesy|girly|innerHTML/i);
});
