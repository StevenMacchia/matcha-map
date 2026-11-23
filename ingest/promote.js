// npm run promote: the review folder's confirmed and likely items -> events, without a crawl (step 2b of `npm run ingest`, alone).
//   npm run promote [-- --dry] [-- --no-pages]
// Items a person fixed in data/review/ (see docs/LANES.md "Review-queue conventions") become events through the same promote rules,
// geocoding (cached Nominatim) and writer as a full ingest; one that is an event already held merges into it.
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { createGeocoder } from "./lib/geocode.js";
import { finalize } from "./lib/pipeline.js";
import { readReview, promote } from "./lib/review.js";
import { readEvents } from "./lib/write.js";
import { info, warn } from "./lib/log.js";

const flags = new Set(process.argv.slice(2));
const now = new Date();
const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
const held = readEvents();
const rv = promote(readReview(), held, { sources, now });
const d = Object.entries(rv.stats.dropped).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
info(`review: ${rv.stats.read} items, ${rv.stats.promoted} new, ${rv.stats.merged} merged into events held, ${rv.stats.duplicates} duplicates, ${rv.stats.unsure} unsure, dropped by rule: ${d}`);
if (flags.has("--dry")) process.exit(0);

const fetcher = createFetcher();
const { merged } = await finalize(rv.candidates, { now, geocoder: createGeocoder({}), fetcher, liveSourceIds: [], dry: false });
info(`events: ${merged.events.length} total, ${merged.events.filter((e) => e.status === "upcoming").length} upcoming (+${merged.stats.added} new, ${merged.stats.updated} updated, ${merged.stats.merged} folded)`);
if (!flags.has("--no-pages")) {
  for (const [mod, fn] of [["../tools/gen-pages.js", "run"], ["../tools/gen-feeds.js", "run"], ["../tools/gen-event-pages.js", "run"], ["../tools/gen-brand-extras.js", "run"], ["../tools/gen-sitemap-extras.js", "run"]]) {
    try { await (await import(mod))[fn](); } catch (e) { warn(`${mod}: ${e.message}`); }
  }
  try { await (await import("../tools/gen-weekend.js")).generate(); } catch (e) { warn(`weekend: ${e.message}`); }
  info("pages, feeds, event pages, weekend, extras regenerated");
}
