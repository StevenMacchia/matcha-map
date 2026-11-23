// npm run pages: write the static, indexable layer into site/: one page per city (site/city/<st>/<slug>/), one per brand
// (site/brand/<handle>/), sitemap.xml, robots.txt, and the SEO head of the home page. Runs at the end of `npm run ingest`
// (never from watch). The pages load no map; they link into the app with ?city=, ?event= and ?brand=.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { brandOf as cleanBrand, placeOf } from "../ingest/lib/names.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LIMITS = { files: 20000, bytes: 15 * 1024 * 1024 };
export const NEAR_KM = 25;
export const TOP_CITIES = 100;
const KM_PER_MI = 1.609344;

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const handleSlug = (h, fallback) => String(h || "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "") || String(fallback || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
export const cityPath = (c) => `city/${c.state.toLowerCase()}/${c.slug}/`;
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");
const cityKey = (c) => c.state + "/" + c.slug;

export function km(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ---- time ----
export function dayKey(ms, tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}
const keyDate = (k) => new Date(k + "T12:00:00Z");
const addKey = (k, n) => new Date(keyDate(k).getTime() + n * 864e5).toISOString().slice(0, 10);
export function dayLabel(k) { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(keyDate(k)); }
function clock(ms, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(ms);
  const g = (t) => (p.find((x) => x.type === t) || {}).value || "";
  const period = g("dayPeriod").replace(/\s/g, "");
  return { hour: g("hour"), minute: g("minute"), period, text: g("minute") === "00" ? `${g("hour")} ${period}` : `${g("hour")}:${g("minute")} ${period}`, zero: g("hour") === "12" && g("minute") === "00" && period === "AM" };
}
export function timeText(e, tz) {
  const zone = e.tz || tz;
  const st = Date.parse(e.start);
  if (e.all_day || isNaN(st)) return "All day";
  const a = clock(st, zone);
  if (a.zero) return "Time not posted";
  if (!e.end || isNaN(Date.parse(e.end))) return a.text;
  const b = clock(Date.parse(e.end), zone);
  const left = a.period === b.period ? (a.minute === "00" ? a.hour : `${a.hour}:${a.minute}`) : a.text;
  return `${left}\u2013${b.text}`;
}
// Saturday and Sunday of the current weekend as day keys (the coming one on a weekday; the rest of it on a weekend day).
export function weekendKeys(todayKey) {
  const dow = keyDate(todayKey).getUTCDay();
  if (dow === 0) return [addKey(todayKey, -1), todayKey];
  const sat = addKey(todayKey, 6 - dow);
  return [sat, addKey(sat, 1)];
}

// ---- events ----
export function isUpcoming(e, nowMs) {
  if (e.status === "cancelled") return false;
  const st = Date.parse(e.start);
  if (isNaN(st)) return false;
  const en = e.end && !isNaN(Date.parse(e.end)) ? Date.parse(e.end) : st + (e.all_day ? 864e5 : 3 * 36e5);
  return en >= nowMs;
}
export const isApprox = (e) => e.approx === true || (e.geocode_source === "none" && !e.address);

// The city an event belongs to: the listed city of that name in that state, else the nearest listed city in the state within 25 km.
export function makeCityLocator(cities) {
  const byName = new Map();
  for (const c of cities) byName.set(`${c.state}|${norm(c.name)}`, c);
  return (e) => {
    const hit = byName.get(`${e.state}|${norm(e.city)}`);
    if (hit) return hit;
    if (e.lat == null || e.lng == null || !isFinite(e.lat) || !isFinite(e.lng)) return null;
    let best = null, bd = NEAR_KM;
    for (const c of cities) {
      if (c.state !== e.state) continue;
      const d = km(c, e);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
}

export function eventLink(e) {
  const p = e.posts || {};
  return safeUrl(p.instagram) || safeUrl(p.tiktok) || safeUrl(p.other) || safeUrl(e.source_url);
}
const imgUrl = (e) => (e.image && (e.image.local ? `${SITE_URL}/${e.image.local}` : safeUrl(e.image.url))) || safeUrl(e.image_url) || "";

export function brandNameOf(e, srcById) { return e.brand || (srcById.get(e.source_id) || {}).brand || "A matcha brand"; }
export function eventHandle(e, srcById) {
  const s = srcById.get(e.source_id);
  return handleSlug(e.handle || (s && s.instagram), s && s.id);
}

// ---- JSON-LD ----
const FREE = /^\s*(free|free entry|free admission|no cover|no charge)\s*[.!]?\s*$/i;
export const isFree = (e) => typeof e.price === "string" && FREE.test(e.price);
export function eventLd(e, ctx) {
  const approx = isApprox(e);
  const place = { "@type": "Place", name: approx || !e.venue ? [e.city, e.state].filter(Boolean).join(", ") : e.venue };
  const addr = { "@type": "PostalAddress", addressCountry: "US" };
  if (e.city) addr.addressLocality = e.city;
  if (e.state) addr.addressRegion = e.state;
  if (!approx && e.address) addr.streetAddress = e.address;
  if (!approx && /^\d{5}(-\d{4})?$/.test(String(e.zip || ""))) addr.postalCode = String(e.zip);
  place.address = addr;
  if (!approx && typeof e.lat === "number" && typeof e.lng === "number" && isFinite(e.lat) && isFinite(e.lng)) place.geo = { "@type": "GeoCoordinates", latitude: e.lat, longitude: e.lng };
  const ld = {
    "@type": "Event",
    name: e.title || `${ctx.brand} matcha pop-up`,
    startDate: e.all_day ? String(e.start).slice(0, 10) : e.start,
    eventStatus: e.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: place,
    organizer: { "@type": "Organization", name: ctx.brand },
  };
  if (e.end) ld.endDate = e.all_day ? String(e.end).slice(0, 10) : e.end;
  if (ctx.insta) ld.organizer.url = ctx.insta;
  if (isFree(e)) ld.isAccessibleForFree = true, ld.offers = { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" };
  const im = imgUrl(e);
  if (im) ld.image = [im];
  const d = String(e.description || "").slice(0, 200).trim();
  ld.description = d || `Matcha pop-up by ${ctx.brand}${e.city ? " in " + e.city : ""}.`;
  return ld;
}
// A page's lastmod: the newest day any of its events was seen, capped at the data's own date (never in the future).
export const seenDay = (e) => { const d = String(e.last_seen || e.first_seen || "").slice(0, 10); return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d) ? d : ""; };
export const newestDay = (events, cap) => events.map(seenDay).filter((d) => d && d <= cap).sort().pop() || cap;
export const eventPageId = (e) => (e.id && /^[a-z0-9]{6,32}$/i.test(e.id) ? e.id : "");
export const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

// ---- html ----
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; base-uri 'self'; form-action 'none'; manifest-src 'self'; connect-src 'self'";

// image: a page's own share card (a city card from `npm run weekend`); the site card otherwise.
export function shell({ title, desc, canonical, ld = [], body, image }) {
  const og = image || `${SITE_URL}/og.png`;
  return `<!doctype html>
<html lang="en" class="pg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#FBF6EA">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Matcha Map">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(og)}">
<script src="/theme.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/pages.css">
${ld.map(ldScript).join("\n")}
</head>
<body class="pg">
<header class="pg-top"><a class="pg-home" href="/"><svg class="pg-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-base"/></svg><span>Matcha Map</span></a><a class="pg-map" href="/">Open the map</a></header>
<main class="pg-main">
${body}
</main>
<footer class="pg-foot"><p>Matcha Map is a free map of matcha pop-ups across America. Map data \u00a9 OpenStreetMap contributors.</p></footer>
</body>
</html>
`;
}

const mapLink = (q, text) => `<a class="pg-btn" href="/?${q}">${esc(text || "See on the map")}</a>`;

function eventCard(e, ctx) {
  const place = isApprox(e) || !e.venue ? "Place not posted yet" : e.venue + (e.address ? ` \u00b7 ${e.address}` : "");
  const menu = Array.isArray(e.menu) && e.menu.length ? `<p class="pg-menu">Menu: ${esc(e.menu.slice(0, 8).join(", "))}</p>` : "";
  const link = eventLink(e);
  const note = e.confidence === "unsure" ? `<p class="pg-note">Date read from a post and not confirmed. Check the post before you go.</p>` : "";
  const head = ctx.brandHandle ? `<a href="/brand/${esc(ctx.brandHandle)}/">${esc(ctx.heading)}</a>` : esc(ctx.heading);
  return `<li class="pg-ev">
<h3>${head}</h3>
<p class="pg-when">${ctx.day ? esc(ctx.day) + " \u00b7 " : ""}${esc(timeText(e, ctx.tz))}</p>
<p class="pg-where">${esc(place)}</p>
${menu}${note}
<p class="pg-links">${link ? `<a href="${esc(link)}" rel="noopener">See the post</a>` : ""}${mapLink("event=" + encodeURIComponent(e.id))}</p>
</li>`;
}

function groupByDay(items, tzOf, todayKey) {
  const groups = [];
  for (const it of items) {
    let k = dayKey(Date.parse(it.e.start), it.e.tz || tzOf);
    // No "Today" in a static page: it is wrong after midnight. Weekday and date only; relative words belong to client code.
    const label = k < todayKey ? "Started earlier, still on" : dayLabel(k);
    if (k < todayKey) k = "0";
    const g = groups[groups.length - 1];
    if (g && g.k === k) g.items.push(it); else groups.push({ k, label, items: [it] });
  }
  return groups;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const shortDay = (k) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(keyDate(k)).replace(",", "");
export const shortDayOf = (e, tz) => shortDay(dayKey(Date.parse(e.start), e.tz || tz));
const listJoin = (a) => (a.length < 2 ? a.join("") : a.join(" and "));
export function cityIntro(c, ups, tz) {
  if (!ups.length) return "";
  const brands = [...new Set(ups.map((x) => x.brand))];
  const next = ups[0];
  const where = next.e.venue && !isApprox(next.e) ? " at " + next.e.venue : "";
  return `${plural(ups.length, "matcha pop-up")} ${ups.length === 1 ? "is" : "are"} listed for ${c.name}, ${c.state}, from ${plural(brands.length, "brand")}. The next one is ${next.brand} on ${shortDayOf(next.e, tz)}${where}. Dates come from each brand's own posts, so check the post before you go.`;
}
export function cityDesc(c, ups, tz) {
  const all = [...new Set(ups.map((x) => x.brand))];
  return `${plural(ups.length, "matcha pop-up")} in ${c.name}, ${c.state}, next on ${shortDayOf(ups[0].e, tz)}: ${all.length > 2 ? all.slice(0, 2).join(", ") + " and more" : listJoin(all)}. Times, places and menus.`;
}

export function cityLead(c, wk, m30) {
  if (!m30) return `No matcha pop-ups are posted for ${c.name} right now. Brands usually post a few days ahead, so check back, or open the map to see the nearest ones.`;
  return `${wk ? wk + " this weekend" : "None this weekend"}, ${m30} in the next 30 days.`;
}

// ---- the build ----
// The calendar feed for a city page: its own when npm run feeds wrote one, else every pop-up.
const feedOf = (d, c) => { const k = `${c.slug}-${c.state.toLowerCase()}`; return d.cityFeeds && d.cityFeeds.has(k) ? `/feeds/${k}.ics` : "/feeds/all.ics"; };

export function buildSite(d) {
  const nowMs = d.now instanceof Date ? d.now.getTime() : Date.parse(d.now);
  const cities = d.cities;
  const sources = d.sources || [];
  const shops = (d.shops || []).filter((s) => s.verified && isFinite(s.lat) && isFinite(s.lng) && s.name);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const locate = makeCityLocator(cities);
  const updated = new Date(d.generated || nowMs);
  const lastmod = updated.toISOString().slice(0, 10);
  const updatedText = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(updated);

  // brands: every source plus every named watch-list account
  const brands = new Map();
  for (const s of sources) {
    if (s.active === false) continue;
    const slug = handleSlug(s.instagram, s.id);
    if (!slug || brands.has(slug)) continue;
    brands.set(slug, { slug, name: s.brand, instagram: s.instagram ? handleSlug(s.instagram) : "", tiktok: s.tiktok || "", website: safeUrl(s.website), city: s.home_city || "", state: s.home_state || "", kind: s.kind || "", ids: new Set([s.id]), events: [] });
  }
  for (const a of (d.watchlist && d.watchlist.accounts) || []) {
    if (!a.name || a.status === "dropped" || (a.platform && a.platform !== "instagram")) continue;
    const slug = handleSlug(a.handle);
    if (!slug) continue;
    const b = brands.get(slug);
    if (b) { b.website = b.website || safeUrl(a.website); continue; }
    brands.set(slug, { slug, name: a.name, instagram: slug, tiktok: "", website: safeUrl(a.website), city: "", state: "", kind: "", ids: new Set(a.source_id ? [a.source_id] : []), events: [] });
  }
  const bySource = new Map();
  for (const b of brands.values()) for (const id of b.ids) if (!bySource.has(id)) bySource.set(id, b);
  const brandOf = (e) => brands.get(eventHandle(e, srcById)) || bySource.get(e.source_id);

  // events: upcoming ones by city, all of them by brand
  const byCity = new Map();
  for (const raw of d.events) {
    // Same cleaning as the flyers: a handle is never shown as the brand, and a handle or placeholder venue is blanked.
    const hnd = raw.handle || (srcById.get(raw.source_id) || {}).instagram;
    const e = { ...raw, brand: cleanBrand({ brand: raw.brand, handle: hnd, auto_name: (srcById.get(raw.source_id) || {}).auto_name }), venue: placeOf({ ...raw, handle: hnd }) === raw.venue ? raw.venue : "" };
    const b = brandOf(e);
    const up = isUpcoming(e, nowMs);
    const c = up ? locate(e) : null;
    const info = { e, up, brand: b ? b.name : brandNameOf(e, srcById), handle: b ? b.slug : "", insta: b && b.instagram ? `https://www.instagram.com/${b.instagram}/` : "" };
    if (b) b.events.push(info);
    if (c) { const k = cityKey(c); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(info); }
  }

  // which cities get a page: upcoming events, a brand based there with a pop-up coming, a verified shop within 25 km, or the top 100 by population
  const nearShops = new Map();
  for (const c of cities) {
    const list = [];
    for (const s of shops) { const dd = km(c, s); if (dd <= NEAR_KM) list.push({ s, km: dd }); }
    if (list.length) nearShops.set(cityKey(c), list.sort((a, b) => a.km - b.km));
  }
  const top = new Set([...cities].sort((a, b) => b.pop - a.pop).slice(0, TOP_CITIES).map(cityKey));
  const cityByName = new Map(cities.map((c) => [`${c.state}|${norm(c.name)}`, c]));
  const homeBrands = new Map();
  for (const b of brands.values()) {
    const c = cityByName.get(`${b.state}|${norm(b.city)}`);
    if (!c) continue;
    const k = cityKey(c);
    if (!homeBrands.has(k)) homeBrands.set(k, []);
    homeBrands.get(k).push(b);
  }
  const withBrandPopup = (k) => (homeBrands.get(k) || []).some((b) => b.events.some((x) => x.up));
  const chosen = cities.filter((c) => { const k = cityKey(c); return top.has(k) || byCity.has(k) || nearShops.has(k) || withBrandPopup(k); });

  const files = new Map();
  const urls = [{ loc: SITE_URL + "/" }];
  const nearbyPool = chosen;

  for (const c of chosen) {
    const k = cityKey(c);
    const ups = (byCity.get(k) || []).sort((a, b) => Date.parse(a.e.start) - Date.parse(b.e.start));
    const today = dayKey(nowMs, c.tz), wk = weekendKeys(today);
    const wkN = ups.filter((x) => wk.includes(dayKey(Date.parse(x.e.start), x.e.tz || c.tz))).length;
    const m30 = ups.filter((x) => Date.parse(x.e.start) <= nowMs + 30 * 864e5).length;
    const label = `${c.name}, ${c.state}`;
    const near = nearbyPool.filter((x) => x !== c).map((x) => ({ x, km: km(c, x) })).sort((a, b) => a.km - b.km).slice(0, 6);
    const credited = new Map();
    let body = `<nav class="pg-crumb" aria-label="Breadcrumb"><a href="/">Matcha Map</a> <span aria-hidden="true">\u203a</span> <span>${esc(label)}</span></nav>
<h1>Matcha pop-ups in ${esc(label)}</h1>
<p class="pg-lead">${esc(cityLead(c, wkN, m30))}</p>
${ups.length ? `<p class="pg-intro">${esc(cityIntro(c, ups, c.tz))}</p>
` : ""}<p class="pg-sub">Updated ${esc(updatedText)}. ${mapLink("city=" + c.slug + "-" + c.state.toLowerCase(), "Open " + c.name + " on the map")}</p>
`;
    if (ups.length) {
      body += `<section><h2>Upcoming pop-ups</h2>\n`;
      for (const g of groupByDay(ups, c.tz, today)) {
        body += `<h3 class="pg-day">${esc(g.label)}</h3>\n<ul class="pg-list">\n`;
        for (const it of g.items) {
          credited.set(it.brand, it.handle);
          body += eventCard(it.e, { tz: c.tz, heading: it.brand, brandHandle: it.handle }) + "\n";
        }
        body += `</ul>\n`;
      }
      body += `</section>\n`;
    } else {
      body += `<section><h2>Upcoming pop-ups</h2><p>Nothing is posted for ${esc(c.name)} yet. The map lists pop-ups as brands announce them.</p>` +
        `<p><a class="pg-btn" href="/add/">Add your pop-up</a> <a class="pg-btn" href="${feedOf(d, c)}">Calendar feed of every pop-up</a></p></section>\n`;
    }
    const sh = nearShops.get(k) || [];
    if (sh.length) {
      body += `<section><h2>Matcha shops nearby</h2>\n<ul class="pg-list pg-shops">\n`;
      for (const { s, km: dd } of sh.slice(0, 12)) {
        const w = safeUrl(s.website);
        body += `<li><strong>${w ? `<a href="${esc(w)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</strong> <span class="pg-dim">${Math.round(dd / KM_PER_MI)} mi</span><br>${esc(s.address || "")}</li>\n`;
      }
      body += `</ul></section>\n`;
    }
    const home = homeBrands.get(k) || [];
    if (home.length) {
      body += `<section><h2>Brands based in ${esc(c.name)}</h2>\n<ul class="pg-chips">\n`;
      for (const b of home) { credited.set(b.name, b.slug); body += `<li><a href="/brand/${esc(b.slug)}/">${esc(b.name)}</a>${b.instagram ? ` <a class="pg-dim" href="https://www.instagram.com/${esc(b.instagram)}/" rel="noopener">@${esc(b.instagram)}</a>` : ""}</li>\n`; }
      body += `</ul></section>\n`;
    }
    if (near.length) {
      body += `<section><h2>Nearby cities</h2>\n<ul class="pg-chips">\n${near.map((n) => `<li><a href="/${cityPath(n.x)}">${esc(n.x.name)}, ${esc(n.x.state)}</a> <span class="pg-dim">${Math.round(n.km / KM_PER_MI)} mi</span></li>`).join("\n")}\n</ul></section>\n`;
    }
    body += `<section class="pg-how"><h2>How this map works</h2>
<p>Matcha Map collects pop-ups that brands post publicly, on their own sites, in event listings and on Instagram, matches each one to a day and a place, and puts them on one map. Dates come from those posts, so check the post before you go. When a brand has not said where, the page says so instead of guessing.</p>
${credited.size ? `<p class="pg-credit">Every pop-up belongs to its brand: ${[...credited].map(([n, h]) => (h ? `<a href="/brand/${esc(h)}/">${esc(n)}</a>` : esc(n))).join(", ")}.</p>` : ""}
</section>`;

    const title = ups.length ? `Matcha pop-ups in ${label} this weekend and beyond` : `Matcha pop-ups in ${label} this week | Matcha Map`;
    const desc = ups.length ? cityDesc(c, ups, c.tz).slice(0, 158) : (m30 ? `${wkN ? wkN + " this weekend and " : ""}${m30} matcha pop-up${m30 === 1 ? "" : "s"} in the next 30 days in ${label}, with times, places and menus.` : `Matcha pop-ups in ${label}: none posted right now. Brands post a few days ahead; see nearby cities and the map.`).slice(0, 154);
    const canonical = `${SITE_URL}/${cityPath(c)}`;
    const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Matcha Map", item: SITE_URL + "/" },
      { "@type": "ListItem", position: 2, name: label, item: canonical }] }];
    for (const it of ups) ld.push({ "@context": "https://schema.org", ...eventLd(it.e, { brand: it.brand, insta: it.insta }) });
    const listed = ups.filter((it) => eventPageId(it.e));
    if (listed.length) ld.push({ "@context": "https://schema.org", "@type": "ItemList", name: `Matcha pop-ups in ${label}`, numberOfItems: listed.length, itemListElement: listed.slice(0, 50).map((it, i) => {
      const ev = eventLd(it.e, { brand: it.brand, insta: it.insta });
      return { "@type": "ListItem", position: i + 1, url: `${SITE_URL}/e/${it.e.id}/`, item: { "@type": "Event", name: ev.name, startDate: ev.startDate, url: `${SITE_URL}/e/${it.e.id}/`, location: { "@type": "Place", name: ev.location.name, address: { "@type": "PostalAddress", addressLocality: c.name, addressRegion: c.state } } } };
    }) });
    const ogKey = `city-${c.slug}-${c.state.toLowerCase()}`;
    const image = d.cityOg && d.cityOg.has(ogKey) ? `${SITE_URL}/og/${ogKey}.png` : undefined;
    files.set(cityPath(c) + "index.html", shell({ title, desc, canonical, ld, body, image }));
    urls.push({ loc: canonical, lastmod: newestDay(ups.map((x) => x.e), lastmod) });
  }

  // brand pages
  const KIND = { popup: "Matcha pop-up brand", cafe: "Cafe", venue: "Venue", organizer: "Event organizer", "tea-brand": "Tea brand", festival: "Festival" };
  const brandPages = [...brands.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const b of brandPages) {
    const ups = b.events.filter((x) => x.up).sort((a, c) => Date.parse(a.e.start) - Date.parse(c.e.start));
    const past = b.events.filter((x) => !x.up).sort((a, c) => Date.parse(c.e.start) - Date.parse(a.e.start)).slice(0, 20);
    const home = [b.city, b.state].filter(Boolean).join(", ");
    const hc = cityByName.get(`${b.state}|${norm(b.city)}`);
    const tt = b.tiktok ? (safeUrl(b.tiktok) || "https://www.tiktok.com/@" + String(b.tiktok).replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "")) : "";
    const links = [b.instagram ? `<a href="https://www.instagram.com/${esc(b.instagram)}/" rel="noopener">Instagram @${esc(b.instagram)}</a>` : "", tt ? `<a href="${esc(tt)}" rel="noopener">TikTok</a>` : "", b.website ? `<a href="${esc(b.website)}" rel="noopener">Website</a>` : ""].filter(Boolean);
    const cards = (list) => list.map((x) => {
      const c = locate(x.e);
      return eventCard(x.e, { tz: (c && c.tz) || x.e.tz, heading: x.e.title || x.brand, day: dayLabel(dayKey(Date.parse(x.e.start), x.e.tz || (c && c.tz))), brandHandle: "" });
    }).join("\n");
    let body = `<nav class="pg-crumb" aria-label="Breadcrumb"><a href="/">Matcha Map</a> <span aria-hidden="true">\u203a</span> <span>${esc(b.name)}</span></nav>
<h1>${esc(b.name)}</h1>
<p class="pg-lead">${esc(KIND[b.kind] || "Matcha brand")}${home ? ` based in ${esc(home)}` : ""}. ${ups.length ? plural(ups.length, "upcoming pop-up") + " on the map." : "No upcoming pop-ups are posted right now."}</p>
<p class="pg-sub">${links.join(" \u00b7 ")}${links.length ? "<br>" : ""}${mapLink("brand=" + encodeURIComponent(b.slug), "See " + b.name + " on the map")}${hc ? ` <a href="/${cityPath(hc)}">More in ${esc(hc.name)}</a>` : ""}</p>
`;
    // N8: next dates, drinks with art and the story, from extra.json when `npm run brand-extras` wrote one
    body += `<div id="brand-extras" data-src="extra.json"></div><script src="/brand-extras.js" defer></script>
`;
    if (ups.length) body += `<section><h2>Upcoming pop-ups</h2>\n<ul class="pg-list">\n${cards(ups)}\n</ul></section>\n`;
    if (past.length) body += `<section><h2>Past pop-ups kept on file</h2>\n<ul class="pg-list">\n${cards(past)}\n</ul></section>\n`;
    body += `<section class="pg-how"><h2>About this page</h2><p>This page lists what ${esc(b.name)} has posted publicly. Everything here belongs to ${esc(b.name)}; follow the links above to see it from the source. Dates come from posts, so check the post before you go.</p></section>`;
    const title = `${b.name} matcha pop-ups: dates and places`;
    const desc = `${b.name}${home ? ", " + home : ""}: ${ups.length ? plural(ups.length, "upcoming matcha pop-up") : "no upcoming pop-ups posted right now"}. Dates, places and links on Matcha Map.`.slice(0, 154);
    const canonical = `${SITE_URL}/brand/${b.slug}/`;
    const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Matcha Map", item: SITE_URL + "/" },
      { "@type": "ListItem", position: 2, name: b.name, item: canonical }] }];
    const org = { "@context": "https://schema.org", "@type": "Organization", name: b.name, url: canonical };
    const same = [b.instagram ? `https://www.instagram.com/${b.instagram}/` : "", b.website, b.tiktok ? (safeUrl(b.tiktok) || "https://www.tiktok.com/@" + String(b.tiktok).replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "")) : ""].filter(Boolean);
    if (same.length) org.sameAs = same;
    const logo = d.brandPictures && d.brandPictures.get(b.slug);
    if (logo) org.logo = logo;
    ld.push(org);
    for (const it of ups) ld.push({ "@context": "https://schema.org", ...eventLd(it.e, { brand: it.brand, insta: b.instagram ? `https://www.instagram.com/${b.instagram}/` : "" }) });
    files.set(`brand/${b.slug}/index.html`, shell({ title, desc, canonical, ld, body }));
    urls.push({ loc: canonical, lastmod: newestDay(b.events.map((x) => x.e), lastmod), thin: !b.events.length && !b.city, slug: b.slug });
  }

  // size guard: drop brand pages with no events and no city first when close to a limit, then fail loudly
  const lim = d.limits || LIMITS;
  const sizeOf = () => { let n = 0; for (const t of files.values()) n += Buffer.byteLength(t); return n; };
  const OTHER = 6; // sitemap, robots, home, og and the like
  if (files.size + OTHER > lim.files * 0.9 || sizeOf() > lim.bytes * 0.9) {
    for (let i = urls.length - 1; i >= 0; i--) if (urls[i].thin) { files.delete(`brand/${urls[i].slug}/index.html`); urls.splice(i, 1); }
  }
  if (files.size + OTHER > lim.files || sizeOf() > lim.bytes) throw new Error(`page set too large: ${files.size} files, ${sizeOf()} bytes (limits ${lim.files} files, ${lim.bytes} bytes)`);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod || lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  const pageBytes = sizeOf();
  files.set("sitemap.xml", sitemap);
  files.set("robots.txt", robots);
  const nCity = [...files.keys()].filter((p) => p.startsWith("city/")).length;
  return { files, urls, counts: { cities: nCity, brands: [...files.keys()].filter((p) => p.startsWith("brand/")).length, bytes: pageBytes + Buffer.byteLength(sitemap) + robots.length } };
}

