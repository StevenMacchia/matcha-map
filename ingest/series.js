// npm run series: recurring pop-ups (data/series.json) -> dated events flagged `series`, without a full ingest.
//   npm run series              expand every series, merge into data/events.json, regenerate the generated pages
//   npm run series -- --dry     show what would change
//   npm run series -- --detect  list recurring patterns in the held events that are not recorded yet (for a human to check)
// `npm run ingest` runs the same expansion as step 2c; this is the quick path for one rung or one new series.
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { createGeocoder } from "./lib/geocode.js";
import { finalize } from "./lib/pipeline.js";
import { readEvents } from "./lib/write.js";
import { info, warn } from "./lib/log.js";
import { readSeries, seriesCandidates, recheckSeries, writeSeries, detectSeries, endedOccurrences } from "./lib/series.js";

const flags = new Set(process.argv.slice(2));
const now = new Date();
const list = readSeries();
const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
const held = readEvents();

if (flags.has("--detect")) {
  const found = detectSeries(held, list, now.toISOString().slice(0, 10));
  for (const d of found) info(`${String(d.dates).padStart(3)} dates  ${d.weekdays.padEnd(22)} ${d.brand} | ${d.venue} | ${d.city}${d.phrase ? " | weekly words" : ""} | ${d.source_url}`);
  info(`${found.length} patterns not in data/series.json`);
  process.exit(0);
}

if (!flags.has("--dry") && !flags.has("--no-fetch")) {
  const fetcher = createFetcher();
  for (const l of await recheckSeries(list, fetcher, now)) info("recheck: " + l);
  writeSeries(list);
}
const sc = seriesCandidates(list, held, { sources, now });
const gone = endedOccurrences(held, list, now);
info(`series: ${sc.stats.series} running, ${sc.stats.added} dates to add, ${sc.stats.flagged} held dates to flag, ${gone.size} ended dates to remove, dropped by rule: ${JSON.stringify(sc.stats.dropped)}`);
if (flags.has("--dry")) process.exit(0);

const geocoder = createGeocoder({ noFetch: true });
const { merged } = await finalize(sc.candidates, { now, geocoder, fetcher: null, liveSourceIds: [], dry: false });
const up = merged.events.filter((e) => e.status === "upcoming");
info(`events: ${merged.events.length} total, ${up.length} upcoming, ${up.filter((e) => e.series).length} of them in a series (+${merged.stats.added} new, ${merged.stats.updated} updated)`);

if (!flags.has("--no-pages")) {
  for (const [mod, fn] of [["../tools/gen-pages.js", "run"], ["../tools/gen-feeds.js", "run"], ["../tools/gen-event-pages.js", "run"], ["../tools/gen-brand-extras.js", "run"], ["../tools/gen-sitemap-extras.js", "run"]]) {
    try { await (await import(mod))[fn](); } catch (e) { warn(`${mod}: ${e.message}`); }
  }
  try { await (await import("../tools/gen-weekend.js")).generate(); } catch (e) { warn(`weekend: ${e.message}`); }
  info("pages, feeds, event pages, weekend, extras regenerated");
}
