// Drink illustrator (tools/illustrate): text -> spec, spec -> SVG, the `npm run art` runner, the browser copy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { specFromText, drawDrink, drawEventArt, parseSymbols, FLAVORS, TEST_DRINKS, mix, slugify } from "../tools/illustrate/drink.js";
import { renderAll } from "../tools/illustrate/run.js";
import { buildPrompt, imageProvider, STYLE } from "../tools/illustrate/image-api.js";
import { renderMissingArt } from "../ingest/lib/art.js";
import { FLAVORS as MENU_FLAVORS } from "../ingest/lib/menu-terms.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const symbols = parseSymbols(fs.readFileSync(path.join(ROOT, "site/characters.svg"), "utf8"));
const S = (t) => specFromText(t);
const colors = (s) => s.layers.map((l) => l.c);
const names = (s) => s.layers.map((l) => l.n);

function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  return { l, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) };
}
// Balanced tags, one root <svg>, a viewBox, no NaN or undefined leaking into attributes.
function assertValidSvg(svg) {
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.ok(!/NaN|undefined|Infinity|\[object/.test(svg), "no NaN/undefined in the markup");
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `closing </${m[2]}>`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], "every tag closed");
  assert.ok(!/\d\.\d{4,}/.test(svg), "numbers rounded");
}

test("flavour words give their colour and layer", () => {
  const sm = S("strawberry matcha");
  assert.deepEqual(names(sm), ["strawberry", "milk", "matcha"]);
  assert.equal(sm.blend, "layered");
  assert.equal(colors(sm)[0], FLAVORS.strawberry[0]);
  assert.ok(sm.garnish.some((g) => g.type === "strawberry"));
  assert.equal(names(S("ube matcha"))[0], "ube");
  assert.equal(hsl(colors(S("ube matcha"))[0]).l > 0.6, true, "ube milk is a light lilac");
  const hj = S("hojicha latte");
  assert.ok(!names(hj).includes("matcha"), "hojicha latte has no matcha");
  assert.ok(colors(hj).includes(FLAVORS.hojicha[0]));
  assert.equal(hj.blend, "marble");
  assert.equal(names(S("black sesame matcha"))[0], "black sesame");
  assert.ok(S("black sesame matcha").toppings.includes("sesame"));
  assert.deepEqual(names(S("matcha lemonade")), ["lemonade", "matcha"]);
  const yz = S("yuzu matcha tonic");
  assert.equal(yz.fizz, true);
  assert.ok(yz.garnish.some((g) => g.type === "citrus"));
  assert.deepEqual(names(S("matcha latte")), ["milk", "matcha"]);
  assert.equal(S("matcha latte").blend, "marble");
  assert.equal(names(S("dirty matcha")).pop(), "espresso");
  assert.equal(S("strawberry cloud matcha").top.type, "foam");
  assert.ok(hsl(S("strawberry cloud matcha").top.c).l > 0.75, "a pink cloud, not a red one");
});

test("cups, sweets and toppings from the words", () => {
  const v = (t) => S(t).vessel;
  assert.equal(v("canned sparkling matcha"), "can");
  assert.equal(v("bottled matcha milk"), "bottle");
  assert.equal(v("hot matcha latte"), "mug");
  assert.equal(v("hot hojicha latte to go"), "cup");
  assert.equal(v("usucha"), "bowl");
  assert.equal(v("ceremonial matcha"), "bowl");
  assert.equal(v("iced matcha latte"), "tall");
  assert.equal(v("matcha einspanner"), "short");
  assert.equal(S("matcha einspanner").top.type, "cream");
  assert.ok(S("matcha einspanner").toppings.includes("dust"));
  assert.equal(v("matcha soft serve"), "cone");
  assert.equal(v("ube soft serve cup"), "scoop");
  assert.equal(v("ube ice cream"), "scoop");
  assert.equal(v("matcha affogato"), "coupe");
  assert.equal(S("matcha tiramisu").item, "tiramisu");
  assert.equal(S("matcha cookie").item, "cookie");
  assert.equal(S("strawberry daifuku").item, "mochi");
  assert.equal(S("matcha shaved ice").vessel, "kakigori");
  const boba = S("iced matcha with boba");
  assert.equal(boba.kind, "drink");
  assert.ok(boba.toppings.includes("boba"));
  assert.equal(boba.straw.w, 14, "a wide boba straw");
  const mochi = S("mango matcha latte with mochi");
  assert.equal(mochi.kind, "drink", "mochi after 'with' is a topping");
  assert.ok(mochi.toppings.includes("mochi"));
  assert.ok(S("matcha latte with whipped cream").toppings.includes("whip"));
  assert.ok(S("cookies and cream matcha").toppings.includes("oreo"));
  assert.ok(S("matcha latte with grass jelly").toppings.includes("jelly"));
  assert.ok(S("taro matcha").toppings.includes("taro"));
  assert.ok(S("matcha with cookie crumble").toppings.includes("crumble"));
  assert.ok(S("brown sugar boba milk tea").streaks);
  assert.equal(S("hot matcha latte").straw, null, "no straw in a hot drink");
  assert.equal(S("hot matcha latte").top.type, "art");
  assert.ok(S("chai matcha").garnish.some((g) => g.type === "cinnamon"));
  assert.ok(S("sakura matcha latte").garnish.some((g) => g.type === "sakura"));
  assert.equal(S("small matcha latte").size, "s");
});

