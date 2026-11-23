// Ticketmaster Discovery API (key-gated: TICKETMASTER_API_KEY; free at developer.ticketmaster.com, 5000 calls a day, 5 a second).
// Two calls a run: GET https://app.ticketmaster.com/discovery/v2/events.json?keyword=matcha&countryCode=US&size=100, and the same
// with classificationName=food. Official API, so robots.txt does not apply ({robots:false}); the shared fetcher still paces
// and caches. Each event carries a local date and time, a venue with street, city, state and coordinates, so an event can be
// "confirmed". Matcha is checked on the name and info text (keyword search also matches promoters' blurbs). Pseudo-source
// `ticketmaster:<promoter or venue slug>`.
import { siteBudget, finish, skipped, CAP } from "./common.js";
import { tzFor, zonedIso, STATES } from "../tz.js";

export const name = "ticketmaster";
export const host = "app.ticketmaster.com";
export const searchUrl = (key, extra = "") => `https://${host}/discovery/v2/events.json?keyword=matcha&countryCode=US&size=100${extra}&apikey=${encodeURIComponent(key)}`;
export const QUERIES = ["", "&classificationName=food"];

// One Discovery response -> [RawItem]. Pure.
export function eventsToRaw(json) {
  const out = [];
  for (const e of json?._embedded?.events || []) {
    const v = e._embedded?.venues?.[0] || {};
    const state = v.state?.stateCode, city = v.city?.name;
    const d = e.dates?.start || {};
    if (!state || !STATES.includes(state) || !d.localDate || e.dates?.status?.code === "cancelled") continue;
    const tz = e.dates?.timezone || v.timezone || tzFor({ city, state }) || "America/New_York";
    const [y, mo, dd] = d.localDate.split("-").map(Number);
    const [h, mi] = d.localTime ? d.localTime.split(":").map(Number) : [0, 0];
    const street = v.address?.line1 || null;
    const text = [e.name, e.info, e.pleaseNote, e.description].filter(Boolean).join(". ");
    out.push({
      source_url: e.url, text, description: e.info ? String(e.info).slice(0, 400) : null,
      image_url: (e.images || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null,
      hints: { start: zonedIso(tz, y, mo, dd, h, mi), end: null, tz, venue: v.name || null, address: street ? `${street}, ${city}, ${state}${v.postalCode ? ` ${v.postalCode}` : ""}` : null, city, state, title: e.name, all_day: !d.localTime },
      organizer: { name: e.promoter?.name || v.name || null, url: null },
      price_hint: e.priceRanges?.[0] ? `$${e.priceRanges[0].min}${e.priceRanges[0].max && e.priceRanges[0].max !== e.priceRanges[0].min ? `-${e.priceRanges[0].max}` : ""}` : null,
      lat: v.location ? +v.location.latitude : null, lng: v.location ? +v.location.longitude : null, evidence: [e.url],
    });
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], env = {}, cap = CAP } = ctx;
  if (!env.TICKETMASTER_API_KEY) return skipped("off (set TICKETMASTER_API_KEY; free at developer.ticketmaster.com)");
  const b = siteBudget(fetcher, name, cap);
  const raws = [], seen = new Set();
  for (const q of QUERIES) {
    const r = await b.get(searchUrl(env.TICKETMASTER_API_KEY, q), { robots: false });
    if (!r.ok) continue;
    let j; try { j = JSON.parse(r.text); } catch { continue; }
    for (const raw of eventsToRaw(j)) if (!seen.has(raw.source_url)) { seen.add(raw.source_url); raws.push(raw); }
  }
  const out = finish(name, raws, sources);
  return { ...out, stats: { listed: raws.length, fetches: b.st.used, pages: b.st.pages, stopped: b.st.stopped } };
}

export default { name, host, discover };
