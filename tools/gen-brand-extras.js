// npm run brand-extras: per brand, a small JSON fragment at site/brand/<handle>/extra.json with the upcoming dates, the
// distinct drinks (with art paths), the price range and a one-line story. site/brand-extras.js renders it on the brand page.
// Only brands whose page exists (site/brand/<handle>/index.html) and that have something to show get a fragment.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isUpcoming, handleSlug, eventHandle, dayKey, dayLabel, timeText, isApprox } from "./gen-pages.js";
import { drinkLookup, drinkSlug, drinkName } from "../site/search.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// "$7", "$6-9", "from $5" -> numbers; "free" -> 0. Returns { min, max, text } or null.
export function priceRange(prices) {
  const nums = [];
  for (const p of prices) {
    const t = String(p || "");
    if (/^\s*free\s*$/i.test(t)) { nums.push(0); continue; }
    for (const m of t.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)) nums.push(Number(m[1]));
    const tail = /\$\s*\d+(?:\.\d+)?\s*[-–]\s*(\d+(?:\.\d+)?)/.exec(t);
    if (tail) nums.push(Number(tail[1]));
  }
  if (!nums.length) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const f = (n) => (n === 0 ? "Free" : "$" + (Number.isInteger(n) ? n : n.toFixed(2)));
  return { min, max, text: min === max ? f(min) : `${f(min)} to ${f(max)}` };
}

export function buildExtras({ events, sources = [], brands = [], art = null, now = new Date(), hasPage = () => true }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const lookup = drinkLookup(art);
  const bio = new Map((brands || []).filter((b) => b.bio).map((b) => [String(b.handle).toLowerCase(), b.bio]));
  const by = new Map();
  for (const e of events) {
    const slug = eventHandle(e, srcById);
    if (!slug) continue;
    if (!by.has(slug)) by.set(slug, []);
    by.get(slug).push(e);
  }
  const out = new Map();
  for (const [slug, list] of by) {
    if (!hasPage(slug)) continue;
    const ups = list.filter((e) => isUpcoming(e, nowMs)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const drinks = new Map(), prices = [];
    for (const e of list) {
      if (e.price) prices.push(e.price);
      for (const m of e.menu || []) {
        const s = drinkSlug(m, lookup);
        if (!s || drinks.has(s)) continue;
        const has = !!(art && art.drinks && art.drinks[s]);
        drinks.set(s, { slug: s, name: has ? drinkName(s, art) : m, art: has ? `/art/drinks/${s}.svg` : null });
      }
    }
    const src = [...srcById.values()].find((s) => handleSlug(s.instagram, s.id) === slug);
    const story = String(bio.get(slug) || (src && src.kind_note) || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!ups.length && !drinks.size && !story) continue;
    out.set(slug, {
      v: 1, brand: slug,
      upcoming: ups.slice(0, 12).map((e) => ({
        id: e.id, day: dayLabel(dayKey(Date.parse(e.start), e.tz)), time: timeText(e, e.tz),
        place: isApprox(e) || !e.venue ? [e.city, e.state].filter(Boolean).join(", ") : [e.venue, e.city].filter(Boolean).join(", "),
        url: `/e/${e.id}/`, map: `/?event=${e.id}`,
      })),
      drinks: [...drinks.values()].slice(0, 16),
      price: priceRange(prices),
      story,
    });
  }
  return out;
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const site = path.join(root, "site");
  const ev = read("site/data/events.json");
  const art = fs.existsSync(path.join(site, "art", "index.json")) ? read("site/art/index.json") : null;
  const brands = fs.existsSync(path.join(site, "data", "brands.json")) ? read("site/data/brands.json").brands : [];
  const out = buildExtras({ events: ev.events, sources: read("data/sources.json"), brands, art, now,
    hasPage: (slug) => fs.existsSync(path.join(site, "brand", slug, "index.html")) });
  // clear stale fragments, then write
  const bdir = path.join(site, "brand");
  if (fs.existsSync(bdir)) for (const d of fs.readdirSync(bdir)) { const f = path.join(bdir, d, "extra.json"); if (fs.existsSync(f) && !out.has(d)) fs.rmSync(f); }
  for (const [slug, x] of out) fs.writeFileSync(path.join(bdir, slug, "extra.json"), JSON.stringify(x));
  return { count: out.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`brand extras: ${run().count} fragments`);
}
