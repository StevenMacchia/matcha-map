// Merge candidates into events.json: ids, first/last seen, status, decay, expiry, write.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SOCIAL_POST } from "./extract.js";

const CONF = ["unsure", "likely", "confirmed"];
const DAY = 86400000;
export const DECAY_DAYS = 14;
export const KEEP_PAST_DAYS = 30;

// id = sha1(source_id + start date + lowercased venue-or-address), first 12 hex.
export function eventId(e) {
  const day = String(e.start).slice(0, 10);
  const where = String(e.venue || e.address || "").toLowerCase().trim();
  return createHash("sha1").update(`${e.source_id}${day}${where}`).digest("hex").slice(0, 12);
}

// When does an event stop being "now"? End if known, else a 3h guess, or a full day if all-day.
export function endMs(e) {
  if (e.end) return Date.parse(e.end);
  return Date.parse(e.start) + (e.all_day ? DAY : 3 * 3600000);
}

// Status from now. A cancelled event stays cancelled.
export function computeStatus(e, now) {
  if (e.status === "cancelled") return "cancelled";
  return endMs(e) < new Date(now).getTime() ? "past" : "upcoming";
}

const stepDown = (c, n) => CONF[Math.max(0, CONF.indexOf(c) - n)];

// Fields of the schema, in a stable order, so candidates carry no extra keys.
const FIELDS = ["id", "brand", "source_id", "handle", "source_url", "title", "start", "end", "tz", "all_day", "venue", "address", "city", "state", "zip", "lat", "lng", "geocode_source", "confidence", "status", "last_seen", "first_seen", "extracted_by", "image", "posts", "menu", "price", "description", "links"];
const emptyPosts = () => ({ instagram: null, tiktok: null, other: null });
const emptyLinks = () => ({ website: null, instagram: null, tiktok: null });
const DEFAULTS = { menu: () => [], posts: emptyPosts, links: emptyLinks };
export function clean(e) {
  const o = {};
  for (const k of FIELDS) {
    const v = e[k];
    o[k] = v === undefined || v === null ? (DEFAULTS[k] ? DEFAULTS[k]() : null) : v;
  }
  o.posts = { ...emptyPosts(), ...o.posts };
  o.links = { ...emptyLinks(), ...o.links };
  o.menu = (Array.isArray(o.menu) ? o.menu : []).slice(0, 8);
  return o;
}

