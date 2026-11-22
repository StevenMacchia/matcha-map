// Shared by the per-site crawlers in this folder (ingest/lib/sites/<name>.js).
// Every crawler exports { name, host, discover(ctx) -> { items: RawItem[], candidates: Candidate[], stats } } where
// ctx = { fetcher, now, sources, cities?, cap? }. A RawItem is the normal extractor input plus
// `source_hint`: the pseudo-source record (id `<site>:<slug>`) the event belongs to, built by pseudoSource() below.
//
// Rules every crawler follows: the shared fetcher (project User-Agent, robots.txt, 1 request per second per host,
// 6-hour disk cache); robots.txt fetched first and the site skipped when it answers 401/403/429 or disallows
// everything for us; at most CAP network fetches per site per run; every further request stops after an HTTP 429
// or 403; only public pages, JSON-LD or JSON the page itself embeds; never instagram.com, tiktok.com or
// facebook.com; keep matcha events only (word list in adapters/mato.js).
//
// Pop-up aggregators checked in rung 22 (2026-11-22) and skipped; none has a public, allowed, structured, dated listing:
//   thepopuplist.com     robots.txt allows all, but every page redirects to /lander (a parked page); no listings.
//   popupinsider.com     robots.txt allows public pages; a retail-industry magazine (WordPress), editorial articles, no event listing, no JSON-LD.
//   shoppopup.com        did not answer (no connection).
//   popupsnearme.com     a Squarespace "Coming Soon" page; its robots.txt carries "Disallow: /".
//   thepopupcollective.com  a photography portfolio (Wix); no events.
//   US pop-up finders    three web searches found only city pages on Eventbrite and AllEvents (both crawled already) and editorial roundups.
//   Local calendars seen in results, not built: thebostoncalendar.com, downtownraleigh.org/do, rinoartdistrict.org/do (single-city, mostly past dates).
//   MarketSpread         is used: adapters/marketspread.js (robots allows all; vendor page -> market -> event pages naming the vendor).
import { parseRobots, robotsAllows } from "../fetch.js";
import { jsonLd, ldImage, httpUrl, decode } from "../html.js";
import { eventToRaw, hasMatcha } from "../../adapters/mato.js";
import { zonedIso, tzFor, STATES } from "../tz.js";
import { debug, warn } from "../log.js";

export { hasMatcha };
export const CAP = 300;
const STATE_SET = new Set(STATES);

// Prefixes of pseudo-source ids. Events under them stay only while a matcha word is in their text (write.js).
// The order is the duplicate priority: when two sites list the same event, the lower rank wins.
export const SITE_ORDER = ["mato", "luma", "eventbrite", "dostuff", "meetup", "linktree", "allevents", "tiktok", "instagram"];

export const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export const looksLikeHandle = (s) => /^[A-Za-z0-9._]{3,30}$/.test(s || "") && /[A-Za-z]/.test(s) && !/\.$/.test(s) && !/\.\./.test(s);
export const titleKey = (t) => String(t || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();

// A fetcher wrapper for one site: counts network fetches (cache hits are free), stops at the cap and after HTTP 429 or 403.
export function siteBudget(fetcher, name, cap = CAP) {
  const st = { used: 0, cap, stopped: null, hitCap: false, pages: 0 };
  const get = async (url, opts = {}) => {
    if (st.stopped) return { ok: false, status: st.stopped, text: "", skipped: true };
    if (st.used >= cap) { st.hitCap = true; return { ok: false, status: 0, text: "", skipped: true }; }
    let r;
    try { r = await fetcher.get(url, opts); } catch (e) { debug(name, "fetch failed", url, e.message); st.used++; return { ok: false, status: 0, text: "", error: e.message }; }
    if (!r.fromCache && !r.blocked) st.used++;
    if (r.ok) st.pages++;
    if ((r.status === 429 || r.status === 403) && !opts.isRobots) { st.stopped = r.status; warn(`${name}: HTTP ${r.status}, stopping for this run`); }
    return r;
  };
  return { get, st, left: () => cap - st.used };
}

// robots.txt first. -> {ok:true} or {ok:false, reason}. A site that answers 401/403/429 to robots.txt, or disallows "/"
// for us, is skipped for the whole run. A missing robots.txt (404) means no rules.
export async function gate(b, host) {
  // A 403 on robots.txt skips that host only (bot protection); it does not stop the other hosts of a multi-host crawl.
  const r = await b.get(`https://${host}/robots.txt`, { robots: false, isRobots: true });
  if (r.skipped) return { ok: false, reason: r.status ? `stopped (HTTP ${r.status})` : "no budget" };
  if (r.status === 401 || r.status === 403 || r.status === 429) return { ok: false, reason: `robots.txt answered HTTP ${r.status}` };
  if (r.status >= 500 || r.status === 0) return { ok: false, reason: `robots.txt unreachable (${r.status || r.error || "error"})` };
  if (!r.ok) return { ok: true, rules: [] };
  const rules = parseRobots(r.text);
  if (!robotsAllows(rules, "/")) return { ok: false, reason: "robots.txt disallows /" };
  return { ok: true, rules };
}

// ---- JSON-LD events -----------------------------------------------------------------------------
const isEventType = (t) => [].concat(t || []).some((x) => /Event$/.test(String(x)));

// Every Event in a page's JSON-LD (also inside an ItemList, an @graph or a nested "item"), with a location given
// by @id resolved against Place objects in the same graph. -> [ld]
export function ldEvents(html) {
  const places = new Map();
  const out = [];
  const walk = (n, d = 0) => {
    if (!n || typeof n !== "object" || d > 6) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d + 1)); return; }
    if (n["@type"] === "Place" && n["@id"]) places.set(n["@id"], n);
    if (isEventType(n["@type"]) && n.startDate) out.push(n);
    if (n.itemListElement) walk(n.itemListElement, d + 1);
    if (n.item) walk(n.item, d + 1);
  };
  jsonLd(html).forEach((b) => walk(b));
  for (const e of out) {
    const loc = [].concat(e.location || [])[0];
    if (loc && typeof loc === "object" && loc["@id"] && !loc.name && places.has(loc["@id"])) e.location = places.get(loc["@id"]);
  }
  return out;
}

