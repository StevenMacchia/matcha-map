// Yelp Fusion events endpoint (key-gated: YELP_API_KEY, the same free key the enrichment uses; 500 calls a day for all of Yelp).
// GET https://api.yelp.com/v3/events?term=matcha&location=<City, ST>&limit=50&start_date=<unix now> for `PER_RUN` of the 40 metros
// a run (metros.js rotation). Official API ({robots:false}; yelp.com pages themselves stay unread, robots.txt disallows them).
// Yelp has narrowed the events endpoint on some plans: a 403 or 404 ends this crawler for the run and says so in its stats.
// Pseudo-source `yelpevents:<business or event slug>`, confidence capped at likely (events are user-submitted).
import { skipped } from "./common.js";
const BASE = "https://api.yelp.com/v3";
import { STATES } from "../tz.js";

export const name = "yelpevents";
export const host = "api.yelp.com";
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

// Off with or without a key since 2026-11-23: event listings are Yelp Content, which may not be stored past 24 hours or put in a
// listings database (docs/YELP-TERMS.md). eventsToRaw stays for the parser test. The crawl loop that read PER_RUN metros is gone.
export async function discover() {
  return skipped("off (set YELP_API_KEY changes nothing: Yelp content is leads-only under docs/YELP-TERMS.md; the events endpoint is not read)");
}

export default { name, host, discover };