// ---- home head (between the markers in site/index.html) ----
export const SEO_START = "<!-- seo:start (written by tools/gen-pages.js) -->";
export const SEO_END = "<!-- seo:end -->";
export function homeHead() {
  const title = "Matcha Map: matcha pop-ups across America, by day";
  const desc = "Find matcha pop-ups near you, day by day. One map of pop-ups, markets and shops across America, with times, places and menus.";
  const ld = { "@context": "https://schema.org", "@type": "WebSite", name: "Matcha Map", url: SITE_URL + "/", potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: SITE_URL + "/?q={search_term_string}" }, "query-input": "required name=search_term_string" } };
  return [SEO_START,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${SITE_URL}/">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Matcha Map">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${SITE_URL}/">`, `<meta property="og:image" content="${SITE_URL}/og.png">`,
    `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`, `<meta name="twitter:image" content="${SITE_URL}/og.png">`,
    ldScript(ld), SEO_END].join("\n");
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function patchIndex(html) {
  const block = homeHead();
  if (html.includes(SEO_START)) return html.replace(new RegExp(reEsc(SEO_START) + "[\\s\\S]*?" + reEsc(SEO_END)), () => block);
  return html.replace(/<title>[^<]*<\/title>\s*<meta name="description"[^>]*>/, () => block);
}

