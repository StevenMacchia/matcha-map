// Yelp Fusion events endpoint (key-gated: YELP_API_KEY, the same free key the enrichment uses; 500 calls a day for all of Yelp).
// GET https://api.yelp.com/v3/events?term=matcha&location=<City, ST>&limit=50&start_date=<unix now> for `PER_RUN` of the 40 metros
// a run (metros.js rotation). Official API ({robots:false}; yelp.com pages themselves stay unread, robots.txt disallows them).
// Yelp has narrowed the events endpoint on some plans: a 403 or 404 ends this crawler for the run and says so in its stats.
// Pseudo-source `yelpevents:<business or event slug>`, confidence capped at likely (events are user-submitted).
import { siteBudget, finish, skipped, CAP } from "./common.js";
import { BASE } from "../enrich/yelp.js";
import { STATES } from "../tz.js";
import { METROS, rotate } from "./metros.js";

export const name = "yelpevents";
export const host = "api.yelp.com";
const PER_RUN = 6;
export const eventsUrl = (m, now = new Date()) => `${BASE}/events?term=matcha&location=${encodeURIComponent(`${m.city}, ${m.state}`)}&limit=50&sort_on=time_start&sort_by=asc&start_date=${Math.floor(new Date(now).getTime() / 1000)}`;

// One events response -> [RawItem]. Pure.
export function eventsToRaw(json) {
  const out = [];
  for (const e of json?.events || []) {
    const l = e.location || {};
    if (!e.time_start || !STATES.includes(l.state) || e.is_canceled) continue;
    const start = String(e.time_start).replace(" ", "T");
    out.push({
      source_url: e.event_site_url, text: [e.name, e.description].filter(Boolean).join(". "), description: e.description ? String(e.description).slice(0, 400) : null,
      image_url: e.image_url || null,
      hints: { start, end: e.time_end ? String(e.time_end).replace(" ", "T") : null, venue: null, address: l.address1 ? [l.address1, l.city, `${l.state} ${l.zip_code || ""}`.trim()].join(", ") : null, city: l.city, state: l.state, title: e.name },
      organizer: { name: e.business_id ? e.business_id.replace(/-/g, " ") : null, url: null },
      price_hint: e.is_free ? "free" : e.cost ? `$${e.cost}${e.cost_max ? `-${e.cost_max}` : ""}` : null, evidence: [e.event_site_url, e.tickets_url].filter(Boolean),
    });
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], env = {}, now = new Date(), cap = CAP } = ctx;
  if (!env.YELP_API_KEY) return skipped("off (set YELP_API_KEY; free at yelp.com/developers)");
  const b = siteBudget(fetcher, name, cap);
  const raws = [];
  const stats = { cities: 0 };
  for (const m of rotate(METROS, now, ctx.perRun ?? PER_RUN, { salt: 4 })) {
    if (b.st.stopped) break;
    const r = await b.get(eventsUrl(m, now), { robots: false, headers: { Authorization: `Bearer ${env.YELP_API_KEY}`, Accept: "application/json" } });
    if (r.status === 404) { stats.closed = "events endpoint answered 404"; break; }
    if (!r.ok) continue;
    stats.cities++;
    try { raws.push(...eventsToRaw(JSON.parse(r.text))); } catch { /* not JSON */ }
  }
  const out = finish(name, raws, sources);
  return { ...out, stats: { ...stats, listed: raws.length, fetches: b.st.used, pages: b.st.pages, stopped: b.st.stopped } };
}

export default { name, host, discover };
