// node tools/card-completeness.mjs [--all] [--md] [--json] [file]
// Share of shop rows that carry each field a map card shows: website, phone, hours, menu link, image, Instagram handle, note.
// Reads data/shops.json; by default only the rows the site layer draws (verified, or confirmed via public-page or overture), because those
// are the cards a visitor can open. --all counts every row in the file (held rows too). --md prints markdown tables (for
// docs/CARD-COMPLETENESS.md), --json prints the counts.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const FIELDS = [
  ["website", "Website", (s) => !!s.website],
  ["phone", "Phone", (s) => !!s.phone],
  ["hours", "Hours", (s) => !!s.opening_hours],
  ["menu", "Menu link", (s) => !!s.menu_url],
  ["image", "Image", (s) => !!s.image_url],
  ["instagram", "Instagram", (s) => !!s.instagram],
  ["note", "Note", (s) => !!(s.note && String(s.note).trim())],
];

export const shown = (s) => (s.verified || s.confirmed_via === "public-page" || s.confirmed_via === "overture") && s.status !== "closed";

// rows -> { total, fields:{key:count} } per group key.
export function tally(rows, groupOf) {
  const out = new Map();
  for (const s of rows) {
    const k = groupOf(s);
    const g = out.get(k) || { total: 0, fields: Object.fromEntries(FIELDS.map(([f]) => [f, 0])) };
    g.total++;
    for (const [f, , has] of FIELDS) if (has(s)) g.fields[f]++;
    out.set(k, g);
  }
  return out;
}

const pct = (n, t) => (t ? `${Math.round((100 * n) / t)}%` : "-");

export function table(groups, label, { md = false, order } = {}) {
  const keys = order || [...groups.keys()].sort();
  const head = [label, "Rows", ...FIELDS.map(([, h]) => h)];
  const lines = keys.filter((k) => groups.has(k)).map((k) => { const g = groups.get(k); return [k, String(g.total), ...FIELDS.map(([f]) => pct(g.fields[f], g.total))]; });
  const all = { total: 0, fields: Object.fromEntries(FIELDS.map(([f]) => [f, 0])) };
  for (const g of groups.values()) { all.total += g.total; for (const [f] of FIELDS) all.fields[f] += g.fields[f]; }
  lines.push(["**All**", String(all.total), ...FIELDS.map(([f]) => pct(all.fields[f], all.total))]);
  if (md) return [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i < 1 ? "---" : "---:")).join("|")}|`, ...lines.map((l) => `| ${l.join(" | ")} |`)].join("\n");
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  return [head.map((h, i) => h.padEnd(w[i])).join("  "), ...lines.map((l) => l.map((c, i) => c.padEnd(w[i])).join("  "))].join("\n");
}

export function report(rows, opts = {}) {
  const tier = (s) => (s.tier === "serves" ? "serves (matcha on the menu)" : "shop (core)");
  const byTier = tally(rows, tier);
  const byState = tally(rows, (s) => s.state || "?");
  const byTierState = tally(rows, (s) => `${s.state || "?"} ${s.tier === "serves" ? "serves" : "core"}`);
  return {
    tier: table(byTier, "Tier", opts),
    state: table(byState, "State", opts),
    tierState: table(byTierState, "State and tier", opts),
    counts: { tier: Object.fromEntries(byTier), state: Object.fromEntries(byState) },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) || "data/shops.json";
  const all = JSON.parse(fs.readFileSync(file, "utf8")).shops;
  const rows = args.includes("--all") ? all : all.filter(shown);
  const r = report(rows, { md: args.includes("--md") });
  if (args.includes("--json")) console.log(JSON.stringify(r.counts, null, 1));
  else console.log(`${rows.length} rows (${args.includes("--all") ? "all rows in the file" : "rows the site draws"}) from ${file}\n\nBy tier\n${r.tier}\n\nBy state\n${r.state}${args.includes("--md") ? `\n\nBy state and tier\n${r.tierState}` : ""}`);
}
