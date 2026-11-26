// npm run weekend: shareable "This weekend in <City>" pages, one per city with a pop-up between the coming Friday and Sunday
// (the next weekend once Sunday evening has passed): site/weekend/<city>-<st>/index.html and site/weekend/index.html.
// Also renders the per-city link-preview images (site/og/weekend-<city>-<st>.png and site/og/city-<city>-<st>.png) with
// tools/gen-og.js. Runs at the end of `npm run ingest`, after pages and feeds.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { esc, ldScript, eventLd, isUpcoming, isApprox, timeText, dayLabel, dayKey, brandNameOf, eventHandle, makeCityLocator, cityPath, loadCities, eventArtSizes, weekendWindow, inWindow, windowText, addDays, SUNDAY_CUTOFF_HOUR } from "./gen-pages.js";
export { weekendWindow, inWindow, windowText, addDays, SUNDAY_CUTOFF_HOUR }; // the window rule lives in gen-pages.js (city pages link here too)
import { cityCardHtml, renderCards, MAX_OG_BYTES } from "./gen-og.js";
import { drinkLookup, drinkSlug, drinkName, slugify } from "../site/search.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSP = "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; font-src 'self'; img-src 'self' https: data:; connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; form-action 'none'";
// ---- the window: weekendWindow, inWindow, windowText live in gen-pages.js ----
const plural = (n) => `${n} matcha pop-up${n === 1 ? "" : "s"}`;
const keyOf = (c, e) => (c ? `${c.slug}-${c.state.toLowerCase()}` : e.city && e.state ? `${slugify(e.city)}-${e.state.toLowerCase()}` : null);

// ---- html ----
function head({ title, desc, canonical, img, ld, noindex = false }) {
  return `<!doctype html>
<html lang="en" class="pg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)} | Matcha Map</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex, follow">\n' : ""}<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#FBF6EA">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Matcha Map">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<script src="/theme.js"></script>
<link rel="preload" href="/fonts/mplus-rounded-1c-latin-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/mplus-rounded-1c-latin-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/pages.css">
<link rel="stylesheet" href="/weekend.css">
${ld.map(ldScript).join("\n")}
</head>
<body class="pg">
<header class="pg-top"><a class="pg-home" href="/"><svg class="pg-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-base"/></svg><span>Matcha Map</span></a><a class="pg-map" href="/">Open the map</a></header>
<main class="pg-main">
`;
}
const FOOT = `</main>
<footer class="pg-foot"><p>Matcha Map is a free map of matcha pop-ups across America. Map data © OpenStreetMap contributors.</p></footer>
</body>
</html>
`;

function card(it, ctx) {
  const { e } = it;
  const place = isApprox(e) || !e.venue ? "Place not posted yet" : e.venue + (e.address ? ` · ${e.address}` : "");
  let pic = "";
  if (e.image && e.image.local && ctx.hasFile(`site/${e.image.local}`)) pic = `/${e.image.local}`;
  else if (ctx.hasArt(e.id)) pic = `/art/events/${e.id}.svg`;
  const chips = [];
  const seen = new Set();
  for (const m of e.menu || []) {
    const s = drinkSlug(m, ctx.lookup);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const has = !!(ctx.art && ctx.art.drinks && ctx.art.drinks[s]);
    chips.push(`<li class="wk-chip">${has ? `<img src="/art/drinks/${esc(s)}.svg" alt="" width="28" height="34" loading="lazy">` : ""}<span>${esc(has ? drinkName(s, ctx.art) : m)}</span></li>`);
    if (chips.length >= 6) break;
  }
  const brandHead = it.handle ? `<a href="/brand/${esc(it.handle)}/">${esc(it.brand)}</a>` : esc(it.brand);
  const same = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]/g, "") === String(b).toLowerCase().replace(/[^a-z0-9]/g, "");
  const evTitle = e.title && !same(e.title, it.brand) ? `<p class="wk-title">${esc(e.title)}</p>` : "";
  const note = e.confidence === "unsure" ? `<p class="wk-note">Read from a post, not confirmed. Check the post before you go.</p>` : "";
  return `<li class="wk-ev">${pic ? `<img class="wk-pic" src="${esc(pic)}" alt="" width="96" height="96" loading="lazy">` : `<svg class="wk-pic wk-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-base"/></svg>`}
<div class="wk-b"><p class="wk-when">${esc(timeText(e, ctx.tz))}</p><h3>${brandHead}</h3>${evTitle}<p class="wk-where">${esc(place)}</p>
${chips.length ? `<ul class="wk-chips">${chips.join("")}</ul>` : ""}${note}
<p class="wk-links"><a href="/e/${esc(e.id)}/">Details</a><a href="/?event=${encodeURIComponent(e.id)}">On the map</a></p></div></li>`;
}

