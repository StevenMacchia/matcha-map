// `npm run discover -- --report`: one row per source with what each step kept, printed and written to docs/DISCOVERY-YIELD.md.
// Columns: fetched (network fetches this run; cache hits are free), candidates (dated readings the extractor made), dated (with a
// start on or after today), geocoded (a real pin, not the city centre), promoted (confirmed or likely and kept: written to the
// map now, or promotable from data/review by ingest), dropped by reason (quality rules, no state, duplicate of a better source).
import fs from "node:fs";

export const COLS = ["source", "fetched", "candidates", "dated", "geocoded", "promoted", "dropped"];

export function newRow(source, fetched = 0, note = "") { return { source, fetched, candidates: 0, dated: 0, geocoded: 0, promoted: 0, dropped: {}, note }; }
export const dropText = (d) => Object.entries(d).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "0";

export function table(rows) {
  const cells = rows.map((r) => [r.source, r.fetched, r.candidates, r.dated, r.geocoded, r.promoted, dropText(r.dropped)].map(String));
  const w = COLS.map((c, i) => Math.max(c.length, ...cells.map((x) => x[i].length)));
  const line = (x) => x.map((v, i) => (i && i < 6 ? v.padStart(w[i]) : v.padEnd(w[i]))).join("  ");
  return [line(COLS), ...cells.map(line)].join("\n");
}

export function markdown(rows, { now = new Date(), totals = {}, notes = [] } = {}) {
  const md = [
    "# Discovery yield",
    "",
    `Written by \`npm run discover -- --report\` on ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC. Real numbers from that run, zeros included.`,
    "",
    "Columns: fetched = network fetches this run (cache hits are free); candidates = dated readings the extractor made; dated = starting today or later; geocoded = a real pin (not the city centre); promoted = confirmed or likely and kept (on the map now, or promoted from `data/review/` by the next `npm run ingest`); dropped = by reason (quality rule id, no state, a better source has it).",
    "",
    `| ${COLS.join(" | ")} | note |`,
    `|${COLS.map(() => "---").join("|")}|---|`,
    ...rows.map((r) => `| ${r.source} | ${r.fetched} | ${r.candidates} | ${r.dated} | ${r.geocoded} | ${r.promoted} | ${dropText(r.dropped)} | ${String(r.note || "").replace(/\|/g, "/")} |`),
    "",
    ...Object.entries(totals).map(([k, v]) => `- ${k}: ${v}`),
    ...(notes.length ? ["", ...notes.map((n) => `- ${n}`)] : []),
    "",
  ];
  return md.join("\n");
}

export function writeReport(rows, opts = {}, file = "docs/DISCOVERY-YIELD.md") {
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(file, markdown(rows, opts));
  return file;
}
