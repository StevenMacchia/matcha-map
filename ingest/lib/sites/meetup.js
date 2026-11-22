// Meetup: the public event search for "matcha" in each US city.
//
// Public structure (read 2026-11-22):
//   robots.txt     https://www.meetup.com/robots.txt, "User-agent: *": Disallow /files/, /fb/, /preview/, /n/*, and the calendar
//                  atom/rss/xml feeds. /find/ is allowed.
//   search page    https://www.meetup.com/find/?keywords=matcha&source=EVENTS&location=us--<st>--<City> is Next.js; the page's
//                  <script id="__NEXT_DATA__"> holds props.pageProps.__APOLLO_STATE__, a flat map of "Event:<id>" objects
//                  {title, dateTime (with offset), description, eventType PHYSICAL|ONLINE, eventUrl, venue{name,address,city,state,
//                  country} or an __ref, featuredEventPhoto{__ref -> PhotoInfo{highResUrl}}, group{__ref -> Group{name,urlname}}}.
//                  The first page holds about a dozen events; the search is fuzzy, so the matcha word list decides.
// One page per city. The hosting group is the organizer.
import { hasMatcha, siteBudget, gate, finish, skipped, CAP, CITY_STATE, looksLikeHandle } from "./common.js";
import { zonedIso, tzFor } from "../tz.js";
import { httpUrl } from "../html.js";

export const name = "meetup";
export const host = "www.meetup.com";

export const cityUrl = (city) => {
  const st = (CITY_STATE[city] || "").toLowerCase();
  return `https://${host}/find/?keywords=matcha&source=EVENTS&location=us--${st}--${encodeURIComponent(city === "Washington DC" ? "Washington" : city)}`;
};

const readApollo = (html) => {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1])?.props?.pageProps?.__APOLLO_STATE__ || null; } catch { return null; }
};

// Search page html -> [RawItem] for physical events with a matcha word in the title or description. US only.
export function parseSearch(html, cityHint = null) {
  const ap = readApollo(html);
  if (!ap) return [];
  const ref = (v) => (v && v.__ref ? ap[v.__ref] : v);
  const out = [];
  for (const e of Object.values(ap)) {
    if (e?.__typename !== "Event" || !e.title || !e.eventUrl || !e.dateTime || e.eventType === "ONLINE") continue;
    if (!hasMatcha(e.title, e.description)) continue;
    const v = ref(e.venue) || {};
    if (v.country && v.country.toLowerCase() !== "us") continue;
    const state = /^[A-Z]{2}$/.test(v.state || "") ? v.state : cityHint?.state || null;
    const city = v.city || cityHint?.city || null;
    if (!state) continue;
    const g = ref(e.group) || {};
    const photo = ref(e.featuredEventPhoto) || ref(e.displayPhoto) || {};
    const street = /^\d/.test(v.address || "") ? String(v.address).replace(/,?\s*USA$/, "") : null;
    out.push({
      source_url: e.eventUrl, text: `${e.title}. ${e.description || ""}`.trim(), description: e.description || null, image_url: httpUrl(photo.highResUrl),
      hints: { start: e.dateTime.replace(/\.\d+(?=[+-]\d\d:\d\d$|Z$)/, ""), end: null, venue: v.name && v.name !== "Online event" ? v.name : null, address: street, city, state, title: e.title, tz: tzFor({ city, state }) },
      organizer: { name: g.name || null, url: g.urlname ? `https://${host}/${g.urlname}/` : null },
    });
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], cities = Object.keys(CITY_STATE), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  if (!g.ok) return skipped(g.reason);
  const seen = new Set(), raws = [];
  let searches = 0;
  for (const city of cities) {
    if (!CITY_STATE[city] || b.st.stopped || b.left() <= 0) continue;
    const r = await b.get(cityUrl(city));
    if (!r.ok) continue;
    searches++;
    for (const raw of parseSearch(r.text, { city, state: CITY_STATE[city] })) if (!seen.has(raw.source_url)) { seen.add(raw.source_url); raws.push(raw); }
  }
  const out = finish(name, raws, sources);
  return { ...out, stats: { searches, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
void zonedIso; void looksLikeHandle;