export function cityPage(c, list, win, ctx) {
  const key = c.key;
  const label = `${c.name}, ${c.state}`;
  const n = list.length;
  const title = `This weekend in ${c.name}: ${plural(n)}`;
  const brands = [...new Set(list.map((x) => x.brand))];
  const desc = `${plural(n)} in ${label}, ${windowText(win.keys)}: ${brands.slice(0, 3).join(", ")}${brands.length > 3 ? " and more" : ""}. Times, places and menus.`.slice(0, 200);
  const canonical = `${SITE_URL}/weekend/${key}/`;
  const img = ctx.hasOg(`weekend-${key}.png`) ? `${SITE_URL}/og/weekend-${key}.png` : `${SITE_URL}/og.png`;
  const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Matcha Map", item: SITE_URL + "/" },
    { "@type": "ListItem", position: 2, name: "This weekend", item: SITE_URL + "/weekend/" },
    { "@type": "ListItem", position: 3, name: label, item: canonical }] }];
  for (const it of list) ld.push({ "@context": "https://schema.org", ...eventLd(it.e, { brand: it.brand, insta: it.insta, website: it.website, brandPage: it.handle ? `${SITE_URL}/brand/${it.handle}/` : "", art: ctx.hasArt }), url: `${SITE_URL}/e/${it.e.id}/` });
  let body = `<nav class="pg-crumb" aria-label="Breadcrumb"><a href="/">Matcha Map</a> <span aria-hidden="true">›</span> <a href="/weekend/">This weekend</a> <span aria-hidden="true">›</span> <span>${esc(label)}</span></nav>
<h1>${esc(title)}</h1>
<p class="pg-lead">${esc(windowText(win.keys))}, ${esc(label)}.</p>
<p class="wk-actions"><a class="pg-btn" href="/?city=${esc(key)}">See ${esc(c.name)} on the map</a><a class="pg-btn" href="/feeds/${esc(key)}.ics">Add to calendar</a><a class="pg-btn" href="/add/">Know one we missed?</a></p>
`;
  let last = "";
  for (const it of list) {
    const k = dayKey(Date.parse(it.e.start), it.e.tz || c.tz);
    const day = win.keys.includes(k) ? k : win.keys[0];
    if (day !== last) { body += `${last ? "</ul>\n" : ""}<h2 class="wk-day">${esc(dayLabel(day))}</h2>\n<ul class="pg-list wk-list">\n`; last = day; }
    body += card(it, { ...ctx, tz: c.tz }) + "\n";
  }
  body += `</ul>
<p class="pg-sub wk-more"><a href="/${cityPath(c)}">All upcoming pop-ups in ${esc(c.name)}</a> · <a href="/weekend/">Other cities this weekend</a></p>
<section class="pg-how"><h2>About this page</h2><p>Pop-ups are read from what brands post publicly, so check the post or the brand before you go. Dates and places can change.</p></section>
`;
  return head({ title, desc, canonical, img, ld }) + body + FOOT;
}

