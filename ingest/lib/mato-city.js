// MATO city crawler: finds matcha events and the venues behind them on ma.to, in every US city.
//
// How MATO is laid out (read from the public HTML on 2026-11-22; no ma.to/api/ call anywhere):
//   robots.txt           https://ma.to/robots.txt. Allows everything except /api/, /search, /venue/added,
//                        account pages and any URL with a query string (Disallow: /*?). The project fetcher
//                        applies these. Its Sitemap line points at https://ma.to/sitemap.xml.
//   city list            https://ma.to/cities. Server-rendered, one <section> per country: an <h2> with the
//                        country name, then <ul><li><a href="/events/<city-slug>">City</a>. 82 cities today;
//                        the "United States" section is the one we use. The page also carries an ItemList
//                        JSON-LD (all countries mixed), which we do not use because it has no country.
//   city page            https://ma.to/events/<city-slug>  (today's events, at most 18 cards)
//                        https://ma.to/events/<city-slug>/this-weekend
//                        https://ma.to/events/<city-slug>/anytime/<category>  (the next 18 of that category;
//                        categories seen: food-and-drinks, markets, workshops, wellness, community, party ...).
//                        There is no plain-link pagination: "load more" is a script call to /api/, so a city
//                        page only ever shows the nearest 18 events. Each card is an <a aria-label="<title>"
//                        class="absolute inset-0 z-0" href="/event/<slug>"> followed by date, title, venue name,
//                        a one-line blurb and category tags. The page JSON-LD CollectionPage lists the same
//                        events as ItemList (name + url).
//   event page           https://ma.to/event/<title>-<dd>-<mon>-<yyyy>[-n]  (or ...-<yyyy>-<mm>-<dd>); schema.org
//                        Event JSON-LD with name, description, startDate, image, organizer {name, url
//                        /venue/<slug>}, location {name, address {streetAddress, addressLocality, addressRegion?,
//                        addressCountry}}. The organizer slug is the brand; it is usually its Instagram handle.
//   venue page           https://ma.to/venue/<slug>  (read by ingest/adapters/mato.js)
//   sitemaps             https://api.ma.to/v1/sitemap?type=static|events-structured|events&page=N|venues&page=N
//                        (host api.ma.to, path /v1/sitemap, named by ma.to's own robots.txt Sitemap line, so it is
//                        the published crawler route and not the disallowed ma.to/api/). "events-structured" lists
//                        which city/category pages exist; "events" lists every event URL (about 940,000, 94 pages of
//                        10,000, about 2 MB each, past events included) with the title in the slug. A matcha word in
//                        the slug is a cheap signal for events the nearest-18 city pages do not reach.
//
// Politeness: the shared fetcher (project User-Agent, robots.txt, 1 request per second per host, 6 hour disk
// cache), at most CAP network fetches per run, and no more requests after an HTTP 429.
import fs from "node:fs";
import path from "node:path";
import { decode, jsonLd } from "./html.js";
import { slugDate, eventToRaw, hasMatcha, slugHasMatcha } from "../adapters/mato.js";
export { hasMatcha, slugHasMatcha };
import { debug, info, warn } from "./log.js";

export const BASE = "https://ma.to";
export const SITEMAP_INDEX = `${BASE}/sitemap.xml`;
export const CAP = 400;
export const CITIES_TTL_MS = 24 * 3600 * 1000;
export const CITY_PAGES = ["", "/this-weekend", "/anytime/food-and-drinks", "/anytime/markets"]; // suffixes after /events/<city>
const DAY = 86400000;

// US cities MATO lists -> state. The city page gives no state; an event page usually does and wins when it has one.
export const CITY_STATE = {
  alameda: "CA", atlanta: "GA", austin: "TX", baltimore: "MD", berkeley: "CA", boston: "MA", charlotte: "NC", chicago: "IL",
  columbus: "OH", dallas: "TX", denver: "CO", detroit: "MI", "fort-worth": "TX", honolulu: "HI", houston: "TX", "kansas-city": "MO",
  "los-angeles": "CA", miami: "FL", minneapolis: "MN", nashville: "TN", "new-orleans": "LA", "new-york": "NY", oakland: "CA",
  orlando: "FL", "palo-alto": "CA", philadelphia: "PA", phoenix: "AZ", pittsburgh: "PA", portland: "OR", raleigh: "NC",
  sacramento: "CA", "salt-lake-city": "UT", "san-antonio": "TX", "san-diego": "CA", "san-francisco": "CA", "san-jose": "CA",
  "santa-barbara": "CA", seattle: "WA", washington: "DC",
};
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");

