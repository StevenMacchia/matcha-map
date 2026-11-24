// npm run pages: write the static, indexable layer into site/: one page per city (site/city/<st>/<slug>/), one per brand
// (site/brand/<handle>/), sitemap.xml, robots.txt, and the SEO head of the home page. Runs at the end of `npm run ingest`
// (never from watch). The pages load no map; they link into the app with ?city=, ?event= and ?brand=.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { brandOf as cleanBrand, placeOf } from "../ingest/lib/names.js";
import { tzForPlace } from "../ingest/lib/tz.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LIMITS = { files: 20000, bytes: 30 * 1024 * 1024 };
export const NEAR_KM = 25; // a pop-up or shop this close belongs to the city
export const NEARBY_KM = 64; // 40 miles: the Nearby section and the index rule reach this far
export const NEARBY_MAX = 12;
export const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
export const stateHref = (st) => `state/${String(st).toLowerCase()}/`;
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
  const en = Date.parse(e.end);
  if (en <= st) return a.text; // zero-length or backwards range: one time, never "11-11 AM"
  const b = clock(en, zone);
  if (b.text === a.text) return a.text;
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

// ---- the weekend window (gen-weekend.js re-exports these) ----
export const SUNDAY_CUTOFF_HOUR = 20; // from 8 pm Sunday local time, "this weekend" means the next one
export const addDays = addKey;
function localHour(ms, tz) {
  try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(ms)) % 24; } catch { return 12; }
}
// Friday, Saturday and Sunday (day keys, venue-local) of the weekend to show. Mon-Thu: the coming one. Fri-Sun: the one under way,
// until 8 pm Sunday, then the next.
export function weekendWindow(nowMs, tz = "America/New_York") {
  const today = dayKey(nowMs, tz);
  const dow = keyDate(today).getUTCDay(); // 0 = Sunday
  let fri;
  if (dow >= 1 && dow <= 4) fri = addDays(today, 5 - dow);
  else if (dow === 5) fri = today;
  else if (dow === 6) fri = addDays(today, -1);
  else fri = addDays(today, -2);
  const next = dow === 0 && localHour(nowMs, tz) >= SUNDAY_CUTOFF_HOUR;
  if (next) fri = addDays(fri, 7);
  return { today, keys: [fri, addDays(fri, 1), addDays(fri, 2)], next };
}
// Does the event fall in the window: it starts on one of the days, or began earlier and runs into the first.
export function inWindow(e, keys, tz) {
  const zone = e.tz || tz;
  const st = Date.parse(e.start);
  if (isNaN(st)) return false;
  const k = dayKey(st, zone);
  if (keys.includes(k)) return true;
  const en = e.end && !isNaN(Date.parse(e.end)) ? Date.parse(e.end) : NaN;
  return k < keys[0] && !isNaN(en) && dayKey(en, zone) >= keys[0];
}
const shortMonthDay = (k) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(keyDate(k));
export const windowText = (keys) => `${shortMonthDay(keys[0])} to ${shortMonthDay(keys[2])}`;

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
const CSP = "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; base-uri 'self'; form-action 'none'; manifest-src 'self'; connect-src 'self' https://cloudflareinsights.com";

// image: a page's own share card (a city card from `npm run weekend`); the site card otherwise.
export function shell({ title, desc, canonical, ld = [], body, image, noindex = false }) {
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
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}<meta name="color-scheme" content="light">
${noindex ? "" : `<meta name="theme-color" content="#FBF6EA">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
`}<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Matcha Map">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(og)}">
${noindex ? "" : `<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
`}<meta name="twitter:card" content="summary_large_image">
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
const andList = (a) => (a.length < 3 ? a.join(" and ") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const NEARBY_MI = Math.round(NEARBY_KM / KM_PER_MI); // 40
const NEAR_MI = Math.floor(NEAR_KM / KM_PER_MI); // 15
const miText = (kmv) => { const m = Math.max(1, Math.round(kmv / KM_PER_MI)); return `${m} ${m === 1 ? "mile" : "miles"}`; };
const followersText = (n) => { n = Number(n); if (!isFinite(n) || n <= 0) return ""; const r = (v) => String(Math.round(v * 10) / 10).replace(/\.0$/, ""); return `${n >= 1e6 ? r(n / 1e6) + "m" : n >= 1e3 ? r(n / 1e3) + "k" : String(Math.round(n))} followers`; };
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "") + "…");
const UPDATED = "~UPDATED~"; // stands in for the date while a page is hashed, so the date alone never moves a lastmod

const shortDay = (k) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(keyDate(k)).replace(",", "");
export const shortDayOf = (e, tz) => shortDay(dayKey(Date.parse(e.start), e.tz || tz));
const listJoin = (a) => (a.length < 2 ? a.join("") : a.join(" and "));

// The sentence under the lead. The counts live in the lead; this names the next pop-up.
export function cityIntro(c, ups, tz) {
  if (!ups.length) return "";
  const next = ups[0];
  const where = next.e.venue && !isApprox(next.e) ? " at " + next.e.venue : "";
  return `The next one is ${next.brand} on ${shortDayOf(next.e, tz)}${where}.`;
}

