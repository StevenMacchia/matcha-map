// Matcha drink types for the social graphics. whatTheyPour(menu_matcha) turns a shop's menu lines into up to N rows, one per
// drink type: the glyph's id, and the drink's name as the menu gives it (only cleaned of price tails and page furniture).
// Nothing is invented: a name that fits no type gets the plain "matcha" glyph; a line that is not a drink to pour is skipped.
// The type rules live in data/drink-types.json; the glyphs are drawn in tools/social/glyphs.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let CFG = null;
export function drinkConfig(file = path.join(ROOT, "data", "drink-types.json")) {
  if (CFG && file === CFG.file) return CFG;
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  CFG = { file, types: j.types.map((t) => ({ id: t.id, label: t.label, re: new RegExp(t.words, "i") })), plain: j.plain, skip: new RegExp(j.skip, "i"),
    strip: j.strip.map((s) => new RegExp(s, "i")), maxName: j.maxName, max: j.max };
  return CFG;
}
export const TYPE_IDS = () => [...drinkConfig().types.map((t) => t.id), drinkConfig().plain.id];

const STRICT = /matcha|hojicha|uji|latte|ceremonial|usucha/i;
// a pop-up's own menu lines: drinks and the sweets poured or served with them, not syrups, merch or notes
const LOOSE = /matcha|hojicha|latte|tea|milk|soda|lemonade|tonic|boba|coffee|espresso|cortado|float|slush|smoothie|chai|cloud|cream|ice|soft ?serve|cake|mochi|cookie|crepe|parfait|bingsu|macaron|dessert/i;
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&reg;|&#174;|&#8482;/g, "").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
// the name as it will be printed, or "" when the menu line is not a drink to pour
// loose: the line comes from a pop-up's own menu (already known to be a drink list), so it need not say "matcha"
export function cleanDrink(raw, cfg = drinkConfig(), loose = false) {
  let s = decode(String(raw == null ? "" : raw)).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) for (const re of cfg.strip) s = s.replace(re, "").trim();
  if (!s || s.length > cfg.maxName || !(loose ? LOOSE : STRICT).test(s) || cfg.skip.test(s) || /[$→]|\d\.\d\d/.test(s)) return "";
  if ((s.match(/,/g) || []).length >= 3) return "";      // an ingredient run, not a drink name
  return s;
}
export function drinkType(name, cfg = drinkConfig()) {
  const t = cfg.types.find((x) => x.re.test(name));
  return t ? t.id : cfg.plain.id;
}
export const typeLabel = (id, cfg = drinkConfig()) => (cfg.types.find((t) => t.id === id) || cfg.plain).label;

// menu: array of {name} or strings. Returns { items: [{ type, name }], more } with one row per type (the first drink of that
// type, in menu order), at most `max` rows; `more` counts the other distinct drinks on the menu that are not shown.
export function whatTheyPour(menu, max = 5, cfg = drinkConfig(), loose = false) {
  const seen = new Set(), drinks = [];
  for (const x of Array.isArray(menu) ? menu : []) {
    const name = cleanDrink(x && typeof x === "object" ? x.name : x, cfg, loose);
    const k = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!name || seen.has(k)) continue;
    seen.add(k); drinks.push({ type: drinkType(name, cfg), name });
  }
  const byType = new Map();
  for (const d of drinks) if (!byType.has(d.type)) byType.set(d.type, d);
  const items = [...byType.values()].slice(0, max);
  return { items, more: drinks.length - items.length };
}
