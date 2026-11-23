// Merge candidates into events.json: ids, first/last seen, status, decay, expiry, write.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SOCIAL_POST } from "./extract.js";
import { hasMatcha } from "../adapters/mato.js";
import { SITE_ORDER } from "./sites/common.js";
import { PLACEHOLDER_VENUE } from "./names.js";
import { judge } from "./quality.js";

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
const FIELDS = ["id", "brand", "source_id", "kind", "category", "handle", "source_url", "title", "start", "end", "tz", "all_day", "venue", "address", "city", "state", "zip", "lat", "lng", "geocode_source", "approx", "confidence", "status", "last_seen", "first_seen", "extracted_by", "image", "image_url", "posts", "menu", "price", "description", "links", "hours", "pay", "evidence"];
const emptyPosts = () => ({ instagram: null, tiktok: null, other: null });
const emptyLinks = () => ({ website: null, instagram: null, tiktok: null });
const DEFAULTS = { approx: () => false, menu: () => [], posts: emptyPosts, links: emptyLinks, kind: () => "popup", category: () => "matcha", evidence: () => [] };
export function clean(e) {
  const o = {};
  for (const k of FIELDS) {
    const v = e[k];
    o[k] = v === undefined || v === null ? (DEFAULTS[k] ? DEFAULTS[k]() : null) : v;
  }
  o.posts = { ...emptyPosts(), ...o.posts };
  o.links = { ...emptyLinks(), ...o.links };
  o.menu = (Array.isArray(o.menu) ? o.menu : []).slice(0, 8);
  o.evidence = [...new Set((Array.isArray(o.evidence) ? o.evidence : []).filter((u) => String(u || "").startsWith("http")))].slice(0, 8);
  return o;
}

// MATO finds: the slug is nearly always the brand's own handle, so they are pop-ups, unless the title says class, workshop, meetup, tasting, 101 or club.
export const MATO_ORGANIZER = /\b(class(es)?|workshop|meet-?up|tasting|101|club)\b/i;
// The same rule covers the pseudo-sources of the other event sites (luma:, eventbrite:, dostuff:, meetup:, allevents:, see ingest/lib/sites).
export const isPseudoId = (id) => SITE_ORDER.some((p) => String(id || "").startsWith(`${p}:`));
export const isMatoSource = (id, source) => isPseudoId(id) || /Found on MATO/.test(source?.kind_note || "");
export const matoKind = (title) => (MATO_ORGANIZER.test(String(title || "")) ? "organizer" : "popup");

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
  // kind and category come from the source; MATO finds with no source record are organizers, anything else unknown is a matcha pop-up.
  if (isMatoSource(e.source_id, source)) { m.kind = matoKind(e.title); m.category = "matcha"; }
  else { m.kind = source?.kind || e.kind || "popup"; m.category = source?.category || e.category || "matcha"; }
  // approx: drawn at the city's centre because no place was found (the geocoder's last resort); false for anything geocoded.
  m.approx = m.geocode_source === "none" && m.lat != null;
  return clean(m);
}

// A fresh reading keeps what the last one learned when it brings nothing new: the downloaded image
// (same url), and any link or image the source stopped showing.
function carryRich(merged, prev, c) {
  if (prev.image) {
    if (!c.image) merged.image = prev.image;
    else if (c.image.url === prev.image.url) merged.image = { ...c.image, local: prev.image.local || c.image.local || null, width: prev.image.width || c.image.width || null, height: prev.image.height || c.image.height || null };
  }
  // The API picture url is refreshed on every read; an older one stays only until a read brings a new one.
  merged.image_url = c.image_url || prev.image_url || null;
  merged.posts = Object.fromEntries(["instagram", "tiktok", "other"].map((k) => [k, c.posts?.[k] || prev.posts?.[k] || null]));
  merged.links = Object.fromEntries(["website", "instagram", "tiktok"].map((k) => [k, c.links?.[k] || prev.links?.[k] || null]));
}

// Events found through MATO or another event site (source_id mato:<slug>, luma:<slug> ...) stay only while their title, description, venue or brand has a matcha word.
export const keepMatoEvent = (e) => !isPseudoId(e.source_id) || hasMatcha(e.title, e.description, e.venue, e.brand, (e.menu || []).join(" "));

