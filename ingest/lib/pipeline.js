// Shared by `npm run ingest` and `npm run watch`: RawItems -> candidates, then dedupe, geocode, merge, write.
import fs from "node:fs";
import { extract, richFields } from "./extract.js";
import { downloadImages, pruneImages } from "./images.js";
import { improve } from "./llm.js";
import { eventId, mergeEvents, readEvents, writeEvents, endMs, KEEP_PAST_DAYS } from "./write.js";

const CONF = ["unsure", "likely", "confirmed"];

// One RawItem -> geocode-ready candidates for a source.
export async function itemToCandidates(raw, source, now, handle) {
  let cands = extract(raw, { source, now });
  cands = await improve(cands, raw, { now });
  const rich = richFields(raw, source);
  return cands.map((c) => ({ ...c, ...rich, brand: source.brand, source_id: source.id, handle: raw.handle || handle || null }));
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

// An event first found on MATO under mato:<slug> is replaced when the same venue is later read as a real source
// (same handle, same day, same place): the old record would otherwise show twice.
export function dropSuperseded(existing, final) {
  const sameSlot = new Set(final.filter((c) => !String(c.source_id).startsWith("mato:") && c.handle).map((c) => `${String(c.handle).toLowerCase()}|${String(c.start).slice(0, 10)}|${String(c.venue || c.address || "").toLowerCase().trim()}`));
  return existing.filter((e) => !(String(e.source_id).startsWith("mato:") && sameSlot.has(`${String(e.handle || "").toLowerCase()}|${String(e.start).slice(0, 10)}|${String(e.venue || e.address || "").toLowerCase().trim()}`)));
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
