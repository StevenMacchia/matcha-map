// npm run feeds: calendar and RSS feeds written into site/feeds/. Runs at the end of `npm run ingest` (after pages).
//   all.ics                every upcoming pop-up            <city>-<st>.ics   one per city with an upcoming pop-up
//   events/<id>.ics        one event, for add-to-calendar    new.xml           RSS 2.0: first seen in the last 14 days
//   index.json             { all, new, cities: { "<city>-<st>": "/feeds/<city>-<st>.ics" } }
// Times are written as UTC (no VTIMEZONE needed); all-day events are DATE values. UID = the event id.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { isUpcoming, isApprox, makeCityLocator, brandNameOf, timeText } from "./gen-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NEW_DAYS = 14;
export const NEW_MAX = 100;
export const UID_DOMAIN = "matchamap-cu7.pages.dev";
// Calendar feeds: the end (or the start, if no end) is today or later, by the event's own calendar day.
export function inCalendar(e, now = new Date()) {
  if (!e || !e.id || e.status === "cancelled") return false;
  const ref = e.end && !isNaN(Date.parse(e.end)) ? e.end : e.start;
  if (isNaN(Date.parse(ref))) return false;
  let today;
  try { today = new Intl.DateTimeFormat("en-CA", { timeZone: e.tz || "UTC" }).format(now); } catch { today = now.toISOString().slice(0, 10); }
  return String(ref).slice(0, 10) >= today;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
const slugOf = (s) => String(s || "").toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pad = (n, w = 2) => String(n).padStart(w, "0");

// ---- ICS ----
export function icsEscape(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
// Fold at 75 octets (never inside a multi-byte character), continuation lines start with a space.
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; limit = 74; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
// ISO string with offset -> "20261205T160000Z".
export function utcStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
// The local calendar date written in the ISO string ("2026-12-05T00:00:00-05:00" -> "20261205"), plus n days.
export function dateValue(iso, plusDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + plusDays));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export const eventUrl = (e) => `${SITE_URL}/e/${e.id}/`;

export function whereText(e) {
  const city = [e.city, e.state].filter(Boolean).join(", ");
  if (isApprox(e)) return city;
  return [e.venue, e.address, city].filter(Boolean).join(", ");
}
export function descriptionText(e, brand) {
  const bits = [];
  if (e.description) bits.push(e.description);
  if (Array.isArray(e.menu) && e.menu.length) bits.push(`Menu: ${e.menu.join(", ")}`);
  if (e.price) bits.push(`Price: ${e.price}`);
  if (e.confidence === "unsure") bits.push("Details not confirmed yet. Check the brand's post before you go.");
  else if (e.confidence === "likely") bits.push("Likely, not fully confirmed.");
  bits.push(`More: ${eventUrl(e)}`);
  return bits.join("\n");
}

// One VEVENT as an array of unfolded lines.
export function veventLines(e, { stampIso } = {}) {
  const brand = e.brand || "Matcha";
  const lines = ["BEGIN:VEVENT", `UID:${e.id}@${UID_DOMAIN}`];
  const stamp = utcStamp(stampIso) || utcStamp(e.last_seen) || utcStamp(new Date().toISOString());
  lines.push(`DTSTAMP:${stamp}`);
  const mod = utcStamp(e.last_seen);
  if (mod) lines.push(`LAST-MODIFIED:${mod}`);
  if (e.all_day) {
    const s = dateValue(e.start);
    let endPlus = dateValue(e.end || e.start, 1);
    if (e.end && dateValue(e.end, 1) <= s) endPlus = dateValue(e.start, 1);
    lines.push(`DTSTART;VALUE=DATE:${s}`, `DTEND;VALUE=DATE:${endPlus}`);
  } else {
    const s = utcStamp(e.start);
    const endIso = e.end && !isNaN(Date.parse(e.end)) ? e.end : new Date(Date.parse(e.start) + 2 * 36e5).toISOString();
    lines.push(`DTSTART:${s}`, `DTEND:${utcStamp(endIso)}`);
  }
  lines.push(`SUMMARY:${icsEscape(e.title || `${brand} matcha pop-up`)}`);
  const where = whereText(e);
  if (where) lines.push(`LOCATION:${icsEscape(where)}`);
  lines.push(`DESCRIPTION:${icsEscape(descriptionText(e, brand))}`);
  lines.push(`URL:${eventUrl(e)}`);
  if (!isApprox(e) && typeof e.lat === "number" && typeof e.lng === "number") lines.push(`GEO:${e.lat.toFixed(6)};${e.lng.toFixed(6)}`);
  lines.push(`STATUS:${e.confidence === "unsure" ? "TENTATIVE" : "CONFIRMED"}`, "CATEGORIES:Matcha", "END:VEVENT");
  return lines;
}
export function calendar(name, events, { stampIso } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Matcha Map//Pop-ups//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H"];
  for (const e of events) lines.push(...veventLines(e, { stampIso }));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- RSS ----
const xesc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const rfc822 = (iso) => new Date(iso).toUTCString();
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
export function enclosureOf(e, root = ROOT) {
  let url = "", len = 0;
  if (e.image && e.image.local) {
    url = `${SITE_URL}/${e.image.local}`;
    try { len = fs.statSync(path.join(root, "site", e.image.local)).size; } catch { len = 0; }
  } else if (e.image && /^https?:\/\//.test(e.image.url || "")) url = e.image.url;
  else if (/^https?:\/\//.test(e.image_url || "")) url = e.image_url;
  if (!url) return null;
  const ext = (/\.([a-z]{3,4})(?:\?|$)/i.exec(url) || [])[1];
  return { url, length: len, type: MIME[String(ext || "").toLowerCase()] || "image/jpeg" };
}
export function rss(events, { now = new Date(), root = ROOT } = {}) {
  const fresh = events.filter((e) => e.first_seen && now - Date.parse(e.first_seen) <= NEW_DAYS * 864e5 && !isNaN(Date.parse(e.first_seen)))
    .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen) || (a.id < b.id ? -1 : 1)).slice(0, NEW_MAX);
  const items = fresh.map((e) => {
    const brand = e.brand || "A matcha brand";
    const title = `${brand}, ${dayLabel(e.start)}, ${e.city || [e.state].filter(Boolean).join("")}`;
    const enc = enclosureOf(e, root);
    return `<item>
<title>${xesc(title)}</title>
<link>${xesc(eventUrl(e))}</link>
<guid isPermaLink="false">${xesc(e.id)}</guid>
<pubDate>${rfc822(e.first_seen)}</pubDate>
<description>${xesc(descriptionText(e, brand).replace(/\n/g, " "))}</description>${enc ? `\n<enclosure url="${xesc(enc.url)}" length="${enc.length}" type="${enc.type}"/>` : ""}
</item>`;
  });
  const built = fresh.length ? rfc822(fresh[0].first_seen) : now.toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Matcha Map: new pop-ups</title>
<link>${SITE_URL}/</link>
<atom:link href="${SITE_URL}/feeds/new.xml" rel="self" type="application/rss+xml"/>
<description>Matcha pop-ups first seen in the last ${NEW_DAYS} days.</description>
<language>en-us</language>
<lastBuildDate>${built}</lastBuildDate>
${items.join("\n")}
</channel>
</rss>
`;
}

// ---- the whole set ----
export function buildFeeds({ events, cities = [], now = new Date(), generated = null }) {
  const nowMs = now.getTime();
  const up = events.filter((e) => e.id && isUpcoming(e, nowMs) && inCalendar(e, now)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1));
  const locate = makeCityLocator(cities);
  const stampIso = generated || now.toISOString();
  const files = new Map();
  files.set("all.ics", calendar("Matcha Map: all pop-ups", up, { stampIso }));
  const byCity = new Map();
  for (const e of up) {
    const c = locate(e);
    const key = c ? `${c.slug}-${c.state.toLowerCase()}` : e.city && e.state ? `${slugOf(e.city)}-${e.state.toLowerCase()}` : null;
    if (!key) continue;
    if (!byCity.has(key)) byCity.set(key, { name: c ? c.name : e.city, state: e.state, events: [] });
    byCity.get(key).events.push(e);
  }
  const cityIndex = {}, names = {};
  for (const [key, v] of [...byCity].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    files.set(`${key}.ics`, calendar(`Matcha Map: ${v.name}, ${v.state}`, v.events, { stampIso }));
    cityIndex[key] = `/feeds/${key}.ics`; names[key] = `${v.name}, ${v.state}`;
  }
  for (const e of up) files.set(`events/${e.id}.ics`, calendar(`${e.brand || "Matcha"} pop-up`, [e], { stampIso }));
  files.set("new.xml", rss(events.filter((e) => e.status !== "cancelled" && e.id && isUpcoming(e, nowMs) && inCalendar(e, now)), { now }));
  const freshCount = (files.get("new.xml").match(/<item>/g) || []).length;
  files.set("index.json", JSON.stringify({ generated: stampIso, all: "/feeds/all.ics", new: "/feeds/new.xml", cities: cityIndex, names }, null, 1) + "\n");
  return { files, counts: { cities: byCity.size, events: up.length, fresh: freshCount } };
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const ev = read("site/data/events.json");
  const cities = read("data/cities.json").cities;
  const out = buildFeeds({ events: ev.events, cities, now, generated: ev.generated });
  const dir = path.join(root, "site", "feeds");
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [p, text] of out.files) { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`feeds: all.ics, ${o.counts.cities} city feeds, ${o.counts.events} event files, new.xml with ${o.counts.fresh} item(s)`);
}