// ---- what counts as matcha: hasMatcha and slugHasMatcha live in adapters/mato.js (re-exported above) ----

// A MATO venue slug that is also a valid Instagram handle (letters, digits, dots, underscores; no hyphens).
export const looksLikeHandle = (slug) => /^[A-Za-z0-9._]{3,30}$/.test(slug || "") && /[A-Za-z]/.test(slug) && !/\.$/.test(slug) && !/\.\./.test(slug);

// ---- city list ---------------------------------------------------------------------------------
// /cities html -> [{slug, name, country}] (every country). US ones: filter country === "United States".
export function parseCities(html) {
  const out = [];
  for (const sec of String(html).split(/<section\b/).slice(1)) {
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(sec);
    if (!h2) continue;
    const country = decode(h2[1].replace(/<[^>]+>|<!--[\s\S]*?-->/g, " ")).replace(/[^\p{L} ]+/gu, " ").replace(/\s+/g, " ").trim();
    for (const m of sec.matchAll(/<a\b[^>]*href="\/events\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      out.push({ slug: m[1], name: decode(m[2].replace(/<[^>]+>/g, "")).trim(), country });
    }
  }
  return out;
}
export const usCities = (cities) => cities.filter((c) => c.country === "United States");

// .cache/mato-cities.json, good for a day. Returns {cities, fromCache}.
export async function loadCities(get, { file = ".cache/mato-cities.json", now = new Date() } = {}) {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c.cities?.length && now.getTime() - Date.parse(c.fetched) < CITIES_TTL_MS) return { cities: c.cities, fromCache: true };
  } catch { /* none */ }
  const r = await get(`${BASE}/cities`);
  if (!r.ok) return { cities: [], fromCache: false, error: r.blocked ? "blocked by robots.txt" : `HTTP ${r.status || "error"}` };
  const cities = parseCities(r.text);
  if (cities.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fetched: now.toISOString(), cities }, null, 1));
  }
  return { cities, fromCache: false };
}

// ---- city page events ----------------------------------------------------------------------------
// A city page -> [{slug, url, title, venue, text}] (cards in page order; falls back to the JSON-LD ItemList).
export function parseCityEvents(html) {
  const out = new Map();
  const anchors = [...String(html).matchAll(/<a\b[^>]*aria-label="([^"]*)"[^>]*href="\/event\/([a-z0-9-]+)"[^>]*>/g)];
  anchors.forEach((m, i) => {
    const slug = m[2];
    if (out.has(slug)) return;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : m.index + 6000;
    const seg = String(html).slice(m.index + m[0].length, Math.min(end, m.index + 6000))
      .replace(/<(script|style|svg|button)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n");
    const lines = decode(seg).split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const title = decode(m[1]);
    const at = lines.findIndex((l) => l === title);
    const venue = at >= 0 && lines[at + 1] && !/^\d{1,2} \w{3} \d{4}$/.test(lines[at + 1]) ? lines[at + 1] : null;
    out.set(slug, { slug, url: `${BASE}/event/${slug}`, title, venue, text: [title, ...lines].join(" | ") });
  });
  for (const x of jsonLd(html)) {
    for (const it of x?.mainEntity?.itemListElement || []) {
      const slug = /\/event\/([a-z0-9-]+)/.exec(it.url || "")?.[1];
      if (slug && !out.has(slug)) out.set(slug, { slug, url: `${BASE}/event/${slug}`, title: it.name || "", venue: null, text: it.name || "" });
    }
  }
  return [...out.values()];
}

// Keep the cards that mention matcha in the title, blurb, venue, tags or in the slug itself.
export const matchaCards = (cards) => cards.filter((c) => hasMatcha(c.text) || slugHasMatcha(c.slug));

// ---- sitemaps ------------------------------------------------------------------------------------
export const sitemapLocs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));

