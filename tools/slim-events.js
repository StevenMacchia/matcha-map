// Writes site/data/events-slim.json: what the list rows and the map pins need, nothing else, so the first paint does
// not wait for descriptions, posts, evidence and remote photo URLs. site/app.js loads this first, then the full
// events.json in the background and swaps the full record in by id. Run by `npm run pages` and `npm run feeds`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Fields kept as they are. The extras past the spec's list are read by the row and the pin: tz (the "today" and
// "tomorrow" words), category (the filter chips), source_id (the brand fallback), hours (an all-day row's time line),
// geocode_source (the approximate-pin rule), title and address (the pin label, "Near <city>").
const KEEP = ["id", "brand", "handle", "start", "end", "all_day", "venue", "city", "state", "lat", "lng", "status", "confidence", "kind", "approx",
  "series", "tz", "category", "source_id", "hours", "geocode_source", "title", "address"];

export function slimEvent(e) {
  const o = {};
  for (const k of KEEP) if (e[k] !== undefined && e[k] !== null) o[k] = e[k];
  // menu names only: a menu item may be an object with a price in the full record
  if (Array.isArray(e.menu) && e.menu.length) o.menu = e.menu.map((m) => (m && typeof m === "object" ? m.name || m.item || "" : String(m))).filter(Boolean);
  const loc = e.image && typeof e.image.local === "string" ? e.image.local : "";
  if (loc) o.image = { local: loc };
  return o;
}

export function slimData(data) {
  return { generated: data.generated, slim: true, events: (data.events || []).map(slimEvent) };
}

export function writeSlim(siteDir = path.join(root, "site")) {
  const from = path.join(siteDir, "data", "events.json");
  if (!fs.existsSync(from)) return null;
  const out = slimData(JSON.parse(fs.readFileSync(from, "utf8")));
  const to = path.join(siteDir, "data", "events-slim.json");
  fs.writeFileSync(to, JSON.stringify(out));
  return { file: to, count: out.events.length, bytes: fs.statSync(to).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = writeSlim();
  console.log(r ? `slim: ${r.count} events, ${r.bytes} bytes -> site/data/events-slim.json` : "slim: no site/data/events.json");
}
