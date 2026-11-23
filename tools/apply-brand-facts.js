// Merge data/review/brand-facts.json into data/sources.json, only where the source field is empty.
// Usage: node tools/apply-brand-facts.js [--facts file] [--sources file] [--dry]   (npm run brands:apply)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
// fact key -> source field
export const FIELD_MAP = {
  story: "about",
  signature_drinks: "signature_drinks",
  price_range: "price_range",
  pay: "pay",
  typical_hours: "hours_note",
  website: "website",
  linktree: "linktree",
  tiktok: "tiktok",
};

const empty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

export function applyFacts(sources, facts) {
  const counts = Object.fromEntries(Object.values(FIELD_MAP).map((f) => [f, 0]));
  let touched = 0;
  const missing = [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  for (const [id, f] of Object.entries(facts.brands || {})) {
    const s = byId.get(id);
    if (!s) { missing.push(id); continue; }
    let changed = false;
    for (const [fk, sf] of Object.entries(FIELD_MAP)) {
      if (empty(f[fk]) || !empty(s[sf])) continue;
      s[sf] = f[fk];
      counts[sf]++;
      changed = true;
    }
    if (changed) touched++;
  }
  return { counts, touched, missing };
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}

if (import.meta.url === new URL(process.argv[1], "file://").href || process.argv[1]?.endsWith("apply-brand-facts.js")) {
  const factsPath = arg("--facts", path.join(ROOT, "data/review/brand-facts.json"));
  const srcPath = arg("--sources", path.join(ROOT, "data/sources.json"));
  const sources = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
  const { counts, touched, missing } = applyFacts(sources, facts);
  if (!process.argv.includes("--dry")) fs.writeFileSync(srcPath, JSON.stringify(sources, null, 2) + "\n");
  console.log(`brands:apply  ${touched} sources updated${process.argv.includes("--dry") ? " (dry run)" : ""}`);
  for (const [f, n] of Object.entries(counts)) console.log(`  ${f}: ${n}`);
  if (missing.length) console.log(`  ids not in sources: ${missing.join(", ")}`);
}
