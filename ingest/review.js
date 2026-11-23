// npm run review: the items in data/review/ that ingest will not promote (unsure, or hedged in their notes), as a table for a human.
// Flags: --all also prints the promotable ones' count per file. To accept an item, check its evidence URL, then set its
// confidence to "likely" (or fix the field that was wrong) in the file; the next `npm run ingest` promotes it.
import { readReview, unsureTable, effectiveConfidence, PROMOTE } from "./lib/review.js";

const items = readReview();
const { rows, text } = unsureTable(items);
console.log(text);
console.log(`\n${rows.length} to review of ${items.length} items in data/review/`);
if (process.argv.includes("--all")) {
  const per = {};
  for (const i of items) { const k = i._file; per[k] = per[k] || { promotable: 0, review: 0 }; per[k][PROMOTE.has(effectiveConfidence(i)) ? "promotable" : "review"]++; }
  for (const [f, n] of Object.entries(per)) console.log(`${f.padEnd(24)} ${n.promotable} promotable, ${n.review} to review`);
}
