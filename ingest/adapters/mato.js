// MATO (ma.to) venue pages.
// How MATO exposes dates: the venue page is server-rendered Next.js. Its HTML lists
// links like /event/<slug>-<dd>-<mon>-<yyyy> for upcoming and recent events (there is no
// JSON blob of events, and /api/ is disallowed in robots.txt, so we do not use it). Each
// event page carries a schema.org Event in JSON-LD with startDate (with offset), name,
// description and location.name ("@venue, City, ST"). So: venue page -> event links ->
// keep the ones dated from yesterday on -> read the JSON-LD on each event page.
// Public, no login.
import { jsonLd } from "../lib/html.js";
import { debug } from "../lib/log.js";

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Date in a slug like "holiday-cookie-buffet-14-dec-2026" -> ms (UTC midnight) or null.
export function slugDate(slug) {
  const iso = /-(\d{4})-(\d{2})-(\d{2})$/.exec(slug);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const m = /-(\d{1,2})-([a-z]{3})-(\d{4})$/.exec(slug);
  return m && MON[m[2]] ? Date.UTC(+m[3], MON[m[2]] - 1, +m[1]) : null;
}

// Event links on a venue page, deduped, in page order.
export function eventLinks(html) {
  const seen = new Set();
  for (const m of html.matchAll(/href="\/event\/([a-z0-9-]+)"/g)) seen.add(m[1]);
  return [...seen];
}

// JSON-LD Event -> RawItem (or null).
export function eventToRaw(ld, url) {
  if (!ld || ld["@type"] !== "Event" || !ld.startDate) return null;
  if (/Cancel/i.test(ld.eventStatus || "")) return null;
  const norm = (s) => (s ? String(s).replace(/\.\d+(?=[+-]\d\d:\d\d$|Z$)/, "") : null);
  return {
    source_url: url,
    text: `${ld.name || ""}. ${ld.description || ""}`.trim(),
    hints: { start: norm(ld.startDate), end: norm(ld.endDate), venue: ld.location?.name || null, title: ld.name || null },
  };
}

export default {
  name: "mato",
  matches(source) {
    try { return new URL(source.schedule_url).host === "ma.to"; } catch { return false; }
  },
  async fetch(source, ctx) {
    const page = await ctx.fetcher.get(source.schedule_url);
    if (!page.ok) throw new Error(page.blocked ? "blocked by robots.txt" : `HTTP ${page.status || "error"}`);
    const cutoff = ctx.now.getTime() - 86400000;
    const slugs = eventLinks(page.text).filter((s) => { const d = slugDate(s); return d === null || d >= cutoff; });
    const items = [];
    for (const s of slugs) {
      const url = `https://ma.to/event/${s}`;
      const r = await ctx.fetcher.get(url);
      if (!r.ok) { debug("mato event failed", url, r.status); continue; }
      const raw = eventToRaw(jsonLd(r.text).find((x) => x["@type"] === "Event"), url);
      if (raw) items.push(raw);
    }
    return items;
  },
};