// ---- main ----
export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const ev = read("site/data/events.json");
  const data = {
    now, generated: ev.generated, events: ev.events,
    cities: read("data/cities.json").cities, sources: read("data/sources.json"),
    shops: read("site/data/shops.json").shops || [],
    cityFeeds: new Set(fs.existsSync(path.join(root, "site/feeds")) ? fs.readdirSync(path.join(root, "site/feeds")).filter((n) => n.endsWith(".ics")).map((n) => n.slice(0, -4)) : []),
    cityOg: new Set(fs.existsSync(path.join(root, "site/og")) ? fs.readdirSync(path.join(root, "site/og")).filter((n) => /^city-.*.png$/.test(n)).map((n) => n.slice(0, -4)) : []),
    brandPictures: (() => { try { return new Map(read("site/data/brands.json").brands.filter((x) => String(x.picture || "").startsWith("https://")).map((x) => [handleSlug(x.handle), x.picture])); } catch { return new Map(); } })(),
    watchlist: fs.existsSync(path.join(root, "data/watchlist.json")) ? read("data/watchlist.json") : { accounts: [] },
  };
  const out = buildSite(data);
  const site = path.join(root, "site");
  for (const dir of ["city", "brand"]) fs.rmSync(path.join(site, dir), { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(site, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  const ix = path.join(site, "index.html");
  const html = fs.readFileSync(ix, "utf8"), next = patchIndex(html);
  if (next !== html) fs.writeFileSync(ix, next);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`pages: ${o.counts.cities} city pages, ${o.counts.brands} brand pages, ${o.urls.length} sitemap urls, ${(o.counts.bytes / 1048576).toFixed(2)} MB`);
}