// A sitemap index -> {events:[urls], structured:url|null}.
export function parseSitemapIndex(xml) {
  const locs = sitemapLocs(xml);
  return { events: locs.filter((u) => /type=events(&|$)/.test(u) && /page=/.test(u)), structured: locs.find((u) => /type=events-structured/.test(u)) || null };
}

// events-structured -> Map(city-slug -> Set of page suffixes that exist, like "/this-weekend", "/anytime/markets").
export function structuredPages(xml) {
  const m = new Map();
  for (const u of sitemapLocs(xml)) {
    const r = /^https:\/\/ma\.to\/events\/([a-z0-9-]+)(\/[a-z0-9/-]*)?$/.exec(u);
    if (!r) continue;
    if (!m.has(r[1])) m.set(r[1], new Set());
    m.get(r[1]).add(r[2] || "");
  }
  return m;
}

// An events sitemap page -> slugs with a matcha word that are not long past (undated slugs are kept).
export function matchaSlugsFromSitemap(xml, now = new Date()) {
  const cutoff = new Date(now).getTime() - DAY;
  const out = [];
  for (const u of sitemapLocs(xml)) {
    const slug = /^https:\/\/ma\.to\/event\/([a-z0-9-]+)$/.exec(u)?.[1];
    if (!slug || !slugHasMatcha(slug)) continue;
    const d = slugDate(slug);
    if (d === null || d >= cutoff) out.push(slug);
  }
  return out;
}

// ---- event pages -> found events ------------------------------------------------------------------
const slugOf = (url) => /\/venue\/([A-Za-z0-9._-]+)/.exec(url || "")?.[1] || null;

// Event page html -> {ld, venueSlug, venueName, city, state, country, address} or null. Never throws.
export function parseEventPage(html, cityHint = null) {
  const ld = jsonLd(html).find((x) => x["@type"] === "Event");
  if (!ld || !ld.startDate) return null;
  const org = [].concat(ld.organizer || [])[0] || {};
  let venueSlug = slugOf(org.url) || slugOf(org["@id"]);
  let venueName = org.name || null;
  if (!venueSlug) {
    const m = /href="\/venue\/([A-Za-z0-9._-]+)"[^>]*>([^<]*)/.exec(html);
    if (m) { venueSlug = m[1]; venueName = venueName || decode(m[2]).trim(); }
  }
  if (!venueSlug) venueSlug = slugOf(ld.location?.["@id"]);
  if (!venueName) venueName = ld.location?.name || null;
  const a = ld.location?.address || {};
  const street = typeof a === "string" ? a : a.streetAddress || "";
  const place = ld.location?.name || "";
  let state = [a.addressRegion, /,\s*([A-Z]{2})\b/.exec(street)?.[1], /,\s*([A-Z]{2})\s*$/.exec(place)?.[1]].map((s) => String(s || "").toUpperCase()).find((s) => STATES.has(s)) || null;
  const locality = (typeof a === "object" && a.addressLocality) || /,\s*([^,]+),\s*[A-Z]{2}\s*$/.exec(place)?.[1] || null;
  const city = locality ? decode(locality).trim() : cityHint?.name || null;
  if (!state) state = CITY_STATE[slugify(locality)] || CITY_STATE[cityHint?.slug] || null;
  const country = (typeof a === "object" && a.addressCountry) || null;
  return { ld, venueSlug, venueName, city, state, country, address: street || null };
}

// The brand record for an event whose venue slug is not in data/sources.json: id mato:<slug>.
export function syntheticSource(f) {
  const slug = f.venueSlug;
  return {
    id: `mato:${slug}`, brand: f.venueName || slug, home_city: f.city || "", home_state: f.state || "",
    website: null, instagram: looksLikeHandle(slug) ? slug : null, tiktok: null,
    schedule_url: `${BASE}/venue/${slug}`, schedule_kind: "website", adapter: "mato", active: true,
  };
}

export const handleFor = (slug) => (looksLikeHandle(slug) ? slug : String(slug).replace(/[^A-Za-z0-9._]/g, "_"));

// Which existing source (if any) already reads this MATO venue: by instagram handle or by schedule_url.
export function sourceForVenue(sources, slug) {
  const s = String(slug).toLowerCase();
  return (sources || []).find((x) => (x.instagram && x.instagram.toLowerCase() === s) || (x.schedule_url && x.schedule_url.toLowerCase().replace(/\/+$/, "") === `${BASE}/venue/${s}`)) || null;
}