// ---- index or noindex (docs/SEO-CITY-PAGES.md section 4) ----
// A city page is indexable when it has a pop-up matched to it, a pop-up within 40 miles, a verified shop within 25 km, or a brand
// based there. Each field is a count or a list. Pure: re-evaluated every run from the data.
export function cityIndexable({ ups = 0, nearby = 0, shops = 0, brands = 0 } = {}) {
  const n = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);
  const reasons = [];
  if (n(ups)) reasons.push("popup");
  if (n(nearby)) reasons.push("nearby");
  if (n(shops)) reasons.push("shop");
  if (n(brands)) reasons.push("brand");
  return { indexable: reasons.length > 0, reasons };
}

// ---- shops: opening hours (OSM syntax) and LocalBusiness ----
const OSM_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HM = "(?:[01]\\d|2[0-3]):[0-5]\\d";
const RULE_RE = new RegExp(`^([A-Z][a-z](?:\\s*-\\s*[A-Z][a-z])?(?:\\s*,\\s*[A-Z][a-z](?:\\s*-\\s*[A-Z][a-z])?)*)\\s+(off|${HM}\\s*-\\s*(?:${HM}|24:00)(?:\\s*,\\s*${HM}\\s*-\\s*(?:${HM}|24:00))*)$`);
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// "Mo-Fr 08:00-17:00; Sa 09:00-15:00" -> [{ days: [0..6, Monday = 0], times: [["08:00","17:00"]] }] (times empty for "off"), or null for
// anything else: no days, 24/7, holidays, months, overnight ranges, a day named twice, "closed" notes. Null means text only, no schema.
export function parseOpeningHours(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 200) return null;
  const rules = [], used = new Set();
  for (const part of s.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const m = RULE_RE.exec(p);
    if (!m) return null;
    const days = [];
    for (const tok of m[1].split(",")) {
      const [a, b = a] = tok.split("-").map((x) => OSM_DAYS.indexOf(x.trim()));
      if (a < 0 || b < 0) return null;
      for (let i = a; ; i = (i + 1) % 7) { days.push(i); if (i === b) break; }
    }
    if (days.some((d) => used.has(d)) || new Set(days).size !== days.length) return null;
    days.forEach((d) => used.add(d));
    const times = [];
    if (m[2] !== "off") {
      let last = -1;
      for (const r of m[2].split(",")) {
        const [o, c] = r.split("-").map((x) => x.trim());
        if (minutes(o) <= last || minutes(c) <= minutes(o)) return null;
        last = minutes(c);
        times.push([o, c]);
      }
    }
    rules.push({ days, times });
  }
  return rules.length ? rules : null;
}
export function openingHoursSpec(rules) {
  const out = [];
  for (const r of rules) for (const [o, c] of r.times) out.push({ "@type": "OpeningHoursSpecification", dayOfWeek: r.days.map((d) => `https://schema.org/${DAY_NAMES[d]}`), opens: o, closes: c === "24:00" ? "23:59" : c });
  return out;
}
const h12 = (t) => { const h = Number(t.slice(0, 2)) % 24, mi = t.slice(3, 5); return `${h % 12 || 12}${mi === "00" ? "" : ":" + mi} ${h < 12 ? "AM" : "PM"}`; };
export function hoursText(rules) {
  const dayText = (days) => {
    const sorted = [...days].sort((a, b) => a - b);
    const run = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
    return run ? `${DAY_NAMES[sorted[0]].slice(0, 3)}-${DAY_NAMES[sorted[sorted.length - 1]].slice(0, 3)}` : sorted.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
  };
  return rules.map((r) => `${dayText(r.days)} ${r.times.length ? r.times.map(([o, c]) => `${h12(o)}-${h12(c)}`).join(", ") : "closed"}`).join("; ");
}
// One CafeOrCoffeeShop per verified shop that has a street address and a place; never a rating or review field (docs/YELP-TERMS.md).
export function shopLd(s) {
  if (!s || !s.verified || !s.name || !s.address || !s.city || !s.state || !isFinite(s.lat) || !isFinite(s.lng)) return null;
  const address = { "@type": "PostalAddress", streetAddress: s.address, addressLocality: s.city, addressRegion: s.state, addressCountry: "US" };
  if (/^\d{5}(-\d{4})?$/.test(String(s.zip || ""))) address.postalCode = String(s.zip);
  const ld = { "@type": "CafeOrCoffeeShop", name: s.name, address, geo: { "@type": "GeoCoordinates", latitude: s.lat, longitude: s.lng } };
  const url = safeUrl(s.website);
  if (url) ld.url = url;
  const ig = handleSlug(s.instagram);
  if (ig) ld.sameAs = [`https://www.instagram.com/${ig}/`];
  const rules = parseOpeningHours(s.opening_hours);
  const spec = rules ? openingHoursSpec(rules) : [];
  if (spec.length) ld.openingHoursSpecification = spec;
  return ld;
}