// One-off migration: an event saved before the card fields existed gets them defaulted.
// posts come from source_url when it is an Instagram or TikTok post; links come from its source.
export function migrateEvent(e, source = null) {
  const m = { ...e };
  const posts = { ...emptyPosts(), ...(e.posts || {}) };
  const sm = SOCIAL_POST.exec(e.source_url || "");
  if (sm && !posts[sm[1].toLowerCase()]) posts[sm[1].toLowerCase()] = e.source_url.split(/[?#]/)[0];
  m.posts = posts;
  const links = { ...emptyLinks(), ...(e.links || {}) };
  if (source) {
    links.website = links.website || source.website || null;
    links.instagram = links.instagram || (source.instagram ? `https://www.instagram.com/${source.instagram}/` : null);
    links.tiktok = links.tiktok || (source.tiktok ? `https://www.tiktok.com/@${source.tiktok}` : null);
  }
  m.links = links;
  return clean(m);
}

// A fresh reading keeps what the last one learned when it brings nothing new: the downloaded image
// (same url), and any link or image the source stopped showing.
function carryRich(merged, prev, c) {
  if (prev.image) {
    if (!c.image) merged.image = prev.image;
    else if (c.image.url === prev.image.url) merged.image = { ...c.image, local: prev.image.local || c.image.local || null, width: prev.image.width || c.image.width || null, height: prev.image.height || c.image.height || null };
  }
  merged.posts = Object.fromEntries(["instagram", "tiktok", "other"].map((k) => [k, c.posts?.[k] || prev.posts?.[k] || null]));
  merged.links = Object.fromEntries(["website", "instagram", "tiktok"].map((k) => [k, c.links?.[k] || prev.links?.[k] || null]));
}

// mergeEvents(existing[], candidates[], opts) -> { events, decay, stats }
//  opts.now: Date|string; opts.liveSourceIds: sources fetched OK this run;
//  opts.decay: { [id]: stepsAlreadyApplied } (sidecar state so decay is not repeated).
export function mergeEvents(existing, candidates, { now = new Date(), liveSourceIds = [], decay = {} } = {}) {
  const nowIso = new Date(now).toISOString();
  const nowMs = new Date(now).getTime();
  const live = new Set(liveSourceIds);
  const byId = new Map(existing.map((e) => [e.id, { ...e }]));
  const newDecay = { ...decay };
  const stats = { added: 0, updated: 0, decayed: 0, dropped: 0 };
  const seenThisRun = new Set();

  for (const c of candidates) {
    const id = c.id || eventId(c);
    const prev = byId.get(id);
    if (seenThisRun.has(id)) {
      // Same event twice in one run: keep the more confident reading.
      const cur = byId.get(id);
      if (CONF.indexOf(c.confidence) <= CONF.indexOf(cur.confidence)) continue;
    }
    seenThisRun.add(id);
    const merged = { ...(prev || {}), ...c, id, first_seen: prev ? prev.first_seen : nowIso, last_seen: nowIso };
    if (prev) carryRich(merged, prev, c);
    if (prev && prev.status === "cancelled") merged.status = "cancelled";
    byId.set(id, clean(merged));
    delete newDecay[id];
    if (prev) stats.updated++; else stats.added++;
  }

  const out = [];
  for (const [id, e0] of byId) {
    const e = { ...e0 };
    // Unseen for 14+ days from a live source: one step down per 14 days.
    if (!seenThisRun.has(id) && live.has(e.source_id) && e.extracted_by !== "manual") {
      const unseen = (nowMs - Date.parse(e.last_seen)) / DAY;
      const due = Math.floor(unseen / DECAY_DAYS);
      const done = newDecay[id] || 0;
      if (due > done) {
        e.confidence = stepDown(e.confidence, due - done);
        newDecay[id] = due;
        stats.decayed++;
      }
    }
    e.status = computeStatus(e, nowMs);
    // Past events are kept 30 days, then dropped.
    if (e.status === "past" && nowMs - endMs(e) > KEEP_PAST_DAYS * DAY) { stats.dropped++; delete newDecay[id]; continue; }
    out.push(clean(e));
  }
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  for (const id of Object.keys(newDecay)) if (!out.some((e) => e.id === id)) delete newDecay[id];
  return { events: out, decay: newDecay, stats };
}

// Write data/events.json and copy to site/data/events.json.
export function writeEvents(events, { now = new Date(), dataPath = "data/events.json", sitePath = "site/data/events.json" } = {}) {
  const body = JSON.stringify({ generated: new Date(now).toISOString(), events }, null, 2) + "\n";
  for (const p of [dataPath, sitePath]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  // Brands layer: copy sources.json next to events.json so the site needs no hand copy.
  const srcFrom = path.join(path.dirname(dataPath), "sources.json");
  if (fs.existsSync(srcFrom)) fs.copyFileSync(srcFrom, path.join(path.dirname(sitePath), "sources.json"));
  return body;
}

// Reads events and migrates old records (see migrateEvent). Sources come from sources.json beside the file.
export function readEvents(dataPath = "data/events.json") {
  let events = [];
  try { events = JSON.parse(fs.readFileSync(dataPath, "utf8")).events || []; } catch { return []; }
  let sources = [];
  try { sources = JSON.parse(fs.readFileSync(path.join(path.dirname(dataPath), "sources.json"), "utf8")); } catch { /* none */ }
  const byId = new Map(sources.map((s) => [s.id, s]));
  return events.map((e) => migrateEvent(e, byId.get(e.source_id) || null));
}
