// The review folder (data/review/). Every candidate any crawler finds is written to data/review/<yyyy-mm-dd>.json as
// {generated, items:[...]}: an event-shaped record (the event.schema fields it has) plus evidence (URLs), hours, pay and notes.
// Hand-written files (data/review/sweep-<group>.json from coverage sweeps) use the same item shape. `npm run ingest` reads every
// file here and promotes the items at confidence confirmed or likely that pass the quality rules; an item that is the same event as
// one already in events.json (same brand, same start day, and the same venue or within 300 m) is merged into it, richer value kept.
// Unsure items stay in their file for a human (`npm run review` lists them).
import fs from "node:fs";
import path from "node:path";
import { eventId } from "./write.js";
import { judge } from "./quality.js";
import { kmBetween } from "./geocode.js";
import { tzFor, zonedIso, STATES } from "./tz.js";
import { slugify } from "./sites/common.js";

export const REVIEW_DIR = "data/review";
export const KEEP_DAYS = 14; // dated run files older than this are removed; sweep files are never touched
export const SAME_KM = 0.3;
export const PROMOTE = new Set(["confirmed", "likely"]);
const CONF = ["unsure", "likely", "confirmed"];

export const ITEM_FIELDS = ["brand", "handle", "title", "start", "end", "tz", "all_day", "venue", "address", "city", "state", "zip", "lat", "lng", "approx", "source_id", "kind", "source_url", "posts", "menu", "price", "description", "image_url", "confidence", "extracted_by", "evidence", "hours", "pay", "notes"];

const isUrl = (u) => /^https?:\/\//.test(u || "");
export const arr = (x) => (Array.isArray(x) ? x : x === undefined || x === null || x === "" ? [] : [x]);
const empty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

// A pipeline candidate -> review item. site: the crawler that found it.
export function toItem(c, site = null) {
  const o = {};
  for (const k of ITEM_FIELDS) if (!empty(c[k])) o[k] = c[k];
  if (o.posts && Object.values(o.posts).every((v) => !v)) delete o.posts;
  o.evidence = [...new Set([c.source_url, ...arr(c.evidence)].filter(isUrl))];
  const why = [site && `found by ${site}`, c.cityInferred && "city inferred from the source", c.approx && "pin at the city centre", c.llm_brand && `model read brand: ${c.llm_brand}`, c.drop && `dropped: ${c.drop}`].filter(Boolean);
  if (why.length) o.notes = [o.notes, ...why].filter(Boolean).join("; ");
  return o;
}

const itemKey = (i) => `${i.source_id || slugify(i.brand)}|${String(i.start || "").slice(0, 10)}|${String(i.venue || i.address || "").toLowerCase().trim()}`;

// Write (or update) today's run file. Same key replaces, new keys are appended. Dated files older than KEEP_DAYS are pruned.
export function writeReview(items, { now = new Date(), dir = REVIEW_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date(now).toISOString().slice(0, 10);
  const file = path.join(dir, `${day}.json`);
  let old = [];
  try { old = JSON.parse(fs.readFileSync(file, "utf8")).items || []; } catch { /* first run today */ }
  const byKey = new Map(old.map((i) => [itemKey(i), i]));
  for (const i of items) byKey.set(itemKey(i), i);
  const all = [...byKey.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.brand).localeCompare(String(b.brand)));
  fs.writeFileSync(file, JSON.stringify({ generated: new Date(now).toISOString(), items: all }, null, 2) + "\n");
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
    if (m && Date.parse(m[1]) < new Date(now).getTime() - KEEP_DAYS * 86400000) fs.rmSync(path.join(dir, f));
  }
  return { file, count: all.length };
}

// Every item of every .json file in the folder, each tagged with its file name (_file). A broken file is skipped, not fatal.
export function readReview(dir = REVIEW_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    for (const i of Array.isArray(j) ? j : j?.items || []) if (i && typeof i === "object") out.push({ ...i, _file: f });
  }
  return out;
}

