// node tools/case-studies-draft.mjs [--n 19] [--min 2]: draft docs/CASE-STUDIES.md entries from our own record (data/events.json, data/sources.json,
// data/watchlist.json), for brands not yet in the file: the three latest dated pop-ups, the channel each one was read from, whether we can read
// that channel, and what found the brand. These entries describe what OUR record shows (the channel a dated post was read from), not every channel
// a brand uses; the entry says so. Prints markdown to stdout; a human appends it.
import fs from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const N = arg("--n", 19), MIN = arg("--min", 2);
const events = JSON.parse(fs.readFileSync("data/events.json", "utf8")).events;
const sources = new Map(JSON.parse(fs.readFileSync("data/sources.json", "utf8")).map((s) => [s.id, s]));
const watch = new Map(JSON.parse(fs.readFileSync("data/watchlist.json", "utf8")).accounts.map((a) => [String(a.handle).toLowerCase(), a]));
const doc = fs.readFileSync("docs/CASE-STUDIES.md", "utf8").toLowerCase();
const SKIP = /^(matcha event|isshiki|cha cha|kettl|chalait|sorate|nana)/i;

const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; } };
function channel(e, src) {
  const urls = [e.source_url, ...(e.evidence || []).map((x) => (typeof x === "string" ? x : x?.url)).filter((u) => /^https?:/.test(u || ""))];
  const hs = [...new Set(urls.map(host).filter(Boolean))];
  const own = src?.website ? host(src.website) : null;
  const w = e.handle ? watch.get(String(e.handle).toLowerCase()) : null;
  const parts = hs.map((h) => {
    if (/instagram\.com$/.test(h)) return w && w.graph_checked_at && !w.graph_error ? "own-instagram-post (readable: Graph business account on the watch list)" : "own-instagram-post (not readable: not a Graph-readable account)";
    if (/tiktok\.com$/.test(h)) return "tiktok (not read)";
    if (h === "ma.to") return "ma.to venue list (readable)";
    if (own && h === own) return "own site (readable)";
    return `${h} (readable web page)`;
  });
  return parts.join("; ") || "no public URL kept";
}
const day = (e) => String(e.start).slice(0, 10);
const time = (e) => (e.all_day ? "all day" : `${String(e.start).slice(11, 16)}${e.end ? "-" + String(e.end).slice(11, 16) : ""}`);

const by = new Map();
// Dates materialised from a recurring series (e.series) are one announcement, not separate pop-ups: they are left out.
for (const e of events) { if (!e.brand || SKIP.test(e.brand) || e.series) continue; (by.get(e.brand) || by.set(e.brand, []).get(e.brand)).push(e); }
const picks = [...by].filter(([b, l]) => l.length >= MIN && !doc.includes(b.toLowerCase().slice(0, 12))).sort((a, b) => b[1].length - a[1].length).slice(0, N);
const out = [];
for (const [brand, list] of picks) {
  const l = list.slice().sort((a, b) => String(b.start).localeCompare(String(a.start)));
  const first = list.slice().sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)))[0];
  const src = sources.get(first.source_id);
  const city = `${first.city || "?"} ${first.state || ""}`.trim();
  out.push(`### ${brand} (${city}${first.handle ? ", @" + first.handle : ""})`);
  out.push(`- Who: ${first.category || first.kind || "matcha"} pop-up brand (${list.length} dated pop-ups in our data)${src?.website ? "; own site " + host(src.website) : "; no own site in our sources"}. Drafted from our record by tools/case-studies-draft.mjs: the channels below are the ones a dated post was read from, not every channel the brand uses.`);
  for (const e of l.slice(0, 3)) out.push(`- ${day(e)}, ${time(e)}, ${e.venue || "venue not stated"}${e.city && e.city !== first.city ? ", " + e.city : ""}: ${channel(e, src)}. In our data: yes (first seen ${String(e.first_seen).slice(0, 10)}${e.confidence === "unsure" ? ", date unsure" : ""}).`);
  out.push(`- Found for us by: ${src ? "the watch list / sources record" : "a find outside sources.json"}, first read from ${host(first.source_url) || "an unrecorded page"} on ${String(first.first_seen).slice(0, 10)}${first.extracted_by ? " (extracted by " + first.extracted_by + ")" : ""}. Would have found it a week earlier: not computed from our record.`);
  out.push("");
}
console.log(out.join("\n"));
console.error(`${picks.length} entries drafted`);
