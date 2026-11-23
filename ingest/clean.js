// npm run clean: apply the noise rules (ingest/lib/write.js keepEvent and tidy) to the events already on file.
// Drops events with no state, a generic title and no brand, or that come from a watch-list account without a matcha term,
// pop-up intent and a place; blanks placeholder venues ("Cafe of the day"); marks vendor-list listings as unsure organizer
// events; keeps an Instagram CDN picture as image_url. Rewrites data/events.json and site/data/events.json.
// Flags: --dry (print the counts only)
import fs from "node:fs";
import { readEvents, writeEvents, mergeEvents, keepMatoEvent, keepEvent, tidy, GENERIC_TITLE, hasNoBrand, isWatchPseudo, passesWatchRule } from "./lib/write.js";
import { PLACEHOLDER_VENUE } from "./lib/names.js";
import { info } from "./lib/log.js";

const CDN = /^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//;

const now = new Date();
const dry = process.argv.includes("--dry");
const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
const sourceIds = new Set(sources.map((s) => s.id));
const before = readEvents();
const up = (list) => list.filter((e) => e.status === "upcoming").length;

// Why each dropped event went, in the order the rules run.
const why = { "not matcha (site find)": 0, "no state": 0, "generic title, no brand": 0, "watch-list account without matcha, pop-up intent and a place": 0 };
for (const e of before) {
  if (keepEvent(e, { sourceIds })) continue;
  if (!keepMatoEvent(e)) why["not matcha (site find)"]++;
  else if (!e.state) why["no state"]++;
  else if (GENERIC_TITLE.test(String(e.title || "").trim()) && hasNoBrand(e)) why["generic title, no brand"]++;
  else why["watch-list account without matcha, pop-up intent and a place"]++;
}
const blanked = before.filter((e) => PLACEHOLDER_VENUE.test(String(e.venue || "").trim())).length;
const softened = before.filter((e) => tidy(e) !== e).length - blanked;

const merged = mergeEvents(before, [], { now, sourceIds }).events.map((e) => {
  if (!e.image_url && e.image?.url && CDN.test(e.image.url)) return { ...e, image_url: e.image.url };
  return e;
});
info(`events before: ${before.length} (${up(before)} upcoming)`);
info(`events after:  ${merged.length} (${up(merged)} upcoming)`);
for (const [k, v] of Object.entries(why)) if (v) info(`  removed ${v}: ${k}`);
info(`  placeholder venues blanked: ${blanked}; vendor-list listings marked unsure organizer: ${Math.max(0, softened)}`);
if (dry) info("(dry run: nothing written)");
else { writeEvents(merged, { now }); info("wrote data/events.json and site/data/events.json"); }
