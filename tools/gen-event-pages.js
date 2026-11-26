// npm run event-pages: one tiny page per upcoming pop-up at site/e/<event-id>/index.html, so a shared link has its own
// title, description and preview image, and the full card from site/cards.js rendered server-side (verdict, picture,
// drinks, hours, place, calendar and share, posts, brand story, also nearby), so the link works with no JavaScript. A
// button opens the pop-up on the map (/?event=<id>). Runs at the end of `npm run ingest`, after pages.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { cardHtml } from "../site/cards.js";
import { esc, shortDayOf, makeCityLocator, cityPath, ldScript, eventLd, isUpcoming, isApprox, timeText, dayLabel, dayKey, brandNameOf, eventHandle, eventArtSizes, newestDay } from "./gen-pages.js";
import { patchState, updateRegistry, writeRedirects, dirsWithIndex, hash12, hashInput } from "./seo-lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSP = "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; img-src 'self' https: data:; style-src 'self'; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; form-action 'none'";

// og:image: the event's photo, else site/art/events/<id>.svg when it exists, else the shared card.
export function ogImage(e, { hasArt = () => false } = {}) {
  if (e.image && e.image.local) return `${SITE_URL}/${e.image.local}`;
  if (e.image && /^https?:\/\//.test(e.image.url || "")) return e.image.url;
  if (/^https?:\/\//.test(e.image_url || "")) return e.image_url;
  if (hasArt(e.id)) return `${SITE_URL}/art/events/${e.id}.svg`;
  return `${SITE_URL}/og.png`;
}

// card: extra context for cardHtml ({ art, brands, events, now }); base, page layout and links are set here.
// tag: { title, desc } suffixes for the rare pop-up whose title or description another page repeats (docs/SEO-RULES.md, rule 4).
export function eventTitle(e, sources = new Map()) {
  const place = [e.city, e.state].filter(Boolean).join(", ");
  return `${brandNameOf(e, sources)} matcha pop-up, ${shortDayOf(e, e.tz || "America/New_York")}, ${e.city || place}`;
}
export function eventPage(e, { sources = new Map(), hasArt = () => false, card = {}, tag = {} } = {}) {
  const brand = brandNameOf(e, sources);
  const place = [e.city, e.state].filter(Boolean).join(", ");
  const day = dayLabel(dayKey(Date.parse(e.start), e.tz || "America/New_York"));
  const time = timeText(e, e.tz);
  const title = eventTitle(e, sources) + (tag.title || "");
  const where = isApprox(e) ? `${place} (place not posted yet)` : [e.venue, e.address, place].filter(Boolean).join(", ");
  const bits = [`${day}, ${e.all_day ? "all day" : time}`, where];
  if (e.menu && e.menu.length) bits.push(`Menu: ${e.menu.slice(0, 5).join(", ")}`);
  if (e.price) bits.push(`Price: ${e.price}`);
  const desc = bits.join(". ").slice(0, 280) + (tag.desc || "");
  const canonical = `${SITE_URL}/e/${e.id}/`;
  const img = ogImage(e, { hasArt });
  const s = sources.get(e.source_id) || {};
  const handle = eventHandle(e, sources);
  const site = /^https?:\/\//i.test(s.website || "") ? s.website : "";
  const ld = { "@context": "https://schema.org", ...eventLd(e, { brand, insta: e.handle ? `https://www.instagram.com/${e.handle}/` : s.instagram ? `https://www.instagram.com/${String(s.instagram).replace(/^@/, "")}/` : "", website: site, brandPage: handle && card.brandHref && card.brandHref(handle) ? `${SITE_URL}/brand/${handle}/` : "", art: hasArt }), url: canonical };
  const go = `/?event=${e.id}`;
  return `<!doctype html>
<html lang="en" class="pg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)} | Matcha Map</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Matcha Map">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<script src="/theme.js"></script>
<link rel="preload" href="/fonts/mplus-rounded-1c-latin-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/mplus-rounded-1c-latin-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/pages.css">
<link rel="stylesheet" href="/cards.css">
${ldScript(ld)}
</head>
<body class="pg">
<header class="pg-top"><a class="pg-home" href="/"><svg class="pg-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-base"/></svg><span>Matcha Map</span></a><a class="pg-map" href="${go}">See it on the map</a></header>
<main class="pg-main pg-card">
<h1 class="pg-sr">${esc(title)}</h1>
${cardHtml(e, { ...card, sources: card.sources || [...sources.values()], base: "/", page: true, absolute: true, eventHref: (id) => `/e/${id}/` })}
</main>
<script type="module" src="/cards-page.js"></script>
</body>
</html>
`;
}

// known: { cities: Set of "st/slug" for city pages that exist, brands: Set of handles with a brand page, locate(e) -> city or null }
export function buildEventPages({ events, sources = [], now = new Date(), hasArt = () => false, art = null, brands = null, known = null, prev = {}, cap = "" }) {
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const card = { now, art, brands, sources, events: events.filter((e) => isUpcoming(e, now.getTime())) };
  if (known) {
    card.cityHref = (e) => { const c = known.locate && known.locate(e); return c && known.cities.has(`${c.state.toLowerCase()}/${c.slug}`) ? { href: "/" + cityPath(c), name: c.name } : ""; };
    card.brandHref = (h) => (known.brands.has(h) ? `/brand/${h}/` : "");
  }
  const files = new Map(), stamps = {}, registry = {};
  const listed = events.filter((e) => e.id && /^[a-z0-9]{6,32}$/i.test(e.id) && isUpcoming(e, now.getTime()));
  // titles and descriptions must be unique across pages: a repeat gets the venue, the time or the id's first six letters
  const bump = (list, base, tags) => {
    const seen = new Map();
    for (const e of list) { const k = base(e); seen.set(k, (seen.get(k) || 0) + 1); }
    const used = new Set(), out = new Map();
    for (const e of list) {
      let t = "";
      if (seen.get(base(e)) > 1) for (const cand of tags(e)) if (cand && !used.has(base(e) + cand)) { t = cand; break; }
      used.add(base(e) + t);
      out.set(e.id, t);
    }
    return out;
  };
  const tTitle = bump(listed, (e) => eventTitle(e, srcById), (e) => [e.venue ? ` at ${e.venue}` : "", ` (${timeText(e, e.tz)})`, ` (${e.id.slice(-6)})`]);
  const descOf = (e) => eventPage(e, { sources: srcById, hasArt, card, tag: { title: tTitle.get(e.id) } }).match(/<meta name="description" content="([^"]*)"/)[1];
  const tDesc = bump(listed, descOf, (e) => [`. Ref ${e.id.slice(-6)}`]);
  for (const e of listed) {
    const html = eventPage(e, { sources: srcById, hasArt, card, tag: { title: tTitle.get(e.id), desc: tDesc.get(e.id) } });
    const key = `e/${e.id}`, h = hash12(hashInput(html)), p = prev[key], computed = newestDay([e], cap || now.toISOString().slice(0, 10));
    stamps[key] = [h, p && p[0] === h ? p[1] : p && p[1] > computed ? p[1] : computed];
    files.set(`e/${e.id}/index.html`, html);
    const c = known && known.locate && known.locate(e);
    registry[e.id] = c && known.cities.has(`${c.state.toLowerCase()}/${c.slug}`) ? `${c.state.toLowerCase()}/${c.slug}` : "";
  }
  return { files, counts: { pages: files.size }, stamps, registry: { events: registry } };
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const ev = read("site/data/events.json");
  const sources = read("data/sources.json");
  const opt = (p) => { try { return read(p); } catch { return null; } };
  const arts = eventArtSizes(path.join(root, "site", "art", "events"));
  const hasArt = (id) => arts.get(id) || false;
  const listDirs = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name) : []);
  const cityDirs = new Set(); for (const st of listDirs(path.join(root, "site", "city"))) for (const sl of listDirs(path.join(root, "site", "city", st))) cityDirs.add(`${st}/${sl}`);
  const known = { cities: cityDirs, brands: new Set(listDirs(path.join(root, "site", "brand"))), locate: makeCityLocator(read("data/cities.json").cities) };
  const prev = opt("data/pages-lastmod.json") || {};
  const site = path.join(root, "site");
  const onDisk = dirsWithIndex(path.join(site, "e")); // published before this run: an event page missing now gets a 301 (rule 3)
  const out = buildEventPages({ events: ev.events, sources, now, hasArt, art: opt("site/art/index.json"), brands: opt("site/data/brands.json"), known, prev, cap: String(ev.generated || "").slice(0, 10) });
  fs.rmSync(path.join(site, "e"), { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(site, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  // the event pages' {hash, lastmod} sit in data/pages-lastmod.json beside the city pages' (gen-pages.js keeps these keys when it rewrites the file)
  const all = Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith("e/")));
  fs.writeFileSync(path.join(root, "data/pages-lastmod.json"), JSON.stringify({ ...all, ...out.stamps }) + "\n");
  writeRedirects(root, patchState(root, (s) => updateRegistry(s, "events", out.registry.events, onDisk)));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`event pages: ${o.counts.pages}`);
}
