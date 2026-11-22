// The watch list: accounts the map keeps checking (data/watchlist.json, see data/schema/watchlist.schema.json).
// Pure functions plus load/save. Cadence and status rules live here so they are testable.
import fs from "node:fs";
import path from "node:path";
import { readNote, looksLikeHandle } from "./mato-city.js";

export const FILE = "data/watchlist.json";
const HOUR = 3600000, DAY = 86400000;
export const QUIET_AFTER_DAYS = 90;      // watching -> quiet after this long with no hit
export const DROP_CANDIDATE_DAYS = 60;   // candidate with no hit this long -> dropped
export const RECENT_HIT_DAYS = 30;

export { readNote };
export const slug = (handle) => String(handle).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const norm = (h) => String(h || "").replace(/^@/, "").trim();
const key = (a) => `${a.platform}:${a.handle.toLowerCase()}`;

export function load(file = FILE) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { updated: null, accounts: [] }; }
}
export function save(wl, { file = FILE, now = new Date() } = {}) {
  wl.updated = new Date(now).toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(wl, null, 2) + "\n");
}

export function newAccount(o, now = new Date()) {
  return {
    handle: norm(o.handle), platform: o.platform || "instagram", source_id: o.source_id ?? null,
    status: o.status || "candidate", found_via: o.found_via || "manual", found_from: o.found_from ?? null,
    first_seen: new Date(now).toISOString(), last_checked: null, last_post_with_popup: null,
    hits: 0, checks: 0, cadence_hours: 72, notes: o.notes || "",
  };
}

// 24h for watching with a hit in the last 30 days, 72h for watching with none (and candidates), 168h for quiet.
export function cadenceFor(acc, now = new Date()) {
  if (acc.status === "quiet") return 168;
  if (acc.status === "watching" && acc.last_post_with_popup && new Date(now) - Date.parse(acc.last_post_with_popup) <= RECENT_HIT_DAYS * DAY) return 24;
  return 72;
}

export function isDue(acc, now = new Date()) {
  if (acc.status === "dropped") return false;
  if (!acc.last_checked) return true;
  return new Date(now) - Date.parse(acc.last_checked) >= (acc.cadence_hours || cadenceFor(acc, now)) * HOUR;
}
export function nextCheck(acc, now = new Date()) {
  if (acc.status === "dropped") return null;
  if (!acc.last_checked) return new Date(now).toISOString();
  return new Date(Date.parse(acc.last_checked) + (acc.cadence_hours || cadenceFor(acc, now)) * HOUR).toISOString();
}

// Record one finished check. foundCount = dated pop-ups seen this check (drives status); hitCount = the new ones, added to hits; popupAt = ISO of the post that had one.
// Returns the same account object, updated.
export function recordCheck(acc, { now = new Date(), hitCount = 0, foundCount = hitCount, popupAt = null } = {}) {
  const n = new Date(now);
  acc.checks = (acc.checks || 0) + 1;
  acc.last_checked = n.toISOString();
  if (foundCount > 0) {
    acc.hits = (acc.hits || 0) + hitCount;
    acc.last_post_with_popup = popupAt || n.toISOString();
    if (acc.status === "candidate" || acc.status === "quiet") acc.status = "watching";
  } else {
    const since = Date.parse(acc.last_post_with_popup || acc.first_seen);
    if (acc.status === "watching" && n - since > QUIET_AFTER_DAYS * DAY) acc.status = "quiet";
    else if (acc.status === "candidate" && n - Date.parse(acc.first_seen) > DROP_CANDIDATE_DAYS * DAY) acc.status = "dropped";
  }
  acc.cadence_hours = cadenceFor(acc, n);
  return acc;
}

// Add a candidate unless the handle is already on the list (any status). Returns the account or null.
export function addCandidate(wl, c, now = new Date()) {
  const h = norm(c.handle);
  if (!h) return null;
  const platform = c.platform || "instagram";
  if (wl.accounts.some((a) => a.platform === platform && a.handle.toLowerCase() === h.toLowerCase())) return null;
  const acc = newAccount({ ...c, handle: h, platform, status: "candidate" }, now);
  wl.accounts.push(acc);
  return acc;
}

// Seed from sources.json: every source with an instagram handle becomes "watching".
export function seedFromSources(sources, wl = { updated: null, accounts: [] }, now = new Date()) {
  for (const s of sources) {
    if (!s.instagram) continue;
    const have = wl.accounts.find((a) => a.platform === "instagram" && a.handle.toLowerCase() === s.instagram.toLowerCase());
    if (have) { have.source_id = have.source_id || s.id; continue; }
    wl.accounts.push(newAccount({ handle: s.instagram, source_id: s.id, status: "watching", found_via: "seed", found_from: "data/sources.json" }, now));
  }
  return wl;
}

