// Drink illustrator: turns a menu line ("strawberry matcha latte", "hojicha latte", "matcha soft serve")
// into a house-style cartoon SVG. One isomorphic ES module, no DOM, no dependencies: `npm run art` uses it
// in Node and site/art.js is a byte-for-byte copy for the browser (test/illustrate.test.js checks).
//
//   specFromText(text)        -> spec (composable parts, see below) or null when the text is not a drink or sweet
//   drawDrink(spec, opts)     -> SVG string, 200 x 240 sticker: backdrop, the drink, Mattie, a name label
//   drawEventArt(event, opts) -> SVG string, 640 x 400 (16:10) scene: one or two signature drinks, Mattie, the brand
//   parseSymbols(sheetText)   -> {id: {vb, body}} from site/characters.svg, for opts.symbols
//
// opts: { symbols, chars: "inline" | "use" | "none", href: "characters.svg", label: true, mattie: true, uid }
// With chars "use" Mattie is a <use href="<href>#m-happy">, for pages that already hold the sheet; "inline"
// copies the symbol body in, so the file draws on its own. Everything is deterministic: small variations
// (tilt, straw colour, pose, side) come from a hash of the drink name, so a drink always looks the same.
//
// Spec: { v, name, label, kind: "drink"|"sweet", vessel, size: s|m|l, temp: iced|hot, layers: [{c, f, n}]
// bottom to top, blend: layered|marble|solid, ice, fizz, streaks, top: {type: foam|cream|whip|art, c} | null,
// toppings: [boba|jelly|mochi|whip|berries|crumble|oreo|dust|taro|sesame], straw: {c, c2, w, a} | null,
// garnish: [{type: strawberry|citrus|mint|cinnamon|sakura, c}], item (sweets), flavors, pose, side, tilt, seed }

export const VERSION = "drink-1";
const FONT = "'M PLUS Rounded 1c', ui-rounded, 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', Nunito, Arial, sans-serif";
const INK = "#4B3426", CREAM = "#FFFDF7", MILK = "#FFF7EA", MATCHA = "#7DB54E", LATTE = "#B5D88A", WHITE = "#FFFFFF";

// ---- flavour vocabulary: colour and role -------------------------------------------------------------
// roles: f fruit puree (its own bottom layer), r root/nut/grain (flavoured milk layer), s syrup (tints the
// milk), c citrus (tints tonic or lemonade, citrus wheel), t tea (replaces matcha unless matcha is named),
// k coffee (an espresso layer), m milk (a milk choice).
export const FLAVORS = {
  "strawberry": ["#F48FAB", "f"], "strawberries": ["#F48FAB", "f"], "mango": ["#FFBE4F", "f"], "ube": ["#B795E6", "r"],
  "coconut": ["#FFF8EC", "s"], "coconut cream": ["#FFF8EC", "s"], "yuzu": ["#FFD644", "c"], "yuzu honey": ["#FFD644", "c"],
  "black sesame": ["#A49DAE", "r"], "sesame": ["#A49DAE", "r"], "brown sugar": ["#C98B4E", "s"], "honey": ["#FFCD5C", "s"],
  "lavender": ["#C7B3F0", "s"], "rose": ["#F7B3C4", "s"], "peach": ["#FFB48A", "f"], "blueberry": ["#8C9EEA", "f"],
  "banana": ["#FFE07A", "f"], "pistachio": ["#BFD98A", "r"], "hojicha": ["#C98B5A", "t"], "houjicha": ["#C98B5A", "t"],
  "genmaicha": ["#D9B57A", "t"], "vanilla": ["#FFEFC9", "s"], "caramel": ["#E0A35A", "s"], "salted caramel": ["#E0A35A", "s"],
  "chocolate": ["#A0664A", "r"], "cherry": ["#EE5E7E", "f"], "raspberry": ["#F2729A", "f"], "lemon": ["#FFE36A", "c"],
  "orange": ["#FFAA4D", "c"], "mandarin": ["#FFAA4D", "c"], "pineapple": ["#FFD34E", "f"], "watermelon": ["#FF8296", "f"],
  "cucumber": ["#BDE6A4", "f"], "mint": ["#9EE0B5", "s"], "ginger": ["#F2C878", "s"], "cinnamon": ["#D49A66", "s"],
  "pumpkin spice": ["#EE9A4E", "r"], "pumpkin": ["#F4A04E", "r"], "maple": ["#E2A157", "s"], "red bean": ["#B4706A", "r"],
  "azuki": ["#B4706A", "r"], "kinako": ["#E6C48E", "r"], "sakura": ["#F7BCCB", "s"], "oat": ["#F6EAD3", "m"],
  "almond": ["#F5E6CF", "m"], "hazelnut": ["#CF9F6E", "s"], "espresso": ["#6E4330", "k"], "dirty": ["#6E4330", "k"],
  "taro": ["#C9A3DE", "r"], "cookies and cream": ["#E9E4DE", "r"], "apple": ["#E8D98A", "f"], "pear": ["#E5E79A", "f"],
  "melon": ["#A8E39A", "f"], "lychee": ["#FCDDE2", "f"], "passion fruit": ["#FFC23E", "f"], "passionfruit": ["#FFC23E", "f"],
  "grapefruit": ["#FF9C86", "c"], "pandan": ["#A3D977", "r"], "earl grey": ["#C8B5A6", "t"], "chai": ["#D7A274", "t"],
  "sweet potato": ["#F0A868", "r"], "chestnut": ["#C99068", "r"], "cardamom": ["#E8D6A8", "s"], "fig": ["#C98AA8", "f"],
  "blackberry": ["#9B7BC8", "f"], "cold brew": ["#6E4330", "k"], "coffee": ["#6E4330", "k"], "cheese": ["#FFF0B8", "s"],
};
// Words that are modifiers, not colours (they still shape the drink).
const MODIFIERS = ["sparkling", "iced", "cloud"];
const KEYS = Object.keys(FLAVORS).sort((a, b) => b.length - a.length);

// ---- small helpers -------------------------------------------------------------------------------------
export function hash(s) { let h = 5381; s = String(s || ""); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function slugify(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "drink"; }
const n = (x) => String(Math.round(x * 10) / 10);
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function rgb(h) { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function hex(a) { return "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase(); }
// mix(a, b, t): t = share of b.
export function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); }
const dark = (c, t = 0.22) => mix(c, "#5A3A2A", t);
const light = (c, t = 0.5) => mix(c, WHITE, t);
const at = (o) => Object.entries(o).map(([k, v]) => v == null || v === false ? "" : ` ${k}="${typeof v === "number" ? n(v) : v}"`).join("");
const el = (tag, o, inner) => inner == null ? `<${tag}${at(o)}/>` : `<${tag}${at(o)}>${inner}</${tag}>`;
const P = (d, o = {}) => el("path", { d, ...o });
const line = (o) => ({ fill: "none", stroke: INK, "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round", ...o });
const solid = (fill, o = {}) => ({ fill, stroke: INK, "stroke-width": 4, "stroke-linejoin": "round", ...o });
// d-string builder: numbers rounded to one decimal.
function D(parts) { return parts.map((p) => typeof p === "number" ? n(p) : p).join(" ").replace(/ ?([MLQCAZ]) ?/g, "$1"); }

function titleCase(s) { return s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "&"); }

// ---- text -> spec --------------------------------------------------------------------------------------
const RE = {
  softserve: /\bsoft ?serves?\b/, icecream: /\b(ice cream|gelato|scoops?)\b/, affogato: /\baffogato\b/,
  slice: /\b(tiramisu|cheesecakes?|cakes?|roll cake|brulee|brûlée|brownies?|pie|crepe cake|financier)\b/,
  cookie: /\bcookies?\b(?! and cream)/, macaron: /\bmacarons?\b/, mochi: /\b(mochi|daifuku)\b/, donut: /\b(donuts?|doughnuts?)\b/,
  pastry: /\b(croissants?|pastry|pastries|scones?|madeleines?|natas?|tarts?|muffins?|bread|cinnamon rolls?|financiers?|cupcakes?|waffles?|taiyaki)\b/,
  dango: /\bdango\b/, kakigori: /\b(shaved ice|kakigori)\b/,
  drink: /\b(matcha|latte|lattes|tea|tonic|lemonade|soda|sparkling|iced|hot|boba|milk|einspanner|einspänner|cloud|foam|cold brew|coffee|chai|cortado|cappuccino|usucha|koicha|ceremonial|cocktails?|shot|drink|smoothie|frappe|kombucha|fizz|spritz|americano|espresso|au lait)\b/,
};
const lastIndex = (t, re) => { let i = -1; const g = new RegExp(re.source, "g"); let m; while ((m = g.exec(t))) i = m.index; return i; };

