// npm run menus: public drink and food menus of storefronts and shops -> data/menus.json.
// Reads only a brand's own public pages (robots.txt respected, 1 request a second a host, through ingest/lib/fetch.js).
// Every item must come from the page text: a name, a price only when the page shows one, a short note only when the
// page prints a description. A page that is a template placeholder, an image, a PDF or app-rendered stays empty.
//   node ingest/menus.js [--dry] [--only <host>] [--out <file>]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { attachMenus } from "./lib/shops/menus.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const PRICE = /\$\s?\d{1,3}(?:\.\d{1,2})?\+?/;
const isPrice = (l) => /^(?:[A-Z]{1,2}:?\s)?\$\s?\d/.test(l) && l.replace(PRICE, "").replace(/\$\s?\d{1,3}(?:\.\d{1,2})?\+?/g, "").replace(/\b[A-Z]{1,2}\b|[\s/·:-]/g, "") === "";
const clean = (s) => s.replace(/\s+/g, " ").replace(/​|‌/g, "").trim();
const PLACEHOLDER = /this is your (first|second|third|fourth|fifth) item|customize it any way you want|lorem ipsum/i;

export function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h\d|tr|section)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ").replace(/&#8217;|&rsquo;|&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .split("\n").map(clean).filter(Boolean);
}

const priceOf = (l) => { const m = l.match(/(?:[A-Z]{1,2}:?\s)?\$\s?\d{1,3}(?:\.\d{1,2})?\+?(?:\s*(?:[-–/]|to)\s*\$\s?\d{1,3}(?:\.\d{1,2})?)?/g); return m ? clean(m.join(" · ")).replace(/\$\s+/g, "$") : null; };
const item = (name, price, note) => ({ name: clean(name).slice(0, 80), price: price || null, note: note && !/Selection$|^\(/.test(clean(note)) ? clean(note).slice(0, 140) : null });

// "NAME / description lines / $ price": Labora. Names are the last all-caps line before the first lower-case line.
function nameDescPrice(lines, from, to) {
  const out = []; let buf = [];
  for (const l of lines.slice(from, to)) {
    if (isPrice(l)) {
      const caps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();
      const firstLower = buf.findIndex((b) => !caps(b));
      const head = firstLower < 0 ? buf : buf.slice(0, firstLower);
      const name = head[head.length - 1];
      const desc = firstLower < 0 ? "" : buf.slice(firstLower).join(" ");
      if (name) out.push(item(name, priceOf(l), desc));
      buf = [];
    } else buf.push(l);
  }
  return out;
}

// "Name / [one-sentence description ending in a full stop] / $ price": title-case names with section headings between items.
function nameSentencePrice(lines, from, to) {
  const out = []; let buf = [];
  for (const l of lines.slice(from, to)) {
    if (isPrice(l)) {
      const last = buf[buf.length - 1];
      const hasDesc = buf.length >= 2 && /[.!]$/.test(last);
      const name = hasDesc ? buf[buf.length - 2] : last;
      if (name && name.length <= 70 && !/[.!]$/.test(name)) out.push(item(name, priceOf(l), hasDesc ? last : ""));
      buf = [];
    } else buf.push(l);
  }
  return out;
}

// "$ p / name / [desc] / $ p": the price is printed before and after each item (Squarespace menu blocks).
function priceBracket(lines, from, to) {
  const out = []; const seen = new Set(); let i = from;
  const L = lines.slice(from, to);
  for (i = 0; i < L.length; i++) {
    if (!isPrice(L[i])) continue;
    let j = i + 1; const mid = [];
    while (j < L.length && !isPrice(L[j])) mid.push(L[j++]);
    if (j < L.length && priceOf(L[j]) === priceOf(L[i]) && mid.length >= 1 && mid.length <= 3) {
      const key = mid[0] + priceOf(L[i]);
      if (!seen.has(key)) { seen.add(key); out.push(item(mid[0], priceOf(L[i]), mid.slice(1).join(" "))); }
      i = j;
    }
  }
  return out;
}

// "Name / [hot / cold] / R $a / L $b" or "Name / $p": the name is the last text line before the price run.
function nameThenPrice(lines, from, to, { skip = /^(hot|cold|hot \/ cold|iced|hot or cold)$/i } = {}) {
  const out = []; const seen = new Set(); const L = lines.slice(from, to);
  for (let i = 0; i < L.length; i++) {
    if (!isPrice(L[i])) continue;
    let end = i; const ps = [];
    while (end < L.length && isPrice(L[end])) ps.push(priceOf(L[end++]));
    let k = i - 1; const back = [];
    while (k >= 0 && !isPrice(L[k]) && back.length < 3) { back.unshift(L[k]); k--; }
    const text = back.filter((b) => !skip.test(b));
    const name = text[text.length - 1];
    if (name && name.length <= 70 && !seen.has(name)) { seen.add(name); out.push(item(name, ps.join(" · "), "")); }
    i = end - 1;
  }
  return out;
}

// "Name (430 Cal.) / [$p] / description": Maiko main site. A price printed inside an HTML comment is not public and is dropped.
function namePriceDesc(lines, from, to) {
  const out = []; const L = lines.slice(from, to);
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(.{2,70}?)\s*\(\d[\d-]*\s*Cal\.?\)/i);
    if (!m) continue;
    let j = i + 1; let price = null;
    const ps = [];
    while (L[j] && isPrice(L[j])) ps.push(priceOf(L[j++]));
    if (ps.length) price = ps.join(" · ").replace(/:/g, "");
    const d = L[j] && !/\(\d[\d-]*\s*Cal/i.test(L[j]) && !isPrice(L[j]) && L[j].length < 200 ? L[j] : "";
    out.push(item(m[1], price, d));
  }
  return out;
}