// ---- city copy: lead, FAQ ----
// f: { ups, shops, brands, nearest: { it, km } | null }  (counts, and the nearest pop-up outside the city's own)
export function cityLead(c, f) {
  const label = `${c.name}, ${c.state}`;
  if (f.ups) {
    const rest = [];
    if (f.shops) rest.push(plural(f.shops, "matcha shop"));
    if (f.brands) rest.push(plural(f.brands, "brand") + " based here");
    return `${plural(f.ups, "upcoming matcha pop-up")} in ${label}${rest.length ? ", " + andList(rest) : ""}, updated ${UPDATED}.`;
  }
  if (f.nearest && f.nearest.km <= NEARBY_KM) {
    const e = f.nearest.it.e;
    return `No matcha pop-up is listed in ${c.name} right now. The nearest is in ${[e.city, e.state].filter(Boolean).join(", ")}, ${miText(f.nearest.km)} away (${f.nearest.it.brand}, ${shortDayOf(e, c.tz)}).`;
  }
  return `No matcha pop-up is listed within ${NEARBY_MI} miles of ${c.name} right now. ${f.shops ? `${plural(f.shops, "matcha shop")} ${f.shops === 1 ? "is" : "are"} listed here.` : "No matcha shop is listed either."}`;
}
// f: { win, wk, ups, nearest, shops, firstShop }
export function cityFaq(c, f) {
  const when = windowText(f.win.keys), day = (it) => shortDayOf(it.e, c.tz);
  let a1;
  if (f.wk.length) a1 = `Yes. ${plural(f.wk.length, "matcha pop-up")} ${f.wk.length === 1 ? "is" : "are"} listed in ${c.name} this weekend (${when}): ${andList(f.wk.slice(0, 3).map((it) => `${it.brand} on ${day(it)}`))}.`;
  else if (f.ups.length) a1 = `No. Nothing is listed in ${c.name} for this weekend (${when}) yet. The next pop-up is ${f.ups[0].brand} on ${day(f.ups[0])}.`;
  else if (f.nearest && f.nearest.km <= NEARBY_KM) a1 = `No. Nothing is listed in ${c.name} for this weekend (${when}). The nearest pop-up is ${f.nearest.it.brand} in ${[f.nearest.it.e.city, f.nearest.it.e.state].filter(Boolean).join(", ")}, ${miText(f.nearest.km)} away, on ${shortDayOf(f.nearest.it.e, c.tz)}.`;
  else a1 = `No. Nothing is listed within ${NEARBY_MI} miles of ${c.name} for this weekend (${when}).`;
  const a2 = f.shops
    ? `${f.shops === 1 ? "1 verified matcha cafe or shop is" : `${f.shops} verified matcha cafes and shops are`} listed within ${NEAR_MI} miles of ${c.name}. The closest is ${f.firstShop}.`
    : `No matcha shop is listed within ${NEAR_MI} miles of ${c.name}.`;
  return [
    { q: `Is there a matcha pop-up in ${c.name} this weekend?`, a: a1 },
    { q: `How many matcha shops are in ${c.name}?`, a: a2 },
    { q: `How do I get alerts for ${c.name}?`, a: `Pick ${c.name} on the alerts page and add your email.` },
    { q: `How do I list my pop-up in ${c.name}?`, a: `Use the Add your pop-up page with the brand, date and place. It is free.` },
  ];
}
export const faqLd = (items) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) });
const faqHtml = (items, name) => `<section class="pg-faq"><h2>Questions</h2>\n${items.map((x) => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join("\n")}\n</section>\n`;

// ---- the cities the pages are built for: data/cities.json plus the brand home cities site/cities.js carries beyond it ----
const slugOfName = (name) => String(name).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export function loadCities(root = ROOT) {
  const base = JSON.parse(fs.readFileSync(path.join(root, "data/cities.json"), "utf8")).cities;
  const have = new Set(base.map((c) => `${c.name}|${c.state}`));
  const slugs = new Set(base.map((c) => `${c.state}/${c.slug}`));
  const extra = [];
  try {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, "site/cities.js"), "utf8"), ctx);
    for (const [k, v] of Object.entries(ctx.window.CITIES || {})) {
      const [name, state] = k.split("|");
      if (have.has(k) || !STATE_NAMES[state] || !Array.isArray(v) || !isFinite(v[0]) || !isFinite(v[1])) continue;
      const slug = slugOfName(name);
      if (!slug || slugs.has(`${state}/${slug}`)) continue;
      slugs.add(`${state}/${slug}`);
      extra.push({ name, state, pop: 0, lat: v[0], lng: v[1], slug, tz: tzForPlace(state, v[0], v[1]) || "America/New_York", extra: true });
    }
  } catch { /* no site/cities.js: the listed cities only */ }
  return base.concat(extra);
}

// ---- the build ----
// The calendar feed for a city page: its own when npm run feeds wrote one, else every pop-up.
const feedOf = (d, c) => { const k = `${c.slug}-${c.state.toLowerCase()}`; return d.cityFeeds && d.cityFeeds.has(k) ? `/feeds/${k}.ics` : "/feeds/all.ics"; };
const crumbLd = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) });
const crumbHtml = (trail, last) => `<nav class="pg-crumb" aria-label="Breadcrumb">${trail.map(([n, h]) => `<a href="${esc(h)}">${esc(n)}</a> <span aria-hidden="true">›</span> `).join("")}<span>${esc(last)}</span></nav>`;

