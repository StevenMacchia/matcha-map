// Merge data/review/watchlist-additions.json into data/watchlist.json. Idempotent: a handle already on the list
// (same platform, lowercase) is skipped. Usage: node tools/apply-watchlist-additions.js [additions.json] [watchlist.json]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { load, newAccount, addCandidate, FILE } from "../ingest/lib/watchlist.js";

export const ADDITIONS = "data/review/watchlist-additions.json";
const place = (a) => [a.city, a.state].filter(Boolean).join(", ");

// Returns { added, skipped } and appends new accounts to wl.accounts (existing entries are never touched).
export function applyAdditions(wl, additions, { sourceIds = new Set(), now = new Date() } = {}) {
  let added = 0, skipped = 0;
  for (const a of additions) {
    const notes = [place(a), a.reason, a.evidence && `evidence: ${a.evidence}`].filter(Boolean).join(" | ");
    const acc = addCandidate(wl, {
      handle: a.handle, platform: a.platform || "instagram", found_via: "manual", found_from: a.evidence || null, notes,
      source_id: a.source_id && sourceIds.has(a.source_id) ? a.source_id : null,
    }, a.added ? new Date(a.added) : now);
    if (!acc) { skipped++; continue; }
    if (a.status && a.status !== "candidate") acc.status = a.status;
    added++;
  }
  return { added, skipped };
}

function main() {
  const [addFile = ADDITIONS, wlFile = FILE] = process.argv.slice(2);
  const additions = JSON.parse(fs.readFileSync(addFile, "utf8")).additions || [];
  const raw = fs.readFileSync(wlFile, "utf8");
  const wl = JSON.parse(raw);
  const srcPath = "data/sources.json";
  let sourceIds = new Set();
  try { const s = JSON.parse(fs.readFileSync(srcPath, "utf8")); sourceIds = new Set((s.sources || s).map((x) => x.id)); } catch {}
  const before = wl.accounts.length;
  const { added, skipped } = applyAdditions(wl, additions, { sourceIds });
  if (added) {
    // same layout as watchlist.js save(): two-space JSON, trailing newline; updated stamp only when something changed
    wl.updated = new Date().toISOString();
    fs.writeFileSync(wlFile, JSON.stringify(wl, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  }
  console.log(`additions ${additions.length}: added ${added}, already present ${skipped}; list ${before} -> ${wl.accounts.length}`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
