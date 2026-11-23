// Map density (site/density.js): from zoom 10 up, places fold by a 0.01 degree grid to zoom 12, and any two markers left
// stand at least 28 px apart (a closer one joins the first as a stack that spreads on tap). Run on a fixture and on today's data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SITE = path.resolve("site");
const w = {};
vm.runInNewContext(fs.readFileSync(path.join(SITE, "density.js"), "utf8"), { window: w });
const D = w.MatchaDensity;
const pt = (key, lat, lng, kind = "s") => ({ key, ll: [lat, lng], kind });
const dist = (a, b, z, shift) => { const p = D.px({ ll: a.ll, kind: a.kind }, z, shift), q = D.px({ ll: b.ll, kind: b.kind }, z, shift); return Math.hypot(p[0] - q[0], p[1] - q[1]); };

test("two pins closer than 28 px fold into one stack at the first pin's spot; far ones stand alone", () => {
  // at zoom 14 one degree of longitude is 512 * 2^14 / 360 = 23302 px, so 0.0005 degrees is about 12 px
  const g = D.group([pt("s:b", 40.75, -73.99), pt("s:a", 40.75, -73.9895), pt("s:c", 40.76, -73.98)], 14);
  assert.equal(g.length, 2);
  const stack = g.find((x) => x.keys.length === 2);
  assert.equal(stack.kind, "fan");
  assert.deepEqual(Array.from(stack.keys).sort(), ["s:a", "s:b"]);
  assert.equal(stack.key, "s:a", "the leader is the first by key");
  assert.equal(g.find((x) => x.keys.length === 1).kind, "one");
});

test("zoom 10 to 12: a 0.01 degree cell is one neighbourhood group on its middle member", () => {
  const pts = [pt("s:1", 40.7501, -73.9901), pt("s:2", 40.7505, -73.9905), pt("s:3", 40.7509, -73.9909), pt("s:4", 40.7801, -73.9601)];
  const g = D.group(pts, 11, { grid: 0.01 });
  const cell = g.find((x) => x.keys.length === 3);
  assert.equal(cell.kind, "cell");
  assert.equal(cell.key, "s:2", "the member nearest the cell's mean");
  assert.equal(g.length, 2);
});

test("every pair of markers left stands at least 28 px apart, with the marker's own offset", () => {
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push(pt("s:" + i, 40.70 + ((i * 37) % 100) / 1000, -74.02 + ((i * 53) % 100) / 1000, i % 3 ? "s" : "b"));
  const shift = (p) => (p.kind === "b" ? [12, 12] : [0, 0]);
  for (const z of [10, 11, 12, 13, 14, 16]) {
    const g = D.group(pts, z, { grid: z < 12 ? 0.01 : 0, shift });
    assert.equal(g.reduce((n, x) => n + x.keys.length, 0), pts.length, "every point in exactly one group at " + z);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = { ll: g[i].ll, kind: pts.find((p) => p.key === g[i].key).kind }, b = { ll: g[j].ll, kind: pts.find((p) => p.key === g[j].key).kind };
      assert.ok(dist(a, b, z, shift) >= 28, `zoom ${z}: ${g[i].key} and ${g[j].key} are ${dist(a, b, z, shift).toFixed(1)} px apart`);
    }
  }
});

test("with marker boxes: no two markers left overlap, a group measured at its grown size", () => {
  const pts = [];
  for (let i = 0; i < 300; i++) pts.push(pt((i % 3 ? "s:" : "e:") + i, 40.70 + ((i * 37) % 100) / 900, -74.02 + ((i * 53) % 100) / 900, i % 3 ? "s" : "e"));
  const shift = (p) => (p.kind === "e" ? [0, -23] : [0, 0]);
  const half = (p, n) => (n > 1 ? (n > 9 ? [30, 33] : [26, 27]) : p.kind === "e" ? [20, 23] : [14, 14]);
  const kindOf = new Map(pts.map((p) => [p.key, p.kind]));
  for (const z of [10, 12, 13, 14]) {
    const g = D.group(pts, z, { grid: z < 12 ? 0.01 : 0, shift, half, slack: 0 });
    assert.equal(g.reduce((n, x) => n + x.keys.length, 0), pts.length);
    const box = (x) => { const k = { ll: x.ll, kind: kindOf.get(x.key) }, c = D.px(k, z, shift), h = half(k, x.keys.length); return [c[0] - h[0], c[1] - h[1], c[0] + h[0], c[1] + h[1]]; };
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = box(g[i]), b = box(g[j]), w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      assert.ok(!(w > 0 && h > 0), `zoom ${z}: ${g[i].key} (${g[i].keys.length}) and ${g[j].key} (${g[j].keys.length}) overlap ${w.toFixed(1)}x${h.toFixed(1)}`);
    }
  }
});

test("a spread stack: members stand apart from each other and from the middle", () => {
  for (const n of [2, 3, 5, 8, 9, 20, 60]) {
    const o = D.fanOffsets(n);
    assert.equal(o.length, n);
    for (let i = 0; i < n; i++) {
      assert.ok(Math.hypot(o[i][0], o[i][1]) >= 28, `n=${n}: member ${i} too near the middle`);
      for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(o[i][0] - o[j][0], o[i][1] - o[j][1]) >= 28, `n=${n}: ${i} and ${j} overlap`);
    }
  }
});

test("today's shops: deterministic, and fast enough for every half zoom", () => {
  const shops = JSON.parse(fs.readFileSync(path.join(SITE, "data", "shops.json"), "utf8")).shops.filter((s) => isFinite(s.lat) && isFinite(s.lng));
  const pts = shops.map((s) => pt("s:" + s.id, s.lat, s.lng));
  const t = Date.now(), a = D.group(pts, 12, { grid: 0 }), b = D.group(pts.slice().reverse(), 12, { grid: 0 });
  assert.ok(Date.now() - t < 1500, "two passes over every shop in under 1.5 s");
  assert.deepEqual(a.map((g) => g.key).sort(), b.map((g) => g.key).sort(), "the same groups whatever the input order");
});

test("the page loads density.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const a = html.indexOf('src="density.js'), b = html.indexOf('src="app.js');
  assert.ok(a > 0 && b > a, "density.js before app.js");
  assert.match(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"), /"\/density\.js"/);
});