// "This weekend" block: only when the city has a pop-up in the window gen-weekend.js computes; links that page.
function weekendBlock(c, wk, win) {
  const names = andList(wk.slice(0, 3).map((it) => `${it.brand} on ${shortDayOf(it.e, c.tz)}`));
  return `<section class="pg-wk"><h2>This weekend in ${esc(c.name)}</h2>\n<p>${esc(plural(wk.length, "matcha pop-up"))} ${wk.length === 1 ? "is" : "are"} listed for ${esc(windowText(win.keys))}: ${esc(names)}${wk.length > 3 ? " and more" : ""}. <a href="/weekend/${esc(c.slug)}-${c.state.toLowerCase()}/">See this weekend in ${esc(c.name)}</a></p></section>\n`;
}

function shopsSection(c, sh) {
  const shown = sh.slice(0, NEARBY_MAX);
  const li = ({ s, km: dd }) => {
    const w = safeUrl(s.website);
    const rules = parseOpeningHours(s.opening_hours);
    const hours = rules ? hoursText(rules) : String(s.opening_hours || "").trim().slice(0, 120);
    return `<li><strong>${w ? `<a href="${esc(w)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</strong> <span class="pg-dim">${Math.round(dd / KM_PER_MI)} mi</span><br>${esc(s.address || "")}${hours ? `<br><span class="pg-dim">Hours: ${esc(hours)}</span>` : ""}</li>`;
  };
  // one group per tier value as it appears in the rows; rows with no tier go last under "Other"
  const tiers = [...new Set(shown.map(({ s }) => String(s.tier || "")))].sort((p, q) => (p === "") - (q === "") || p.localeCompare(q));
  const groups = tiers.map((t) => `<h3 class="pg-day">${esc(t ? t.charAt(0).toUpperCase() + t.slice(1) : "Other")}</h3>\n<ul class="pg-list pg-shops">\n${shown.filter(({ s }) => String(s.tier || "") === t).map(li).join("\n")}\n</ul>`);
  return `<section><h2>Matcha cafes and shops in ${esc(c.name)}</h2>\n${groups.join("\n")}${sh.length > NEARBY_MAX ? `<p class="pg-dim">The nearest ${NEARBY_MAX} of ${sh.length}.</p>` : ""}</section>\n`;
}

// Pop-ups between the city's own match and 64 km, by distance, each with its city and miles.
function nearbySection(c, nb) {
  const items = nb.map(({ it, km: dd }) => {
    const e = it.e, where = [e.city, e.state].filter(Boolean).join(", ");
    const href = eventPageId(e) ? `/e/${esc(e.id)}/` : `/?event=${encodeURIComponent(e.id)}`;
    return `<li><strong>${esc(it.brand)}</strong> <span class="pg-dim">${esc(shortDayOf(e, c.tz))} · ${esc(where)} · ${esc(miText(dd))}</span> <a href="${href}">Details</a></li>`;
  });
  return `<section><h2>Pop-ups near ${esc(c.name)}</h2>\n<ul class="pg-list pg-shops">\n${items.join("\n")}\n</ul></section>\n`;
}

