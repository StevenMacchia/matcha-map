// Depth for upcoming events: fill hours, price, menu, poster and description from the event's own public page, only where the field
// is empty and only from words that page prints. Listing and article pages (a newsletter, a guide) are never read for these fields:
// they describe many events. Instagram and TikTok are behind a login and are not fetched.
import { jsonLd, metaContent, ldImage, decode } from "./html.js";
import { priceFromText, menuFromText, hoursFromText, payFromText, descriptionFromText } from "./extract.js";
import { tzForPlace, tzFor, offsetMinutes, zonedIso } from "./tz.js";

// Hosts whose pages are one event each (a page per date), so their markup is that event's.
export const EVENT_PAGE_HOSTS = /(^|\.)(eventbrite\.[a-z.]+|ma\.to|allevents\.in|luma\.com|lu\.ma|meetup\.com|happeningnext\.com)$/i;
export const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
export const isEventPage = (u) => EVENT_PAGE_HOSTS.test(hostOf(u));

const money = (n) => { const x = Number(n); return Number.isFinite(x) ? "$" + (Number.isInteger(x) ? x : x.toFixed(2)) : null; };

// "Free", "$12", "$10 to $25" from JSON-LD offers; null when the page prints no price. USD only.
export function priceFromOffers(offers) {
  const list = (Array.isArray(offers) ? offers : offers ? [offers] : []).flatMap((o) => (o && o.offers ? [o.offers].flat() : [o]));
  const nums = [];
  for (const o of list) {
    if (!o || (o.priceCurrency && !/^usd$/i.test(o.priceCurrency))) continue;
    for (const k of ["price", "lowPrice", "highPrice"]) if (o[k] !== undefined && o[k] !== "" && Number.isFinite(Number(o[k]))) nums.push(Number(o[k]));
  }
  if (!nums.length) return null;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  if (hi === 0) return "Free";
  return lo === hi ? money(lo) : lo === 0 ? `Free to ${money(hi)}` : `${money(lo)} to ${money(hi)}`;
}

// What an event page says about itself: { name, description, image_url, price, startDate, endDate, offers }, or null without an Event block.
export function pageFacts(html) {
  const ev = jsonLd(html).find((x) => [x["@type"]].flat().some((t) => /Event$/i.test(String(t))));
  if (!ev) return null;
  const stripTags = (s) => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return {
    name: stripTags(ev.name), description: stripTags(ev.description) || stripTags(metaContent(html, "og:description")) || null,
    image_url: ldImage(ev.image) || metaContent(html, "og:image") || null, price: priceFromOffers(ev.offers),
    startDate: ev.startDate || null, endDate: ev.endDate || null,
  };
}

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.values(v).some(Boolean));

// The fields to fill on event `e` from page facts: only empty ones. Returns { patch, filled: [names] }.
export function fillFrom(e, f, url) {
  const patch = {}, filled = [];
  const set = (k, v) => { patch[k] = v; filled.push(k); };
  if (!f) return { patch, filled };
  const tf = timeFix(e, f);
  if (tf && tf.start) { patch.start = tf.start; patch.all_day = false; if (!e.end && tf.end) patch.end = tf.end; filled.push("time"); }
  const text = [f.name, f.description].filter(Boolean).join("\n");
  if (empty(e.description) && f.description && f.description.length >= 30) set("description", descriptionFromText(f.description));
  if (empty(e.price)) { const p = f.price || priceFromText(f.description); if (p) set("price", p); }
  if (empty(e.menu)) { const m = menuFromText(text); if (m && m.length) set("menu", m.slice(0, 8)); }
  if (empty(e.hours)) { const h = hoursFromText(f.description || ""); if (h) set("hours", h); }
  if (empty(e.pay)) { const p = payFromText(f.description || ""); if (p) set("pay", p); }
  if (empty(e.image) && empty(e.image_url) && f.image_url) { set("image_url", f.image_url); patch.image = { url: f.image_url, local: null, credit: hostOf(url), width: null, height: null }; filled.push("image"); }
  return { patch, filled };
}

// A page's start date against the stored start: same instant, same wall clock in another zone (a zone bug), or a different day.
// -> "same" | "tz" (the wall-clock time matches but the offset does not) | "differs" | null (no usable date)
export function compareStart(e, f) {
  if (!f || !f.startDate) return null;
  const ps = Date.parse(f.startDate), es = Date.parse(e.start);
  if (!Number.isFinite(ps) || !Number.isFinite(es)) return null;
  if (ps === es) return "same";
  const wall = (s) => String(s).replace(/(Z|[+-]\d{2}:?\d{2})$/, "").slice(0, 16);
  if (wall(f.startDate) === wall(e.start)) return "tz";
  return "differs";
}

// The zone an event should have: its pin's zone for states split by a line, else its city's, else its state's.
export function expectedTz(e) {
  // A city-only event is drawn at its city's centre, which is good enough to pick the zone of a state a line runs through.
  return tzForPlace(e.state, e.lat, e.lng) || tzFor({ city: e.city, state: e.state });
}

// A stored all-day (or local-midnight) start whose own page prints a time on the same day gets that time, in the event's zone.
// Page dates are read as wall-clock: Allevents prints local time with a +00:00 label, so the offset on the page is never used.
export function timeFix(e, f) {
  if (!f || !f.startDate || !(e.all_day || /T00:00:00/.test(e.start))) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(f.startDate);
  if (!m || (m[4] === "00" && m[5] === "00") || `${m[1]}-${m[2]}-${m[3]}` !== String(e.start).slice(0, 10)) return null;
  const zoned = (iso) => { const x = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || ""); return x ? zonedIso(e.tz, +x[1], +x[2], +x[3], +x[4], +x[5]) : null; };
  const start = zoned(f.startDate), end = zoned(f.endDate);
  return { start, end: end && Date.parse(end) > Date.parse(start) && Date.parse(end) - Date.parse(start) <= 18 * 3600000 ? end : null, all_day: false };
}
export { offsetMinutes };
