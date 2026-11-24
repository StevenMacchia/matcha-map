// "What they pour": a shop's (or pop-up's) matcha drinks, each drawn by the repo's own drink illustration engine
// (tools/illustrate/drink.js, docs/ART.md): a name in data/drinks.json is drawn from its parts, any other menu name is parsed
// from its words (cup, layers, ice, foam, toppings, straw, garnish). A name whose words parse to nothing is drawn as the
// engine's plain matcha drawing (flagged `plain`, and counted by plainReport so the parser can be taught those words).
// Nothing is invented: names are the menu's own, cleaned only of price tails and page furniture; merch, powders and page
// text are dropped (the skip and strip rules are in data/drink-types.json).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { specFromText, drawDrink } from "../illustrate/drink.js";
import { loadCatalog } from "../illustrate/run.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let CFG = null, CATALOG = false;
export function drinkConfig(file = path.join(ROOT, "data", "drink-types.json")) {
  if (!CATALOG) { loadCatalog(ROOT); CATALOG = true; }
  if (CFG && file === CFG.file) return CFG;
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  CFG = { file, skip: new RegExp(j.skip, "i"), strip: j.strip.map((s) => new RegExp(s, "i")), maxName: j.maxName };
  return CFG;
}

const STRICT = /matcha|hojicha|uji|latte|ceremonial|usucha/i;
// a pop-up's own menu lines: drinks and the sweets poured or served with them, not syrups, merch or notes
const LOOSE = /matcha|hojicha|latte|\btea\b|milk|soda|lemonade|tonic|boba|coffee|espresso|cortado|float|slush|smoothie|chai|cloud|cream|\bice\b|soft ?serve|cake|mochi|cookie|crepe|parfait|bingsu|macaron|dessert/i;
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&reg;|&#174;|&#8482;/g, "").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
// the name as it will be printed, or "" when the menu line is not a drink to pour
// loose: the line comes from a pop-up's own menu (already known to be a drink list)
export function cleanDrink(raw, cfg = drinkConfig(), loose = false) {
  let s = decode(String(raw == null ? "" : raw)).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) for (const re of cfg.strip) s = s.replace(re, "").trim();
  if (!s || s.length > cfg.maxName || !(loose ? LOOSE : STRICT).test(s) || cfg.skip.test(s) || /[$→]|\d\.\d\d/.test(s)) return "";
  if ((s.match(/,/g) || []).length >= 3) return "";      // an ingredient run, not a drink name
  return s;
}

// does the engine read this name? (false: it is drawn as the plain matcha drawing)
export const parsed = (name) => { drinkConfig(); return !!specFromText(name); };
// the drawing for a name: the engine's own, or its plain matcha drawing; no Mattie and no sticker (the row has the name)
export function drinkSvg(name, uid) {
  drinkConfig();
  const spec = specFromText(name) || specFromText("matcha");
  return drawDrink(spec, { mattie: false, label: false, uid: uid || undefined });
}
const look = (spec) => JSON.stringify([spec.kind, spec.temp, spec.layers, spec.flavors, spec.toppings, spec.garnish, spec.ice, spec.top, spec.straw, spec.blend]);

// menu: array of {name} or strings. Returns { items: [{ name, plain }], more }: one row per visibly different drawing (the
// first such drink in menu order), at most `max` rows; `more` counts the other distinct drinks not shown.
export function whatTheyPour(menu, max = 5, cfg = drinkConfig(), loose = false) {
  const seen = new Set(), drinks = [];
  for (const x of Array.isArray(menu) ? menu : []) {
    const name = cleanDrink(x && typeof x === "object" ? x.name : x, cfg, loose);
    const k = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!name || seen.has(k)) continue;
    seen.add(k);
    const spec = specFromText(name);
    drinks.push({ name, plain: !spec, look: spec ? look(spec) : "plain" });
  }
  const byLook = new Map();
  for (const d of drinks) if (!byLook.has(d.look)) byLook.set(d.look, d);
  const items = [...byLook.values()].slice(0, max).map(({ name, plain }) => ({ name, plain }));
  return { items, more: drinks.length - items.length };
}

// For the parser: every distinct drink name on the shops' menus that the engine could not read, with how many menus list it.
export function plainReport(shops, cfg = drinkConfig()) {
  const names = new Map(); let total = 0;
  for (const s of shops) for (const x of s.menu_matcha || []) {
    const n = cleanDrink(x && x.name, cfg); if (!n) continue;
    total++; if (!parsed(n)) names.set(n, (names.get(n) || 0) + 1);
  }
  return { total, plain: [...names.values()].reduce((a, b) => a + b, 0), distinct: [...names.entries()].sort((a, b) => b[1] - a[1]) };
}