// One city page: { html, lastDay }. The date text is the UPDATED token until buildSite hashes the page.
function cityPage(c, x) {
  const { d, ups, sh, home, nearby, nearest, near3, indexable } = x;
  const label = `${c.name}, ${c.state}`, key = `${c.slug}-${c.state.toLowerCase()}`;
  const today = dayKey(x.nowMs, c.tz), win = weekendWindow(x.nowMs, c.tz);
  const wk = ups.filter((it) => it.e.id && inWindow(it.e, win.keys, c.tz));
  const lead = cityLead(c, { ups: ups.length, shops: sh.length, brands: home.length, nearest });
  const faq = cityFaq(c, { win, wk, ups, nearest, shops: sh.length, firstShop: sh[0] && sh[0].s.name });
  const credited = new Map();
  let body = `${crumbHtml([["Matcha Map", "/"], [STATE_NAMES[c.state] || c.state, "/" + stateHref(c.state)]], label)}
<h1>Matcha pop-ups in ${esc(label)}</h1>
<p class="pg-lead">${esc(lead)}</p>
${ups.length ? `<p class="pg-intro">${esc(cityIntro(c, ups, c.tz))}</p>\n` : ""}<p class="pg-sub">${indexable && !ups.length ? `Updated ${UPDATED}. ` : ""}${mapLink("city=" + key, "Open " + c.name + " on the map")}</p>
`;
  if (!ups.length) body += `<p class="pg-dim">Dates come from each brand's own posts, so check the post before you go.</p>\n`;
  if (wk.length) body += weekendBlock(c, wk, win);
  if (ups.length) {
    body += `<section><h2>Upcoming pop-ups</h2>\n<p class="pg-dim">Dates come from each brand's own posts, so check the post before you go.</p>\n`;
    for (const g of groupByDay(ups, c.tz, today)) {
      body += `<h3 class="pg-day">${esc(g.label)}</h3>\n<ul class="pg-list">\n`;
      for (const it of g.items) {
        credited.set(it.brand, it.handle);
        body += eventCard(it.e, { tz: c.tz, heading: it.brand, brandHandle: it.handle }) + "\n";
      }
      body += `</ul>\n`;
    }
    body += `</section>\n`;
  }
  if (sh.length) body += shopsSection(c, sh);
  if (home.length) {
    body += `<section><h2>Brands based in ${esc(c.name)}</h2>\n<ul class="pg-chips">\n`;
    for (const b of home) { credited.set(b.name, b.slug); body += `<li>${b.picture ? `<img src="${esc(b.picture)}" alt="" width="32" height="32" loading="lazy"> ` : ""}<a href="/brand/${esc(b.slug)}/">${esc(b.name)}</a>${b.instagram ? ` <a class="pg-dim" href="https://www.instagram.com/${esc(b.instagram)}/" rel="noopener">@${esc(b.instagram)}</a>` : ""}${followersText(b.followers) ? ` <span class="pg-dim">${followersText(b.followers)}</span>` : ""}</li>\n`; }
    body += `</ul></section>\n`;
  }
  body += nearby.length ? nearbySection(c, nearby) : `<section><h2>Pop-ups near ${esc(c.name)}</h2><p>Nothing listed yet within ${NEARBY_MI} miles.</p></section>\n`;
  body += faqHtml(faq, c.name);
  body += `<p class="pg-cta"><a class="pg-btn" href="/alerts/?city=${esc(key)}">Get alerts for ${esc(c.name)}</a> <a class="pg-btn" href="/add/">Add your pop-up</a> <a class="pg-btn" href="/add/?city=${esc(key)}">Report a pop-up we missed</a>${indexable ? ` <a class="pg-btn" href="${feedOf(d, c)}">Calendar feed</a>` : ""}</p>\n`;
  body += `<section><h2>Nearby cities</h2>\n<ul class="pg-chips">\n${near3.map((n) => `<li><a href="/${cityPath(n.x)}">${esc(n.x.name)}, ${esc(n.x.state)}</a> <span class="pg-dim">${miText(n.km)}</span></li>`).join("\n")}\n</ul>\n<p class="pg-sub"><a href="/${stateHref(c.state)}">All matcha pop-ups in ${esc(STATE_NAMES[c.state] || c.state)}</a></p></section>\n`;
  // a page with nothing listed (noindex) keeps one line, so the thin set stays under 6 KB
  body += !indexable ? "" : `<section class="pg-how"><h2>How this map works</h2>
<p>Matcha Map collects pop-ups that brands post publicly, on their own sites, in event listings and on Instagram, matches each one to a day and a place, and puts them on one map. Dates come from those posts, so check the post before you go. When a brand has not said where, the page says so instead of guessing.</p>
${credited.size ? `<p class="pg-credit">Every pop-up belongs to its brand: ${[...credited].map(([n, h]) => (h ? `<a href="/brand/${esc(h)}/">${esc(n)}</a>` : esc(n))).join(", ")}.</p>` : ""}
</section>`;

  const title = `Matcha pop-ups in ${label}: this weekend and upcoming`;
  const desc = clip(lead.replace(UPDATED, x.updatedText), 158).replace(x.updatedText, UPDATED);
  const canonical = `${SITE_URL}/${cityPath(c)}`;
  const ld = [crumbLd([["Matcha Map", SITE_URL + "/"], [STATE_NAMES[c.state] || c.state, `${SITE_URL}/${stateHref(c.state)}`], [label, canonical]])];
  // Standalone Event blocks carry an image, same fallback as the ItemList below: photo, drawn art, then the site card.
  // No `performer`: Google lists it as recommended only, and these are brand pop-ups with no named act, so the
  // organizer (already set) is the honest party; inventing a performer would be a made-up claim.
  const evImage = (e, ev) => (ev.image && ev.image[0]) || (d.eventArt && d.eventArt.has(e.id) ? `${SITE_URL}/art/events/${e.id}.svg` : `${SITE_URL}/og.png`);
  for (const it of ups) { const ev = eventLd(it.e, { brand: it.brand, insta: it.insta }); ev.image = [evImage(it.e, ev)]; ld.push({ "@context": "https://schema.org", ...ev }); }
  const listed = ups.filter((it) => eventPageId(it.e));
  if (listed.length) ld.push({ "@context": "https://schema.org", "@type": "ItemList", name: `Matcha pop-ups in ${label}`, numberOfItems: listed.length, itemListElement: listed.slice(0, 50).map((it, i) => {
    const ev = eventLd(it.e, { brand: it.brand, insta: it.insta });
    return { "@type": "ListItem", position: i + 1, item: { "@type": "Event", name: ev.name, startDate: ev.startDate, url: `${SITE_URL}/e/${it.e.id}/`, image: evImage(it.e, ev), location: { "@type": "Place", name: ev.location.name, address: { "@type": "PostalAddress", addressLocality: c.name, addressRegion: c.state } } } };
  }) });
  for (const { s } of sh.slice(0, NEARBY_MAX)) { const l = shopLd(s); if (l) ld.push({ "@context": "https://schema.org", ...l }); }
  ld.push(faqLd(faq));
  const ogKey = `city-${key}`;
  const image = d.cityOg && d.cityOg.has(ogKey) ? `${SITE_URL}/og/${ogKey}.png` : undefined;
  return { html: shell({ title, desc, canonical, ld, body, image, noindex: !indexable }), lastDay: newestDay([...ups, ...nearby.map((n) => n.it)].map((it) => it.e), x.cap) };
}

