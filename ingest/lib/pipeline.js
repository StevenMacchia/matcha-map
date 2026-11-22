// Shared by `npm run ingest` and `npm run watch`: RawItems -> candidates, then dedupe, geocode, merge, write.
import fs from "node:fs";
import { extract, richFields } from "./extract.js";
import { downloadImages, pruneImages } from "./images.js";
import { improve } from "./llm.js";
import { SITE_ORDER } from "./sites/common.js";
import { matoKind, isMatoSource, isPseudoId, eventId, mergeEvents, readEvents, writeEvents, endMs, KEEP_PAST_DAYS } from "./write.js";

const CONF = ["unsure", "likely", "confirmed"];

// One RawItem -> geocode-ready candidates for a source.
export async function itemToCandidates(raw, source, now, handle) {
  let cands = extract(raw, { source, now });
  cands = await improve(cands, raw, { now });
  const rich = richFields(raw, source);
  const mato = isMatoSource(source.id, source);
  return cands.map((c) => ({ ...c, ...rich, ...(mato ? { kind: matoKind(c.title), category: "matcha" } : { kind: source.kind || "popup", category: source.category || "matcha" }), brand: source.brand, source_id: source.id, handle: raw.handle || handle || null }));
}

// processItems(items, source, {now, handle}) -> { candidates, popupAt }.
// popupAt = newest published_at among items that produced a dated candidate (or null).
export async function processItems(items, source, { now = new Date(), handle = null } = {}) {
  const candidates = [];
  let popupAt = null;
  for (const raw of items) {
    const cs = await itemToCandidates(raw, source, now, handle);
    if (!cs.length) continue;
    candidates.push(...cs);
    if (raw.published_at && (!popupAt || Date.parse(raw.published_at) > Date.parse(popupAt))) popupAt = new Date(raw.published_at).toISOString();
  }
  return { candidates, popupAt };
}

// Dedupe by id (best confidence wins) and drop long-past ones.
export function dedupeCandidates(candidates, now) {
  const byId = new Map();
  for (const c of candidates) {
    c.id = eventId(c);
    if (now.getTime() - endMs(c) > KEEP_PAST_DAYS * 86400000) continue;
    const p = byId.get(c.id);
    if (!p || CONF.indexOf(c.confidence) > CONF.indexOf(p.confidence)) byId.set(c.id, c);
  }
  return [...byId.values()];
}

// An event first found on MATO (or another event site) under <site>:<slug> is replaced when the same venue is later read as a
// real source (same handle, same day, same place): the old record would otherwise show twice. A pseudo-source event is also
// dropped when a better-ranked site (see SITE_ORDER) reads the same title on the same day.
export function dropSuperseded(existing, final) {
  const slot = (e) => `${String(e.handle || "").toLowerCase()}|${String(e.start).slice(0, 10)}|${String(e.venue || e.address || "").toLowerCase().trim()}`;
  const sameSlot = new Set(final.filter((c) => !isPseudoId(c.source_id) && c.handle).map(slot));
  const rank = (id) => { const i = SITE_ORDER.indexOf(String(id).split(":")[0]); return isPseudoId(id) ? i : -1; };
  const norm = (t) => String(t || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
  const best = new Map();
  for (const c of final) { if (!norm(c.title)) continue; const k = `${norm(c.title)}|${String(c.start).slice(0, 10)}`; best.set(k, Math.min(best.get(k) ?? 99, rank(c.source_id))); }
  return existing.filter((e) => {
    if (!isPseudoId(e.source_id)) return true;
    if (sameSlot.has(slot(e))) return false;
    if (!norm(e.title)) return true;
    const b = best.get(`${norm(e.title)}|${String(e.start).slice(0, 10)}`);
    return !(b !== undefined && b < rank(e.source_id));
  });
}

// Geocode, merge with data/events.json, and (unless dry) write. Returns {merged, final}.
export async function finalize(candidates, { now, geocoder, fetcher = null, liveSourceIds = [], dry = false }) {
  const final = [];
  for (const c of dedupeCandidates(candidates, now)) final.push(await geocoder.geocode(c));
  if (!dry) geocoder.save();
  const existing = dropSuperseded(readEvents(), final);
  let decay = {};
  try { decay = JSON.parse(fs.readFileSync("data/decay.json", "utf8")); } catch { /* first run */ }
  const merged = mergeEvents(existing, final, { now, liveSourceIds, decay });
  if (!dry) {
    if (fetcher) {
      merged.images = await downloadImages(merged.events, { fetcher });
      pruneImages(merged.events);
    }
    writeEvents(merged.events, { now });
    fs.writeFileSync("data/decay.json", JSON.stringify(merged.decay, null, 2) + "\n");
  }
  return { merged, final };
}
