// The look of each daily card (tools/social/styles.js): ten named styles, a deterministic rotation (a day mixes looks, the same
// style never runs on two consecutive feed posts), a pin-off config, and the soft pastel look unchanged as the default.
// The overlap and overflow gate for every style is in test/social-gate.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, loadData, recordHistory, BANNED } from "../tools/social/plan.js";
import { STYLE_NAMES, STYLES, activeStyles, assignStyles, styleOf, styleCss, DEFAULT_STYLE } from "../tools/social/styles.js";
import { itemHtml } from "../tools/social/render.js";
import { addDays } from "../tools/gen-pages.js";

const DATA = loadData();

test("ten styles, each with a word of intent, tokens and a decoration", () => {
  assert.equal(STYLE_NAMES.length, 10);
  for (const n of STYLE_NAMES) assert.ok(!BANNED.test(n + STYLES[n].word + STYLES[n].note), n + " is named without a banned word (the style name is stored on every plan item)");
  for (const n of STYLE_NAMES) {
    const s = STYLES[n];
    assert.ok(s.word && s.note, n + " has a word and a note");
    assert.ok(styleCss(n).includes(`body.st-${n}`), n + " css");
    const d = s.deco({ W: 1080, H: 1350, story: false, g: { head: 168 }, seed: 7 });
    assert.ok(typeof d === "string" && !/<image|<text|<foreignObject/i.test(d), n + " decoration is shapes only: no photo, no words");
  }
  assert.equal(styleOf("nope").name, DEFAULT_STYLE, "an unknown style is the soft pastel look");
});

test("a card carries its style's class, and the default is the soft look", () => {
  const p = plan({ date: "2026-11-24", data: DATA, history: {} });
  const it = p.items.find((x) => x.slot === "feed");
  assert.ok(STYLE_NAMES.includes(it.style), "plan items carry a style");
  assert.match(itemHtml({ ...it, style: "neon" }), /class="feed st-neon/);
  assert.match(itemHtml({ ...it, style: undefined }), /class="feed st-pastel v\d/);
});

test("rotation: same date gives the same styles; the same style never runs on two consecutive feed posts; a day mixes looks", () => {
  let h = {}, last = null, seen = new Set(), mixed = 0, days = 0;
  for (const date of Array.from({ length: 60 }, (_, i) => addDays("2026-11-24", i))) {
    const p = plan({ date, data: DATA, history: h }), again = plan({ date, data: DATA, history: h });
    assert.deepEqual(p.items.map((i) => i.style), again.items.map((i) => i.style), date + " is deterministic");
    const feed = p.items.filter((i) => i.slot === "feed").sort((a, b) => a.time.localeCompare(b.time));
    for (const it of feed) { assert.notEqual(it.style, last, `${date}: ${it.name} repeats the previous feed post's style ${last}`); last = it.style; seen.add(it.style); }
    const all = new Set(p.items.map((i) => i.style));
    if (p.items.length >= 3) { days++; if (all.size >= 2) mixed++; }
    // a story group shares one look
    let grp = null;
    for (const it of p.items.filter((i) => i.slot === "story")) { if (it.role === "title") grp = it.style; else if (grp) assert.equal(it.style, grp, date + " a story group keeps one look"); }
    assert.deepEqual(recordHistory(h, p)[date].styles.feed, feed.map((i) => i.style));
    h = recordHistory(h, p);
  }
  assert.equal(mixed, days, "every day with three or more cards mixes looks");
  assert.ok(seen.size >= 8, "over two months the feed shows most looks, saw " + [...seen].join(","));
});

test("a style pinned off in the config is never picked, and never all of them", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "styles-")), "s.json");
  fs.writeFileSync(f, JSON.stringify({ off: ["comic", "neon"] }));
  const on = activeStyles(f);
  assert.equal(on.length, 8);
  assert.ok(!on.includes("comic") && !on.includes("neon"));
  let h = {};
  for (let i = 0; i < 20; i++) { const date = addDays("2026-11-24", i), p = plan({ date, data: DATA, history: h, styles: on }); for (const it of p.items) assert.ok(on.includes(it.style)); h = recordHistory(h, p); }
  fs.writeFileSync(f, JSON.stringify({ off: STYLE_NAMES }));
  assert.deepEqual(activeStyles(f), [DEFAULT_STYLE], "all off falls back to the soft look");
  assert.deepEqual(activeStyles(path.join(os.tmpdir(), "no-such-styles.json")), STYLE_NAMES, "no config: all on");
  const one = [{ slot: "feed", time: "10:00" }, { slot: "feed", time: "13:00" }];
  assignStyles(one, { date: "2026-12-01", lastFeed: "pastel", styles: ["pastel"] });
  assert.equal(one[0].style, "pastel", "one style left is used even when it repeats");
});
