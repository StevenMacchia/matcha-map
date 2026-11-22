// Generic brand page: fetch it, strip to text, hand each line with a date to the extractor.
import { htmlToLines } from "../lib/html.js";
import { findDates, refDate } from "../lib/extract.js";
import { tzFor } from "../lib/tz.js";

// Lines of a page that mention a date; short lines borrow the line before as context.
export function dateLines(html, now, source) {
  const tz = tzFor({ city: source.home_city, state: source.home_state }) || "America/New_York";
  const ref = refDate(now, tz);
  const lines = htmlToLines(html);
  const out = [];
  const seen = new Set();
  lines.forEach((l, i) => {
    if (l.length > 700 || !findDates(l, ref).length) return;
    const text = l.length < 40 && i > 0 ? `${lines[i - 1]} ${l}` : l;
    if (seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out.slice(0, 40);
}

export default {
  name: "website",
  matches: (source) => source.schedule_kind === "website" && !!(source.schedule_url || source.website),
  async fetch(source, ctx) {
    const url = source.schedule_url || source.website;
    const r = await ctx.fetcher.get(url);
    if (!r.ok) throw new Error(r.blocked ? "blocked by robots.txt" : `HTTP ${r.status || "error"}`);
    return dateLines(r.text, ctx.now, source).map((text) => ({ source_url: url, text, maxAheadDays: 60 }));
  },
};