test("not a drink or sweet: no art", () => {
  for (const t of ["chili oil", "scallions", "dumpling", "sando", "", null]) assert.equal(S(t), null, String(t));
  assert.equal(S("himoricafe.htx — matcha").label, "Matcha", "brand prefix dropped from the label");
});

test("every menu flavour has an appetising colour", () => {
  const darkOk = new Set(["espresso", "dirty", "coffee", "cold brew", "chocolate", "red bean", "azuki"]);
  const paleOk = new Set(["coconut", "coconut cream", "oat", "almond", "vanilla", "cheese", "black sesame", "sesame", "earl grey", "lychee", "cookies and cream", "cardamom"]);
  for (const entry of MENU_FLAVORS) {
    const k = entry.split("|")[0];
    if (["sparkling", "iced", "cloud"].includes(k)) continue;
    assert.ok(FLAVORS[k], `colour for ${k}`);
    const { l, s } = hsl(FLAVORS[k][0]);
    if (!darkOk.has(k)) assert.ok(l >= 0.5, `${k} is light enough (${l.toFixed(2)})`);
    if (!paleOk.has(k) && !darkOk.has(k)) assert.ok(s >= 0.35, `${k} is not muddy (saturation ${s.toFixed(2)})`);
  }
  // layered milk colours stay clean too
  for (const t of TEST_DRINKS) for (const c of (S(t).layers || [])) assert.ok(hsl(c.c).l > 0.3, `${t} ${c.n}`);
  assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
});