// A city that has pop-ups coming up, just none between this Friday and Sunday: say so kindly and point on (noindex, not in the sitemap).
export function emptyCityPage(c, win, ctx) {
  const key = c.key, label = `${c.name}, ${c.state}`;
  const title = `This weekend in ${c.name}: nothing posted yet`;
  const desc = `No matcha pop-ups posted in ${label} for ${windowText(win.keys)} yet. Brands post a few days ahead.`;
  const canonical = `${SITE_URL}/weekend/${key}/`;
  const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Matcha Map", item: SITE_URL + "/" },
    { "@type": "ListItem", position: 2, name: "This weekend", item: SITE_URL + "/weekend/" },
    { "@type": "ListItem", position: 3, name: label, item: canonical }] }];
  const body = `<nav class="pg-crumb" aria-label="Breadcrumb"><a href="/">Matcha Map</a> <span aria-hidden="true">›</span> <a href="/weekend/">This weekend</a> <span aria-hidden="true">›</span> <span>${esc(label)}</span></nav>
<h1>${esc(title)}</h1>
<p class="pg-lead">${esc(windowText(win.keys))}, ${esc(label)}.</p>
<p class="wk-empty">Nothing is posted for ${esc(c.name)} this weekend yet. Brands usually post a few days ahead, so check back midweek. Know one? Add it and everyone here will see it.</p>
<p class="wk-actions"><a class="pg-btn" href="/add/">Add your pop-up</a>${ctx.hasFeed(key) ? `<a class="pg-btn" href="/feeds/${esc(key)}.ics">${esc(c.name)} calendar feed</a>` : ""}<a class="pg-btn" href="/${cityPath(c)}">All upcoming in ${esc(c.name)}</a></p>
<p class="pg-sub wk-more"><a href="/?city=${esc(key)}">See ${esc(c.name)} on the map</a> · <a href="/weekend/">Other cities this weekend</a></p>
`;
  return head({ title, desc, canonical, img: `${SITE_URL}/og.png`, ld, noindex: true }) + body + FOOT;
}

export function indexPage(rows, win, ctx) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  const title = rows.length ? `This weekend: ${plural(total)} in ${rows.length} ${rows.length === 1 ? "city" : "cities"}` : "This weekend: matcha pop-ups";
  const desc = rows.length ? `Matcha pop-ups this weekend (${windowText(win.keys)}), by city: ${rows.slice(0, 4).map((r) => r.name).join(", ")}${rows.length > 4 ? " and more" : ""}.` : "Matcha pop-ups this weekend, by city.";
  const canonical = `${SITE_URL}/weekend/`;
  const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Matcha Map", item: SITE_URL + "/" },
    { "@type": "ListItem", position: 2, name: "This weekend", item: canonical }] }];
  let body = `<nav class="pg-crumb" aria-label="Breadcrumb"><a href="/">Matcha Map</a> <span aria-hidden="true">›</span> <span>This weekend</span></nav>
<h1>${esc(title)}</h1>
<p class="pg-lead">${esc(windowText(win.keys))}. Pick a city.</p>
`;
  if (rows.length) body += `<ul class="pg-chips wk-cities">\n${rows.map((r) => `<li><a href="/weekend/${esc(r.key)}/">${esc(r.name)}, ${esc(r.state)}</a> <span class="pg-dim">${r.n}</span></li>`).join("\n")}\n</ul>\n`;
  else body += `<p class="wk-empty">Nothing is posted for this weekend yet. Brands usually post a few days ahead, so check back midweek, or add one you know about.</p>\n`;
  body += `<p class="pg-sub"><a class="pg-btn" href="/">Open the map</a> <a class="pg-btn" href="/add/">Add your pop-up</a></p>\n`;
  return head({ title, desc, canonical, img: `${SITE_URL}/og.png`, ld }) + body + FOOT;
}

// ---- the build ----
export function buildWeekend({ events, cities = [], sources = [], art = null, now = new Date(), hasArt = () => false, hasFile = () => false, hasOg = () => false, hasFeed = () => false }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const locate = makeCityLocator(cities);
  const lookup = drinkLookup(art);
  const byCity = new Map(), upByCity = new Map();
  for (const e of events) {
    if (!e.id || !isUpcoming(e, nowMs)) continue;
    const c = locate(e);
    const key = keyOf(c, e);
    if (!key) continue;
    const city = c ? { ...c, key } : { key, name: e.city, state: e.state, slug: slugify(e.city), tz: e.tz || "America/New_York" };
    const s = srcById.get(e.source_id);
    const info = { e, brand: brandNameOf(e, srcById), handle: eventHandle(e, srcById), insta: s && s.instagram ? `https://www.instagram.com/${String(s.instagram).replace(/^@/, "")}/` : "", website: s && s.website ? s.website : "" };
    if (!upByCity.has(key)) upByCity.set(key, { city, n: 0 });
    upByCity.get(key).n++;
    const win = weekendWindow(nowMs, city.tz);
    if (!inWindow(e, win.keys, city.tz)) continue;
    if (!byCity.has(key)) byCity.set(key, { city, win, list: [] });
    byCity.get(key).list.push(info);
  }
  const ctx = { hasArt, hasFile, hasOg, hasFeed, lookup, art };
  const files = new Map(), rows = [], ogJobs = [];
  for (const [key, v] of byCity) {
    v.list.sort((a, b) => Date.parse(a.e.start) - Date.parse(b.e.start) || (a.e.id < b.e.id ? -1 : 1));
    files.set(`weekend/${key}/index.html`, cityPage(v.city, v.list, v.win, ctx));
    rows.push({ key, name: v.city.name, state: v.city.state, n: v.list.length });
    ogJobs.push({ out: `og/weekend-${key}.png`, tag: "This weekend", city: v.city.name, line: plural(v.list.length) });
  }
  for (const [key, v] of upByCity) if (!byCity.has(key)) files.set(`weekend/${key}/index.html`, emptyCityPage(v.city, weekendWindow(nowMs, v.city.tz), ctx));
  rows.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
  const first = byCity.size ? byCity.get(rows[0].key).win : weekendWindow(nowMs);
  files.set("weekend/index.html", indexPage(rows, first, ctx));
  for (const [key, v] of upByCity) ogJobs.push({ out: `og/city-${key}.png`, tag: v.city.state, city: v.city.name, line: `${plural(v.n)} coming up` });
  return { files, rows, ogJobs, window: first, counts: { cities: byCity.size, events: rows.reduce((a, r) => a + r.n, 0) } };
}

