// npm run shops:recheck: the weekly look at held storefronts (data/shops-overrides.json rows with verified:false and a "Held <date>" reason).
// For each held row's own page (the www host) it reports what a person needs to decide: whether the page now says "Matcha Toko" (rename the
// row), and any date after the hold's cutoff printed on the page (a sign the store is live again). It never flips a row: setting
// verified true (deleting verified:false, keeping the note) is a human call after reading the page.
//   npm run shops:recheck [-- --cutoff 2026-11-08]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { htmlToLines } from "./lib/html.js";

const i = process.argv.indexOf("--cutoff");
const cutoff = i > 0 ? process.argv[i + 1] : "2026-11-08";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Every date a page text prints (ISO, "Nov 21, 2026", "November 21"), as YYYY-MM-DD; a date without a year is read as 2026.
export function datesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of String(text).matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/gi)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    out.add(`${m[3] || "2026"}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`);
  }
  return [...out].sort();
}

export function judge(html, cutoffDate) {
  const text = htmlToLines(html).join("\n");
  return { toko: /matcha\s*toko/i.test(text), after: datesIn(text).filter((d) => d > cutoffDate && d <= "2027-12-31"), closed: /permanently closed|temporarily closed|has closed|now closed/i.test(text) };
}

async function main() {
  const o = JSON.parse(fs.readFileSync("data/shops-overrides.json", "utf8"));
  const shops = new Map(JSON.parse(fs.readFileSync("data/shops.json", "utf8")).shops.map((s) => [s.id, s]));
  const held = Object.entries(o).filter(([, v]) => v.verified === false && /^Held \d{4}-\d\d-\d\d/.test(String(v.why || "")) || (v.verified === false && /Held 20\d\d/.test(String(v.why || ""))));
  const f = createFetcher();
  const pages = new Map();
  console.log(`${held.length} held rows; cutoff ${cutoff}`);
  for (const [id, v] of held) {
    const s = shops.get(id); if (!s || !s.website) { console.log(`${id}: no website`); continue; }
    const url = s.website.replace("//matchacafe-maiko.com", "//www.matchacafe-maiko.com");
    if (!pages.has(url)) { try { const r = await f.get(url, { cache: false }); pages.set(url, r.ok ? judge(r.text, cutoff) : { err: r.blocked ? "robots" : `http ${r.status}` }); } catch (e) { pages.set(url, { err: e.message }); } }
    const j = pages.get(url);
    console.log(`${(s.city || "?") + " " + s.state}`.padEnd(18), j.err ? j.err : `toko ${j.toko ? "YES (rename)" : "no"}; dates after ${cutoff}: ${j.after.slice(0, 5).join(", ") || "none"}${j.closed ? "; says closed" : ""}`, "|", url.slice(0, 70));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