// A found event -> {source, raw}: the RawItem from mato.js's own parser, with city and state set when MATO gave them.
export function foundToItem(f, url, sources = []) {
  const source = sourceForVenue(sources, f.venueSlug) || syntheticSource(f);
  const raw = eventToRaw(f.ld, url);
  if (!raw) return null;
  if (f.city) raw.hints.city = f.city;
  if (f.state) raw.hints.state = f.state;
  if (f.venueSlug && looksLikeHandle(f.venueSlug)) raw.handle = f.venueSlug;
  return { source, raw };
}

// Notes line on a watchlist candidate; promote() and pseudoSource() read it back (see watchlist.js).
export function candidateNote(f, title = "") {
  return `mato_venue=${f.venueSlug}; home=${f.city || ""}, ${f.state || ""}; brand=${f.venueName || f.venueSlug}; e.g. ${title || f.ld?.name || ""}`.slice(0, 160);
}
export function readNote(notes) {
  const m = /mato_venue=([A-Za-z0-9._-]+)/.exec(notes || "");
  if (!m) return null;
  const home = /home=([^;]*?),\s*([A-Z]{2})?\s*(?:;|$)/.exec(notes);
  const brand = /brand=([^;]*)/.exec(notes)?.[1]?.trim() || null;
  return { slug: m[1], city: home?.[1]?.trim() || "", state: home?.[2] || "", brand };
}

// ---- the crawl -------------------------------------------------------------------------------------
// Wraps the fetcher: counts network fetches (cache hits are free), stops at the cap and after an HTTP 429.
export function budgeted(fetcher, cap = CAP) {
  const st = { used: 0, cap, stopped429: false, hitCap: false };
  const get = async (url, opts = {}) => {
    if (st.stopped429) return { ok: false, status: 429, text: "", skipped: true };
    if (st.used >= cap) { st.hitCap = true; return { ok: false, status: 0, text: "", skipped: true }; }
    let r;
    try { r = await fetcher.get(url, opts); } catch (e) { debug("fetch failed", url, e.message); st.used++; return { ok: false, status: 0, text: "", error: e.message }; }
    if (!r.fromCache && !r.blocked) st.used++;
    if (r.status === 429) { st.stopped429 = true; warn("ma.to: HTTP 429, stopping for this run"); }
    return r;
  };
  return { get, st, left: () => cap - st.used };
}