// "Name ($a - $b)" then a description line (Setsugekka).
function inlineRange(lines, from, to) {
  const out = []; const L = lines.slice(from, to);
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(.{3,70}?)\s*\((\$\s?[\d.]+(?:\s*-\s*\$\s?[\d.]+)?)\)\s*$/);
    if (m) out.push(item(m[1], m[2].replace(/\s+/g, "").replace(/-/g, " - "), L[i + 1] && !PRICE.test(L[i + 1]) && !/^\*/.test(L[i + 1]) ? L[i + 1] : ""));
  }
  return out;
}

// JSON-LD Menu > MenuSection > MenuItem blocks.
function jsonLdMenu(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n["@type"] === "MenuItem" && n.name) {
        const o = Array.isArray(n.offers) ? n.offers[0] : n.offers;
        const p = o && o.price ? "$" + Number(o.price).toFixed(2).replace(/\.00$/, "") : null;
        out.push(item(n.name, p, n.description || ""));
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(j);
  }
  return out;
}

const idx = (lines, re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };

// One entry per storefront site. `urls` are tried in order; the first page that yields items is kept.
// The result is keyed by the site's host without "www.": a shop or brand whose website has that host shows the menu.
export const SITES = [
  { host: "laboracafe.com", urls: ["http://www.laboracafe.com/menu"], mode: "nameDescPrice", start: /Labora Cafe drinks menu/i, end: /^(?:Labora App|Join|Find us|LOCATIONS|©)/i },
  { host: "thematchabarx.com", urls: ["https://www.thematchabarx.com/menu"], mode: "priceBracket", start: /^Menu$/, end: /\(816\)/ },
  { host: "setsugekkany.com", urls: ["https://www.setsugekkany.com/menu/"], mode: "inlineRange", start: /^Tax included/i, end: /^(Tea Ceremony|Contact|© )/i },
  { host: "nanasgreentealasvegas.com", urls: ["https://nanasgreentealasvegas.com/menu.html"], mode: "nameThenPrice", start: /^Matcha latte base/i, end: /^(Order Online|©|Catering)/i },
  // The Hawaii store's menu: the page says prices apply to Hawaii only and vary by location, so other stores get the names without prices.
  { host: "matchacafe-maiko.com", urls: ["https://www.matchacafe-maiko.com/eng/menu/"], mode: "namePriceDesc", start: /^Shaved Ice Selection/, end: /^(Copyright|©)/i, stripPrices: true, note: "Main menu of the Hawaii store; items and prices vary by location" },
  { host: "cafemaikoorl.com", urls: ["https://cafemaikoorl.com/menu"], mode: "priceBracket", start: /^OUR MENU/, end: /^(Free Parking|Parking|©)/i },
  { host: "kijitorabrooklyn.com", urls: ["https://www.kijitorabrooklyn.com/menu"], mode: "priceBracket", start: /^MENU$/ },
  { host: "matchaandcreme.com", urls: ["https://www.matchaandcreme.com/"], mode: "nameSentencePrice", start: /^FALL SPECIAL$/, end: /^Our Gallery$/ },
  { host: "cinsei.com", urls: ["https://cinsei.com/"], mode: "jsonld" },
];