// ---- state hubs ----
// rows: one per city of the state: { c, ups, shops, brands }. Three lists: pop-ups, shops, every other city.
function statePage(st, rows, x) {
  const name = STATE_NAMES[st] || st, canonical = `${SITE_URL}/${stateHref(st)}`;
  const U = rows.reduce((n, r) => n + r.ups.length, 0), S = x.shopCount;
  const withUps = rows.filter((r) => r.ups.length).sort((a, b) => b.ups.length - a.ups.length || a.c.name.localeCompare(b.c.name));
  const withShops = rows.filter((r) => r.shops).sort((a, b) => b.shops - a.shops || a.c.name.localeCompare(b.c.name));
  const rest = rows.filter((r) => !r.ups.length && !r.shops).sort((a, b) => a.c.name.localeCompare(b.c.name));
  const link = (r) => `<a href="/${cityPath(r.c)}">${esc(r.c.name)}</a>`;
  const lead = U
    ? `${plural(U, "upcoming matcha pop-up")} in ${name}, across ${withUps.length} ${withUps.length === 1 ? "city" : "cities"}${S ? `. ${plural(S, "matcha shop")} ${S === 1 ? "is" : "are"} listed too` : ""}.`
    : S ? `No matcha pop-up is listed in ${name} right now. ${plural(S, "matcha shop")} ${S === 1 ? "is" : "are"} listed.` : `No matcha pop-up or matcha shop is listed in ${name} right now. Pick a city below to see the nearest.`;
  let body = `${crumbHtml([["Matcha Map", "/"]], name)}
<h1>Matcha pop-ups in ${esc(name)}</h1>
<p class="pg-lead">${esc(lead)}</p>
<p class="pg-sub">Updated ${UPDATED}. <a href="/state/">All states</a></p>
`;
  if (withUps.length) body += `<section><h2>Cities with upcoming pop-ups</h2>\n<ul class="pg-chips">\n${withUps.map((r) => `<li>${link(r)} <span class="pg-dim">${r.ups.length} · next ${esc(shortDayOf(r.ups[0].e, r.c.tz))}</span></li>`).join("\n")}\n</ul></section>\n`;
  if (withShops.length) body += `<section><h2>Cities with matcha shops</h2>\n<ul class="pg-chips">\n${withShops.map((r) => `<li>${link(r)} <span class="pg-dim">${r.shops}</span></li>`).join("\n")}\n</ul></section>\n`;
  if (rest.length) body += `<section><h2>${withUps.length || withShops.length ? "Every other city" : "Every city"} in ${esc(name)}</h2>\n<ul class="pg-chips">\n${rest.map((r) => `<li>${link(r)}</li>`).join("\n")}\n</ul></section>\n`;
  const title = `Matcha pop-ups in ${name}: cities, this weekend and upcoming`;
  const ld = [crumbLd([["Matcha Map", SITE_URL + "/"], [name, canonical]])];
  return { html: shell({ title, desc: clip(lead, 158), canonical, ld, body, noindex: !x.indexable }), lastDay: x.lastDay };
}

function statesIndexPage(list) {
  const canonical = `${SITE_URL}/state/`, title = "Matcha pop-ups by state: every US state and DC";
  const desc = "Matcha pop-ups and matcha shops by state, with the cities in each. Pick a state to see this weekend and what is coming up.";
  const body = `${crumbHtml([["Matcha Map", "/"]], "States")}
<h1>Matcha pop-ups by state</h1>
<p class="pg-lead">Pick a state to see its cities, this weekend and what is coming up.</p>
<ul class="pg-chips">
${list.map((s) => `<li><a href="/${stateHref(s.st)}">${esc(s.name)}</a>${s.ups ? ` <span class="pg-dim">${s.ups}</span>` : ""}</li>`).join("\n")}
</ul>`;
  return shell({ title, desc, canonical, ld: [crumbLd([["Matcha Map", SITE_URL + "/"], ["States", canonical]])], body });
}

