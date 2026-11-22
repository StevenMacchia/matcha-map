// Eventbrite organizer pages (https://www.eventbrite.com/o/<slug>-<id>).
// How Eventbrite exposes dates: the organizer page is Next.js server-rendered and embeds __NEXT_DATA__ with
// the organizer's `upcomingEvents` (12 per page; `hasMoreUpcoming` and `upcomingEventsTotal` say there are more):
// each {name, url, start_date, start_time (local), end_date, end_time, timezone, is_online_event, is_cancelled,
// summary, image{url}, primary_venue{name, address{address_1, city, region, postal_code}}}. Public, no login or API;
// robots.txt allows /o/. Events at a source of kind venue or organizer are kept only when they say matcha.
import { zonedIso } from "../lib/tz.js";
import { rawHasMatcha, needsMatchaFilter } from "./mato.js";
import { httpUrl } from "../lib/html.js";

// html -> the object that holds upcomingEvents, or null.
export function readOrganizer(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let j; try { j = JSON.parse(m[1]); } catch { return null; }
  const find = (o, d = 0) => {
    if (!o || typeof o !== "object" || d > 8) return null;
    if (Array.isArray(o.upcomingEvents)) return o;
    for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; }
    return null;
  };
  return find(j);
}

const local = (date, time, tz) => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!d) return null;
  const t = /^(\d{2}):(\d{2})/.exec(time || "") || [null, "0", "0"];
  return zonedIso(tz, +d[1], +d[2], +d[3], +t[1], +t[2]);
};

// One upcomingEvents entry -> RawItem (null for online, cancelled or undated ones).
export function eventToItem(e) {
  if (!e || e.is_online_event || e.is_cancelled || !e.start_date) return null;
  const tz = e.timezone || "America/New_York";
  const a = e.primary_venue?.address || {};
  const street = a.address_1 && /^\d/.test(a.address_1) ? [a.address_1, a.city, [a.region, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null;
  return {
    source_url: e.url,
    text: `${e.name || ""}. ${e.summary || ""}`.trim(),
    description: e.summary || null,
    image_url: httpUrl(e.image?.url),
    hints: {
      start: local(e.start_date, e.start_time, tz), end: e.end_date ? local(e.end_date, e.end_time, tz) : null, tz,
      venue: e.primary_venue?.name || null, address: street, city: a.city || null, state: /^[A-Z]{2}$/.test(a.region || "") ? a.region : null, title: e.name,
    },
  };
}

export default {
  name: "eventbrite",
  matches(source) {
    try { const u = new URL(source.schedule_url); return /(^|\.)eventbrite\.com$/.test(u.host) && /^\/o\//.test(u.pathname); } catch { return false; }
  },
  async fetch(source, ctx) {
    const page = await ctx.fetcher.get(source.schedule_url);
    if (!page.ok) throw new Error(page.blocked ? "blocked by robots.txt" : `HTTP ${page.status || "error"}`);
    const data = readOrganizer(page.text);
    if (!data) throw new Error("no embedded organizer data");
    const cutoff = ctx.now.getTime() - 86400000;
    const items = [];
    for (const e of data.upcomingEvents) {
      const raw = eventToItem(e);
      if (!raw || !raw.hints.start || Date.parse(raw.hints.start) < cutoff) continue;
      if (needsMatchaFilter(source) && !rawHasMatcha(raw, {})) continue;
      items.push(raw);
    }
    return items;
  },
};