// "2026-12-06", "2026-12-06T11:00", "2026-12-06T11:00:00-08:00" -> {start, all_day} in the venue's zone, or null.
export function normStart(s, tz) {
  const t = String(s || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!m) return null;
  if (m[6]) return Number.isNaN(Date.parse(t)) ? null : { start: t, all_day: false };
  const [y, mo, d] = m.slice(1, 4).map(Number);
  const timed = m[4] !== undefined;
  return { start: zonedIso(tz, y, mo, d, timed ? +m[4] : 0, timed ? +m[5] : 0), all_day: !timed };
}

const normBrand = (b) => String(b || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const normVenue = (v) => String(v || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const hasLL = (e) => typeof e.lat === "number" && typeof e.lng === "number" && !e.approx;
// Same event: same brand (or handle), same start day, and the same venue or within 300 m (city-centre pins do not count).
export function sameEvent(a, b) {
  const brand = (normBrand(a.brand) && normBrand(a.brand) === normBrand(b.brand)) || (a.handle && b.handle && String(a.handle).toLowerCase() === String(b.handle).toLowerCase());
  if (!brand || String(a.start).slice(0, 10) !== String(b.start).slice(0, 10)) return false;
  const va = normVenue(a.venue || a.address), vb = normVenue(b.venue || b.address);
  if (va && va === vb) return true;
  return hasLL(a) && hasLL(b) && kmBetween(a, b) <= SAME_KM;
}

// The richer of two values: a longer string, arrays unioned, objects merged key by key, else the non-empty one; `a` wins ties.
export function richer(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return [...new Set([...arr(a), ...arr(b)])];
  if (a && typeof a === "object" && b && typeof b === "object") return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, a[k] ?? b[k] ?? null]));
  if (typeof a === "string" && typeof b === "string") return b.trim().length > a.trim().length ? b : a;
  return empty(a) ? b ?? null : a;
}

// Merge a found item into an event already held. The id inputs (source, start day, venue or address) stay the existing ones,
// so the merged record keeps its id; everything else takes the richer value.
export function mergeInto(e, c) {
  const o = { ...e };
  for (const k of ["title", "end", "zip", "handle", "posts", "menu", "price", "description", "image_url", "evidence", "hours", "pay", "links"]) o[k] = richer(e[k], c[k]);
  if (e.venue && !e.address && c.address) o.address = c.address; // the id reads the venue first, so adding a street keeps it
  if (!hasLL(e) && hasLL(c)) Object.assign(o, { lat: c.lat, lng: c.lng, approx: false, geocode_source: c.geocode_source || "manual", keepCoords: true });
  if (e.all_day && c.all_day === false && String(c.start).slice(0, 10) === String(e.start).slice(0, 10)) { o.start = c.start; o.all_day = false; }
  o.menu = (o.menu || []).slice(0, 8);
  o.confidence = CONF[Math.max(CONF.indexOf(e.confidence), CONF.indexOf(c.confidence))];
  return o;
}

// The source an item belongs to: its source_id, else the source whose Instagram handle it names, else review:<brand slug>.
function sourceFor(i, sources) {
  if (i.source_id) return sources.find((s) => s.id === i.source_id) || { id: i.source_id };
  const h = String(i.handle || "").replace(/^@/, "").toLowerCase();
  return (h && sources.find((s) => String(s.instagram || "").toLowerCase() === h)) || { id: `review:${slugify(i.brand) || "event"}` };
}