// ---- noise rules (rung 27) --------------------------------------------------------------------
// A title that is only "Matcha event" / "Matcha pop-up" with no brand beyond it says nothing about who or where.
export const GENERIC_TITLE = /^matcha (event|pop[\s-]?up)$/i;
export const hasNoBrand = (e) => !String(e.brand || "").trim() || /^matcha$/i.test(String(e.brand).trim()) || String(e.brand).trim().toLowerCase() === String(e.title || "").trim().toLowerCase();

// A post of an account that is on the watch list but not in sources.json is written only with all three:
// a matcha term, pop-up intent (a pop-up, market, vendor, booth, stand, cart, "find us", "serving"...) and a place.
export const POPUP_INTENT = /pop[\s-]?ups?\b|\bmarket\b|\bvendors?\b|\bbooth\b|\bstand\b|\bcart\b|catch us|find us|we['’]?ll be at|\bserving\b|come by|this weekend at/i;
export const hasPopupIntent = (...parts) => POPUP_INTENT.test(parts.filter(Boolean).join(" | "));
export const hasPlace = (e) => !!(e.venue || e.address || e.city);
export const passesWatchRule = (parts, place) => hasMatcha(...parts) && hasPopupIntent(...parts) && hasPlace(place);
// An event of a watch-list account (not a source, not a site find). sourceIds: ids in data/sources.json.
export const isWatchPseudo = (e, sourceIds) => !isPseudoId(e.source_id) && !String(e.source_id).startsWith("hashtag:") && !sourceIds.has(e.source_id);

// Keep or drop one event. ctx.sourceIds (optional) switches on the watch-list rule.
let DROPS = null; // data/overrides.json entries with drop: true are removed by id (a human call)
function dropped(id) {
  if (!DROPS) { try { const o = JSON.parse(fs.readFileSync("data/overrides.json", "utf8")); DROPS = new Set(Object.keys(o).filter((k) => o[k] && o[k].drop === true)); } catch { DROPS = new Set(); } }
  return DROPS.has(id);
}
export function keepEvent(e, { sourceIds = null } = {}) {
  if (dropped(e.id)) return false;
  if (!keepMatoEvent(e)) return false;
  // Site and web finds (pseudo sources) must name matcha as the point: hotel, craft-class and generic listings go (ingest/lib/quality.js).
  if (isPseudoId(e.source_id) && !judge(e).keep) return false;
  if (!e.state) return false; // no state, no place on the map (the schema needs one)
  if (GENERIC_TITLE.test(String(e.title || "").trim()) && hasNoBrand(e)) return false;
  if (sourceIds && isWatchPseudo(e, sourceIds) && !passesWatchRule([e.title, e.description, e.brand, e.venue, (e.menu || []).join(" ")], e)) return false;
  return true;
}

const SITE_LISTING = /^(eventbrite|allevents|meetup):/;
// Soften what is probably wrong without dropping it: a placeholder venue ("Cafe of the day") is blanked and the event marked
// unsure; a listing whose only matcha word sits inside a long run of vendor names is an organizer event, unsure.
export function tidy(e) {
  let o = e;
  if (PLACEHOLDER_VENUE.test(String(o.venue || "").trim())) o = { ...o, venue: "", confidence: "unsure" };
  if (SITE_LISTING.test(String(o.source_id || ""))) {
    const d = String(o.description || "");
    const list = (d.match(/@\w/g) || []).length > 8 || d.split(",").length > 9;
    if (list && !hasMatcha(o.title)) o = { ...o, confidence: "unsure", kind: "organizer" };
  }
  return o;
}

// mergeEvents(existing[], candidates[], opts) -> { events, decay, stats }
//  opts.now: Date|string; opts.liveSourceIds: sources fetched OK this run;
//  opts.decay: { [id]: stepsAlreadyApplied } (sidecar state so decay is not repeated).
export function mergeEvents(existing, candidates, { now = new Date(), liveSourceIds = [], decay = {}, sourceIds = null } = {}) {
  const nowIso = new Date(now).toISOString();
  const nowMs = new Date(now).getTime();
  const live = new Set(liveSourceIds);
  const byId = new Map(existing.filter((e) => keepEvent(e, { sourceIds })).map((e) => [e.id, { ...e }]));
  const newDecay = { ...decay };
  const stats = { added: 0, updated: 0, decayed: 0, dropped: 0, cleaned: existing.filter((e) => !keepEvent(e, { sourceIds })).length };
  const seenThisRun = new Set();

  for (const c0 of candidates) {
    if (!keepEvent(c0, { sourceIds })) { stats.cleaned++; continue; }
    const c = tidy(c0);
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
    out.push(clean(tidy(e)));
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
