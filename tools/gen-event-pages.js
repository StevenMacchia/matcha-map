// npm run event-pages: one tiny page per upcoming pop-up at site/e/<event-id>/index.html, so a shared link has its own
// title, description and preview image, and the full card from site/cards.js rendered server-side (verdict, picture,
// drinks, hours, place, calendar and share, posts, brand story, also nearby), so the link works with no JavaScript. A
// button opens the pop-up on the map (/?event=<id>). Runs at the end of `npm run ingest`, after pages.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { cardHtml } from "../site/cards.js";
import { esc, ldScript, eventLd, isUpcoming, isApprox, timeText, dayLabel, dayKey, brandNameOf } from "./gen-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSP = "default-src 'none'; script-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'self'; form-action 'none'";

// og:image: the event's photo, else site/art/events/<id>.svg when it exists, else the shared card.
export function ogImage(e, { hasArt = () => false } = {}) {
  if (e.image && e.image.local) return `${SITE_URL}/${e.image.local}`;
  if (e.image && /^https?:\/\//.test(e.image.url || "")) return e.image.url;
  if (/^https?:\/\//.test(e.image_url || "")) return e.image_url;
  if (hasArt(e.id)) return `${SITE_URL}/art/events/${e.id}.svg`;
  return `${SITE_URL}/og.png`;
}

// card: extra context for cardHtml ({ art, brands, events, now }); base, page layout and links are set here.
export function eventPage(e, { sources = new Map(), hasArt = () => false, card = {} } = {}) {
  const brand = brandNameOf(e, sources);
  const place = [e.city, e.state].filter(Boolean).join(", ");
  const day = dayLabel(dayKey(Date.parse(e.start), e.tz || "America/New_York"));
  const time = timeText(e, e.tz);
  const title = `${brand} matcha pop-up in ${place}, ${day}`;
  const where = isApprox(e) ? `${place} (place not posted yet)` : [e.venue, e.address, place].filter(Boolean).join(", ");
  const bits = [`${day}${e.all_day ? "" : ", " + time}`, where];
  if (e.menu && e.menu.length) bits.push(`Menu: ${e.menu.slice(0, 5).join(", ")}`);
  if (e.price) bits.push(`Price: ${e.price}`);
  const desc = bits.join(". ").slice(0, 280);
  const canonical = `${SITE_URL}/e/${e.id}/`;
  const img = ogImage(e, { hasArt });
  const ld = { "@context": "https://schema.org", ...eventLd(e, { brand, insta: e.handle ? `https://www.instagram.com/${e.handle}/` : "" }), url: canonical };
  if (img.endsWith("/og.png")) delete ld.image; else ld.image = [img];
  if (typeof ld.description === "string") { ld.description = ld.description.replace(/[*_`#>]+/g, " ").replace(/\s+/g, " ").trim(); if (!ld.description) delete ld.description; }
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap">
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

export function buildEventPages({ events, sources = [], now = new Date(), hasArt = () => false, art = null, brands = null }) {
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const card = { now, art, brands, sources, events: events.filter((e) => isUpcoming(e, now.getTime())) };
  const files = new Map();
  for (const e of events) {
    if (!e.id || !/^[a-z0-9]{6,32}$/i.test(e.id) || !isUpcoming(e, now.getTime())) continue;
    files.set(`e/${e.id}/index.html`, eventPage(e, { sources: srcById, hasArt, card }));
  }
  return { files, counts: { pages: files.size } };
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const ev = read("site/data/events.json");
  const sources = read("data/sources.json");
  const opt = (p) => { try { return read(p); } catch { return null; } };
  const hasArt = (id) => fs.existsSync(path.join(root, "site", "art", "events", `${id}.svg`));
  const out = buildEventPages({ events: ev.events, sources, now, hasArt, art: opt("site/art/index.json"), brands: opt("site/data/brands.json") });
  const site = path.join(root, "site");
  fs.rmSync(path.join(site, "e"), { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(site, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`event pages: ${o.counts.pages}`);
}
