// Generic ICS feed parser. Used for sources with schedule_kind "ics" and as a Luma fallback.
import { isoLocal, tzFor, zonedIso } from "../lib/tz.js";

// Unfold and read VEVENT blocks into plain objects.
export function parseIcs(text) {
  const lines = String(text).replace(/\r/g, "").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const val = line.slice(i + 1).replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
    cur[name.toUpperCase()] = { val, params: Object.fromEntries(params.map((p) => p.split("="))) };
  }
  return events;
}

// One DTSTART/DTEND -> { iso, allDay }, local to tz.
export function icsTime(field, tz) {
  if (!field) return null;
  const v = field.val;
  let m;
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(v))) return { iso: zonedIso(tz, +m[1], +m[2], +m[3], 0, 0), allDay: true };
  if ((m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v))) {
    if (m[7]) return { iso: isoLocal(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), tz), allDay: false };
    const z = field.params.TZID || tz;
    return { iso: zonedIso(z, +m[1], +m[2], +m[3], +m[4], +m[5]), allDay: false };
  }
  return null;
}

// ICS text -> RawItem[] (events ending after `since` ms only).
export function icsToRaw(text, source, since = 0) {
  const tz = tzFor({ city: source.home_city, state: source.home_state }) || "America/New_York";
  const items = [];
  for (const e of parseIcs(text)) {
    const s = icsTime(e.DTSTART, tz);
    if (!s) continue;
    const en = icsTime(e.DTEND, tz);
    if (Date.parse(en?.iso || s.iso) < since) continue;
    items.push({
      source_url: e.URL?.val || source.schedule_url,
      text: `${e.SUMMARY?.val || ""}. ${e.DESCRIPTION?.val || ""}`.trim(),
      hints: { start: s.iso, end: en && !s.allDay ? en.iso : null, all_day: s.allDay, venue: null, address: e.LOCATION?.val || null, title: e.SUMMARY?.val || null },
    });
  }
  return items;
}

export default {
  name: "ics",
  matches: (source) => source.schedule_kind === "ics" && !!source.schedule_url,
  async fetch(source, ctx) {
    const r = await ctx.fetcher.get(source.schedule_url);
    if (!r.ok) throw new Error(r.blocked ? "blocked by robots.txt" : `HTTP ${r.status || "error"}`);
    return icsToRaw(r.text, source, ctx.now.getTime() - 86400000);
  },
};
