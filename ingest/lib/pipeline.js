// Shared by `npm run ingest` and `npm run watch`: RawItems -> candidates, then dedupe, geocode, merge, write.
import fs from "node:fs";
import { extract } from "./extract.js";
import { improve } from "./llm.js";
import { eventId, mergeEvents, readEvents, writeEvents, endMs, KEEP_PAST_DAYS } from "./write.js";

const CONF = ["unsure", "likely", "confirmed"];

// One RawItem -> geocode-ready candidates for a source.
export async function itemToCandidates(raw, source, now, handle) {
  let cands = extract(raw, { source, now });
  cands = await improve(cands, raw, { now });
  return cands.map((c) => ({ ...c, brand: source.brand, source_id: source.id, handle: raw.handle || handle || null }));
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

// Geocode, merge with data/events.json, and (unless dry) write. Returns {merged, final}.
export async function finalize(candidates, { now, geocoder, liveSourceIds = [], dry = false }) {
  const final = [];
  for (const c of dedupeCandidates(candidates, now)) final.push(await geocoder.geocode(c));
  if (!dry) geocoder.save();
  const existing = readEvents();
  let decay = {};
  try { decay = JSON.parse(fs.readFileSync("data/decay.json", "utf8")); } catch { /* first run */ }
  const merged = mergeEvents(existing, final, { now, liveSourceIds, decay });
  if (!dry) {
    writeEvents(merged.events, { now });
    fs.writeFileSync("data/decay.json", JSON.stringify(merged.decay, null, 2) + "\n");
  }
  return { merged, final };
}
