// Luma calendars (luma.com/<slug>).
// How Luma exposes dates: the calendar page is Next.js and embeds its data in
// <script id="__NEXT_DATA__">: props.pageProps.initialData.data.upcoming.entries[], each
// with event {name,start_at (UTC),end_at,timezone,url,location_type,geo_address_info{...}}.
// That is public, needs no login, and luma.com/robots.txt allows it. Fallback if the blob
// is missing: the public ICS feed https://api.lu.ma/ics/get?entity=calendar&id=<cal-id>.
import { isoLocal } from "../lib/tz.js";
import { icsToRaw } from "./ics.js";

// Pull the embedded data out of the page HTML.
export function readNextData(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1])?.props?.pageProps?.initialData?.data || null; } catch { return null; }
}

// One Luma entry -> RawItem (null for online-only events).
export function entryToRaw(entry) {
  const ev = entry.event;
  if (!ev || ev.location_type === "online" || !ev.start_at) return null;
  const tz = ev.timezone || "America/New_York";
  const g = ev.geo_address_info || {};
  const place = g.address && !/^\d/.test(g.address) ? g.address : null;
  return {
    source_url: `https://luma.com/${ev.url}`,
    text: ev.name || "",
    hints: {
      start: isoLocal(ev.start_at, tz), end: ev.end_at ? isoLocal(ev.end_at, tz) : null, tz,
      venue: place, address: g.full_address || g.short_address || null,
      city: g.city || null, state: g.region_short || null, title: ev.name,
    },
  };
}

export default {
  name: "luma",
  matches(source) {
    try { return /(^|\.)(luma\.com|lu\.ma)$/.test(new URL(source.schedule_url).host); } catch { return false; }
  },
  async fetch(source, ctx) {
    const page = await ctx.fetcher.get(source.schedule_url);
    if (!page.ok) throw new Error(page.blocked ? "blocked by robots.txt" : `HTTP ${page.status || "error"}`);
    const data = readNextData(page.text);
    if (data?.upcoming) return data.upcoming.entries.map(entryToRaw).filter(Boolean);
    const id = data?.calendar?.api_id || /cal-[A-Za-z0-9]+/.exec(page.text)?.[0];
    if (!id) throw new Error("no embedded data and no calendar id");
    const ics = await ctx.fetcher.get(`https://api.lu.ma/ics/get?entity=calendar&id=${id}`);
    if (!ics.ok) throw new Error(`ICS HTTP ${ics.status || "error"}`);
    return icsToRaw(ics.text, source, ctx.now.getTime() - 86400000);
  },
};