export async function readSite(f, site, now = new Date().toISOString().slice(0, 10)) {
  for (const url of site.urls) {
    const r = await f.get(url);
    if (!r.ok) continue;
    if (PLACEHOLDER.test(r.text)) continue;
    let items = [];
    if (site.mode === "jsonld") items = jsonLdMenu(r.text);
    else {
      const lines = toText(r.text);
      const a = site.start ? idx(lines, site.start) : 0;
      if (a < 0) continue;
      let b = site.end ? idx(lines, site.end, a + 1) : -1; if (b < 0) b = lines.length;
      const fn = { nameDescPrice, priceBracket, nameThenPrice, namePriceDesc, inlineRange, nameSentencePrice }[site.mode];
      items = fn(lines, a + 1, b);
    }
    const seen = new Set();
    items = items.filter((x) => x.name && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase())).slice(0, 80);
    if (site.stripPrices) items = items.map((x) => ({ ...x, price: null }));
    if (items.length) return { items, source_url: url, read: now, kind: "html", ...(site.note ? { note: site.note } : {}) };
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = createFetcher({ cacheDir: opt("--cache", ".cache") });
  const out = {};
  for (const site of SITES) {
    if (opt("--only") && site.host !== opt("--only")) continue;
    let m = null;
    try { m = await readSite(f, site); } catch (e) { console.error(site.host, "failed:", e.message); }
    console.log(site.host, m ? m.items.length + " items" : "none");
    if (m) out[site.host] = m;
  }
  // Menus read by eye from a published image or PDF live in data/menus-images.json (each with the image URL and date); never overwritten here.
  const img = fs.existsSync("data/menus-images.json") ? JSON.parse(fs.readFileSync("data/menus-images.json", "utf8")).menus : {};
  for (const [h, m] of Object.entries(img)) if (!out[h]) out[h] = m;
  const file = opt("--out", "data/menus.json");
  if (!flag("--dry")) fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), menus: out }, null, 1) + "\n");
  if (!flag("--dry") && !opt("--out")) {
    // Put the menus on the shop rows now, so a shops run is not needed to see them.
    for (const f of ["data/shops.json", "site/data/shops.json"]) {
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      j.shops = attachMenus(j.shops, out);
      fs.writeFileSync(f, f.startsWith("site/") ? JSON.stringify(j) + "\n" : JSON.stringify(j, null, 1) + "\n");
    }
    fs.writeFileSync("site/data/menus.json", JSON.stringify({ generated: new Date().toISOString(), menus: out }) + "\n");
    const withMenu = JSON.parse(fs.readFileSync("data/shops.json", "utf8")).shops.filter((s) => s.menu).length;
    console.log(withMenu + " shop rows now carry a menu");
  }
  console.log(Object.keys(out).length + " sites, " + Object.values(out).reduce((n, m) => n + m.items.length, 0) + " items");
}
