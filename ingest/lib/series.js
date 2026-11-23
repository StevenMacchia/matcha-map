// Recurring pop-ups as series: weekly market stalls, "every Saturday" stands, standing residencies.
// A record in data/series.json holds the rule and an end; each run turns it into dated occurrences (events flagged with `series`),
// so the map shows the pop-up on every day it is there. See docs/SERIES.md for the rules.
import fs from "node:fs";
import { promote, normStart } from "./review.js";
import { eventId } from "./write.js";

export const SERIES_PATH = "data/series.json";
export const HORIZON_DAYS = 42;      // six weeks ahead by default
export const CONFIRM_MAX_DAYS = 28;  // an open-ended series is only extended while a source confirmed it this recently
const DAY = 86400000;
const WD = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WD3 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function readSeries(path = SERIES_PATH) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")).series || []; } catch { return []; }
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const addDays = (d, n) => ymd(dayMs(d) + n * DAY);
const weekdayOf = (d) => new Date(dayMs(d)).getUTCDay();
export const localToday = (now, tz) => new Date(now).toLocaleDateString("en-CA", { timeZone: tz || "UTC" });

export const ruleText = (s) => `weekly on ${[...s.weekdays].sort((a, b) => a - b).map((w) => WD[w]).join(", ")}`;

// The last date the series is shown on. A declared `until` always ends it; an open-ended series (extend: true) runs HORIZON_DAYS
// past today while `confirmed` is recent; everything else is not projected, only the dates a source listed (inside from..until).
export function limitOf(s, today) {
  const horizon = addDays(today, s.horizon_days || HORIZON_DAYS);
  if (s.ended) return s.ended < today ? addDays(today, -1) : s.ended;
  if (s.until) return s.until < horizon || !s.extend ? s.until : horizon;
  if (s.extend && s.confirmed && (dayMs(today) - dayMs(s.confirmed)) / DAY <= CONFIRM_MAX_DAYS) return horizon;
  return null; // open-ended and not confirmed lately: no new dates; the ones already held run out
}

// Dates of one series from today (or `from`) to its limit, by weekday, minus `skip`.
export function occurrences(s, today) {
  const limit = limitOf(s, today);
  if (!limit) return [];
  const out = [];
  for (let d = s.from && s.from > today ? s.from : today; d <= limit; d = addDays(d, 1)) {
    if (s.weekdays.includes(weekdayOf(d)) && !(s.skip || []).includes(d)) out.push(d);
  }
  return out;
}

const dateOnlyTime = (t) => (/^\d{2}:\d{2}$/.test(t || "") ? t : null);

// Review-shaped items (what ingest/lib/review.js promotes) for every occurrence of one series. Confidence is the series' own (default "likely").
export function seriesItemsOf(s, now = new Date()) {
  if (s.active === false) return [];
  const today = localToday(now, s.tz);
  return occurrences(s, today).map((d) => {
    const t0 = dateOnlyTime(s.start_time), t1 = dateOnlyTime(s.end_time);
    return {
      brand: s.brand, handle: s.handle || null, source_id: s.source_id, title: s.title, tz: s.tz,
      start: t0 ? d + "T" + t0 : d, end: t0 && t1 ? d + "T" + t1 : null, all_day: !t0,
      venue: s.venue || "", address: s.address || "", city: s.city, state: s.state, zip: s.zip || null,
      lat: s.lat ?? null, lng: s.lng ?? null, source_url: s.source_url, evidence: s.evidence || [s.source_url],
      description: s.description || null, menu: s.menu || [], price: s.price || null, hours: s.hours || null, pay: s.pay || null,
      image_url: s.image_url || null, posts: s.posts || null, kind: s.kind || null,
      confidence: s.confidence || "likely", extracted_by: "manual",
      notes: "series " + s.id + ": " + ruleText(s) + (s.until ? ", until " + s.until : "") + "; " + (s.rule_source || "source states the rule"),
    };
  });
}

// Series -> pipeline candidates (through the review promote rules, so an occurrence that is an event already held merges into it
// and keeps its id), each carrying `series`. A held event on one of the series' dates is flagged even when nothing new is added.
export function seriesCandidates(list, existing, { sources = [], now = new Date() } = {}) {
  const held = new Set(existing.map((e) => e.id));
  const out = [];
  const stats = { series: 0, flagged: 0, added: 0, dropped: {} };
  for (const s of list) {
    const items = seriesItemsOf(s, now);
    if (!items.length) continue;
    stats.series++;
    const r = promote(items, existing, { sources, now });
    for (const [k, n] of Object.entries(r.stats.dropped)) stats.dropped[k] = (stats.dropped[k] || 0) + n;
    const today = localToday(now, s.tz);
    for (const c of r.candidates) {
      const projected = !held.has(c.id);
      c.series = { id: s.id, rule: ruleText(s), weekdays: [...s.weekdays].sort((a, b) => a - b), until: limitOf(s, today), source_url: s.source_url, projected };
      projected ? stats.added++ : stats.flagged++;
      out.push(c);
    }
  }
  return { candidates: out, stats };
}

