// The overlap and overflow gate for the daily graphics (Steven's acceptance test on every card: "no bugs or overlaps or coming
// out of box"). Every template is rendered with the longest names and the longest drink lists in the real data, in feed and
// story, and the page itself is measured: text under 36px, text off the canvas or out of its own box, a cut-short line, and
// any two boxes that intersect (rows, pills, the pour block, Mattie, the column, the foot). Any hit fails the test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, loadData } from "../tools/social/plan.js";
import { renderPages, itemHtml, chromePath, MIN_TEXT_PX } from "../tools/social/render.js";
import { whatTheyPour, cleanDrink } from "../tools/social/drinks.js";
import { addDays } from "../tools/gen-pages.js";

const hasChrome = fs.existsSync(chromePath());
const DATA = loadData();
const longest = (list, f, n = 1) => list.slice().sort((a, b) => f(b).length - f(a).length).slice(0, n);

// a month of real plans: the longest real brand, venue, city and shop names that ever reach a card
const PLANS = Array.from({ length: 45 }, (_, i) => plan({ date: addDays("2026-11-24", i), data: DATA, history: {} }));
const ALL = PLANS.flatMap((p) => p.items);
const EVENTS = ALL.flatMap((it) => it.events);
const SHOPS = ALL.filter((it) => it.shop).map((it) => it.shop);

// the five longest distinct drink names in the data, one per type, as a real "What they pour" block
const longPour = (() => {
  const names = [...new Set(DATA.shops.flatMap((s) => (s.menu_matcha || []).map((m) => cleanDrink(m && m.name))).filter(Boolean))];
  const per = whatTheyPour(longest(names, (n) => n, 400), 5);
  return { items: per.items, more: 9 };
})();

const base = (o) => ({ slot: "story", date: "2026-11-24", hashtags: [], events: [], more: 0, shop: null, city: "Brooklyn", state: "NY", tag: "Today", ...o });
const evOf = (v, pour) => ({ ...v, pour });
function cards() {
  const out = [];
  const lb = longest(EVENTS, (v) => v.brand + (v.venue || "") + v.city)[0];
  const longCity = longest(EVENTS, (v) => v.city)[0];
  const ls = longest(SHOPS, (s) => s.name + s.address + s.city)[0];
  for (const size of ["story", "feed"]) {
    out.push({ name: `${size} shop, longest name, five longest drinks`, size, it: base({ slot: size, kind: "shop", title: ls.name, city: ls.city, state: ls.state, shop: { ...ls, pour: longPour } }) });
    if (size === "feed") {
      out.push({ name: "feed featured shop, five longest drinks", size, it: base({ slot: "feed", kind: "featured-shop", tag: "Featured shop", title: ls.name, city: ls.city, state: ls.state, shop: { ...ls, pour: longPour } }) });
      out.push({ name: "feed featured pop-up, long pour", size, it: base({ slot: "feed", kind: "featured-popup", tag: "Featured pop-up", title: lb.brand, events: [evOf(lb, longPour)] }) });
      out.push({ name: "feed city feature, four longest shops", size, it: base({ slot: "feed", kind: "city", tag: "City feature", title: "New in " + longCity.city, events: longest(SHOPS, (x) => x.name, 4).map((x) => ({ id: x.id, brand: x.name, kind: "cafe", venue: "", city: x.city, state: x.state, day: "2026-11-24", time: "New on the map", menu: [], pour: x.pour })), more: 9 }) });
    }
    out.push({ name: `${size} shop, one drink`, size, it: base({ slot: size, kind: "shop", title: ls.name, shop: { ...ls, pour: { items: longPour.items.slice(0, 1), more: 0 } } }) });
    out.push({ name: `${size} shop, no pour (the old card)`, size, it: base({ slot: size, kind: "shop", title: ls.name, shop: { ...ls, pour: { items: [], more: 0 } } }) });
    out.push({ name: `${size} pop-up, longest names, long pour`, size, it: base({ slot: size, kind: "today", title: `Today in ${longCity.city}`, city: longCity.city, events: [evOf(lb, longPour)] }) });
    out.push({ name: `${size} pop-up, no pour`, size, it: base({ slot: size, kind: "today", title: `Today in ${lb.city}`, events: [evOf(lb, null)] }) });
    const four = longest(EVENTS, (v) => v.brand + (v.venue || ""), 4);
    out.push({ name: `${size} list of four, longest names`, size, it: base({ slot: size, kind: "weekend", title: `This weekend in ${longCity.city}`, events: four, more: 7 }) });
  }
  const rows = longest(EVENTS, (v) => v.brand, 4).map((v) => ({ id: v.id, brand: v.brand, kind: v.kind, sub: v.time, drinks: longPour.items.slice(0, 2).map((i) => i.name) }));
  for (const place of [longest(EVENTS, (v) => v.city)[0].city, "Washington, DC", "the Triangle", "North Carolina"]) {
    out.push({ name: `story location title, ${place}`, size: "story", it: base({ kind: "location", title: `This weekend in ${place}`, group: { key: "c:x", place, title: `This weekend in ${place}`, n: 1, of: 3, rows, names: [] } }) });
  }
  out.push({ name: "story location title, one row", size: "story", it: base({ kind: "location", title: "New in Ohio", group: { key: "s:OH", place: "Ohio", title: "New in Ohio", n: 1, of: 1, rows: rows.slice(0, 1), names: [] } }) });
  return out;
}

const render = async (list) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-gate-"));
  try { return await renderPages(list.map((c, i) => ({ html: itemHtml(c.it, c.size), out: path.join(dir, `${i}.png`), size: c.size }))); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test("gate: every template with the longest real names and drink lists has no overflow and no overlap", { skip: !hasChrome && "no Chrome" }, async () => {
  assert.ok(EVENTS.length && SHOPS.length && longPour.items.length >= 4, "the data gave real names to draw");
  const list = cards(), res = await render(list);
  assert.equal(res.length, list.length);
  const bad = [];
  res.forEach((r, i) => {
    const c = r.check || {};
    if (!r.ok || [c.small, c.off, c.cut, c.overlap].some((x) => !x || x.length) || !(c.min >= MIN_TEXT_PX - 0.5)) bad.push(`${list[i].name}: ${JSON.stringify({ min: c.min, small: c.small, off: c.off, cut: c.cut, overlap: c.overlap })}`);
  });
  assert.deepEqual(bad, []);
});

test("gate: it catches text out of its box and boxes that intersect", { skip: !hasChrome && "no Chrome" }, async () => {
  const sh = SHOPS[0];
  const huge = { items: [{ name: "W".repeat(70), plain: true }, ...longPour.items.slice(0, 4)], more: 0 };
  const [r1] = await render([{ size: "story", it: base({ kind: "shop", title: sh.name, shop: { ...sh, pour: huge } }) }]);
  assert.ok(r1.check.cut.length || r1.check.off.length, "a 70-letter drink name is flagged");
  // five rows in the feed (it has room for three) run the column past its space
  const [r2] = await render([{ size: "feed", it: base({ slot: "feed", kind: "shop", title: sh.name, shop: { ...sh, pour: longPour } }) }]);
  assert.ok(r2.ok);
  const html = itemHtml(base({ kind: "shop", title: sh.name, shop: { ...sh, pour: longPour } }), "story").replace('class="pour"', 'class="pour" style="position:relative;top:-200px"');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-gate2-"));
  try {
    const [r3] = await renderPages([{ html, out: path.join(dir, "a.png"), size: "story" }]);
    assert.ok(r3.check.overlap.length, "a block pushed over its neighbour is flagged");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
