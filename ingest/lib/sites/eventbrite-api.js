// Eventbrite Platform API (key-gated: EVENTBRITE_TOKEN, a free private token at eventbrite.com/platform/api-keys; 1000 calls an
// hour). Event search was removed from API v3 in 2020, so this reads by lookup only:
//   1. organizers of known brands: every source whose schedule_url or website is an Eventbrite organizer page (/o/<slug>-<id>),
//      GET https://www.eventbriteapi.com/v3/organizers/<id>/events/?status=live&expand=venue
//   2. venues those events use: GET /v3/venues/<id>/events/?status=live (other matcha events at the same place), at most 15.
// The public city search pages and event pages stay with sites/eventbrite.js (no key). Official API ({robots:false}).
// Events of a known source keep that source; others get the pseudo-source `eventbrite:<organizer slug>`.
import { siteBudget, finish, skipped, CAP } from "./common.js";
import { isoLocal, STATES } from "../tz.js";

export const name = "eventbrite-api";
export const host = "www.eventbriteapi.com";
const API = `https://${host}/v3`;
const MAX_VENUES = 15;

export const organizerId = (url) => /eventbrite\.[a-z.]+\/o\/(?:[^/?#]*-)?(\d{6,})/i.exec(String(url || ""))?.[1] || null;

// One /events/ page -> [RawItem]. Pure.
export function eventsToRaw(json, orgName = null) {
  const out = [];
  for (const e of json?.events || []) {
    const v = e.venue || {}, a = v.address || {};
    const tz = e.start?.timezone;
    if (!e.start?.utc || !tz || e.online_event || !STATES.includes(a.region)) continue;
    out.push({
      source_url: e.url, text: [e.name?.text, e.summary, e.description?.text].filter(Boolean).join(". ").slice(0, 3000),
      description: e.summary ? String(e.summary).slice(0, 400) : null, image_url: e.logo?.original?.url || e.logo?.url || null,
      hints: { start: isoLocal(e.start.utc, tz), end: e.end?.utc ? isoLocal(e.end.utc, tz) : null, tz, venue: v.name || null, address: a.address_1 ? [a.address_1, a.city, `${a.region} ${a.postal_code || ""}`.trim()].join(", ") : null, city: a.city, state: a.region, title: e.name?.text },
      organizer: { name: orgName, url: e.organizer_id ? `https://www.eventbrite.com/o/${e.organizer_id}` : null },
      price_hint: e.is_free ? "free" : null, venue_id: e.venue_id || v.id || null, evidence: [e.url],
    });
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], env = {}, cap = CAP } = ctx;
  if (!env.EVENTBRITE_TOKEN) return skipped("off (set EVENTBRITE_TOKEN; free at eventbrite.com/platform/api-keys)");
  const b = siteBudget(fetcher, name, cap);
  const headers = { Authorization: `Bearer ${env.EVENTBRITE_TOKEN}` };
  const orgs = new Map();
  for (const s of sources) { const id = organizerId(s.schedule_url) || organizerId(s.website); if (id && !orgs.has(id)) orgs.set(id, s.brand); }
  const raws = [], venues = new Set(), stats = { organizers: orgs.size, venues: 0 };
  for (const [id, brand] of orgs) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(`${API}/organizers/${id}/events/?status=live&expand=venue`, { robots: false, headers });
    if (!r.ok) continue;
    try { for (const raw of eventsToRaw(JSON.parse(r.text), brand)) { raws.push(raw); if (raw.venue_id) venues.add(raw.venue_id); } } catch { /* not JSON */ }
  }
  for (const vid of [...venues].slice(0, MAX_VENUES)) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(`${API}/venues/${vid}/events/?status=live&expand=venue`, { robots: false, headers });
    if (!r.ok) continue;
    stats.venues++;
    try { raws.push(...eventsToRaw(JSON.parse(r.text)).filter((x) => !raws.some((y) => y.source_url === x.source_url))); } catch { /* not JSON */ }
  }
  // Known brands keep their own source; the rest are filed under eventbrite: like the page crawler's finds.
  const out = finish("eventbrite", raws, sources);
  for (const c of out.candidates) c.found_from = name;
  return { ...out, stats: { ...stats, listed: raws.length, fetches: b.st.used, pages: b.st.pages, stopped: b.st.stopped } };
}

export default { name, host, discover };