const US = /^(US|USA|United States( of America)?)$/i;

// Location of an Event -> {venue, street, city, state, zip, country, address} (state only when it is a US 2-letter code).
export function placeOf(ld) {
  const loc = [].concat(ld.location || []).find((l) => l && typeof l === "object") || {};
  const a = typeof loc.address === "string" ? { streetAddress: loc.address } : loc.address || {};
  const street = String(a.streetAddress || "").replace(/\s+/g, " ").trim();
  const state = [a.addressRegion, /,\s*([A-Z]{2})\s+\d{5}/.exec(street)?.[1], /,\s*([A-Z]{2})\s*$/.exec(street)?.[1]].map((s) => String(s || "").toUpperCase()).find((s) => STATE_SET.has(s)) || null;
  const city = a.addressLocality ? decode(a.addressLocality).trim() : null;
  const zip = a.postalCode ? String(a.postalCode).slice(0, 5) : /\b(\d{5})\b/.exec(street)?.[1] || null;
  // Some feeds repeat city, state and zip inside the street line; keep just the street part, and only when it starts with a number.
  const first = street.split(",")[0].trim();
  const hasNo = /^\d/.test(first);
  const address = hasNo ? [first, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null;
  return { venue: loc.name ? decode(loc.name).trim() : null, street: hasNo ? first : null, city, state, zip, country: a.addressCountry || null, address };
}

const online = (ld) => /Online/.test(String(ld.eventAttendanceMode || "")) && !/Mixed|Offline/.test(String(ld.eventAttendanceMode || ""));

// ld Event -> RawItem or null (no start, cancelled, online-only, no US place). opts: {cityHint:{city,state}, handle}.
// A date-only startDate becomes an all-day event.
export function ldToRaw(ld, url, { cityHint = null, handle = null } = {}) {
  if (!ld?.startDate || online(ld)) return null;
  const raw = eventToRaw({ ...ld, "@type": "Event" }, url);
  if (!raw) return null;
  const p = placeOf(ld);
  if (p.country && !US.test(String(p.country))) return null;
  const state = p.state || cityHint?.state || null;
  const city = p.city || cityHint?.city || null;
  if (!state || !STATE_SET.has(state)) return null;
  raw.hints.city = city;
  raw.hints.state = state;
  if (p.address) raw.hints.address = p.address;
  raw.hints.venue = p.venue && !/^[0-9]/.test(p.venue) && p.venue.toLowerCase() !== String(city || "").toLowerCase() ? p.venue : null;
  const sd = String(ld.startDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
    const [y, mo, d] = sd.split("-").map(Number);
    raw.hints.start = zonedIso(tzFor({ city, state }) || "America/New_York", y, mo, d, 0, 0);
    raw.hints.end = null;
    raw.hints.all_day = true;
  }
  const org = [].concat(ld.organizer || [])[0] || {};
  raw.organizer = { name: org.name ? decode(org.name).trim() : null, url: httpUrl(org.url) };
  if (handle) raw.handle = handle;
  return raw;
}

// ---- pseudo sources and candidates --------------------------------------------------------------
const orgKey = (u) => {
  const s = String(u || "").toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  return /\/o\/(?:[^/]*-)?(\d{6,})$|\/org\/[^/]+\/(\d+)$/.exec(s)?.slice(1).find(Boolean) || s;
};

// An existing source that already reads this organizer (same instagram handle, or schedule_url on the same organizer page).
export function knownSource(sources, { handle = null, orgUrl = null } = {}) {
  return (sources || []).find((s) => (handle && s.instagram && s.instagram.toLowerCase() === handle.toLowerCase()) || (orgUrl && s.schedule_url && orgKey(s.schedule_url) === orgKey(orgUrl))) || null;
}

// The source an event belongs to: an existing record, or the pseudo-source `<site>:<slug>` with brand = organizer name
// (else the venue), kind popup, category matcha.
export function pseudoSource(site, raw, sources = []) {
  const org = raw.organizer || {};
  const known = knownSource(sources, { handle: raw.handle, orgUrl: org.url });
  if (known) return known;
  const name = org.name || raw.hints?.venue || "Matcha event";
  const slug = slugify(org.name || raw.hints?.venue) || "event";
  return {
    id: `${site}:${slug}`, brand: name, home_city: raw.hints?.city || "", home_state: raw.hints?.state || "",
    website: null, instagram: raw.handle && looksLikeHandle(raw.handle) ? raw.handle : null, tiktok: null,
    schedule_url: org.url || null, schedule_kind: "website", adapter: site, active: true, kind: "popup", category: "matcha",
  };
}

// A new organizer -> watchlist candidate (found_via search, found_from <site>). Handle: the Instagram handle when the page
// gave one, else the slug with characters mapped to "_" (the watchlist handle pattern); the note keeps site and organizer.
export function candidateFor(site, raw, source) {
  const slug = source.id.split(":")[1] || slugify(source.brand);
  const handle = raw.handle && looksLikeHandle(raw.handle) ? raw.handle : slug.replace(/[^A-Za-z0-9._]/g, "_");
  const note = `site=${site}; org=${slug}; home=${source.home_city}, ${source.home_state}; brand=${source.brand}; e.g. ${raw.hints?.title || ""}`.slice(0, 160);
  return { handle, found_via: "search", found_from: site, evidence: note, city: source.home_city, state: source.home_state };
}

// RawItems -> {items, candidates}: keep matcha ones, attach source_hint, one candidate per new organizer.
export function finish(site, raws, sources = []) {
  const items = [], candidates = [], seen = new Set();
  const have = new Set((sources || []).map((s) => s.id));
  for (const raw of raws) {
    if (!hasMatcha(raw.text, raw.description, raw.tags, raw.hints?.title, raw.hints?.venue, raw.organizer?.name)) continue;
    const source = pseudoSource(site, raw, sources);
    raw.source_hint = source;
    items.push(raw);
    if (!have.has(source.id) && !seen.has(source.id)) { seen.add(source.id); candidates.push(candidateFor(site, raw, source)); }
  }
  return { items, candidates };
}

// The 40 cities of data/cities-discover.json: state for the per-city crawls.
export const CITY_STATE = {
  "New York": "NY", Brooklyn: "NY", "Los Angeles": "CA", "San Francisco": "CA", Oakland: "CA", "San Diego": "CA", Seattle: "WA", Portland: "OR", Chicago: "IL",
  Boston: "MA", Philadelphia: "PA", "Washington DC": "DC", Atlanta: "GA", Miami: "FL", Austin: "TX", Houston: "TX", Dallas: "TX", Denver: "CO", Phoenix: "AZ",
  "Las Vegas": "NV", Minneapolis: "MN", Detroit: "MI", Nashville: "TN", Charlotte: "NC", Raleigh: "NC", Pittsburgh: "PA", Baltimore: "MD", "San Jose": "CA",
  Sacramento: "CA", "Salt Lake City": "UT", Orlando: "FL", Tampa: "FL", "New Orleans": "LA", Honolulu: "HI", Columbus: "OH", Cleveland: "OH", "Kansas City": "MO",
  "St. Louis": "MO", Indianapolis: "IN", Providence: "RI",
};
export const citySlug = (name) => String(name).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// What a crawler returns when it does not run.
export const skipped = (reason, stats = {}) => ({ items: [], candidates: [], stats: { skipped: reason, fetches: 0, pages: 0, ...stats } });

// Cross-site duplicate key: normalized title + day.
export const dupKey = (title, start) => `${titleKey(title)}|${String(start || "").slice(0, 10)}`;
