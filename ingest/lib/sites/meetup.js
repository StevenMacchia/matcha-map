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
import { hasMatcha, siteBudget, gate, finish, skipped, CAP, looksLikeHandle, planFor } from "./common.js";
import { cityOf } from "../cities.js";
import { zonedIso, tzFor } from "../tz.js";
import { httpUrl } from "../html.js";

export const name = "meetup";
export const host = "www.meetup.com";

// A city entry (or a listed city's name) -> the search: location=us--<state>--<City name>.
export const cityUrl = (city) => {
  const c = cityOf(city);
  return `https://${host}/find/?keywords=matcha&source=EVENTS&location=us--${c.state.toLowerCase()}--${encodeURIComponent(c.name)}`;
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
  const { fetcher, sources = [], cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  if (!g.ok) return skipped(g.reason);
  const plan = planFor(name, ctx);
  const seen = new Set(), raws = [];
  let searches = 0;
  for (const city of plan.batch) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(cityUrl(city));
    if (r.skipped) break;
    if (!r.ok) { plan.done(city, r.status === 404 ? "404" : "error"); continue; }
    searches++;
    const found = parseSearch(r.text, { city: city.name, state: city.state });
    plan.done(city, found.length ? "ok" : "empty");
    for (const raw of found) if (!seen.has(raw.source_url)) { seen.add(raw.source_url); raws.push(raw); }
  }
  const cur = plan.finish();
  const out = finish(name, raws, sources);
  return { ...out, stats: { cities: plan.batch.length, cursor: cur.cursor, skippedCities: cur.skipped, searches, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
void zonedIso; void looksLikeHandle;