const hashOf = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

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
  for (const a of (d.watchlist && d.watchlist.accounts) || []) {
    const b = brands.get(handleSlug(a.handle));
    if (!b) continue;
    if (a.followers_count > 0) b.followers = a.followers_count;
    const pic = (d.brandPictures && d.brandPictures.get(b.slug)) || (String(a.profile_picture_url || "").startsWith("https://") ? a.profile_picture_url : "");
    if (pic) b.picture = pic;
  }
  for (const b of brands.values()) if (!b.picture && d.brandPictures && d.brandPictures.get(b.slug)) b.picture = d.brandPictures.get(b.slug);
  const bySource = new Map();
  for (const b of brands.values()) for (const id of b.ids) if (!bySource.has(id)) bySource.set(id, b);
  const brandOf = (e) => brands.get(eventHandle(e, srcById)) || bySource.get(e.source_id);

  // events: upcoming ones by city, all of them by brand
  const byCity = new Map();
  const allUp = []; // every upcoming pop-up with a point: the Nearby section and the nearest-pop-up sentence read it
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
    if (up && isFinite(e.lat) && isFinite(e.lng) && e.lat != null && e.lng != null) allUp.push(info);
  }

  // Every city gets a page. Whether search engines may index it is cityIndexable()'s call; a noindex page still renders in full.
  const nearShops = new Map();
  for (const c of cities) {
    const list = [];
    for (const s of shops) { const dd = km(c, s); if (dd <= NEAR_KM) list.push({ s, km: dd }); }
    if (list.length) nearShops.set(cityKey(c), list.sort((a, b) => a.km - b.km));
  }
  const cityByName = new Map(cities.map((c) => [`${c.state}|${norm(c.name)}`, c]));
  const homeBrands = new Map();
  for (const b of brands.values()) {
    const c = cityByName.get(`${b.state}|${norm(b.city)}`);
    if (!c) continue;
    const k = cityKey(c);
    if (!homeBrands.has(k)) homeBrands.set(k, []);
    homeBrands.get(k).push(b);
  }
  const shopsByState = new Map();
  for (const s of shops) if (s.state) shopsByState.set(s.state, (shopsByState.get(s.state) || 0) + 1);

  const files = new Map();
  const urls = [{ loc: SITE_URL + "/" }];
  // lastmod moves only when a page's body does: { "city/nc/raleigh": [hash, lastmod] }, kept in data/pages-lastmod.json
  const prev = d.prevPages || {}, stamps = {};
  const stamp = (key, html, computed) => {
    const h = hashOf(html), p = prev[key];
    const lm = p && p[0] === h ? p[1] : p && p[1] > computed ? p[1] : computed;
    stamps[key] = [h, lm];
    return { html: html.split(UPDATED).join(updatedText), lm };
  };
  const near3Of = (c) => {
    const best = [];
    for (const x of cities) {
      if (x === c) continue;
      const dd = km(c, x);
      if (best.length < 3 || dd < best[best.length - 1].km) { best.push({ x, km: dd }); best.sort((a, b) => a.km - b.km); if (best.length > 3) best.pop(); }
    }
    return best;
  };

  const tally = { indexable: 0, noindex: 0, byState: {} };
  const stateRows = new Map();
  for (const c of cities) {
    const k = cityKey(c);
    const ups = (byCity.get(k) || []).sort((a, b) => Date.parse(a.e.start) - Date.parse(b.e.start));
    const sh = nearShops.get(k) || [];
    const home = homeBrands.get(k) || [];
    const mine = new Set(ups);
    const out = []; // upcoming pop-ups that are not this city's own, within the Nearby reach
    let nearest = null;
    for (const it of allUp) {
      if (mine.has(it)) continue;
      const dd = km(c, it.e);
      if (!nearest || dd < nearest.km) nearest = { it, km: dd };
      if (dd <= NEARBY_KM) out.push({ it, km: dd });
    }
    out.sort((a, b) => a.km - b.km || Date.parse(a.it.e.start) - Date.parse(b.it.e.start));
    const nearby = out.slice(0, NEARBY_MAX);
    const { indexable } = cityIndexable({ ups, nearby: out, shops: sh, brands: home });
    const pg = cityPage(c, { d, nowMs, updatedText, cap: lastmod, ups, sh, home, nearby, nearest, near3: near3Of(c), indexable });
    const st = stamp("city/" + cityKey(c).toLowerCase(), pg.html, pg.lastDay);
    files.set(cityPath(c) + "index.html", st.html);
    if (indexable) { urls.push({ loc: `${SITE_URL}/${cityPath(c)}`, lastmod: st.lm }); tally.indexable++; tally.byState[c.state] = (tally.byState[c.state] || 0) + 1; } else tally.noindex++;
    if (!stateRows.has(c.state)) stateRows.set(c.state, []);
    stateRows.get(c.state).push({ c, ups, shops: sh.length, brands: home.length });
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

  // state hubs, then the /state/ index
  const stateList = [];
  const byName = (a, b) => (STATE_NAMES[a[0]] || a[0]).localeCompare(STATE_NAMES[b[0]] || b[0]);
  for (const [st, rows] of [...stateRows].sort(byName)) {
    const U = rows.reduce((n, r) => n + r.ups.length, 0), S = shopsByState.get(st) || 0;
    const indexable = U > 0 || S > 0;
    const pg = statePage(st, rows, { shopCount: S, indexable, lastDay: newestDay(rows.flatMap((r) => r.ups.map((x) => x.e)), lastmod) });
    const s = stamp("state/" + st.toLowerCase(), pg.html, pg.lastDay);
    files.set(stateHref(st) + "index.html", s.html);
    if (indexable) urls.push({ loc: `${SITE_URL}/${stateHref(st)}`, lastmod: s.lm });
    stateList.push({ st, name: STATE_NAMES[st] || st, ups: U });
  }
  if (stateList.length) {
    const s = stamp("state", statesIndexPage(stateList), lastmod);
    files.set("state/index.html", s.html);
    urls.push({ loc: SITE_URL + "/state/", lastmod: s.lm });
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
  // which city and brand pages exist, for the live app (site/cards-app.js links "More in <city>" and the brand name only to a page that is there)
  const hasPage = (c) => files.has(cityPath(c) + "index.html");
  const pagesIndex = { cities: d.cities.filter(hasPage).map((c) => ({ p: `${c.state.toLowerCase()}/${c.slug}`, n: c.name, s: c.state, la: c.lat, lo: c.lng })), brands: [...files.keys()].filter((p) => /^brand\/[^/]+\/index\.html$/.test(p)).map((p) => p.split("/")[1]).sort() };
  files.set("data/pages.json", JSON.stringify(pagesIndex));
  files.set("robots.txt", robots);
  const nCity = [...files.keys()].filter((p) => p.startsWith("city/")).length;
  return { files, urls, lastmods: stamps, counts: { cities: nCity, brands: [...files.keys()].filter((p) => p.startsWith("brand/")).length, states: [...files.keys()].filter((p) => /^state\/[a-z]{2}\//.test(p)).length, indexable: tally.indexable, noindex: tally.noindex, indexableByState: tally.byState, bytes: pageBytes + Buffer.byteLength(sitemap) + robots.length } };
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
// The 50 biggest cities as links, for the home body. The site session places <!-- cities:start --> and <!-- cities:end -->; no markers, no block.
export const CITIES_START = "<!-- cities:start -->";
export const CITIES_END = "<!-- cities:end -->";
export function citiesBlock(cities, n = 50) {
  const top = [...cities].filter((c) => !c.extra).sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name)).slice(0, n);
  return `<ul class="pg-chips">\n${top.map((c) => `<li><a href="/${cityPath(c)}">${esc(c.name)}, ${esc(c.state)}</a></li>`).join("\n")}\n</ul>`;
}
export function patchIndex(html, cities = []) {
  const block = homeHead();
  let out = html.includes(SEO_START)
    ? html.replace(new RegExp(reEsc(SEO_START) + "[\\s\\S]*?" + reEsc(SEO_END)), () => block)
    : html.replace(/<title>[^<]*<\/title>\s*<meta name="description"[^>]*>/, () => block);
  if (out.includes(CITIES_START) && out.includes(CITIES_END)) out = out.replace(new RegExp(reEsc(CITIES_START) + "[\\s\\S]*?" + reEsc(CITIES_END)), () => `${CITIES_START}\n${citiesBlock(cities)}\n${CITIES_END}`);
  return out;
}

// ---- main ----
export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const ev = read("site/data/events.json");
  const data = {
    now, generated: ev.generated, events: ev.events,
    cities: loadCities(root), sources: read("data/sources.json"),
    prevPages: (() => { try { return read("data/pages-lastmod.json"); } catch { return {}; } })(),
    shops: read("site/data/shops.json").shops || [],
    cityFeeds: new Set(fs.existsSync(path.join(root, "site/feeds")) ? fs.readdirSync(path.join(root, "site/feeds")).filter((n) => n.endsWith(".ics")).map((n) => n.slice(0, -4)) : []),
    eventArt: new Set(fs.existsSync(path.join(root, "site/art/events")) ? fs.readdirSync(path.join(root, "site/art/events")).filter((n) => n.endsWith(".svg")).map((n) => n.slice(0, -4)) : []),
    cityOg: new Set(fs.existsSync(path.join(root, "site/og")) ? fs.readdirSync(path.join(root, "site/og")).filter((n) => /^city-.*.png$/.test(n)).map((n) => n.slice(0, -4)) : []),
    brandPictures: (() => { try { return new Map(read("site/data/brands.json").brands.filter((x) => String(x.picture || "").startsWith("https://")).map((x) => [handleSlug(x.handle), x.picture])); } catch { return new Map(); } })(),
    watchlist: fs.existsSync(path.join(root, "data/watchlist.json")) ? read("data/watchlist.json") : { accounts: [] },
  };
  const out = buildSite(data);
  fs.writeFileSync(path.join(root, "data/pages-lastmod.json"), JSON.stringify(out.lastmods) + "\n"); // not under site/: the live app must not load it
  const site = path.join(root, "site");
  for (const dir of ["city", "brand", "state"]) fs.rmSync(path.join(site, dir), { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(site, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  const ix = path.join(site, "index.html");
  const html = fs.readFileSync(ix, "utf8"), next = patchIndex(html, data.cities);
  if (next !== html) fs.writeFileSync(ix, next);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`pages: ${o.counts.cities} city pages, ${o.counts.brands} brand pages, ${o.urls.length} sitemap urls, ${(o.counts.bytes / 1048576).toFixed(2)} MB`);
}