function cleanText(text) {
  let t = String(text || "").toLowerCase().replace(/[–—]|\s-\s/g, " — ").replace(/&/g, " and ").replace(/einsp(ä|ae)nner/g, "einspanner");
  // "himoricafe.htx — matcha": keep the part that names a drink or sweet.
  const parts = t.split(" — ").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) t = parts.filter((p) => RE.drink.test(p) || KEYS.some((k) => p.includes(k)) || Object.values(RE).some((r) => r.test(p))).pop() || parts.pop();
  return t.replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
}
function findFlavors(t) {
  const out = [], taken = [];
  for (const k of KEYS) {
    const re = new RegExp(`\\b${k}\\b`, "g"); let m;
    while ((m = re.exec(t))) {
      const a = m.index, b = a + k.length;
      if (taken.some(([x, y]) => a < y && b > x)) continue;
      taken.push([a, b]); out.push({ k, at: a, c: FLAVORS[k][0], r: FLAVORS[k][1] });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

// ---- the drink catalogue: named combinations and their aliases ----------------------------------------
// BUILTIN_DRINKS is the top-50 list drawn from the words alone. data/drinks.json (when present; run.js and
// the gallery pass it to useCatalog) adds or replaces entries by name and alias, and its `components`
// (base, layers with colour hex, top, toppings, serve style, hot) override what the words would give,
// including the colours. Entry shape: { name, family, aliases: [], components: {...} }.
const B = (family, names) => names.map((x) => { const [name, ...aliases] = x.split("|"); return { name, family, aliases }; });
export const BUILTIN_DRINKS = [
  ...B("Classics", ["matcha latte|matcha|house matcha", "iced matcha latte|iced matcha lattes", "hot matcha latte|hot matcha", "usucha|ceremonial matcha|ceremonial|matcha bowl", "koicha", "iced matcha|matcha americano"]),
  ...B("Fruit", ["strawberry matcha latte|strawberry matcha|strawberry", "mango matcha latte|mango matcha|mango", "blueberry matcha latte|blueberry matcha|blueberry", "banana matcha latte|banana matcha|banana", "peach matcha latte|peach matcha|peach", "raspberry matcha latte|raspberry matcha|raspberry", "passion fruit matcha|passionfruit matcha", "lychee matcha latte|lychee matcha|lychee", "coconut matcha latte|coconut matcha"]),
  ...B("Roots and nuts", ["ube matcha latte|ube matcha|ube", "taro matcha latte|taro matcha", "black sesame matcha latte|black sesame matcha|black sesame", "pistachio matcha latte|pistachio matcha|pistachio", "kinako matcha latte|kinako matcha", "red bean matcha latte|azuki matcha latte|red bean matcha"]),
  ...B("Tea blends", ["hojicha swirl matcha latte|hojicha matcha swirl|hojicha matcha", "hojicha latte|hojicha|iced hojicha latte", "genmaicha matcha latte|genmaicha matcha"]),
  ...B("Coffee", ["dirty matcha|espresso matcha|dirty matcha latte", "matcha einspanner|einspanner", "matcha affogato|affogato"]),
  ...B("Sparkling", ["matcha tonic|matcha espresso tonic", "yuzu matcha tonic|yuzu matcha|yuzu tonic matcha", "matcha lemonade|lemonade matcha|lemon", "sparkling matcha|matcha soda", "matcha coconut water|coconut water matcha"]),
  ...B("Foam tops", ["strawberry cloud matcha|strawberry cloud matcha latte", "matcha cloud latte|cloud matcha|vanilla cloud matcha", "cheese foam matcha|matcha cheese foam|cheese cloud matcha", "sea salt cream matcha|salted cream matcha", "ube cloud matcha|ube cloud matcha latte"]),
  ...B("Boba", ["brown sugar boba matcha|brown sugar matcha boba|brown sugar boba", "matcha milk tea with boba|matcha boba|iced matcha with boba|matcha milk tea", "taro boba matcha|taro matcha boba"]),
  ...B("Floral and sweet", ["lavender matcha latte|lavender matcha|lavender", "rose matcha latte|rose matcha", "sakura matcha latte|sakura matcha|sakura", "honey matcha latte|honey matcha|honey", "vanilla matcha latte|vanilla matcha|vanilla", "cookies and cream matcha|oreo matcha"]),
  ...B("Desserts", ["matcha soft serve|soft serve", "matcha tiramisu|tiramisu", "matcha cheesecake", "matcha shaved ice|matcha kakigori"]),
];
// What the words of some catalogue names need to draw right (the parser cannot guess these).
const BUILTIN_WORDS = { "matcha coconut water": { components: { base: "coconut water", layers: [{ name: "coconut water", hex: "#F4FAF2" }, { name: "matcha", hex: "#7DB54E" }] } },
  "matcha tonic": { components: { layers: [{ name: "tonic", hex: "#EAF6EF" }, { name: "matcha", hex: "#7DB54E" }] } },
  "sparkling matcha": { components: { layers: [{ name: "tonic", hex: "#EEF8E6" }, { name: "matcha", hex: "#9CCB6A" }] } },
  "sea salt cream matcha": { components: { top: { type: "foam", hex: "#FFF8EE" } } },
  "hojicha swirl matcha latte": { components: { blend: "marble", layers: [{ name: "milk", hex: "#FFF7EA" }, { name: "hojicha", hex: "#C98B5A" }, { name: "matcha", hex: "#7DB54E" }] } } };
for (const e of BUILTIN_DRINKS) if (BUILTIN_WORDS[e.name]) Object.assign(e, BUILTIN_WORDS[e.name]);

let CATALOG = new Map(), ENTRIES = [], specCache = new Map();
const hexOk = (h) => { if (typeof h !== "string") return null; const m = h.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i); if (!m) return null; const x = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; return "#" + x.toUpperCase(); };
const word = (x) => typeof x === "string" ? x : x && (x.name || x.type || x.kind || x.flavor || x.id) || "";
const listOf = (x) => Array.isArray(x) ? x : x ? [x] : [];
// useCatalog(entries): these entries (an array, or {drinks: [...]}) replace the built-in list; none -> built-in.
export function useCatalog(extra) {
  const given = listOf(extra && !Array.isArray(extra) ? extra.drinks : extra);
  const list = (given.length ? given : BUILTIN_DRINKS).filter((e) => e && (e.name || e.id));
  const byName = new Map();
  for (const e of list) {
    const name = String(e.name || e.id).trim(), key = cleanText(name);
    const prev = byName.get(key);
    byName.set(key, { ...(prev || {}), ...e, name, family: e.family || e.category || e.group || (prev && prev.family) || "More",
      aliases: [...new Set([...(prev ? prev.aliases : []), ...listOf(e.aliases || e.alias).map(String)])] });
  }
  ENTRIES = [...byName.values()]; CATALOG = new Map(); specCache = new Map();
  for (const e of ENTRIES) for (const a of [e.name, ...e.aliases]) { const k = cleanText(a); if (k && (!CATALOG.has(k) || cleanText(e.name) === k)) CATALOG.set(k, e); }
  return ENTRIES.length;
}
export const catalogEntries = () => ENTRIES.slice();
export const catalogFamilies = () => [...new Set(ENTRIES.map((e) => e.family))];

// One catalogue entry -> spec: the parser reads the name plus the component words, then the components'
// own layers, colours, top, toppings and serve style replace its guesses.
function specFromEntry(e) {
  const c = e.components || {}, serve = String(c.serve || c.serve_style || c.serveStyle || c.style || c.vessel || "").toLowerCase();
  const topW = word(c.top), tops = listOf(c.toppings).map(word);
  const hot = c.hot === true || /\bhot\b/.test(serve);
  const words = [e.name, c.base && word(c.base), hot ? "hot" : "", serve, topW, ...tops.map((x) => "with " + x)].filter(Boolean).join(" ");
  const byName = parseText(e.name); // a sweet stays a sweet ("matcha soft serve ... with matcha dust")
  const s = (byName && byName.kind === "sweet" ? byName : parseText(words)) || byName || parseText("matcha latte");
  s.name = cleanText(e.name); s.label = titleCase(String(e.name).replace(/\s*\(.*?\)\s*/g, " ").trim()).slice(0, 34); s.family = e.family;
  const seed = hash(s.name); s.seed = seed; s.side = seed % 2 ? "l" : "r";
  // serve style
  const V = [[/\bcan/, "can"], [/bottle/, "bottle"], [/bowl|chawan|whisk/, "bowl"], [/soft ?serve|cone/, "cone"], [/to ?go|paper|hot.*cup/, "cup"], [/mug|ceramic/, "mug"],
    [/rocks|short/, "short"], [/coupe|affogato/, "coupe"], [/shaved|kakigori/, "kakigori"], [/plate|slice|dessert/, "plate"], [/tall|glass|iced|cold|cup/, "tall"]];
  const v = serve && V.find(([re]) => re.test(serve));
  if (v && s.kind === "drink" && s.vessel !== "bowl" && !["cone", "plate", "kakigori", "coupe"].includes(v[1])) {
    s.vessel = v[1]; s.temp = ["mug", "cup", "bowl"].includes(v[1]) ? "hot" : hot ? "hot" : "iced";
    if (s.temp === "hot") { s.ice = 0; s.straw = null; }
  }
  // layers, bottom to top (a `position` of "top" first, or layers_order "top_to_bottom", flips them)
  let L = listOf(c.layers).map((l) => typeof l === "string" ? { name: l } : l || {});
  if (L.length && (/top.*bottom/i.test(c.layers_order || c.order || "") || /top/i.test(L[0].position || "") || /bottom/i.test(L[L.length - 1].position || ""))) L = L.reverse();
  if (L.length) {
    const out = L.map((l) => {
      const nm = cleanText(word(l)) || "layer", fk = KEYS.find((k) => nm === k || nm.startsWith(k + " ") || nm.endsWith(" " + k));
      const col = hexOk(l.hex || l.color || l.colour || l.c) || (/matcha/.test(nm) ? MATCHA : /milk|cream|oat/.test(nm) ? MILK : fk ? FLAVORS[fk][0] : LATTE);
      const f = Number(l.f ?? l.share ?? l.fraction ?? l.ratio ?? l.portion ?? l.amount);
      return { c: col, f: f > 0 ? f : 0, n: fk && !/milk|matcha/.test(nm) ? fk : nm };
    });
    const free = out.filter((l) => !l.f), used = out.reduce((a, l) => a + l.f, 0);
    const rest = 1 - used;
    free.forEach((l) => { l.f = rest > 0.05 ? rest / free.length : 1 / out.length; });
    const sum = out.reduce((a, l) => a + l.f, 0);
    if (s.kind === "sweet") s.colors = out.map((l) => l.c).filter((x) => x !== MILK).slice(0, 3).concat(s.colors).slice(0, 3);
    else {
      const foam = s.layers.length && /^(foam|cloud|cream)$/.test(s.layers[s.layers.length - 1].n) ? s.layers[s.layers.length - 1] : null;
      s.layers = out.map((l) => ({ ...l, f: Math.round((l.f / sum) * (foam ? 0.78 : 1) * 100) / 100 }));
      if (foam) s.layers.push(foam);
      s.blend = c.blend || (out.length < 2 ? "solid" : /swirl|marble|blend/.test(words) ? "marble" : "layered");
      if (s.temp === "hot" && s.vessel !== "bowl") { // a hot latte is one stirred colour
        const tea = s.layers[s.layers.length - (foam ? 2 : 1)], milk = out.find((l) => /milk|cream/.test(l.n));
        s.layers = [{ c: milk ? mix(tea.c, milk.c, 0.42) : tea.c, f: 1, n: tea.n + (milk ? " latte" : "") }]; s.blend = "solid";
      }
    }
  }
  // top: colour from the file wins
  const topHex = c.top && typeof c.top === "object" ? hexOk(c.top.hex || c.top.color || c.top.colour) : null;
  if (topW && s.kind === "drink") {
    const type = /none/.test(topW) ? null : /whip/.test(topW) ? null : /cloud/.test(topW) ? "cloud" : /foam|cheese|sea salt|salted|espuma|sweet cream|coconut cream/.test(topW) ? "foam" : /einspanner|cream/.test(topW) ? "cream" : /art|heart|rosetta/.test(topW) ? "art" : null;
    if (/whip/.test(topW) && !s.toppings.includes("whip")) s.toppings.push("whip");
    if (type) {
      const tc = topHex || (s.top && s.top.c) || (type === "cream" ? "#FFF4DC" : "#FFFBF2");
      if (!s.top || s.top.type !== type) {
        if (type !== "art" && s.vessel !== "bowl" && !s.layers.some((l) => /^(foam|cloud|cream)$/.test(l.n))) { s.layers.forEach((l) => { l.f = Math.round(l.f * 78) / 100; }); s.layers.push({ c: tc, f: 0.22, n: type }); }
      }
      s.top = { type, c: tc };
      const fl = s.layers[s.layers.length - 1]; if (/^(foam|cloud|cream)$/.test(fl.n)) { fl.c = tc; fl.n = type; }
      if (type === "cream") s.straw = null;
    }
  } else if (topHex && s.top) { s.top.c = topHex; const fl = s.layers[s.layers.length - 1]; if (fl && /^(foam|cloud|cream)$/.test(fl.n)) fl.c = topHex; }
  for (const t of tops.map((x) => x.toLowerCase())) {
    const tok = /boba|pearl|tapioca/.test(t) ? "boba" : /jell/.test(t) ? "jelly" : /mochi/.test(t) ? "mochi" : /oreo|cookies and cream/.test(t) ? "oreo" : /cookie|crumble|crumb|biscoff|graham/.test(t) ? "crumble"
      : /strawberr|berr/.test(t) ? "berries" : /dust|powder|sift/.test(t) ? "dust" : /taro/.test(t) ? "taro" : /sesame/.test(t) ? "sesame" : /red bean|azuki|anko/.test(t) ? "beans" : /whip/.test(t) ? "whip" : null;
    if (tok && !s.toppings.includes(tok)) s.toppings.push(tok);
    if (/brown sugar/.test(t)) s.streaks = "#B5733C";
  }
  for (const t of tops.map((x) => x.toLowerCase())) {
    const tok = /coconut flake/.test(t) ? "flakes" : /pistachio/.test(t) ? "pistachio" : /honeycomb/.test(t) ? "honeycomb" : /cinnamon/.test(t) ? "cinnamon" : null;
    if (tok && !s.toppings.includes(tok)) s.toppings.push(tok);
  }
  const gw = listOf(c.garnish).map(word).join(" ").toLowerCase(), G = [];
  const citrusHex = (L.map((l) => hexOk(l.hex || l.color)).find((h, i) => /yuzu|lemon|lime|orange|citrus/.test(word(L[i]))) || (/yuzu/.test(gw) ? FLAVORS.yuzu[0] : FLAVORS.lemon[0]));
  if (/strawberr/.test(gw)) G.push({ type: "strawberry", c: "#EF5A78" });
  if (/lemon|yuzu|lime|orange|citrus/.test(gw)) G.push({ type: "citrus", c: citrusHex });
  if (/mint/.test(gw)) G.push({ type: "mint", c: "#6CBF5A" });
  if (/cinnamon/.test(gw) || s.toppings.includes("cinnamon")) G.push({ type: "cinnamon", c: "#B9774A" });
  if (/sakura|blossom|rose/.test(gw)) G.push({ type: "sakura", c: "#F6B7C7" });
  if (/matcha (dust|salt)/.test(gw) && !s.toppings.includes("dust")) s.toppings.push("dust");
  if (/latte art/.test(gw) && s.temp === "hot" && !s.top) s.top = { type: "art", c: MILK };
  if (G.length && s.kind === "drink") { const seen = new Set(); s.garnish = [...G, ...s.garnish].filter((g) => !seen.has(g.type) && seen.add(g.type)).slice(0, 2); }
  s.toppings = s.toppings.filter((t) => t !== "cinnamon");
  if (s.toppings.includes("boba") && s.straw) s.straw.w = 14;
  return s;
}

export function specFromText(text) {
  const key = cleanText(text);
  const e = key && CATALOG.get(key);
  if (!e) return parseText(text);
  if (!specCache.has(e.name)) specCache.set(e.name, JSON.stringify(specFromEntry(e)));
  return JSON.parse(specCache.get(e.name));
}
useCatalog();

function parseText(text) {
  const raw = String(text || "").trim(), t = cleanText(raw);
  if (!t) return null;
  const fl = findFlavors(t), has = (re) => re.test(t), seed = hash(t), R = rng(seed);
  const sweetAt = Math.max(...["softserve", "icecream", "affogato", "slice", "cookie", "macaron", "mochi", "donut", "pastry", "dango", "kakigori"].map((k) => lastIndex(t, RE[k])));
  const drinkAt = lastIndex(t, RE.drink);
  if (sweetAt < 0 && drinkAt < 0 && !fl.length) return null;
  const matchaWord = has(/\b(matcha|usucha|koicha|ceremonial|dirty)\b/);
  const teas = fl.filter((f) => f.r === "t"), coffee = fl.filter((f) => f.r === "k");
  const matcha = matchaWord || (!teas.length && !(coffee.length && !has(/\bmatcha\b/)));
  const label = titleCase(raw.replace(/^.*\s[–—-]\s/, "").replace(/\s+/g, " ").trim()).slice(0, 34);
  const sizeW = has(/\b(mini|small|shot|petite)\b/) ? "s" : has(/\b(large|big|jumbo)\b/) ? "l" : "m";
  const poses = ["m-happy", "m-excited", "m-wave", "m-point", "m-peek", "m-happy"];
  const base = { v: VERSION, name: t, label, seed, size: sizeW, flavors: fl.map((f) => f.k), side: seed % 2 ? "l" : "r",
    tilt: Math.round((R() * 8 - 4) * 10) / 10, pose: poses[seed % poses.length], toppings: [], garnish: [] };
  const colorsOf = (list) => list.map((f) => f.c);
  const main = (list) => colorsOf(list.filter((f) => !["m", "k"].includes(f.r)));

  // -- sweets ------------------------------------------------------------------------------------------
  // A sweet when the sweet word comes last ("matcha tiramisu"), unless it is a topping ("matcha latte with mochi").
  if (sweetAt > drinkAt && !/\b(with|topped|plus|add|and)\b/.test(t.slice(Math.max(0, drinkAt), sweetAt))) {
    const cols = main(fl);
    if (matchaWord && cols[0] !== MATCHA) cols.unshift(MATCHA);
    if (!cols.length) cols.push(has(/\b(mochi|daifuku|macarons?|donuts?|doughnuts?|dango)\b/) ? "#F7BCCB" : "#FFE9B8");
    const s = { ...base, kind: "sweet", temp: "cold", layers: [], blend: "solid", ice: 0, fizz: false, streaks: null, top: null, straw: null, colors: cols.slice(0, 3) };
    const which = ["softserve", "icecream", "affogato", "slice", "cookie", "macaron", "mochi", "donut", "pastry", "dango", "kakigori"].sort((a, b) => lastIndex(t, RE[b]) - lastIndex(t, RE[a]))[0];
    if (which === "softserve") { s.vessel = has(/\bcup\b/) ? "scoop" : "cone"; s.item = "swirl"; }
    else if (which === "icecream") { s.vessel = has(/\bcone\b/) ? "cone" : "scoop"; s.item = "scoops"; }
    else if (which === "affogato") { s.vessel = "coupe"; s.item = "affogato"; s.colors = [cols.find((c) => c !== MATCHA && c !== "#FFE9B8") || "#FFF3DA", matchaWord ? MATCHA : "#6E4330"]; }
    else if (which === "kakigori") { s.vessel = "kakigori"; s.item = "ice"; }
    else {
      s.vessel = "plate";
      s.item = which === "slice" ? (has(/tiramisu/) ? "tiramisu" : has(/cheesecake/) ? "cheesecake" : has(/brownie/) ? "brownie" : "cake") : which === "pastry" ? (has(/cupcake|muffin/) ? "cupcake" : "pastry") : which;
    }
    if (has(/\b(strawberr|berry|berries)/)) s.toppings.push("berries");
    if (has(/\b(oreo|cookies and cream)\b/)) s.toppings.push("oreo");
    else if (has(/\b(crumble|cookie butter|biscoff|crunch|crisp|graham)\b/)) s.toppings.push("crumble");
    if (matchaWord && ["tiramisu", "swirl", "scoops", "ice"].includes(s.item)) s.toppings.push("dust");
    if (has(/\bmochi\b/) && s.item !== "mochi") s.toppings.push("mochi");
    if (has(/\b(red bean|azuki|anko)\b/)) s.toppings.push("beans");
    s.pose = s.item === "affogato" ? "m-excited" : base.pose;
    return s;
  }

  // -- drinks ------------------------------------------------------------------------------------------
  const sparkling = has(/\b(tonic|sparkling|soda|lemonade|kombucha|fizz|spritz|cocktails?)\b/) ||
    (fl.length > 0 && fl.every((f) => f.r === "c") && !has(/\b(latte|milk|oat|cream|cloud|foam)\b/)); // "yuzu", "lemon": a citrus matcha fizz
  const bowlWords = has(/\b(usucha|koicha|ceremonial|bowl|chawan|whisked|traditional)\b/);
  const hotWords = has(/\b(hot|warm|cappuccino|cortado|steamed)\b/);
  let vessel = "tall";
  if (has(/\b(can|canned|cans)\b/)) vessel = "can";
  else if (has(/\b(bottle|bottled|bottles)\b/)) vessel = "bottle";
  else if (has(/\biced\b/)) vessel = has(/\b(shot|cocktail)\b/) ? "short" : "tall";
  else if (bowlWords) vessel = "bowl";
  else if (hotWords) vessel = has(/\b(to go|paper cup|cup)\b/) ? "cup" : "mug";
  else if (has(/\b(shot|cocktails?|einspanner|cortado)\b/)) vessel = "short";
  const temp = ["mug", "cup", "bowl"].includes(vessel) ? "hot" : "iced";
  const fruits = fl.filter((f) => f.r === "f"), roots = fl.filter((f) => f.r === "r"), syrups = fl.filter((f) => f.r === "s"),
    citrus = fl.filter((f) => f.r === "c"), milks = fl.filter((f) => f.r === "m");
  const milky = !sparkling && !has(/\b(usucha|koicha|americano)\b/) && !(has(/\bshot\b/) && !has(/latte/)) &&
    (has(/\b(latte|lattes|milk|oat|almond|soy|au lait|cloud|cream|boba|bubble|chai|cortado|cappuccino|einspanner|dirty)\b/) ||
     fruits.length + roots.length + syrups.length > 0 || /^(house |our |signature |classic )?matcha$/.test(t) || (teas.length > 0 && !matchaWord));
  let milk = MILK;
  if (milks.length) milk = mix(MILK, milks[0].c, 0.6);
  const syrup = syrups.find((f) => !/^(cheese|coconut)/.test(f.k));
  if (syrup) milk = mix(MILK, syrup.c, syrup.k === "brown sugar" ? 0.35 : 0.42);
  const tea = matcha ? (has(/\bkoicha\b/) ? "#5E9A36" : MATCHA) : teas.length ? teas[0].c : coffee.length ? coffee[0].c : MATCHA;
  let layers = [], blend = "solid";
  if (vessel === "bowl") { layers = [{ c: has(/\bkoicha\b/) ? "#5E9A36" : "#8CC15A", f: 1, n: "matcha" }]; }
  else if (sparkling) {
    const tint = citrus[0] || fruits[0];
    const water = has(/\blemonade\b/) ? mix("#FFE680", tint ? tint.c : "#FFE680", 0.4) : tint ? light(tint.c, 0.45) : "#EAF6EF";
    layers = [{ c: water, f: 0.58, n: has(/\blemonade\b/) ? "lemonade" : "tonic" }, { c: tea, f: 0.42, n: matcha ? "matcha" : "tea" }]; blend = "layered";
  } else if (milky) {
    if (fruits.length && (matcha || teas.length)) {
      layers = fruits.slice(0, 2).map((f, i) => ({ c: f.c, f: i ? 0.16 : 0.26, n: f.k }));
      layers.push({ c: milk, f: 0.3, n: "milk" }, { c: tea, f: 0.4 - (fruits.length > 1 ? 0.12 : 0), n: matcha ? "matcha" : teas[0].k }); blend = "layered";
    } else if (fruits.length) { layers = [{ c: fruits[0].c, f: 0.32, n: fruits[0].k }, { c: mix(milk, fruits[0].c, 0.18), f: 0.68, n: "milk" }]; blend = "layered"; }
    else if (roots.length && (matcha || teas.length)) {
      const r0 = roots[0];
      layers = [{ c: mix(MILK, r0.c, 0.62), f: 0.52, n: r0.k }, { c: tea, f: 0.48, n: matcha ? "matcha" : teas[0].k }]; blend = "layered";
      if (teas.length && matcha) layers.splice(1, 0, { c: mix(teas[0].c, MILK, 0.2), f: 0.22, n: teas[0].k });
    } else if (roots.length) { layers = [{ c: MILK, f: 0.4, n: "milk" }, { c: mix(roots[0].c, MILK, 0.15), f: 0.6, n: roots[0].k }]; blend = "marble"; }
    else if (teas.length && matcha) { layers = [{ c: mix(teas[0].c, MILK, 0.3), f: 0.5, n: teas[0].k }, { c: tea, f: 0.5, n: "matcha" }]; blend = "layered"; }
    else { layers = [{ c: milk, f: 0.55, n: "milk" }, { c: tea, f: 0.45, n: matcha ? "matcha" : teas.length ? teas[0].k : "coffee" }]; blend = "marble"; }
    if (temp === "hot") { const top = layers[layers.length - 1]; layers = [{ c: mix(top.c, milk, top.c === MATCHA ? 0.42 : 0.38), f: 1, n: top.n + " latte" }]; blend = "solid"; }
  } else { layers = [{ c: tea === MATCHA ? "#8CC15A" : tea, f: 1, n: matcha ? "matcha" : "tea" }]; }
  if (coffee.length && vessel !== "bowl" && !layers.some((l) => l.c === coffee[0].c)) {
    layers.forEach((l) => { l.f *= 0.8; }); layers.push({ c: "#6E4330", f: 0.2, n: "espresso" }); if (blend === "solid") blend = "layered";
  }
  let top = null;
  const foamAt = lastIndex(t, /\b(cloud|cold foam|foam|cream top|cheese foam|cream cap|sea salt cream|salted cream)\b/);
  if (has(/\beinspanner\b/)) top = { type: "cream", c: "#FFF4DC" };
  else if (foamAt >= 0) {
    const before = fl.filter((f) => f.at < foamAt && f.r !== "t").pop(), w = before && t.slice(before.at + before.k.length, foamAt).trim().length < 6 ? before : null;
    top = { type: /^cloud/.test(t.slice(foamAt)) ? "cloud" : "foam", c: has(/cheese/) ? "#FFF1C2" : w ? mix(w.c, WHITE, 0.45) : "#FFFBF2" };
  } else if (temp === "hot" && vessel !== "bowl" && milky) top = { type: "art", c: MILK };
  if (top && top.type !== "art" && vessel !== "bowl") { layers.forEach((l) => { l.f *= 0.78; }); layers.push({ c: top.c, f: 0.22, n: top.type }); }
  const tops = [];
  if (has(/\b(boba|bubble|pearls?|tapioca)\b/)) tops.push("boba");
  if (has(/\bjell(y|ies)\b/)) tops.push("jelly");
  if (has(/\bmochi\b/)) tops.push("mochi");
  if (has(/\b(whip|whipped)\b/)) tops.push("whip");
  if (fruits.some((f) => /^strawberr/.test(f.k)) && temp === "iced") tops.push("berries");
  if (has(/\b(oreo|cookies and cream)\b/)) tops.push("oreo");
  else if (has(/\b(cookie|cookies|crumble|cookie butter|biscoff|crisp|graham|crunch)\b/)) tops.push("crumble");
  if (has(/\btaro\b/)) tops.push("taro");
  if (fl.some((f) => /sesame/.test(f.k))) tops.push("sesame");
  if (matcha && (top && top.type === "cream" || tops.includes("whip"))) tops.push("dust");
  const garnish = [];
  const cit = citrus[0]; if (cit && vessel !== "bowl") garnish.push({ type: "citrus", c: cit.c });
  if (fruits.some((f) => /^strawberr/.test(f.k)) && ["tall", "short"].includes(vessel)) garnish.push({ type: "strawberry", c: "#EF5A78" });
  if (has(/\bmint\b/)) garnish.push({ type: "mint", c: "#6CBF5A" });
  if (has(/\b(cinnamon|chai|pumpkin spice)\b/)) garnish.push({ type: "cinnamon", c: "#B9774A" });
  if (has(/\b(sakura|cherry blossom|rose)\b/)) garnish.push({ type: "sakura", c: "#F6B7C7" });
  const strawCols = [["#F6B7C7", "#D98CA2"], ["#A8D08D", "#6E9A5E"], ["#FFFBF0", "#F28AA5"], ["#FFE7A0", "#E0A35A"]];
  const sc = strawCols[(seed >>> 3) % strawCols.length];
  const straw = temp === "iced" && ["tall", "short"].includes(vessel) && !(top && top.type === "cream")
    ? { c: sc[0], c2: sc[1], w: tops.includes("boba") ? 14 : 9, a: Math.round((R() * 16 - 4) * 10) / 10 } : null;
  const ice = temp === "iced" && ["tall", "short"].includes(vessel) && !tops.includes("whip") ? 2 + (seed % 3) : 0;
  return { ...base, kind: "drink", vessel, temp, layers: layers.map((l) => ({ ...l, f: Math.round(l.f * 100) / 100 })), blend, ice,
    fizz: sparkling, streaks: syrups.some((f) => f.k === "brown sugar") ? "#B5733C" : null, top, toppings: tops, straw, garnish: garnish.slice(0, 2),
    pose: vessel === "bowl" ? "m-whisk" : base.pose };
}

// ---- drawing: vessels in local coordinates, base centre at (0, 0), y up is negative ---------------------
function tapered(H, tw, bw, r) {
  const L = -tw / 2, Rr = tw / 2, bl = -bw / 2, br = bw / 2;
  const sides = D(["M", L, -H, "L", bl, -r, "Q", bl, 0, bl + r, 0, "L", br - r, 0, "Q", br, 0, br, -r, "L", Rr, -H]);
  return { H, sides, clip: sides + "Z", widthAt: (y) => bw + (tw - bw) * (-y / H), rim: { y: -H, rx: tw / 2, ry: 7 } };
}
function gradient(id, layers, y0, y1, blend) {
  if (layers.length === 1 || blend === "solid") return { defs: "", fill: layers[layers.length - 1].c };
  const band = blend === "marble" ? 0.14 : 0.03, total = layers.reduce((s, l) => s + l.f, 0);
  const stops = []; let acc = 0;
  for (let i = layers.length - 1; i >= 0; i--) { // top first
    const s = acc / total, e = (acc + layers[i].f) / total; acc += layers[i].f;
    stops.push([i === layers.length - 1 ? 0 : s + band, layers[i].c], [i === 0 ? 1 : e - band, layers[i].c]);
  }
  return { defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${n(y0)}" y2="${n(y1)}">` +
    stops.map(([o, c]) => `<stop offset="${n(Math.max(0, Math.min(1, o)) * 100)}%" stop-color="${c}"/>`).join("") + "</linearGradient>", fill: `url(#${id})` };
}

function iceCubes(spec, G, y0, R) {
  let s = "";
  for (let i = 0; i < spec.ice; i++) {
    const w = G.widthAt(y0) - 20, x = -w / 2 + 8 + (i + 0.5) * (w - 16) / spec.ice - 14 + R() * 6, y = y0 - 10 + (i % 2) * 22 + R() * 6, rot = R() * 40 - 20;
    s += el("rect", { x, y, width: 28, height: 26, rx: 7, transform: `rotate(${n(rot)} ${n(x + 14)} ${n(y + 13)})`, fill: WHITE, "fill-opacity": 0.5, stroke: WHITE, "stroke-width": 2.5, "stroke-opacity": 0.95 });
    s += P(D(["M", x + 6, y + 7, "q", 4, -3, 9, -2]), { transform: `rotate(${n(rot)} ${n(x + 14)} ${n(y + 13)})`, ...line({ stroke: WHITE, "stroke-width": 3 }) });
  }
  return s;
}
function inside(spec, G, y0, R) { // toppings that sit in the liquid
  let s = "";
  const bw = G.widthAt(-8);
  if (spec.toppings.includes("boba")) {
    for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
      const x = -bw / 2 + 10 + i * (bw - 20) / 5 + (row ? 7 : 0) + R() * 3, y = -12 - row * 13 - R() * 3;
      if (row && i === 5) continue;
      s += el("circle", { cx: x, cy: y, r: 7.5, fill: "#3D2620", stroke: INK, "stroke-width": 2 }) + el("circle", { cx: x + 2.4, cy: y - 2.6, r: 2, fill: "#9A6A52" });
    }
  }
  if (spec.streaks) for (let i = 0; i < 3; i++) {
    const x = -bw / 2 + 12 + i * (bw / 3);
    s += P(D(["M", x, y0 + 14, "c", -8, 18, 10, 30, 0, 52, "c", -6, 14, 6, 22, 2, 36]), line({ stroke: spec.streaks, "stroke-width": 6, opacity: 0.7 }));
  }
  if (spec.toppings.includes("jelly") || spec.toppings.includes("mochi") || spec.toppings.includes("taro")) {
    const kinds = spec.toppings.filter((t) => ["jelly", "mochi", "taro"].includes(t));
    for (let i = 0; i < 4; i++) {
      const k = kinds[i % kinds.length], x = -bw / 2 + 12 + i * (bw - 34) / 3 + R() * 4, y = -36 - R() * 12;
      const c = k === "mochi" ? "#FFF8F0" : k === "taro" ? "#C9A3DE" : light(spec.layers[spec.layers.length - 1].c, 0.2);
      s += el("rect", { x, y, width: 18, height: 16, rx: k === "jelly" ? 3 : 8, fill: c, "fill-opacity": k === "jelly" ? 0.75 : 1, stroke: INK, "stroke-width": 2, transform: `rotate(${n(R() * 30 - 15)} ${n(x + 9)} ${n(y + 8)})` });
    }
  }
  if (spec.toppings.includes("berries")) for (let i = 0; i < 2; i++) {
    const x = i ? bw / 2 - 26 : -bw / 2 + 8, y = -40 + i * 8;
    s += berry(x + 9, y, 11, -20 + i * 40, true);
  }
  if (spec.fizz) for (let i = 0; i < 9; i++) s += el("circle", { cx: R() * (bw - 20) - bw / 2 + 10, cy: y0 + 20 + R() * (-y0 - 34), r: 1.8 + R() * 2.4, fill: "none", stroke: WHITE, "stroke-width": 1.8, opacity: 0.9 });
  return s;
}
function berry(x, y, r, rot, half) { // strawberry (a slice when half)
  const body = P(D(["M", x, y + r * 1.25, "C", x - r * 1.5, y + r * 0.2, x - r * 1.1, y - r, x, y - r * 0.7, "C", x + r * 1.1, y - r, x + r * 1.5, y + r * 0.2, x, y + r * 1.25, "Z"]),
    { ...solid("#EF5A78", { "stroke-width": 2.5 }), transform: `rotate(${n(rot)} ${n(x)} ${n(y)})` });
  const inner = half ? P(D(["M", x, y + r * 0.8, "C", x - r * 0.9, y + r * 0.1, x - r * 0.6, y - r * 0.4, x, y - r * 0.3, "C", x + r * 0.6, y - r * 0.4, x + r * 0.9, y + r * 0.1, x, y + r * 0.8, "Z"]), { fill: "#FFC2CF", transform: `rotate(${n(rot)} ${n(x)} ${n(y)})` }) : "";
  const seeds = [[-0.4, 0], [0.4, 0], [0, 0.5], [0, -0.2]].map(([a, b]) => el("ellipse", { cx: x + a * r, cy: y + b * r, rx: 1.1, ry: 1.6, fill: "#FFE9A8", transform: `rotate(${n(rot)} ${n(x)} ${n(y)})` })).join("");
  const leaf = half ? "" : P(D(["M", x - r * 0.6, y - r * 0.75, "Q", x, y - r * 1.5, x + r * 0.6, y - r * 0.75, "Q", x, y - r * 0.4, x - r * 0.6, y - r * 0.75, "Z"]), { ...solid("#6CBF5A", { "stroke-width": 2 }), transform: `rotate(${n(rot)} ${n(x)} ${n(y)})` });
  return body + inner + seeds + leaf;
}
function dots(cx, cy, w, h, c, count, R, r = 1.6) { let s = ""; for (let i = 0; i < count; i++) s += el("circle", { cx: cx + (R() - 0.5) * w, cy: cy + (R() - 0.5) * h, r: r * (0.7 + R() * 0.6), fill: c }); return s; }
function onTop(spec, cx, y, w, R) { // crumbs and dust on a foam, cream or whip top
  let s = "";
  if (spec.toppings.includes("dust")) s += dots(cx, y, w * 0.7, 8, "#6FA845", 14, R, 1.5);
  if (spec.toppings.includes("crumble")) s += dots(cx, y, w * 0.6, 7, "#9A6A48", 10, R, 2.2);
  if (spec.toppings.includes("sesame")) s += dots(cx, y, w * 0.6, 7, "#3B2E27", 12, R, 1.2);
  if (spec.toppings.includes("oreo")) s += el("circle", { cx: cx + w * 0.18, cy: y - 6, r: 11, ...solid("#3B2A26", { "stroke-width": 2.5 }) }) + el("circle", { cx: cx + w * 0.18, cy: y - 6, r: 6, fill: "#FFF7EA" }) + dots(cx - 6, y, w * 0.5, 6, "#3B2A26", 8, R, 2);
  if (spec.toppings.includes("beans")) s += dots(cx, y, w * 0.5, 6, "#8A4B44", 8, R, 3);
  if (spec.toppings.includes("flakes")) s += dots(cx, y, w * 0.6, 7, WHITE, 9, R, 2.4) + dots(cx, y, w * 0.5, 6, "#E9DCC6", 5, R, 1.8);
  if (spec.toppings.includes("pistachio")) s += dots(cx, y, w * 0.6, 7, "#8DB45E", 10, R, 2.2);
  if (spec.toppings.includes("honeycomb")) s += el("rect", { x: cx + w * 0.12, y: y - 12, width: 18, height: 14, rx: 3, ...solid("#F2B731", { "stroke-width": 2.5 }) });
  return s;
}
function whip(cx, y, w) {
  return P(D(["M", cx - w / 2, y, "C", cx - w / 2 - 6, y - 16, cx - w / 4, y - 22, cx - w / 6, y - 18, "C", cx - w / 8, y - 34, cx + w / 8, y - 36, cx + w / 6, y - 20,
    "C", cx + w / 4, y - 24, cx + w / 2 + 6, y - 14, cx + w / 2, y, "Z"]), solid("#FFFBF2")) +
    P(D(["M", cx - w / 6, y - 12, "q", w / 6, 6, w / 3, 0]), line({ stroke: "#E9DCC8", "stroke-width": 3 }));
}
function garnishAt(g, x, y, R) {
  if (g.type === "strawberry") return berry(x, y - 4, 13, 18, false);
  if (g.type === "citrus") return el("circle", { cx: x, cy: y, r: 16, ...solid(mix(g.c, "#E8A93A", 0.25), { "stroke-width": 3 }) }) + el("circle", { cx: x, cy: y, r: 11.5, fill: light(g.c, 0.35) }) +
    [0, 60, 120].map((a) => P(D(["M", x + 11 * Math.cos(a * Math.PI / 180), y + 11 * Math.sin(a * Math.PI / 180), "L", x - 11 * Math.cos(a * Math.PI / 180), y - 11 * Math.sin(a * Math.PI / 180)]), line({ stroke: WHITE, "stroke-width": 2 }))).join("");
  if (g.type === "mint") return [-1, 1].map((k) => P(D(["M", x, y, "Q", x + k * 6, y - 22, x + k * 18, y - 18, "Q", x + k * 14, y - 4, x, y, "Z"]), solid(g.c, { "stroke-width": 2.5 }))).join("");
  if (g.type === "cinnamon") return P(D(["M", x - 6, y + 4, "L", x + 14, y - 34]), line({ stroke: INK, "stroke-width": 11 })) + P(D(["M", x - 6, y + 4, "L", x + 14, y - 34]), line({ stroke: g.c, "stroke-width": 6 }));
  if (g.type === "sakura") {
    let s = ""; for (let i = 0; i < 5; i++) { const a = i * 72 * Math.PI / 180; s += el("ellipse", { cx: x + 8 * Math.cos(a), cy: y + 8 * Math.sin(a), rx: 6.5, ry: 5, transform: `rotate(${n(i * 72)} ${n(x + 8 * Math.cos(a))} ${n(y + 8 * Math.sin(a))})`, ...solid(g.c, { "stroke-width": 2 }) }); }
    return s + el("circle", { cx: x, cy: y, r: 3, fill: "#E07A95" });
  }
  return "";
}
function strawSvg(st, x0, y0, x1, y1) {
  return P(D(["M", x0, y0, "L", x1, y1]), line({ "stroke-width": st.w + 6 })) + P(D(["M", x0, y0, "L", x1, y1]), line({ stroke: st.c, "stroke-width": st.w })) +
    P(D(["M", x0, y0, "L", x1, y1]), line({ stroke: st.c2, "stroke-width": st.w, "stroke-dasharray": "6 9", "stroke-linecap": "butt" }));
}
function steam(x, y) {
  return [-14, 4, 20].map((d, i) => P(D(["M", x + d, y, "c", -7, -9, 7, -14, 0, -24]), line({ "stroke-width": 3.5, opacity: 0.32 - i * 0.04 }))).join("");
}

// A tall soft dome of foam over the rim ("cloud"), or a lower cap ("foam", "cold foam", "cheese foam").
function cloudDome(rx, y, h, c) {
  const d = D(["M", -rx + 1, y + 3, "C", -rx - 7, y - h * 0.3, -rx * 0.75, y - h * 0.78, -rx * 0.36, y - h * 0.62,
    "C", -rx * 0.26, y - h * 1.08, rx * 0.3, y - h * 1.12, rx * 0.36, y - h * 0.64, "C", rx * 0.72, y - h * 0.8, rx + 7, y - h * 0.3, rx - 1, y + 3, "Z"]);
  return P(d, { fill: WHITE, stroke: WHITE, "stroke-width": 10, "stroke-linejoin": "round" }) + P(d, solid(c, { "stroke-width": 3.8 })) +
    P(D(["M", -rx + 8, y - 2, "Q", 0, y + 6, rx - 8, y - 2]), line({ stroke: mix(c, "#C9B8A0", 0.35), "stroke-width": 3, opacity: 0.7 })) +
    P(D(["M", -rx * 0.62, y - h * 0.4, "q", rx * 0.12, -h * 0.2, rx * 0.26, -h * 0.2, "M", -rx * 0.1, y - h * 0.82, "q", rx * 0.12, -h * 0.12, rx * 0.24, -h * 0.06]), line({ stroke: WHITE, "stroke-width": 3.5 }));
}
// Layered drinks: fruit bits in a purée at the bottom, and matcha drips where it was poured over milk.
function layerCues(spec, G, liq, bot, R) {
  const L = spec.layers, total = L.reduce((a, l) => a + l.f, 0), yAt = (k) => bot - (L.slice(0, k).reduce((a, l) => a + l.f, 0) / total) * (bot - liq);
  let s = "";
  const f0 = FLAVORS[L[0].n];
  if (L.length > 1 && ((f0 && f0[1] === "f") || /guava|fruit|berry|cherry/.test(L[0].n)) && !/^strawberr/.test(L[0].n)) {
    const y1 = yAt(1), w = G.widthAt(-10);
    for (let i = 0; i < 5; i++) {
      const x = -w / 2 + 10 + i * (w - 28) / 4 + R() * 4, y = y1 + 5 + R() * Math.max(2, bot - y1 - 18);
      s += el("rect", { x, y, width: 10, height: 9, rx: 3.5, fill: dark(L[0].c, 0.16), transform: `rotate(${n(R() * 50 - 25)} ${n(x + 5)} ${n(y + 4.5)})` });
    }
  }
  for (let k = 1; k < L.length; k++) {
    if (!/matcha|hojicha|espresso/.test(L[k].n) || !/milk|ube|taro|sesame|pistachio|lemonade|tonic|coconut|vanilla/.test(L[k - 1].n)) continue;
    const yb = yAt(k), w = G.widthAt(yb);
    for (const dx of [-w * 0.22, w * 0.18]) s += P(D(["M", dx, yb - 2, "c", 0, 6, -3, 9, 0, 13]), line({ stroke: L[k].c, "stroke-width": 5 })) + el("circle", { cx: dx + 1, cy: yb + 17, r: 2.6, fill: L[k].c });
  }
  return s;
}

function glassDrink(spec, G, uid, R) {
  const dome = spec.top && (spec.top.type === "cloud" || spec.top.type === "foam") ? (spec.top.type === "cloud" ? 44 : 26) : 0;
  const H = G.H, top = G.rim.y, liq = top + (dome ? 8 : spec.top && spec.top.type === "cream" ? 6 : spec.temp === "iced" ? 18 : 14), bot = -4;
  const g = gradient(uid + "l", spec.layers, liq, bot, spec.blend);
  let s = "", defs = g.defs + `<clipPath id="${uid}c">${P(G.clip)}</clipPath>`;
  s += P(G.clip, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" }); // die-cut halo
  s += P(G.clip, { fill: "#EEF7F3", "fill-opacity": 0.85 });
  if (spec.straw) { const a = spec.straw.a * Math.PI / 180; s += strawSvg(spec.straw, -6 + Math.sin(a) * 20, -18, 10 + Math.sin(a) * (H + 40), top - 36 - dome * 0.8); }
  let inner = el("rect", { x: -80, y: liq, width: 160, height: -liq, fill: g.fill });
  if (spec.blend === "marble") { const c = spec.layers[spec.layers.length - 1].c, w = G.widthAt(liq); inner += P(D(["M", -w / 3, liq + 10, "c", -10, 20, 16, 26, 4, 48, "M", w / 5, liq + 10, "c", 12, 18, -10, 30, 6, 56]), line({ stroke: c, "stroke-width": 9, opacity: 0.55 })); }
  if (spec.blend === "layered") inner += layerCues(spec, G, liq, bot, R);
  inner += inside(spec, G, liq, R);
  const wl = G.widthAt(liq);
  inner += el("ellipse", { cx: 0, cy: liq, rx: wl / 2, ry: 6, fill: light(spec.layers[spec.layers.length - 1].c, 0.25), stroke: INK, "stroke-width": 2.5, "stroke-opacity": 0.35 });
  inner += iceCubes(spec, G, liq, R);
  s += `<g clip-path="url(#${uid}c)">${inner}</g>`;
  s += P(D(["M", -G.widthAt(-30) / 2 + 9, -30, "L", -G.rim.rx + 11, top + 16]), line({ stroke: WHITE, "stroke-width": 5, opacity: 0.8 }));
  s += P(G.sides, line({ "stroke-width": 4.5 })) + el("ellipse", { cx: 0, cy: top, rx: G.rim.rx, ry: G.rim.ry, fill: "none", stroke: INK, "stroke-width": 4 });
  if (spec.top && spec.top.type === "cream") s += P(D(["M", -G.rim.rx + 3, top + 2, "C", -G.rim.rx + 4, top - 16, G.rim.rx - 4, top - 16, G.rim.rx - 3, top + 2]), solid(spec.top.c, { "stroke-width": 3.5 }));
  if (dome) s += cloudDome(G.rim.rx, top, dome, spec.top.c);
  if (spec.toppings.includes("whip")) s += whip(0, top + 2 - dome * 0.8, G.rim.rx * 1.6);
  const ty = dome ? top - dome * 0.8 : spec.toppings.includes("whip") ? top - 16 : spec.top && spec.top.type === "cream" ? top - 7 : liq;
  s += onTop(spec, 0, ty, G.rim.rx * 1.6, R);
  if (spec.toppings.includes("mochi") && spec.toppings.includes("whip")) s += el("rect", { x: -8, y: top - 40, width: 18, height: 16, rx: 8, ...solid("#FFF8F0", { "stroke-width": 2.5 }) });
  spec.garnish.forEach((gn, i) => { s += garnishAt(gn, i ? -G.rim.rx + 10 : G.rim.rx - 8, top - (gn.type === "mint" ? 4 : 0), R); });
  return { s, defs };
}

function bowlDrink(spec, uid, R, cols) {
  const glaze = cols[spec.seed % cols.length], y = -76, rx = 70;
  let s = P(D(["M", -rx, y, "C", -rx + 2, -28, -50, -10, -28, -10, "L", -26, 0, "L", 26, 0, "L", 28, -10, "C", 50, -10, rx - 2, -28, rx, y, "Z"]), { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" });
  s += P(D(["M", -rx, y, "C", -rx + 2, -28, -50, -10, -28, -10, "L", -26, 0, "L", 26, 0, "L", 28, -10, "C", 50, -10, rx - 2, -28, rx, y, "Z"]), solid(glaze[0], { "stroke-width": 4.5 }));
  s += P(D(["M", -rx + 3, y + 4, "L", rx - 3, y + 4, "L", rx - 6, y + 20, "q", -8, 10, -14, 0, "q", -10, 14, -20, 2, "q", -12, 16, -24, 0, "q", -12, 12, -22, 2, "q", -10, 12, -20, -2, "q", -10, 10, -18, 2, "Z"]), { fill: glaze[1] });
  s += dots(0, -40, 90, 30, glaze[2], 9, R, 1.6);
  s += el("ellipse", { cx: 0, cy: y, rx, ry: 14, ...solid(glaze[1], { "stroke-width": 4 }) });
  s += el("ellipse", { cx: 0, cy: y + 1, rx: rx - 7, ry: 10, fill: spec.layers[0].c, stroke: INK, "stroke-width": 2.5 });
  s += dots(0, y + 1, 90, 10, light(spec.layers[0].c, 0.45), 16, R, 1.8);
  s += P(D(["M", -18, y + 1, "c", 6, -6, 18, -6, 22, 0, "c", 3, 4, -6, 6, -9, 2]), line({ stroke: light(spec.layers[0].c, 0.55), "stroke-width": 2.5 }));
  return { s: s + steam(0, y - 14), defs: "" };
}
function mugDrink(spec, uid, R, cols) {
  const c = cols[spec.seed % cols.length], y = -104, rx = 52;
  const body = D(["M", -rx, y, "L", -rx, -18, "Q", -rx, 0, -rx + 18, 0, "L", rx - 18, 0, "Q", rx, 0, rx, -18, "L", rx, y, "Z"]);
  let s = P(D(["M", rx - 2, -80, "c", 32, -6, 32, 46, 0, 42]), line({ stroke: WHITE, "stroke-width": 24 })) + P(body, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" });
  s += P(D(["M", rx - 2, -80, "c", 32, -6, 32, 46, 0, 42]), line({ "stroke-width": 15 })) + P(D(["M", rx - 2, -80, "c", 32, -6, 32, 46, 0, 42]), line({ stroke: c[0], "stroke-width": 7.5 }));
  s += P(body, solid(c[0], { "stroke-width": 4.5 })) + P(D(["M", -rx + 10, -66, "L", -rx + 10, -28]), line({ stroke: WHITE, "stroke-width": 5, opacity: 0.7 }));
  s += P(D(["M", -rx, -52, "q", rx / 2, 10, rx, 0, "q", rx / 2, -10, rx, 0]), line({ stroke: c[1], "stroke-width": 6 }));
  s += el("ellipse", { cx: 0, cy: y, rx, ry: 12, ...solid(c[1]) }) + el("ellipse", { cx: 0, cy: y + 1, rx: rx - 6, ry: 8.5, fill: spec.layers[0].c, stroke: INK, "stroke-width": 2.5 });
  if (spec.top && spec.top.type === "art") s += P(D(["M", 0, y + 6, "C", -18, y - 2, -12, y - 10, 0, y - 4, "C", 12, y - 10, 18, y - 2, 0, y + 6, "Z"]), { fill: spec.top.c });
  else if (spec.top) s += el("ellipse", { cx: 0, cy: y, rx: rx - 7, ry: 8, fill: spec.top.c });
  s += onTop(spec, 0, y, rx * 1.4, R);
  spec.garnish.forEach((g) => { s += garnishAt(g, rx - 12, y - 2, R); });
  return { s: s + steam(0, y - 16), defs: "" };
}
function paperCup(spec, uid, R) {
  const G = tapered(128, 100, 78, 8), y = -128, sleeve = spec.layers[0].c;
  let s = P(G.clip, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" }) + P(G.clip, solid(CREAM, { "stroke-width": 4.5 }));
  s += `<clipPath id="${uid}c">${P(G.clip)}</clipPath><g clip-path="url(#${uid}c)">` + el("rect", { x: -60, y: -92, width: 120, height: 50, fill: "#E7C79E" }) +
    el("rect", { x: -60, y: -76, width: 120, height: 14, fill: sleeve }) + "</g>" + P(D(["M", -60, -92, "L", 60, -92, "M", -60, -42, "L", 60, -42]), line({ "stroke-width": 3 }));
  s += el("rect", { x: -57, y: y - 14, width: 114, height: 16, rx: 7, ...solid(CREAM) }) + P(D(["M", -48, y - 14, "Q", -46, y - 28, -30, y - 28, "L", 30, y - 28, "Q", 46, y - 28, 48, y - 14]), solid(CREAM));
  s += el("ellipse", { cx: 18, cy: y - 22, rx: 7, ry: 2.6, fill: INK });
  return { s: s + steam(0, y - 36), defs: "" };
}
function bottleDrink(spec, uid, R) {
  const sides = D(["M", -16, -160, "L", -16, -146, "C", -16, -132, -42, -128, -42, -108, "L", -42, -12, "Q", -42, 0, -30, 0, "L", 30, 0, "Q", 42, 0, 42, -12, "L", 42, -108, "C", 42, -128, 16, -132, 16, -146, "L", 16, -160]);
  const G = { H: 160, sides, clip: sides + "Z", widthAt: (y) => (y < -128 ? 32 : 84), rim: { y: -160, rx: 16, ry: 4 } };
  const g = gradient(uid + "l", spec.layers, -122, -4, spec.blend);
  let s = P(G.clip, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" }) + P(G.clip, { fill: "#EEF7F3" });
  s += `<g clip-path="url(#${uid}c)">` + el("rect", { x: -50, y: -122, width: 100, height: 122, fill: g.fill }) + el("ellipse", { cx: 0, cy: -122, rx: 40, ry: 5, fill: light(spec.layers[spec.layers.length - 1].c, 0.25) }) + inside(spec, { widthAt: () => 84 }, -122, R) + "</g>";
  s += el("rect", { x: -42, y: -84, width: 84, height: 40, fill: CREAM, stroke: INK, "stroke-width": 3 }) + leafMark(0, -64, 11, MATCHA);
  s += P(D(["M", -32, -110, "L", -32, -96]), line({ stroke: WHITE, "stroke-width": 5, opacity: 0.8 })) + P(sides, line({ "stroke-width": 4.5 }));
  s += el("rect", { x: -20, y: -180, width: 40, height: 22, rx: 5, ...solid("#F6B7C7") }) + P(D(["M", -12, -176, "L", -12, -162, "M", 0, -176, "L", 0, -162, "M", 12, -176, "L", 12, -162]), line({ stroke: "#D98CA2", "stroke-width": 2.5 }));
  return { s, defs: g.defs + `<clipPath id="${uid}c">${P(G.clip)}</clipPath>` };
}
function leafMark(x, y, r, c) {
  return P(D(["M", x - r, y + r * 0.5, "C", x - r, y - r, x + r * 0.6, y - r * 1.2, x + r, y - r, "C", x + r * 1.1, y + r * 0.3, x, y + r * 1.1, x - r, y + r * 0.5, "Z"]), solid(c, { "stroke-width": 2.5 })) +
    P(D(["M", x - r * 0.7, y + r * 0.4, "Q", x, y - r * 0.1, x + r * 0.7, y - r * 0.7]), line({ stroke: INK, "stroke-width": 2 }));
}
function canDrink(spec, uid, R) {
  const c = spec.layers[0].c, t = spec.layers[spec.layers.length - 1].c;
  const body = D(["M", -40, -150, "L", -40, -8, "Q", -40, 0, -30, 0, "L", 30, 0, "Q", 40, 0, 40, -8, "L", 40, -150, "Z"]);
  let s = P(body, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" });
  s += `<linearGradient id="${uid}w" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${light(t, 0.15)}"/><stop offset="1" stop-color="${light(c, 0.1)}"/></linearGradient>`;
  s += P(body, solid(`url(#${uid}w)`, { "stroke-width": 4.5 }));
  s += P(D(["M", -40, -56, "q", 20, -14, 40, 0, "q", 20, 14, 40, 0, "L", 40, -34, "q", -20, 14, -40, 0, "q", -20, -14, -40, 0, "Z"]), { fill: CREAM, opacity: 0.92 });
  s += leafMark(0, -100, 14, MATCHA) + P(D(["M", -30, -136, "L", -30, -70]), line({ stroke: WHITE, "stroke-width": 6, opacity: 0.6 }));
  s += el("ellipse", { cx: 0, cy: -150, rx: 40, ry: 8, ...solid("#DDE2E4") }) + el("ellipse", { cx: 4, cy: -152, rx: 11, ry: 3.6, fill: "none", stroke: INK, "stroke-width": 2.5 });
  s += dots(0, -90, 66, 100, WHITE, 6, R, 2.6);
  return { s, defs: "" };
}
function cone(spec, uid, R) {
  const cols = spec.colors;
  let s = P(D(["M", -34, -92, "L", 0, 0, "L", 34, -92, "Z"]), { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" });
  s += `<clipPath id="${uid}k">${P(D(["M", -34, -92, "L", 0, 0, "L", 34, -92, "Z"]))}</clipPath>`;
  s += P(D(["M", -34, -92, "L", 0, 0, "L", 34, -92, "Z"]), solid("#EDBB72", { "stroke-width": 4.5 }));
  s += `<g clip-path="url(#${uid}k)">` + [-40, -20, 0, 20, 40].map((d) => P(D(["M", d - 40, -110, "L", d + 20, 0, "M", d + 40, -110, "L", d - 20, 0]), line({ stroke: "#C98F4A", "stroke-width": 2.5 }))).join("") + "</g>";
  s += P(D(["M", -34, -92, "L", 0, 0, "L", 34, -92]), line({ "stroke-width": 4.5 }));
  return s + (spec.item === "scoops" ? scoops(spec, -92, R) : swirl(spec, -88, 84, R));
}
function swirl(spec, y, w, R) {
  const cols = spec.colors; let s = "";
  [[w, 30], [w * 0.8, 28], [w * 0.56, 26]].forEach(([tw, h], i) => {
    const c = light(cols[i % cols.length], 0.12), yy = y - i * 24;
    s += el("rect", { x: -tw / 2, y: yy - h, width: tw, height: h, rx: h / 2, ...solid(c, { "stroke-width": 4 }) }) + P(D(["M", -tw / 2 + 10, yy - h / 2 - 2, "q", tw / 4, 6, tw / 2, 0]), line({ stroke: light(c, 0.5), "stroke-width": 3 }));
  });
  const c = light(cols[3 % cols.length] || cols[0], 0.12), ty = y - 72;
  s += P(D(["M", -14, ty + 4, "C", -14, ty - 14, 4, ty - 14, 6, ty - 26, "C", 14, ty - 14, 16, ty + 4, 2, ty + 4, "Z"]), solid(c, { "stroke-width": 4 }));
  s += onTop(spec, 0, ty + 8, w * 0.7, R);
  if (spec.toppings.includes("berries")) s += berry(w * 0.32, y - 54, 11, 25, false);
  if (spec.toppings.includes("mochi")) s += el("rect", { x: -w * 0.4, y: y - 64, width: 18, height: 16, rx: 8, ...solid("#FFF8F0", { "stroke-width": 2.5 }) });
  return s;
}
function scoops(spec, y, R) {
  const cols = spec.colors; let s = "";
  [[-18, 0], [18, 0], [0, -30]].slice(0, cols.length > 1 ? 3 : 2).forEach(([dx, dy], i) => {
    const c = light(cols[i % cols.length], 0.1), cx = cols.length > 1 ? dx : dx * 0.3, cy = y - 22 + dy + (cols.length > 1 ? 0 : i * -24);
    s += P(D(["M", cx - 30, cy + 8, "C", cx - 34, cy - 30, cx + 34, cy - 30, cx + 30, cy + 8, "q", -6, 8, -12, 2, "q", -6, 8, -12, 0, "q", -6, 8, -12, 0, "q", -6, 6, -12, -2, "Z"]), solid(c, { "stroke-width": 4 }));
    s += P(D(["M", cx - 16, cy - 10, "q", 6, -8, 16, -8]), line({ stroke: light(c, 0.55), "stroke-width": 3 }));
  });
  s += onTop(spec, 0, y - 60, 50, R);
  if (spec.toppings.includes("berries")) s += berry(16, y - 72, 11, 20, false);
  return s;
}
function scoopCup(spec, uid, R) {
  const G = tapered(56, 92, 70, 8);
  let s = P(G.clip, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" }) + P(G.clip, solid("#F6B7C7", { "stroke-width": 4.5 }));
  s += `<clipPath id="${uid}c">${P(G.clip)}</clipPath><g clip-path="url(#${uid}c)">` + [-40, -20, 0, 20, 40].map((x) => el("rect", { x: x - 4, y: -60, width: 9, height: 60, fill: CREAM })).join("") + "</g>" + P(G.sides, line({ "stroke-width": 4.5 }));
  return s + (spec.item === "swirl" ? swirl(spec, -52, 78, R) : scoops(spec, -56, R)) + el("ellipse", { cx: 0, cy: -56, rx: 46, ry: 6, fill: "none", stroke: INK, "stroke-width": 4 });
}
function coupe(spec, uid, R) {
  const G = tapered(84, 112, 88, 12), [scoopC, pourC] = spec.colors, top = -84;
  let s = P(G.clip, { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" }) + P(G.clip, { fill: "#EEF7F3" });
  s += `<clipPath id="${uid}c">${P(G.clip)}</clipPath><g clip-path="url(#${uid}c)">` + el("rect", { x: -70, y: -34, width: 140, height: 34, fill: pourC }) + el("ellipse", { cx: 0, cy: -34, rx: 46, ry: 6, fill: light(pourC, 0.2) }) + "</g>";
  s += el("ellipse", { cx: 0, cy: top, rx: 56, ry: 7, fill: "none", stroke: INK, "stroke-width": 4 });
  s += P(D(["M", -36, top + 6, "C", -42, top - 52, 42, top - 52, 36, top + 6, "Z"]), solid(light(scoopC, 0.15)));
  s += P(D(["M", -26, top - 26, "C", -10, top - 40, 14, top - 42, 26, top - 24, "q", 2, 10, -4, 14, "q", -4, -8, -8, -2, "q", -2, 16, -8, 20, "q", -6, -4, -4, -18, "q", -8, -2, -12, 6, "q", -6, -6, -2, -16, "Z"]), solid(pourC, { "stroke-width": 3 }));
  s += P(D(["M", 4, -54, "q", -2, 12, 0, 22]), line({ stroke: pourC, "stroke-width": 6 }));
  s += P(G.sides, line({ "stroke-width": 4.5 })) + P(D(["M", -48, -26, "L", -50, -64]), line({ stroke: WHITE, "stroke-width": 5, opacity: 0.8 }));
  return s + onTop(spec, 0, top - 30, 40, R);
}
function kakigori(spec, uid, R) {
  const c = spec.colors[0], y = -56;
  let s = P(D(["M", -64, y, "Q", -60, -18, 0, -16, "Q", 60, -18, 64, y, "Z", "M", -8, -16, "L", -10, -6, "L", -28, -2, "L", 28, -2, "L", 10, -6, "L", 8, -16, "Z"]), { fill: WHITE, stroke: WHITE, "stroke-width": 14, "stroke-linejoin": "round" });
  s += P(D(["M", -54, y, "C", -60, y - 90, 60, y - 90, 54, y, "Z"]), solid("#FFFFFF"));
  s += P(D(["M", -44, y - 46, "C", -30, y - 80, 30, y - 80, 44, y - 46, "q", -4, 14, -10, 4, "q", -4, 18, -12, 4, "q", -6, 14, -12, -2, "q", -6, 18, -12, 2, "q", -8, 12, -12, -4, "q", -6, 12, -10, 0, "Z"]), solid(c, { "stroke-width": 3 }));
  s += dots(0, y - 20, 70, 30, "#DDEEF2", 10, R, 2.2);
  s += P(D(["M", -64, y, "Q", -60, -18, 0, -16, "Q", 60, -18, 64, y, "Z"]), solid("#EEF7F3", { "fill-opacity": 0.9 }));
  s += P(D(["M", -8, -16, "L", -10, -6, "L", -28, -2, "L", 28, -2, "L", 10, -6, "L", 8, -16]), solid("#EEF7F3"));
  s += onTop(spec, 0, y - 60, 50, R);
  if (spec.toppings.includes("mochi")) s += el("rect", { x: 14, y: y - 76, width: 18, height: 16, rx: 8, ...solid("#FFF8F0", { "stroke-width": 2.5 }) });
  if (spec.toppings.includes("berries")) s += berry(-20, y - 70, 11, -20, false);
  return s;
}
function plate(spec, uid, R) {
  const cols = spec.colors, c0 = cols[0], c1 = cols[1] || c0;
  let s = el("ellipse", { cx: 0, cy: -16, rx: 90, ry: 22, fill: WHITE, stroke: WHITE, "stroke-width": 14 }) + el("ellipse", { cx: 0, cy: -16, rx: 88, ry: 20, ...solid(CREAM) }) + el("ellipse", { cx: 0, cy: -18, rx: 64, ry: 12, fill: "none", stroke: "#DCE7D0", "stroke-width": 3 });
  const it = spec.item;
  if (["tiramisu", "cheesecake", "cake", "brownie"].includes(it)) {
    const st = it === "tiramisu" ? [["#9CC46A", 14], ["#FFF4DE", 12], ["#9CC46A", 14], ["#FFF4DE", 14]]
      : it === "cheesecake" ? [["#D9A45E", 10], [c0 === MATCHA ? "#C9E09A" : light(c0, 0.55), 40], [c1 === c0 ? light(c0, 0.1) : c1, 8]]
      : it === "brownie" ? [["#7A4A36", 46], ["#A0664A", 8]]
      : [[light(c0, 0.2), 14], ["#FFF4DE", 9], [light(c0, 0.2), 14], ["#FFF4DE", 9], [light(c1, 0.1), 8]];
    const h = st.reduce((a, b) => a + b[1], 0), x0 = -46, x1 = 28, yb = -18, yt = yb - h, dx = 26, dy = -20;
    let yy = yb;
    s += P(D(["M", x0, yb, "L", x0, yt, "L", x0 + dx, yt + dy, "L", x1 + dx, yt + dy, "L", x1 + dx, yb + dy, "L", x1, yb, "Z"]), { fill: WHITE, stroke: WHITE, "stroke-width": 12, "stroke-linejoin": "round" });
    for (const [c, hh] of st) { s += el("rect", { x: x0, y: yy - hh, width: x1 - x0, height: hh, fill: c }) + P(D(["M", x1, yy, "L", x1 + dx, yy + dy, "L", x1 + dx, yy + dy - hh, "L", x1, yy - hh, "Z"]), { fill: dark(c, 0.14) }); yy -= hh; }
    const topC = it === "tiramisu" ? "#7DB54E" : st[st.length - 1][0];
    s += P(D(["M", x0, yt, "L", x0 + dx, yt + dy, "L", x1 + dx, yt + dy, "L", x1, yt, "Z"]), solid(topC, { "stroke-width": 4 }));
    s += P(D(["M", x0, yb, "L", x0, yt, "M", x1, yb, "L", x1, yt, "M", x1 + dx, yt + dy, "L", x1 + dx, yb + dy, "L", x1, yb, "L", x0, yb]), line({ "stroke-width": 4 }));
    if (it === "tiramisu") s += dots((x0 + x1 + dx) / 2, yt + dy / 2, 60, 12, "#5E9A36", 14, R, 1.4);
    s += onTop(spec, (x0 + x1 + dx) / 2, yt + dy / 2, 50, R);
    if (spec.toppings.includes("berries") || (it === "cheesecake" && c0 === "#F48FAB")) s += berry(x1 - 4, yt + dy / 2 - 8, 11, 15, false);
    return s;
  }
  const pos = [[-34, -26], [30, -24], [0, -40]];
  pos.forEach(([x, y], i) => {
    const c = cols[i % cols.length];
    if (it === "cookie") {
      const cc = c === MATCHA ? "#A9CB76" : "#E3B474";
      s += el("ellipse", { cx: x, cy: y, rx: 26, ry: 18, ...solid(cc) }) + dots(x, y, 30, 18, i % 2 ? "#FFF7EA" : "#5A3A2A", 5, R, 2.6);
    } else if (it === "macaron") {
      const mc = light(c, 0.2);
      s += el("rect", { x: x - 22, y: y - 4, width: 44, height: 14, rx: 7, ...solid(mc, { "stroke-width": 3.5 }) }) + el("rect", { x: x - 20, y: y - 9, width: 40, height: 6, rx: 3, fill: CREAM, stroke: INK, "stroke-width": 2.5 }) +
        el("rect", { x: x - 22, y: y - 22, width: 44, height: 14, rx: 7, ...solid(mc, { "stroke-width": 3.5 }) });
    } else if (it === "mochi") {
      const mc = light(c, 0.3);
      s += P(D(["M", x - 24, y + 8, "C", x - 26, y - 26, x + 26, y - 26, x + 24, y + 8, "Z"]), solid(mc)) + dots(x, y - 8, 26, 12, WHITE, 5, R, 1.6) + P(D(["M", x - 12, y - 8, "q", 4, -6, 10, -6]), line({ stroke: WHITE, "stroke-width": 3 }));
      if (spec.toppings.includes("berries") && i === 2) s += berry(x, y - 22, 9, 0, false);
    } else if (it === "donut") {
      if (i > 1) return;
      s += el("ellipse", { cx: x, cy: y, rx: 30, ry: 18, ...solid("#E4B072") }) + P(D(["M", x - 27, y - 2, "C", x - 26, y - 20, x + 26, y - 20, x + 27, y - 2, "q", -5, 6, -9, 1, "q", -5, 7, -10, 1, "q", -6, 6, -10, 0, "q", -6, 6, -10, 0, "q", -6, 6, -9, -1, "Z"]), solid(light(c, 0.15), { "stroke-width": 3 })) +
        el("ellipse", { cx: x, cy: y - 4, rx: 8, ry: 4, ...solid("#E4B072", { "stroke-width": 3 }) }) + dots(x, y - 8, 40, 10, i ? "#F6B7C7" : "#FFF7EA", 6, R, 1.6);
    } else if (it === "dango") {
      if (i) return;
      s += P(D(["M", -60, -16, "L", 52, -62]), line({ stroke: "#8A6248", "stroke-width": 6 }));
      ["#F6B7C7", "#FFF6E6", "#B9DB97"].forEach((dc, k) => { s += el("circle", { cx: -30 + k * 26, cy: -30 - k * 11, r: 15, ...solid(dc) }); });
    } else if (it === "cupcake") {
      if (i > 1) return;
      s += P(D(["M", x - 20, y - 18, "L", x - 15, y + 8, "L", x + 15, y + 8, "L", x + 20, y - 18, "Z"]), solid("#F6B7C7", { "stroke-width": 3.5 })) +
        P(D(["M", x - 24, y - 16, "C", x - 30, y - 34, x - 10, y - 40, x, y - 46, "C", x + 10, y - 40, x + 30, y - 34, x + 24, y - 16, "Z"]), solid(light(c, 0.2), { "stroke-width": 3.5 }));
    } else { // pastry: a croissant
      if (i > 1) return;
      const pc = "#E9B465";
      s += P(D(["M", x - 32, y + 4, "C", x - 30, y - 22, x + 30, y - 22, x + 32, y + 4, "C", x + 20, y - 6, x - 20, y - 6, x - 32, y + 4, "Z"]), solid(pc)) +
        [-14, 0, 14].map((d) => P(D(["M", x + d, y - 15, "q", 3, 6, 0, 12]), line({ stroke: "#B97A36", "stroke-width": 2.5 }))).join("");
      if (c !== MATCHA || spec.flavors.length) s += P(D(["M", x - 20, y - 10, "q", 8, -6, 14, 0, "q", 8, -6, 14, 0]), line({ stroke: c === MATCHA ? MATCHA : c, "stroke-width": 3.5 }));
    }
  });
  return s;
}

const MUGS = [["#FFF3E0", "#F6B7C7"], ["#DCEBC9", "#FFFBF0"], ["#F8D3B5", "#FFFBF0"], ["#FFFBF0", "#B5D39F"]];
const BOWLS = [["#E9DCC6", "#6F8F7A", "#B39C7E"], ["#6F7F8F", "#DDE6EC", "#4E5C6A"], ["#F2C4CF", "#FFF4F6", "#D98CA2"], ["#B88A6A", "#F1E2CC", "#8A6248"]];

// The drink itself, local coordinates (base centre at 0,0). -> {s, defs, h: height above the base}
export function drinkBody(spec, uid) {
  const R = rng(spec.seed ^ 0x9e37);
  switch (spec.vessel) {
    case "tall": { const o = glassDrink(spec, tapered(150, 104, 84, 12), uid, R); return { ...o, h: 190 }; }
    case "short": { const o = glassDrink(spec, tapered(100, 118, 100, 10), uid, R); return { ...o, h: 140 }; }
    case "bowl": return { ...bowlDrink(spec, uid, R, BOWLS), h: 120 };
    case "mug": return { ...mugDrink(spec, uid, R, MUGS), h: 140 };
    case "cup": return { ...paperCup(spec, uid, R), h: 180 };
    case "bottle": return { ...bottleDrink(spec, uid, R), h: 180 };
    case "can": return { ...canDrink(spec, uid, R), h: 160 };
    case "cone": return { s: cone(spec, uid, R), defs: "", h: 200 };
    case "scoop": return { s: scoopCup(spec, uid, R), defs: "", h: 150 };
    case "coupe": return { s: coupe(spec, uid, R), defs: "", h: 140 };
    case "kakigori": return { s: kakigori(spec, uid, R), defs: "", h: 140 };
    default: return { s: plate(spec, uid, R), defs: "", h: 110 };
  }
}

// ---- Mattie and stickers ---------------------------------------------------------------------------------
export function parseSymbols(text) {
  const out = {};
  for (const m of String(text || "").matchAll(/<symbol id="([^"]+)"\s+viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)) out[m[1]] = { vb: m[2], body: m[3].replace(/\s*\n\s*/g, "") };
  return out;
}
function char(id, x, y, size, o) {
  const mode = o.chars || (o.symbols ? "inline" : "none");
  if (mode === "none") return "";
  if (mode === "use") return el("use", { href: `${o.href || ""}#${id}`, x, y, width: size, height: size });
  const sym = (o.symbols && (o.symbols[id] || o.symbols["m-happy"])); if (!sym) return "";
  const vb = sym.vb.split(/\s+/).map(Number), k = size / vb[2];
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${Math.round(k * 1000) / 1000})">${sym.body}</g>`;
}
function sticker(text, cx, cy, size, rot, fill, maxW) {
  const words = String(text).split(" "), per = Math.max(6, Math.floor(maxW / (size * 0.6)));
  const lines = []; let cur = "";
  for (const w of words) { if (cur && (cur + " " + w).length > per) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
  if (cur) lines.push(cur);
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].slice(0, per - 1) + "…"; }
  lines.forEach((l, i) => { if (l.length > per) lines[i] = l.slice(0, per - 1) + "…"; });
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.6 + size * 1.3, h = lines.length * size * 1.18 + size * 0.7;
  const x = cx - w / 2, y = cy - h / 2, rr = Math.min(h / 2, size * 0.9);
  return `<g transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})">` +
    el("rect", { x: x + 4, y: y + 5, width: w, height: h, rx: rr, fill: INK }) +
    el("rect", { x, y, width: w, height: h, rx: rr, fill, stroke: WHITE, "stroke-width": 9, "paint-order": "stroke" }) +
    el("rect", { x, y, width: w, height: h, rx: rr, fill: "none", stroke: INK, "stroke-width": 3.5 }) +
    lines.map((l, i) => el("text", { x: cx, y: y + size * 0.35 + (i + 1) * size * 1.18 - size * 0.2, "font-size": size, "font-weight": 800, "text-anchor": "middle", fill: INK }, esc(l))).join("") + "</g>";
}
function petal(x, y, s, rot) { return el("ellipse", { cx: x, cy: y, rx: s, ry: s * 0.55, transform: `rotate(${n(rot)} ${n(x)} ${n(y)})`, fill: "#F6B7C7", stroke: "#D98CA2", "stroke-width": 1.5 }); }
function sparkle(x, y, s, c) { return P(D(["M", x, y - s, "Q", x, y, x + s, y, "Q", x, y, x, y + s, "Q", x, y, x - s, y, "Q", x, y, x, y - s, "Z"]), { fill: c }); }

// drawDrink(spec, opts) -> 200 x 240 sticker SVG.
export function drawDrink(spec, opts = {}) {
  if (typeof spec === "string") spec = specFromText(spec);
  if (!spec) return "";
  const uid = opts.uid || "d" + (spec.seed >>> 0).toString(36), R = rng(spec.seed ^ 0x51);
  const k = { s: 0.86, m: 1, l: 1.06 }[spec.size] || 1;
  const body = drinkBody(spec, uid), scale = Math.min(k, 196 / body.h);
  const left = spec.side === "l", cx = left ? 118 : 86, base = 206;
  const tint = light(spec.kind === "sweet" ? spec.colors[0] : (spec.layers.find((l) => l.n !== "milk") || spec.layers[0]).c, 0.72);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240" class="art-drink" role="img" aria-label="${esc(spec.label)}" font-family="${FONT}">`;
  s += `<title>${esc(spec.label)}</title><defs>${body.defs}</defs>`;
  s += el("circle", { cx: 100, cy: 116, r: 90, fill: tint, class: "art-bg" }) + el("ellipse", { cx, cy: base + 2, rx: 66 * scale, ry: 9, fill: INK, opacity: 0.12 });
  s += petal(26, 40, 7, -30) + petal(176, 74, 5.5, 40) + sparkle(170, 30, 8, WHITE) + sparkle(30, 150, 6, WHITE);
  s += `<g transform="translate(${n(cx)} ${n(base)}) rotate(${n(spec.tilt)}) scale(${n(scale * 100) / 100})">${body.s}</g>`;
  if (opts.mattie !== false) {
    const pose = spec.pose, size = pose === "m-peek" ? 66 : 76, mx = left ? 2 : 198 - size, my = pose === "m-peek" ? 166 : 132;
    s += char(pose === "m-peek" ? "m-peek" : pose, mx, my, size, opts);
  }
  if (opts.label !== false) s += sticker(spec.label, 100, 222, 14, -spec.tilt * 0.6 - 2, CREAM, 176);
  return s + "</svg>";
}

// drawEventArt(event, opts) -> 640 x 400 scene for an event with no photo: its signature drinks, Mattie and
// the brand name as a sticker. Dates, venue and menu text stay with drawn.js; this is only the picture.
export const FALLBACK_DRINKS = ["iced matcha latte", "strawberry matcha latte", "hojicha latte", "matcha einspanner", "ube matcha latte", "yuzu matcha tonic"];
export function eventDrinks(e) {
  const specs = [], seen = new Set();
  for (const m of (Array.isArray(e.menu) ? e.menu : [])) { const s = specFromText(m); if (s && !seen.has(s.name)) { seen.add(s.name); specs.push(s); } }
  specs.sort((a, b) => (a.kind === "drink" ? 0 : 1) - (b.kind === "drink" ? 0 : 1));
  if (!specs.length) specs.push(specFromText(FALLBACK_DRINKS[hash(e.brand || e.id) % 2 ? 0 : hash(e.id) % FALLBACK_DRINKS.length]));
  return specs.slice(0, 2);
}
const TINTS = [["#F4F8EA", "#DCEBC9", "#BFDDA9"], ["#FFF1F4", "#F9D5DF", "#F6B7C7"], ["#FFF3E6", "#F8D3B5", "#F8C9A2"]];
export function drawEventArt(e, opts = {}) {
  const h = hash(e.brand || e.id), T = TINTS[h % 3], uid = "e" + hash(e.id || e.brand).toString(36), specs = opts.specs || eventDrinks(e), R = rng(h);
  let defs = `<pattern id="${uid}p" width="80" height="80" patternUnits="userSpaceOnUse"><g fill="#F6A3B8" fill-opacity=".3"><ellipse cx="12" cy="14" rx="4" ry="2.2" transform="rotate(-35 12 14)"/><ellipse cx="58" cy="52" rx="4" ry="2.2" transform="rotate(40 58 52)"/></g><g fill="#8CBF7A" fill-opacity=".3"><circle cx="46" cy="14" r="1.6"/><circle cx="22" cy="58" r="1.6"/></g></pattern>`;
  let s = el("rect", { x: 3, y: 3, width: 634, height: 394, rx: 26, fill: T[0], class: "art-bg" }) + el("rect", { x: 3, y: 3, width: 634, height: 394, rx: 26, fill: `url(#${uid}p)` });
  s += el("ellipse", { cx: 400, cy: 236, rx: 200, ry: 150, fill: T[1] }) + P(D(["M", 3, 330, "Q", 160, 300, 320, 326, "T", 637, 318, "L", 637, 371, "Q", 637, 397, 611, 397, "L", 29, 397, "Q", 3, 397, 3, 371, "Z"]), { fill: T[2], opacity: 0.7 });
  // Scale each piece to the room it has: tall drinks by height, plates and bowls by width.
  const WIDE = { plate: 184, bowl: 150, kakigori: 136, mug: 150, coupe: 124, short: 132, scoop: 110 };
  const place = specs.length > 1 ? [[344, 1.18, 170], [512, 1.02, 156]] : [[430, 1.6, 300]];
  specs.forEach((sp, i) => {
    const b = drinkBody(sp, uid + "d" + i), [x, k, room] = place[i], sc = Math.min(k, 270 / b.h, room / (WIDE[sp.vessel] || 120));
    defs += b.defs;
    s += el("ellipse", { cx: x, cy: 352, rx: 70 * sc, ry: 10, fill: INK, opacity: 0.12 }) + `<g transform="translate(${x} 350) rotate(${n(sp.tilt * 0.8)}) scale(${n(sc * 100) / 100})">${b.s}</g>`;
  });
  const pose = opts.pose || ["m-happy", "m-excited", "m-wave", "m-point"][h % 4];
  s += el("ellipse", { cx: 144, cy: 356, rx: 70, ry: 10, fill: INK, opacity: 0.12 }) + char(pose, 44, 170, 200, opts);
  s += petal(600, 40, 10, 25) + petal(570, 70, 7, -20) + petal(250, 120, 6, 40) + sparkle(600, 120, 12, WHITE) + sparkle(256, 60, 9, WHITE) + sparkle(64, 120, 8, WHITE);
  if (opts.label !== false) s += sticker(e.brand || "Matcha pop-up", 190, 92, 40, -4 + (h % 5) - 2, CREAM, 330);
  s += el("rect", { x: 3, y: 3, width: 634, height: 394, rx: 26, fill: "none", stroke: INK, "stroke-width": 5 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400" class="art-event" role="img" aria-label="${esc(e.brand || "Matcha pop-up")}" font-family="${FONT}"><title>${esc(e.brand || "Matcha pop-up")}</title><defs>${defs}</defs>${s}</svg>`;
}

// The test menu: every look the illustrator should get right (gallery and tests).
export const TEST_DRINKS = ["strawberry matcha", "ube matcha", "hojicha latte", "matcha einspanner", "iced matcha with boba", "matcha lemonade",
  "matcha affogato", "yuzu matcha tonic", "black sesame matcha", "matcha soft serve", "matcha tiramisu", "matcha latte"];