// A pseudo source for an account that is not in sources.json yet. Its id is the slug of the handle,
// so events keep the same ids after promotion.
export function pseudoSource(acc) {
  const mv = readNote(acc.notes); // found on MATO: read its venue page, events keep the id mato:<slug>
  if (mv && acc.platform === "instagram") {
    return {
      id: acc.source_id || `mato:${mv.slug}`, brand: mv.brand || acc.handle, home_city: mv.city, home_state: mv.state,
      website: null, instagram: looksLikeHandle(mv.slug) ? mv.slug : null, tiktok: null,
      schedule_url: `https://ma.to/venue/${mv.slug}`, schedule_kind: "website", adapter: "mato", active: true,
      kind: "popup", category: "matcha",
    };
  }
  return {
    id: acc.source_id || slug(acc.handle), brand: acc.handle, home_city: "", home_state: "",
    website: null, instagram: acc.platform === "instagram" ? acc.handle : null, tiktok: acc.platform === "tiktok" ? acc.handle : null,
    schedule_url: null, schedule_kind: "manual", adapter: "manual", active: true,
  };
}

// Promotion: accounts that are watching, have a hit and no source_id become source records.
// Returns {sources, promoted:[handles]}; does not touch disk. The caller writes (npm run watch --promote).
export function promote(wl, sources, { now = new Date(), graphOn = false } = {}) {
  const out = sources.slice();
  const promoted = [];
  const day = new Date(now).toISOString().slice(0, 10);
  for (const acc of wl.accounts) {
    if (acc.platform !== "instagram" || acc.source_id || acc.status !== "watching" || !(acc.hits > 0)) continue;
    const mv0 = readNote(acc.notes);
    let id = slug(mv0 ? mv0.slug : acc.handle);
    if (out.some((s) => s.id === id)) id = `${id}-ig`;
    if (out.some((s) => s.instagram && s.instagram.toLowerCase() === acc.handle.toLowerCase())) { acc.source_id = out.find((s) => s.instagram.toLowerCase() === acc.handle.toLowerCase()).id; continue; }
    const mv = readNote(acc.notes);
    if (mv && !mv.state) continue; // the source schema needs a state
    if (mv) {
      // A MATO find: city and state come from the MATO page, its venue page is the schedule.
      out.push({
        id, brand: mv.brand || acc.handle, home_city: mv.city, home_state: mv.state, website: null, instagram: looksLikeHandle(mv.slug) ? mv.slug : null, tiktok: null,
        schedule_url: `https://ma.to/venue/${mv.slug}`, schedule_kind: "website", adapter: "mato", active: true,
        kind: "popup", category: "matcha", kind_note: "Found on MATO; only its matcha events are kept. Classes and meetups are marked per event.",
        notes: `Found on MATO (${acc.found_from}). Brand name and city come from the MATO listing; check them.`,
        added: day, verified: null,
      });
      acc.source_id = id;
      promoted.push(acc.handle);
      continue;
    }
    out.push({
      id, brand: acc.handle, home_city: "", home_state: "", website: null, instagram: acc.handle, tiktok: null,
      schedule_url: null, schedule_kind: "manual", adapter: graphOn ? "instagram-graph" : "manual", active: true,
      kind: "popup", category: "matcha", kind_note: null,
      notes: `Found via ${acc.found_via}${acc.found_from ? ` (${acc.found_from})` : ""}. Brand, city and state need a human edit.`,
      added: day, verified: null,
    });
    acc.source_id = id;
    promoted.push(acc.handle);
  }
  return { sources: out, promoted };
}

// Order for the by-handle search checks (rung 22): accounts that have had a hit first, then "watching", then candidates, then quiet;
// inside a group the oldest last_checked first (never checked first). Returns a new array.
export function priority(acc) {
  if ((acc.hits || 0) > 0) return 0;
  if (acc.status === "watching") return 1;
  if (acc.status === "candidate") return 2;
  return 3;
}
export function prioritize(accounts) {
  const t = (a) => (a.last_checked ? Date.parse(a.last_checked) : 0);
  return accounts.slice().sort((a, b) => priority(a) - priority(b) || t(a) - t(b));
}
// The accounts one search step may check: the due ones of a platform in priority order, at most `cap` (one credit each).
export function pickForSearch(accounts, platform, cap) {
  return prioritize(accounts.filter((a) => a.platform === platform)).slice(0, Math.max(0, cap));
}
