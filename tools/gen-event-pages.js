// npm run event-pages: one tiny page per upcoming pop-up at site/e/<event-id>/index.html, so a shared link has its own
// title, description and preview image. The page redirects people to the map card (/?event=<id>) with a meta refresh
// and a plain link; crawlers and link unfurlers read the head. Runs at the end of `npm run ingest`, after pages.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { esc, ldScript, eventLd, isUpcoming, isApprox, timeText, dayLabel, dayKey, brandNameOf } from "./gen-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSP = "default-src 'none'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'self'; form-action 'none'";

// og:image: the event's photo, else site/art/events/<id>.svg when it exists, else the shared card.
export function ogImage(e, { hasArt = () => false } = {}) {
  if (e.image && e.image.local) return `${SITE_URL}/${e.image.local}`;
  if (e.image && /^https?:\/\//.test(e.image.url || "")) return e.image.url;
  if (/^https?:\/\//.test(e.image_url || "")) return e.image_url;
  if (hasArt(e.id)) return `${SITE_URL}/art/events/${e.id}.svg`;
  return `${SITE_URL}/og.png`;
}

export function eventPage(e, { sources = new Map(), hasArt = () => false } = {}) {
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
  if (img.endsWith(".svg") || img.endsWith("/og.png")) { if (!(e.image && (e.image.local || e.image.url)) && !e.image_url) delete ld.image; }
  const go = `/?event=${e.id}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta http-equiv="refresh" content="0;url=${go}">
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
${ldScript(ld)}
</head>
<body style="font:500 17px/1.5 ui-rounded,'M PLUS Rounded 1c',sans-serif;background:#FBF6EA;color:#3B2E27;margin:0;padding:32px 20px;max-width:560px">
<h1 style="font-size:24px;margin:0 0 8px">${esc(brand)}</h1>
<p style="margin:0 0 4px"><b>${esc(day)}${e.all_day ? "" : ", " + esc(time)}</b></p>
<p style="margin:0 0 16px">${esc(where)}</p>
<p><a href="${go}" style="color:#3E6B33;font-weight:800">Open this pop-up on the map</a></p>
<p><a href="/feeds/events/${esc(e.id)}.ics" style="color:#3E6B33">Add to calendar</a></p>
</body>
</html>
`;
}

export function buildEventPages({ events, sources = [], now = new Date(), hasArt = () => false }) {
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const files = new Map();
  for (const e of events) {
    if (!e.id || !/^[a-z0-9]{6,32}$/i.test(e.id) || !isUpcoming(e, now.getTime())) continue;
    files.set(`e/${e.id}/index.html`, eventPage(e, { sources: srcById, hasArt }));
  }
  return { files, counts: { pages: files.size } };
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const ev = read("site/data/events.json");
  const sources = read("data/sources.json");
  const hasArt = (id) => fs.existsSync(path.join(root, "site", "art", "events", `${id}.svg`));
  const out = buildEventPages({ events: ev.events, sources, now, hasArt });
  const site = path.join(root, "site");
  fs.rmSync(path.join(site, "e"), { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(site, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`event pages: ${o.counts.pages}`);
}
