// npm run enrich: fill hours, price, menu, poster and description on upcoming events from each event's own public page.
//   npm run enrich [-- --dry] [-- --limit 80] [-- --pages]
// Reads one event page per event (Eventbrite, MATO, Allevents, Luma, Meetup; robots respected, 1 request a second a host, cached),
// fills only empty fields from words the page prints, and checks the page's start date against the stored one (time zone sanity).
// Fill rates before and after are printed. See docs/DEPTH.md.
import "./lib/env.js";
import { createFetcher } from "./lib/fetch.js";
import { readEvents, clean, writeEvents } from "./lib/write.js";
import { downloadImages, pruneImages } from "./lib/images.js";
import { info, warn } from "./lib/log.js";
import { isEventPage, pageFacts, fillFrom, compareStart } from "./lib/enrich-events.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const now = new Date();
const events = readEvents();
const FIELDS = ["menu", "price", "hours", "image", "description", "pay"];
const has = (e, f) => { const v = e[f]; return v && (Array.isArray(v) ? v.length : typeof v === "object" ? Object.values(v).some(Boolean) : true); };
const rates = (list) => FIELDS.map((f) => `${f} ${list.filter((e) => has(e, f)).length}`).join(", ");

const upcoming = events.filter((e) => e.status === "upcoming");
const todo = upcoming.map((e) => ({ e, url: [e.source_url, ...(e.evidence || [])].find(isEventPage) })).filter((x) => x.url);
info(`upcoming ${upcoming.length} (${rates(upcoming)}); ${todo.length} have an event page to read`);

const fetcher = createFetcher();
const patches = new Map(), tz = { same: 0, tz: 0, differs: 0, none: 0 }, odd = [], fails = {};
const limit = opt("--limit", 400);
let n = 0;
for (const { e, url } of todo) {
  if (n++ >= limit) break;
  let f = null;
  try {
    const r = await fetcher.get(url);
    if (!r.ok) { const k = r.blocked ? "robots" : String(r.status); fails[k] = (fails[k] || 0) + 1; continue; }
    f = pageFacts(r.text);
  } catch (err) { fails.error = (fails.error || 0) + 1; warn(`${url}: ${err.message}`); continue; }
  const c = compareStart(e, f);
  tz[c || "none"]++;
  if (c === "tz" || c === "differs") odd.push(`${c} ${e.id} ${e.brand} stored ${e.start} page ${f.startDate} ${url}`);
  const { patch, filled } = fillFrom(e, f, url);
  if (filled.length) patches.set(e.id, { patch, filled });
}
const filledBy = {};
for (const { filled } of patches.values()) for (const k of filled) if (k !== "image_url") filledBy[k] = (filledBy[k] || 0) + 1;
info(`read ${Math.min(n, todo.length)} pages; failures ${JSON.stringify(fails)}; page start vs stored: ${JSON.stringify(tz)}`);
for (const o of odd.slice(0, 12)) info("  " + o);
info(`would fill ${patches.size} events: ${JSON.stringify(filledBy)}`);
if (flag("--dry")) process.exit(0);

const out = events.map((e) => (patches.has(e.id) ? clean({ ...e, ...patches.get(e.id).patch }) : e));
await downloadImages(out, { fetcher }).catch((err) => warn(`images: ${err.message}`));
pruneImages(out);
writeEvents(out, { now });
const up2 = out.filter((e) => e.status === "upcoming");
info(`after: upcoming ${up2.length} (${rates(up2)})`);
if (flag("--pages")) {
  for (const [mod, fn] of [["../tools/gen-pages.js", "run"], ["../tools/gen-feeds.js", "run"], ["../tools/gen-event-pages.js", "run"], ["../tools/gen-brand-extras.js", "run"], ["../tools/gen-sitemap-extras.js", "run"]]) {
    try { await (await import(mod))[fn](); } catch (err) { warn(`${mod}: ${err.message}`); }
  }
  try { await (await import("../tools/gen-weekend.js")).generate(); } catch (err) { warn(`weekend: ${err.message}`); }
  info("pages regenerated");
}