// Render only the cards that changed (hash sidecar), keep each under MAX_OG_BYTES.
export async function renderOg(jobs, { root = ROOT } = {}) {
  const site = path.join(root, "site");
  const sideFile = path.join(site, "og", ".cards.json");
  let side = {};
  try { side = JSON.parse(fs.readFileSync(sideFile, "utf8")); } catch { /* first run */ }
  const todo = [];
  const next = {};
  for (const j of jobs) {
    const h = crypto.createHash("sha1").update([j.tag, j.city, j.line].join("|")).digest("hex").slice(0, 12);
    next[j.out] = h;
    if (side[j.out] !== h || !fs.existsSync(path.join(site, j.out))) todo.push({ ...j, h, html: cityCardHtml({ tag: j.tag, city: j.city, line: j.line, root }), file: path.join(site, j.out) });
  }
  const written = await renderCards(todo.map((j) => ({ html: j.html, out: j.file })));
  let big = 0;
  for (const f of written) if (fs.statSync(f).size > MAX_OG_BYTES) { big++; fs.rmSync(f); }
  const ok = new Set(written.filter((f) => fs.existsSync(f)));
  for (const j of todo) if (!ok.has(j.file)) delete next[j.out];
  // drop cards no job asks for any more
  const dir = path.join(site, "og");
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/^(weekend|city)-.*\.png$/.test(f) && !next["og/" + f]) fs.rmSync(path.join(dir, f));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sideFile, JSON.stringify(next, null, 1) + "\n");
  return { rendered: ok.size, skipped: jobs.length - todo.length, tooBig: big };
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const site = path.join(root, "site");
  const ev = read("site/data/events.json");
  const art = fs.existsSync(path.join(site, "art", "index.json")) ? read("site/art/index.json") : null;
  const arts = eventArtSizes(path.join(site, "art", "events"));
  const out = buildWeekend({
    events: ev.events, cities: loadCities(root), sources: read("data/sources.json"), art, now,
    hasArt: (id) => arts.get(id) || false,
    hasFile: (p) => fs.existsSync(path.join(root, p)),
    hasOg: (n) => fs.existsSync(path.join(site, "og", n)),
    hasFeed: (k) => fs.existsSync(path.join(site, "feeds", `${k}.ics`)),
  });
  fs.rmSync(path.join(site, "weekend"), { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(site, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return out;
}

// Pages, then the cards, then the pages again so their og:image points at the cards that now exist.
export async function generate({ root = ROOT, now = new Date(), og = true } = {}) {
  const out = run({ root, now });
  let cards = null;
  if (og) { cards = await renderOg(out.ogJobs, { root }); run({ root, now }); }
  return { ...out, cards };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = await generate({ og: !(process.argv.includes("--no-og") || process.env.NO_OG) });
  if (o.cards) console.log(`og cards: ${o.cards.rendered} rendered, ${o.cards.skipped} unchanged${o.cards.tooBig ? `, ${o.cards.tooBig} over 150 KB dropped` : ""}`);
  console.log(`weekend: ${o.counts.cities} city pages, ${o.counts.events} pop-ups, ${windowText(o.window.keys)}`);
}
