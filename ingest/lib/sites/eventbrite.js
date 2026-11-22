// Eventbrite public pages: the matcha search page of each US city, then the event pages.
//
// Public structure (read 2026-11-22):
//   robots.txt     https://www.eventbrite.com/robots.txt, "User-agent: *": Disallows /api/v3/destination/events/, /directory/,
//                  /checkout-external*, login pages and any URL whose query has i*, x*, id*, calendar*. /d/ and /e/ and /o/
//                  are allowed, and so is the sitemap. We never add a query string, so the query rules never apply.
//   city search    https://www.eventbrite.com/d/<state>--<city>/matcha/  (e.g. /d/ny--new-york/matcha/, /d/ca--los-angeles/matcha/)
//                  Server-rendered. One JSON-LD ItemList of 20 schema.org Events (name, description, startDate as a DATE only,
//                  image, url, location{name, address{streetAddress, addressLocality, addressRegion, postalCode}, geo}).
//                  The search is fuzzy (it returns food tours and tea ceremonies too), so the matcha word list decides.
//   event page     https://www.eventbrite.com/e/<slug>-tickets-<id>: JSON-LD Event (type EducationEvent, FoodEvent ...) with
//                  startDate and endDate WITH time and offset, location, organizer{name,url /o/<slug>-<id>}, offers, image.
//   organizer page https://www.eventbrite.com/o/<slug>-<id> embeds __NEXT_DATA__ with the organizer's upcomingEvents; read by
//                  ingest/adapters/eventbrite.js for sources whose schedule_url is an organizer page.
// One page per city, then the event pages of the matcha hits (soonest first) while the fetch budget lasts. A hit whose event page
// cannot be read is kept from the listing as an all-day event.
import { ldEvents, ldToRaw, siteBudget, gate, finish, skipped, CAP, hasMatcha, CITY_STATE, citySlug } from "./common.js";

export const name = "eventbrite";
export const host = "www.eventbrite.com";

export const cityUrl = (city) => `https://${host}/d/${(CITY_STATE[city] || "").toLowerCase()}--${citySlug(city === "Washington DC" ? "washington" : city)}/matcha/`;

// City search html -> [{url, title, ld}] for the Events whose name or description has a matcha word.
export function parseListing(html) {
  return ldEvents(html).filter((ld) => ld.url && hasMatcha(ld.name, ld.description)).map((ld) => ({ url: ld.url, title: ld.name, ld }));
}

// Event page html -> RawItem or null.
export function parseEventPage(html, url, cityHint = null) {
  const ld = ldEvents(html).find((x) => x.url === url) || ldEvents(html)[0];
  return ld ? ldToRaw(ld, url, { cityHint }) : null;
}

export async function discover(ctx) {
  const { fetcher, sources = [], cities = Object.keys(CITY_STATE), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  if (!g.ok) return skipped(g.reason);
  const pending = new Map(); // url -> {ld, city}
  let listings = 0;
  for (const city of cities) {
    if (!CITY_STATE[city] || b.st.stopped || b.left() <= 20) continue;
    const r = await b.get(cityUrl(city));
    if (!r.ok) continue;
    listings++;
    for (const h of parseListing(r.text)) if (!pending.has(h.url)) pending.set(h.url, { ld: h.ld, city: { city, state: CITY_STATE[city] } });
  }
  const rows = [...pending.entries()].sort((a, z) => String(a[1].ld.startDate).localeCompare(String(z[1].ld.startDate)));
  const raws = [];
  let eventPages = 0;
  for (const [url, p] of rows) {
    let raw = null;
    if (!b.st.stopped && b.left() > 0) {
      const r = await b.get(url);
      if (r.ok) { eventPages++; raw = parseEventPage(r.text, url, p.city); }
    }
    raw = raw || ldToRaw(p.ld, url, { cityHint: p.city });
    if (raw) raws.push(raw);
  }
  const out = finish(name, raws, sources);
  return { ...out, stats: { listings, hits: rows.length, eventPages, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
