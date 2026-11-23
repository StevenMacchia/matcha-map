// npm run audit: scan data/events.json for events that should not be on a matcha map. Read-only; prints, writes nothing.
//   1. no matcha signal anywhere (brand, title, description, menu; matcha, hojicha, usucha, koicha, ceremonial grade, drinks.json names), by source prefix
//   2. brunch / bar / fitness words with matcha only in the title
//   3. duplicate-looking pairs: same brand, same day, venues within 300 m
//   4. what keepEvent (the writer rule set) would drop, and counts before and after (--counts)
import fs from "node:fs";
import { hasSignal, OFFTOPIC } from "../ingest/lib/quality.js";
import { keepEvent } from "../ingest/lib/write.js";
import { kmBetween } from "../ingest/lib/geocode.js";

const prefix = (e) => String(e.source_id || "").split(":")[0];
const text = (e) => [e.brand, e.title, e.description, (e.menu || []).join(" ")];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function audit(events, { sourceIds = null } = {}) {
  const noSignal = events.filter((e) => !hasSignal(...text(e)));
  const titleOnly = events.filter((e) => hasSignal(e.title) && !hasSignal(e.brand, e.description, (e.menu || []).join(" ")) && OFFTOPIC.test(String(e.description || "")));
  const dupes = [];
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (!norm(a.brand) || norm(a.brand) !== norm(b.brand) || String(a.start).slice(0, 10) !== String(b.start).slice(0, 10)) continue;
    const near = typeof a.lat === "number" && typeof b.lat === "number" && kmBetween(a, b) <= 0.3;
    if (near || (a.venue && norm(a.venue) === norm(b.venue))) dupes.push([a, b]);
  }
  const dropped = events.filter((e) => !keepEvent(e, { sourceIds }));
  return { noSignal, titleOnly, dupes, dropped };
}

export function counts(events, now = new Date()) {
  const up = events.filter((e) => e.status !== "cancelled" && Date.parse(e.end || e.start) >= now.getTime());
  const by = {};
  for (const e of up) { const k = `${e.city}, ${e.state}`; by[k] = (by[k] || 0) + 1; }
  return { total: events.length, upcoming: up.length, cities: Object.entries(by).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 20) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop().split(String.fromCharCode(92)).pop())) {
  const events = JSON.parse(fs.readFileSync("data/events.json", "utf8")).events;
  const sourceIds = new Set(JSON.parse(fs.readFileSync("data/sources.json", "utf8")).map((s) => s.id));
  const r = audit(events, { sourceIds });
  const line = (e) => `  ${e.id} ${String(e.start).slice(0, 10)} ${e.brand} | ${e.title} | ${e.city || ""} ${e.state || ""} | ${e.source_id}`;
  console.log(`no matcha signal (${r.noSignal.length}):`);
  const g = {}; for (const e of r.noSignal) (g[prefix(e)] ||= []).push(e);
  for (const [k, v] of Object.entries(g).sort()) { console.log(` [${k}] ${v.length}`); v.forEach((e) => console.log(line(e))); }
  console.log(`\noff-topic words, matcha only in the title (${r.titleOnly.length}):`); r.titleOnly.forEach((e) => console.log(line(e)));
  console.log(`\nduplicate-looking pairs (${r.dupes.length}):`); r.dupes.forEach(([a, b]) => console.log(line(a) + "\n" + line(b) + "\n"));
  console.log(`\nthe writer would drop ${r.dropped.length}:`); r.dropped.forEach((e) => console.log(line(e)));
  const before = counts(events), after = counts(events.filter((e) => keepEvent(e, { sourceIds })));
  console.log(`\nbefore: ${before.total} total, ${before.upcoming} upcoming\nafter:  ${after.total} total, ${after.upcoming} upcoming`);
  if (process.argv.includes("--counts")) { console.log("top 20 cities (upcoming), before | after"); const am = new Map(after.cities); for (const [c, n] of before.cities) console.log(`  ${c}: ${n} | ${am.get(c) ?? 0}`); }
}
