// Allevents.in: the matcha page of each US city (an aggregator that also carries events announced on Instagram and Facebook).
//
// Public structure (read 2026-11-22):
//   robots.txt     https://allevents.in/robots.txt. "User-agent: *" disallows /manage/*, /go.php, a few /api/ templates, URLs with
//                  ?ref= tracking values and event paths of 2013 to 2021; Crawl-delay only for named SEO bots (not us). City and
//                  category pages are allowed.
//   city page      https://allevents.in/<city-slug>/matcha  (e.g. /new-york/matcha, /los-angeles/matcha). Server-rendered. Three
//                  JSON-LD blocks: an FAQPage ("What matcha Events are happening in New York Today ... X is happening on Sun 22 Nov
//                  2026 from 11:00 AM onwards at KINKA"), an array of about 13 schema.org Events (name, startDate as a DATE only,
//                  image, url, location{name, address{streetAddress, addressLocality, addressRegion}, geo}, organizer[], offers), and
//                  a BreadcrumbList. The search is fuzzy; the matcha word list decides.
//   event page     https://allevents.in/<city>/<slug>/<id>: HTML with og tags and a BreadcrumbList but NO Event JSON-LD, so event
//                  pages add nothing and are not fetched. The start time comes from the FAQ lines when the event is in them;
//                  otherwise the event is an all-day entry on its date.
// Allevents lists many events that originate elsewhere (Eventbrite, Instagram), so confidence is capped at "likely" and
// duplicates of an event another site already has are dropped by title and day (see sites/index.js).
import { decode } from "../html.js";
import { zonedIso, tzFor } from "../tz.js";
import { ldEvents, ldToRaw, titleKey, siteBudget, gate, finish, skipped, CAP, CITY_STATE, citySlug } from "./common.js";

export const name = "allevents";
export const host = "allevents.in";

export const cityUrl = (city) => `https://${host}/${citySlug(city === "Washington DC" ? "washington" : city)}/matcha`;

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// FAQ answers -> Map("title|yyyy-mm-dd" -> {h, mi}) for lines like "X is happening on Sun 22 Nov 2026 from 11:00 AM onwards at Y".
export function faqTimes(html) {
  const out = new Map();
  for (const x of ldEventsFaq(html)) {
    for (const m of x.matchAll(/(?:^|\s)- (.+?) is happening on \w{3} (\d{1,2}) (\w{3}) (\d{4}) from (\d{1,2}):(\d{2}) (AM|PM)/g)) {
      const mo = MON[m[3].toLowerCase()];
      if (!mo) continue;
      let h = +m[5] % 12; if (m[7] === "PM") h += 12;
      out.set(`${titleKey(decode(m[1]))}|${m[4]}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`, { h, mi: +m[6] });
    }
  }
  return out;
}

function* ldEventsFaq(html) {
  for (const m of String(html).matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    for (const x of Array.isArray(j) ? j : [j]) {
      if (x["@type"] !== "FAQPage") continue;
      for (const q of x.mainEntity || []) { const t = q.acceptedAnswer?.text; if (t) yield String(t).replace(/\s+/g, " "); }
    }
  }
}

// City page html -> [RawItem] (US, matcha filtered later by finish()). Times from the FAQ lines when they name the event.
export function parseCityPage(html, cityHint) {
  const times = faqTimes(html);
  const out = [];
  for (const ld of ldEvents(html)) {
    if (!ld.url || !/^https:\/\/allevents\.in\//.test(ld.url)) continue;
    const raw = ldToRaw({ ...ld, name: decode(ld.name || ""), description: decode(ld.description || "") }, ld.url, { cityHint });
    if (!raw) continue;
    const day = String(ld.startDate).slice(0, 10);
    const t = times.get(`${titleKey(raw.hints.title)}|${day}`);
    if (t && raw.hints.all_day) {
      const [y, mo, d] = day.split("-").map(Number);
      raw.hints.start = zonedIso(tzFor({ city: raw.hints.city, state: raw.hints.state }) || "America/New_York", y, mo, d, t.h, t.mi);
      raw.hints.all_day = false;
    }
    out.push(raw);
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], cities = Object.keys(CITY_STATE), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  if (!g.ok) return skipped(g.reason);
  const seen = new Set(), raws = [];
  let pages = 0;
  for (const city of cities) {
    if (!CITY_STATE[city] || b.st.stopped || b.left() <= 0) continue;
    const r = await b.get(cityUrl(city));
    if (!r.ok) continue;
    pages++;
    for (const raw of parseCityPage(r.text, { city, state: CITY_STATE[city] })) if (!seen.has(raw.source_url)) { seen.add(raw.source_url); raws.push(raw); }
  }
  const out = finish(name, raws, sources);
  return { ...out, stats: { cityPages: pages, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