test("drawing is deterministic, valid and small", () => {
  for (const t of [...TEST_DRINKS, "canned yuzu sparkling matcha", "usucha", "hot matcha latte", "bottled matcha milk", "matcha cookie", "strawberry daifuku", "matcha donut", "croissant", "matcha shaved ice", "ube ice cream", "hot hojicha latte to go"]) {
    const a = drawDrink(S(t), { symbols }), b = drawDrink(S(t), { symbols });
    assert.equal(a, b, `${t} is the same every time`);
    assertValidSvg(a);
    assert.match(a, /viewBox="0 0 200 240"/);
    assert.ok(Buffer.byteLength(a) < 30 * 1024, `${t} under 30 KB (${a.length})`);
    assert.ok(a.includes("m-cup") || a.includes("m-o"), `${t} has Mattie inline`);
  }
  assert.notEqual(drawDrink(S("ube matcha"), { symbols }), drawDrink(S("strawberry matcha"), { symbols }));
  assert.match(drawDrink(S("matcha latte"), { chars: "use", href: "/characters.svg" }), /<use href="\/characters.svg#m-/);
  assert.ok(!drawDrink(S("matcha latte"), { chars: "none" }).includes("<use"));
  assert.ok(!drawDrink(S("matcha latte"), { symbols, label: false }).includes("<text"));
  const ev = drawEventArt({ id: "abc123def456", brand: "Matcha & Co <test>", menu: ["strawberry matcha", "hojicha latte", "chili oil"] }, { symbols });
  assertValidSvg(ev);
  assert.match(ev, /viewBox="0 0 640 400"/);
  assert.ok(ev.includes("Matcha &amp; Co &lt;test&gt;"), "brand escaped");
  assert.ok(Buffer.byteLength(ev) < 30 * 1024);
  assert.equal(ev, drawEventArt({ id: "abc123def456", brand: "Matcha & Co <test>", menu: ["strawberry matcha", "hojicha latte", "chili oil"] }, { symbols }));
  assertValidSvg(drawEventArt({ id: "x1", brand: "No Menu", menu: [] }, { symbols }));
});

test("npm run art on a fixture: draws once, then skips; prunes; never draws photo events", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-"));
  fs.mkdirSync(path.join(root, "tools/illustrate"), { recursive: true });
  fs.mkdirSync(path.join(root, "site"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "tools/illustrate/drink.js"), path.join(root, "tools/illustrate/drink.js"));
  fs.copyFileSync(path.join(ROOT, "site/characters.svg"), path.join(root, "site/characters.svg"));
  const events = [
    { id: "aaaaaaaaaaaa", brand: "Brand A", source_id: "a", menu: ["strawberry matcha", "chili oil"], image: null },
    { id: "bbbbbbbbbbbb", brand: "Brand B", source_id: "b", menu: ["ube matcha latte"], image: { local: "img/events/b.jpg" } },
    { id: "cccccccccccc", brand: "", source_id: "c", menu: [], image: { url: "https://x/y.jpg", local: null } },
  ];
  const sources = [{ id: "c", brand: "Brand C" }];
  const one = await renderAll({ events, sources, root });
  const n = TEST_DRINKS.length;
  assert.equal(one.counts.events, 2, "no photo: A and C; B has a downloaded photo");
  assert.equal(one.counts.drinks, n + 1, "the test menu plus ube matcha latte (strawberry matcha is on both)");
  assert.equal(one.counts.notDrinks, 1);
  assert.equal(one.index.events.cccccccccccc.brand, "Brand C", "brand from sources.json");
  assert.ok(fs.existsSync(path.join(root, "site/art/events/aaaaaaaaaaaa.svg")));
  assert.ok(!fs.existsSync(path.join(root, "site/art/events/bbbbbbbbbbbb.svg")));
  assert.ok(fs.existsSync(path.join(root, "site/art/drinks/ube-matcha-latte.svg")));
  assert.equal(fs.readFileSync(path.join(root, "site/art.js"), "utf8"), fs.readFileSync(path.join(root, "tools/illustrate/drink.js"), "utf8"));
  const idx1 = fs.readFileSync(path.join(root, "site/art/index.json"), "utf8");
  const e = JSON.parse(idx1).drinks["ube-matcha-latte"];
  assert.equal(e.text, "ube matcha latte"); assert.equal(e.file, "drinks/ube-matcha-latte.svg"); assert.ok(e.v.startsWith("drink-")); assert.equal(e.spec.vessel, "tall");
  const mtime = fs.statSync(path.join(root, "site/art/events/aaaaaaaaaaaa.svg")).mtimeMs;

  const two = await renderAll({ events, sources, root });
  assert.equal(two.counts.drinks + two.counts.events, 0, "second run draws nothing");
  assert.equal(two.counts.drinksSkipped, n + 1);
  assert.equal(fs.readFileSync(path.join(root, "site/art/index.json"), "utf8"), idx1, "index unchanged");
  assert.equal(fs.statSync(path.join(root, "site/art/events/aaaaaaaaaaaa.svg")).mtimeMs, mtime, "file untouched");

  // A's photo arrives and its menu changes: its scene is pruned, the new drink is drawn.
  events[0] = { ...events[0], image: { local: "img/events/a.jpg" } };
  events[1] = { ...events[1], menu: [] };
  events[2] = { ...events[2], menu: ["matcha lemonade with mint"] };
  const three = await renderAll({ events, sources, root });
  assert.equal(three.counts.events, 1, "C redrawn for its new menu");
  assert.ok(!fs.existsSync(path.join(root, "site/art/events/aaaaaaaaaaaa.svg")), "A pruned");
  assert.ok(fs.existsSync(path.join(root, "site/art/drinks/matcha-lemonade-with-mint.svg")));
  assert.ok(!fs.existsSync(path.join(root, "site/art/drinks/ube-matcha-latte.svg")), "drink no menu has any more pruned");
  fs.rmSync(root, { recursive: true, force: true });
});

test("the site copy matches the source", () => {
  const norm = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
  assert.equal(norm("site/art.js"), norm("tools/illustrate/drink.js"), "run `npm run art` to refresh site/art.js");
});

test("committed art index points at real files", () => {
  const p = path.join(ROOT, "site/art/index.json");
  if (!fs.existsSync(p)) return;
  const idx = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const d of [...Object.values(idx.drinks), ...Object.values(idx.events)]) assert.ok(fs.existsSync(path.join(ROOT, "site/art", d.file)), d.file);
  for (const t of TEST_DRINKS) assert.ok(idx.drinks[slugify(t)], `test drink ${t} committed`);
});

test("image API adapter: off without keys, prompt from the spec, no network here", async () => {
  assert.equal(imageProvider({}), null);
  assert.equal(imageProvider({ OPENAI_API_KEY: "k" }).name, "openai");
  assert.equal(imageProvider({ STABILITY_API_KEY: "k" }).name, "stability");
  const p = buildPrompt(S("strawberry matcha"));
  assert.ok(p.startsWith(STYLE));
  assert.match(p, /no text/);
  assert.match(p, /strawberry/);
  assert.match(p, /tall clear glass/);
  // the ingest hook never throws, even with a broken root
  const r = await renderMissingArt({ events: [], sources: [], root: path.join(os.tmpdir(), "no-such-root-" + Date.now()) });
  assert.equal(r, null);
});
