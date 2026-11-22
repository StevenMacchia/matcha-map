// The DoStuff network of city event sites (DoNYC, Do312, Do206 ...): the matcha search page of each city, then event pages.
//
// Public structure (read 2026-11-22; the city list comes from the "Cities" menu of https://donyc.com):
//   robots.txt     one shared file: "User-agent: *  Disallow: /locales, /features, /*view=map" (GPTBot and ClaudeBot are
//                  disallowed by name; we are neither). Sitemap: https://<host>/sitemaps.xml.
//   hosts          donyc.com (New York), do312.com (Chicago), do206.com (Seattle), do214.com (Dallas), do713.com (Houston),
//                  do617.com (Boston), do303.com (Denver), do317.com (Indianapolis), do816.com (Kansas City), do615.com
//                  (Nashville), do215.com (Philadelphia), dopdx.com (Portland), do210.com (San Antonio), dosd.com (San Diego),
//                  do502.com (Louisville), dolosangeles.com (Los Angeles). do512.com (Austin), dothebay.com (Bay Area) and
//                  do314.com (St. Louis) answer HTTP 403 to robots.txt for our User-Agent, so they are skipped (gate()).
//                  dola.com is no longer DoStuff (an AI app) and doseattle.com does not exist.
//   search page    https://<host>/search?q=matcha is server-rendered (SvelteKit). Tabs "Events N / Venues / Artists / Guides";
//                  an event card is <div data-card-kind="event"> ... <a href="./events/YYYY/M/D/<slug>" aria-label="<title>">
//                  with a date line and the venue name. (/events?q= and /events/search?q= do not filter; not used.)
//   event page     https://<host>/events/YYYY/M/D/<slug>: JSON-LD @graph with an Event (startDate with offset, image, location as an
//                  @id pointing at a Place in the same graph with address and geo). No organizer: the venue is the brand.
// DoStuff is mostly concerts; on 2026-11-22 every searched city had 0 matcha events, so the crawler returns little. It is
// kept because the structure is clean and the network is large.
import { decode } from "../html.js";
import { ldEvents, ldToRaw, siteBudget, gate, finish, skipped, CAP, hasMatcha } from "./common.js";

export const name = "dostuff";
export const host = "donyc.com";

export const SITES = [
  ["donyc.com", "New York", "NY"], ["do312.com", "Chicago", "IL"], ["do206.com", "Seattle", "WA"], ["do214.com", "Dallas", "TX"], ["do713.com", "Houston", "TX"],
  ["do617.com", "Boston", "MA"], ["do303.com", "Denver", "CO"], ["do317.com", "Indianapolis", "IN"], ["do816.com", "Kansas City", "MO"], ["do615.com", "Nashville", "TN"],
  ["do215.com", "Philadelphia", "PA"], ["dopdx.com", "Portland", "OR"], ["do210.com", "San Antonio", "TX"], ["dosd.com", "San Diego", "CA"],
  ["do502.com", "Louisville", "KY"], ["dolosangeles.com", "Los Angeles", "CA"], ["do512.com", "Austin", "TX"], ["dothebay.com", "San Francisco", "CA"], ["do314.com", "St. Louis", "MO"],
];

// Search page html -> [{path, title, date, text}] for event cards that mention matcha (path like /events/2026/12/5/slug).
export function parseSearch(html) {
  const out = [];
  for (const m of String(html).matchAll(/data-card-kind="event"[\s\S]*?<a\b[^>]*href="\.?\/?(events\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/[^"?#]+)"[^>]*aria-label="([^"]*)"([\s\S]*?)(?=data-card-kind=|<\/section>|$)/g)) {
    const seg = m[6].replace(/<[^>]+>/g, " ");
    const title = decode(m[5]);
    const text = decode(`${title} ${seg}`).replace(/\s+/g, " ");
    if (!hasMatcha(text)) continue;
    out.push({ path: `/${m[1]}`, title, date: Date.UTC(+m[2], +m[3] - 1, +m[4]), text });
  }
  return out;
}

export function parseEventPage(html, url, cityHint) {
  const ld = ldEvents(html).find((x) => x.url === url) || ldEvents(html)[0];
  return ld ? ldToRaw(ld, url, { cityHint }) : null;
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const raws = [];
  const stats = { sites: 0, skipped: [], searches: 0, cards: 0, eventPages: 0 };
  for (const [h, city, state] of ctx.hosts || SITES) {
    if (b.st.stopped || b.left() <= 0) break;
    const g = await gate(b, h);
    if (!g.ok) { stats.skipped.push(`${h}: ${g.reason}`); continue; }
    stats.sites++;
    const r = await b.get(`https://${h}/search?q=matcha`);
    if (!r.ok) continue;
    stats.searches++;
    const cards = parseSearch(r.text).filter((c) => c.date >= now.getTime() - 86400000);
    stats.cards += cards.length;
    for (const c of cards) {
      const url = `https://${h}${c.path}`;
      const p = await b.get(url);
      if (!p.ok) continue;
      stats.eventPages++;
      const raw = parseEventPage(p.text, url, { city, state });
      if (raw) raws.push(raw);
    }
  }
  const out = finish(name, raws, sources);
  if (!stats.sites && stats.skipped.length) return skipped(stats.skipped.join("; "), { skippedHosts: stats.skipped });
  return { ...out, stats: { ...stats, skipped: undefined, skippedHosts: stats.skipped, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