// crawlMato(fetcher, {now, sources, cap, sitemap, cityFile, sitemapFile, reserve}) ->
//   { cities, usCities, kept:[{slug,url,city,state,citySlug,found}], items:[{source, raw}], candidates:[...], stats }
export async function crawlMato(fetcher, { now = new Date(), sources = [], cap = CAP, sitemap = true, cityFile = ".cache/mato-cities.json", sitemapFile = ".cache/mato-sitemap.json", reserve = 100 } = {}) {
  const b = budgeted(fetcher, cap);
  const stats = { cities: 0, usCities: 0, cityPages: 0, cards: 0, matchaCards: 0, sitemapPages: 0, sitemapMatches: 0, eventPages: 0, nonUs: 0, kept: 0, fetches: 0, hitCap: false, stopped429: false };
  const out = { cities: [], usCities: [], kept: [], items: [], candidates: [], stats };

  const cl = await loadCities(b.get, { file: cityFile, now });
  if (!cl.cities.length) { warn(`ma.to city list: ${cl.error || "empty"}`); return out; }
  out.cities = cl.cities; out.usCities = usCities(cl.cities);
  stats.cities = out.cities.length; stats.usCities = out.usCities.length;

  // Which pages exist per city (one small sitemap fetch); fall back to the default list.
  let exist = null;
  const idx = sitemap ? await b.get(SITEMAP_INDEX) : { ok: false };
  const index = idx.ok ? parseSitemapIndex(idx.text) : { events: [], structured: null };
  if (index.structured) { const s = await b.get(index.structured); if (s.ok) exist = structuredPages(s.text); }

  // 1. City pages.
  const pending = new Map(); // slug -> {slug, city}
  for (const c of out.usCities) {
    for (const suf of CITY_PAGES) {
      if (exist && exist.has(c.slug) && suf && !exist.get(c.slug).has(suf)) continue;
      if (b.left() <= reserve || b.st.stopped429) break;
      const r = await b.get(`${BASE}/events/${c.slug}${suf}`);
      if (!r.ok) continue;
      stats.cityPages++;
      const cards = parseCityEvents(r.text);
      stats.cards += cards.length;
      for (const k of matchaCards(cards)) { stats.matchaCards++; if (!pending.has(k.slug)) pending.set(k.slug, { slug: k.slug, city: c }); }
    }
  }

  // 2. Sitemap: events with a matcha word in the slug that no city page showed (result cached for a day).
  if (sitemap && index.events.length && !b.st.stopped429) {
    let slugs = null;
    try { const c = JSON.parse(fs.readFileSync(sitemapFile, "utf8")); if (now.getTime() - Date.parse(c.fetched) < CITIES_TTL_MS) slugs = c.slugs; } catch { /* none */ }
    if (!slugs) {
      slugs = [];
      for (const u of index.events) {
        if (b.left() <= reserve || b.st.stopped429) { debug("sitemap stopped early", u); break; }
        const r = await b.get(u, { cache: false });
        if (!r.ok) continue;
        stats.sitemapPages++;
        slugs.push(...matchaSlugsFromSitemap(r.text, now));
      }
      if (stats.sitemapPages === index.events.length) {
        fs.mkdirSync(path.dirname(sitemapFile), { recursive: true });
        fs.writeFileSync(sitemapFile, JSON.stringify({ fetched: now.toISOString(), slugs }));
      }
    }
    stats.sitemapMatches = slugs.length;
    // Soonest first, so the budget goes to what is happening next.
    slugs.sort((a, z) => (slugDate(a) ?? 1e15) - (slugDate(z) ?? 1e15));
    for (const s of slugs) if (!pending.has(s)) pending.set(s, { slug: s, city: null });
  }

  // 3. Event pages: read, keep US ones with a matcha word in the title or description.
  const cutoff = now.getTime() - DAY;
  for (const p of pending.values()) {
    const d = slugDate(p.slug);
    if (d !== null && d < cutoff) continue;
    if (b.left() <= 0 || b.st.stopped429) break;
    const url = `${BASE}/event/${p.slug}`;
    const r = await b.get(url);
    if (!r.ok) continue;
    stats.eventPages++;
    const f = parseEventPage(r.text, p.city);
    if (!f || !f.venueSlug) continue;
    if ((f.country && f.country !== "US") || !f.state) { stats.nonUs++; continue; }
    if (!hasMatcha(f.ld.name, f.ld.description, f.venueName, f.ld.location?.name, [].concat(f.ld.keywords || []).join(" ")) && !slugHasMatcha(p.slug)) continue;
    const item = foundToItem(f, url, sources);
    if (!item) continue;
    out.items.push(item);
    out.kept.push({ slug: p.slug, url, city: f.city, state: f.state, citySlug: p.city?.slug || null, found: f });
  }
  stats.kept = out.kept.length;

  // 4. Watchlist candidates: one per venue slug that looks like an Instagram handle and has no source yet.
  const seenV = new Set();
  for (const k of out.kept) {
    const f = k.found;
    if (seenV.has(f.venueSlug.toLowerCase()) || sourceForVenue(sources, f.venueSlug)) continue;
    seenV.add(f.venueSlug.toLowerCase());
    // The watchlist schema has no "web" platform and its handle pattern has no hyphen: a slug that is not a handle
    // is recorded as platform instagram with its characters mapped to "_", and the real slug lives in the mato_venue note.
    out.candidates.push({ handle: handleFor(f.venueSlug), found_via: "search", found_from: `ma.to/${k.citySlug || slugify(f.city) || "city"}`, evidence: candidateNote(f, f.ld.name), city: f.city, state: f.state });
  }
  stats.fetches = b.st.used; stats.hitCap = b.st.hitCap; stats.stopped429 = b.st.stopped429;
  if (b.st.hitCap) info(`ma.to: hit the ${cap}-fetch cap for this run (${pending.size} pages queued)`);
  return out;
}