// A review item -> a pipeline candidate, or {drop: reason}. Missing fields are tolerated; brand, state, date and a URL are needed.
export function toCandidate(i, sources = []) {
  if (!String(i.brand || "").trim()) return { drop: "no brand" };
  const state = String(i.state || "").toUpperCase();
  if (!STATES.includes(state)) return { drop: "no state" };
  const tz = i.tz || tzFor({ city: i.city, state }) || "America/New_York";
  const when = normStart(i.start, tz);
  if (!when) return { drop: "no date" };
  const source_url = isUrl(i.source_url) ? i.source_url : arr(i.evidence).find(isUrl);
  if (!source_url) return { drop: "no source url" };
  const src = sourceFor(i, sources);
  const ll = typeof i.lat === "number" && typeof i.lng === "number";
  const brand = String(i.brand).trim();
  const c = {
    brand, source_id: src.id, kind: i.kind || src.kind || "popup", category: i.category || src.category || "matcha",
    handle: i.handle ? String(i.handle).replace(/^@/, "") : src.instagram || null, source_url,
    title: i.title || `${brand} pop-up${i.venue ? ` at ${i.venue}` : ""}`, start: when.start, end: i.end ? normStart(i.end, tz)?.start || null : null, tz,
    all_day: typeof i.all_day === "boolean" ? i.all_day : when.all_day, venue: i.venue || "", address: i.address || "", city: i.city || "", state, zip: i.zip || null,
    lat: ll ? i.lat : null, lng: ll ? i.lng : null, geocode_source: ll ? i.geocode_source || "manual" : null, approx: !!i.approx,
    confidence: CONF.includes(i.confidence) ? i.confidence : "unsure", extracted_by: ["rule", "llm", "manual", "sweep"].includes(i.extracted_by) ? i.extracted_by : "manual",
    posts: i.posts || null, menu: arr(i.menu).length ? arr(i.menu).map((m) => String(m).toLowerCase().slice(0, 40)).slice(0, 8) : [], price: i.price || null,
    description: i.description ? String(i.description).slice(0, 200) : null, image_url: i.image_url || null,
    evidence: [...new Set([source_url, ...arr(i.evidence)].filter(isUrl))], hours: i.hours || null, pay: i.pay || null,
    keepCoords: ll,
  };
  if (c.end && Date.parse(c.end) < Date.parse(c.start)) c.end = null;
  return c;
}

// items (readReview) + events held -> {candidates (for finalize), stats}. Nothing is written here.
// Notes that say a worker guessed something (a sample date of a weekly residency, a placeholder time): never promoted.
export const HEDGED = /placeholder|inferred|assum|sample date|not checked|holiday risk/i;
export const effectiveConfidence = (i) => (HEDGED.test(String(i.notes || "")) ? "unsure" : i.confidence);
export const isSweep = (i) => /^sweep-/.test(String(i._file || ""));

export function promote(items, existing = [], { sources = [], now = new Date() } = {}) {
  const stats = { read: items.length, unsure: 0, hedged: 0, promoted: 0, merged: 0, duplicates: 0, past: 0, dropped: {} };
  const drop = (r) => { stats.dropped[r] = (stats.dropped[r] || 0) + 1; };
  const out = [];
  for (const i of items) {
    if (!PROMOTE.has(effectiveConfidence(i))) { stats.unsure++; if (PROMOTE.has(i.confidence)) stats.hedged++; continue; }
    const c = toCandidate(i, sources);
    if (c.drop) { drop(c.drop); continue; }
    if (isSweep(i)) c.extracted_by = "sweep";
    if (Date.parse(c.end || c.start) < new Date(now).getTime() - 86400000) { stats.past++; continue; }
    const q = judge(c);
    if (!q.keep) { drop(q.reason); continue; }
    if (q.kind || /kind:\s*class/i.test(String(i.notes || ""))) c.kind = "organizer"; // the schema's class kind (data/KINDS.md)
    const twin = out.find((o) => sameEvent(o, c));
    if (twin) { Object.assign(twin, mergeInto(twin, c)); stats.duplicates++; continue; }
    const e = existing.find((x) => sameEvent(x, c));
    if (e) { out.push({ ...mergeInto(e, c), id: e.id }); stats.merged++; continue; }
    c.id = eventId(c);
    out.push(c);
    stats.promoted++;
  }
  return { candidates: out, stats };
}

// Unsure items as a plain-text table for a human.
export function unsureTable(items) {
  const rows = items.filter((i) => !PROMOTE.has(effectiveConfidence(i))).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const cut = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " "); return (t.length > n ? t.slice(0, n - 1) + "…" : t).padEnd(n); };
  const lines = [`${cut("date", 16)} ${cut("brand", 22)} ${cut("title", 34)} ${cut("where", 28)} ${cut("file", 18)} evidence`];
  for (const i of rows) {
    const where = [i.venue, [i.city, i.state].filter(Boolean).join(", ")].filter(Boolean).join(" / ");
    lines.push(`${cut(String(i.start || "").slice(0, 16).replace("T", " "), 16)} ${cut(i.brand, 22)} ${cut(i.title, 34)} ${cut(where, 28)} ${cut(i._file, 18)} ${arr(i.evidence)[0] || i.source_url || ""}`);
  }
  return { rows, text: lines.join("\n") };
}