// Held events that belong to a series that has since ended, been removed, or no longer lists that date: future occurrences go.
// Past ones stay (the writer expires them on its own clock).
export function endedOccurrences(existing, list, now = new Date()) {
  const byId = new Map(list.map((s) => [s.id, s]));
  const gone = new Set();
  for (const e of existing) {
    if (!e.series || !e.series.id) continue;
    const s = byId.get(e.series.id);
    const tz = (s && s.tz) || e.tz;
    const today = localToday(now, tz);
    const day = String(e.start).slice(0, 10);
    if (day < today) continue;
    if (!s || s.active === false) { if (e.series.projected) gone.add(e.id); continue; }
    const limit = limitOf(s, today);
    const listed = s.weekdays.includes(weekdayOf(day)) && !(s.skip || []).includes(day) && (!s.from || day >= s.from);
    if (!listed || (limit && day > limit) || (!limit && e.series.projected && day > (e.series.until || today))) gone.add(e.id);
  }
  return gone;
}

// A series the data suggests but nobody has recorded: three or more held dates of one source and place on the same weekday, a week
// apart, or text with a weekly phrase. For the human who writes data/series.json; nothing here creates events.
const RECURRING = /\bweekly\b|\b(?:every|each)\s+(?:other\s+|single\s+)?(?:sun|mon|tue|wed|thu|fri|sat)|\b(?:sun|mon|tues|wednes|thurs|fri|satur)days?\b/i;
export function detectSeries(events, list = [], today = ymd(Date.now())) {
  const known = new Set(list.map((s) => `${s.source_id}|${String(s.venue || "").toLowerCase()}`));
  const groups = new Map();
  for (const e of events) {
    if ((e.end || e.start).slice(0, 10) < today || e.status === "cancelled") continue;
    const k = `${e.source_id}|${String(e.venue || e.address || "").toLowerCase()}`;
    if (!String(e.venue || e.address || "").trim() || known.has(k)) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  const out = [];
  for (const [k, v] of groups) {
    const days = [...new Set(v.map((e) => e.start.slice(0, 10)))].sort();
    const byWd = new Map();
    for (const d of days) (byWd.get(weekdayOf(d)) || byWd.set(weekdayOf(d), []).get(weekdayOf(d))).push(d);
    const weekly = [...byWd.entries()].filter(([, ds]) => ds.length >= 3 && ds.slice(1).every((d, i) => (dayMs(d) - dayMs(ds[i])) % (7 * DAY) === 0));
    const text = v.some((e) => RECURRING.test(`${e.title} ${e.description || ""} ${e.hours || ""}`));
    if (!weekly.length && !(text && days.length >= 2)) continue;
    const f = v[0];
    out.push({ key: k, brand: f.brand, venue: f.venue, city: `${f.city}, ${f.state}`, dates: days.length, weekdays: (weekly.length ? weekly.map(([w]) => w) : [...byWd.keys()]).map((w) => WD3[w]).join("/"), phrase: text, source_url: f.source_url });
  }
  return out.sort((a, b) => b.dates - a.dates);
}

// A page recheck: a series with recheck {url, pattern} is confirmed again today when the page still shows the pattern.
export async function recheckSeries(list, fetcher, now = new Date()) {
  const log = [];
  for (const s of list) {
    if (!s.recheck || s.active === false) continue;
    try {
      const r = await fetcher.get(s.recheck.url);
      if (r.ok && new RegExp(s.recheck.pattern, "i").test(r.text)) { s.confirmed = localToday(now, s.tz); log.push(`${s.id}: confirmed`); }
      else log.push(`${s.id}: page ${r.ok ? "no longer shows the rule" : "not readable"} (confirmed ${s.confirmed})`);
    } catch (e) { log.push(`${s.id}: ${e.message}`); }
  }
  return log;
}

export function writeSeries(list, path = SERIES_PATH) {
  fs.writeFileSync(path, JSON.stringify({ about: "Recurring pop-ups. Rules in docs/SERIES.md; ingest expands them into dated events flagged with `series`.", series: list }, null, 2) + "\n");
}

export { normStart, eventId };
