// npm run tidy: apply the writer's rules to data/events.json now, without a crawl:
// status recomputed, past events dropped after 30 days, city-only unsure finds not re-seen for 14 days expired, duplicates folded
// (ingest/lib/dedupe.js), future dates of ended series removed. Then the generated pages are rebuilt (--no-pages skips that).
//   npm run tidy [-- --dry] [-- --no-pages]
import "./lib/env.js";
import { createGeocoder } from "./lib/geocode.js";
import { finalize } from "./lib/pipeline.js";
import { readEvents } from "./lib/write.js";
import { mergeDuplicateEvents } from "./lib/dedupe.js";
import { info, warn } from "./lib/log.js";

const flags = new Set(process.argv.slice(2));
const now = new Date();
const before = readEvents();
const up = (list) => list.filter((e) => e.status === "upcoming").length;

if (flags.has("--dry")) {
  const dd = mergeDuplicateEvents(before);
  info(`would fold ${dd.merged.length} duplicates (${dd.merged.filter((m) => m.day >= now.toISOString().slice(0, 10)).length} on upcoming days): ${before.length} -> ${dd.events.length} events`);
  process.exit(0);
}

const { merged } = await finalize([], { now, geocoder: createGeocoder({ noFetch: true }), fetcher: null, liveSourceIds: [], dry: false });
info(`tidy: ${before.length} -> ${merged.events.length} events, upcoming ${up(before)} -> ${up(merged.events)}; folded ${merged.stats.merged} duplicates, expired ${merged.stats.expired} unconfirmed city-only finds, dropped ${merged.stats.dropped} past`);

if (!flags.has("--no-pages")) {
  for (const [mod, fn] of [["../tools/gen-pages.js", "run"], ["../tools/gen-feeds.js", "run"], ["../tools/gen-event-pages.js", "run"], ["../tools/gen-brand-extras.js", "run"], ["../tools/gen-sitemap-extras.js", "run"]]) {
    try { await (await import(mod))[fn](); } catch (e) { warn(`${mod}: ${e.message}`); }
  }
  try { await (await import("../tools/gen-weekend.js")).generate(); } catch (e) { warn(`weekend: ${e.message}`); }
  info("pages, feeds, event pages, weekend, extras regenerated");
}
