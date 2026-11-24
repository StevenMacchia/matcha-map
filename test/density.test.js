// Map density (site/density.js), the uncluster rule (2026-11-23): from zoom 9 up nothing groups by area; a pin joins another
// only when the two stand closer than 20 px on screen, as a stack that spreads on hover and tap. spread() is the city split
// test from zoom 6 to 9. Run on a fixture and on today's data.
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

test("the threshold is 20 px", () => assert.equal(D.MIN_PX, 20));

test("two pins closer than 20 px fold into one stack at the first pin's spot; far ones stand alone", () => {
  // at zoom 14 one degree of longitude is 512 * 2^14 / 360 = 23302 px, so 0.0005 degrees is about 12 px
  const g = D.group([pt("s:b", 40.75, -73.99), pt("s:a", 40.75, -73.9895), pt("s:c", 40.76, -73.98)], 14);
  assert.equal(g.length, 2);
  const stack = g.find((x) => x.keys.length === 2);
  assert.equal(stack.kind, "fan");
  assert.deepEqual(Array.from(stack.keys).sort(), ["s:a", "s:b"]);
  assert.equal(stack.key, "s:a", "the leader is the first by key");
  assert.equal(g.find((x) => x.keys.length === 1).kind, "one");
});

test("no neighbourhood grouping: pins 21 px apart in one 0.01 degree cell stand alone at zoom 10 to 12", () => {
  for (const z of [10, 11, 12]) {
    const step = 21 * 360 / (512 * 2 ** z); // 21 px of longitude
    const pts = [0, 1, 2].map((i) => pt("s:" + i, 40.7505, -73.9905 + i * step));
    const g = D.group(pts, z);
    assert.equal(g.length, 3, "zoom " + z);
    assert.ok(g.every((x) => x.kind === "one"));
  }
});

test("every pair of markers left stands at least 20 px apart, with the marker's own offset", () => {
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push(pt("s:" + i, 40.70 + ((i * 37) % 100) / 1000, -74.02 + ((i * 53) % 100) / 1000, i % 3 ? "s" : "b"));
  const shift = (p) => (p.kind === "b" ? [12, 12] : [0, 0]);
  for (const z of [9, 10, 11, 12, 13, 14, 16]) {
    const g = D.group(pts, z, { shift });
    assert.equal(g.reduce((n, x) => n + x.keys.length, 0), pts.length, "every point in exactly one group at " + z);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = { ll: g[i].ll, kind: pts.find((p) => p.key === g[i].key).kind }, b = { ll: g[j].ll, kind: pts.find((p) => p.key === g[j].key).kind };
      assert.ok(dist(a, b, z, shift) >= 20, `zoom ${z}: ${g[i].key} and ${g[j].key} are ${dist(a, b, z, shift).toFixed(1)} px apart`);
    }
    // and every member of a stack is within 20 px of its leader: nothing joins from further away
    for (const x of g) for (const k of x.keys) {
      const p = pts.find((q) => q.key === k), l = pts.find((q) => q.key === x.key);
      assert.ok(dist(p, l, z, shift) < 20 || k === x.key, `zoom ${z}: ${k} joined ${x.key} from ${dist(p, l, z, shift).toFixed(1)} px`);
    }
  }
});

test("with icon sizes: two markers join only where their icons would overlap, and none left overlap past the tuck", () => {
  const pts = [];
  for (let i = 0; i < 300; i++) pts.push(pt((i % 3 ? "s:" : "e:") + i, 40.70 + ((i * 37) % 100) / 900, -74.02 + ((i * 53) % 100) / 900, i % 3 ? "s" : "e"));
  const shift = (p) => (p.kind === "e" ? [0, -35] : [0, 0]);
  const R = { e: 23, s: 18 }, radius = (p, n) => (n > 1 ? 25 : R[p.kind]);
  const kindOf = new Map(pts.map((p) => [p.key, p.kind]));
  for (const z of [9, 11, 13, 14]) {
    const g = D.group(pts, z, { shift, radius });
    assert.equal(g.reduce((n, x) => n + x.keys.length, 0), pts.length);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = { ll: g[i].ll, kind: kindOf.get(g[i].key) }, b = { ll: g[j].ll, kind: kindOf.get(g[j].key) }, d = dist(a, b, z, shift);
      const lim = Math.max(20, radius(a, g[i].keys.length) + radius(b, g[j].keys.length) - 4);
      assert.ok(d >= lim, `zoom ${z}: ${g[i].key} (${g[i].keys.length}) and ${g[j].key} (${g[j].keys.length}) are ${d.toFixed(1)} px apart, under ${lim}`);
    }
  }
  // two shops 33 px apart (their 36 px rings tuck by 3) stand alone; 31 px apart they stack
  const z = 14, px1 = 360 / (512 * 2 ** z);
  assert.equal(D.group([pt("s:a", 40.75, -73.99), pt("s:b", 40.75, -73.99 + 33 * px1)], z, { radius }).length, 2);
  assert.equal(D.group([pt("s:a", 40.75, -73.99), pt("s:b", 40.75, -73.99 + 31 * px1)], z, { radius }).length, 1);
});

test("spread: the screen size of a city's places, which doubles with each zoom", () => {
  const lls = [[29.76, -95.37], [29.70, -95.40], [29.80, -95.30]];
  const s7 = D.spread(lls, 7), s8 = D.spread(lls, 8);
  assert.ok(Math.abs(s8 / s7 - 2) < 1e-9);
  assert.equal(D.spread([[29.76, -95.37]], 12), 0);
  // never less than the widest pair
  for (let i = 0; i < lls.length; i++) for (let j = i + 1; j < lls.length; j++) assert.ok(dist({ ll: lls[i] }, { ll: lls[j] }, 7) <= s7 + 1e-9);
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

test("today's shops: deterministic, and fast enough for every quarter zoom", () => {
  const shops = JSON.parse(fs.readFileSync(path.join(SITE, "data", "shops.json"), "utf8")).shops.filter((s) => isFinite(s.lat) && isFinite(s.lng));
  const pts = shops.map((s) => pt("s:" + s.id, s.lat, s.lng));
  const t = Date.now(), a = D.group(pts, 12), b = D.group(pts.slice().reverse(), 12);
  assert.ok(Date.now() - t < 1500, "two passes over every shop in under 1.5 s");
  assert.deepEqual(a.map((g) => g.key).sort(), b.map((g) => g.key).sort(), "the same groups whatever the input order");
});

test("the page loads density.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const a = html.indexOf('src="density.js'), b = html.indexOf('src="app.js');
  assert.ok(a > 0 && b > a, "density.js before app.js");
  assert.match(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"), /"\/density\.js"/);
});
