// npm run ingest: sources -> adapters -> extractor -> geocoder -> writer.
// Flags: --source <id> | --paste [--file <path>] | --inbox | --no-fetch | --dry | --verbose | --no-art
// Default run = every active source, then data/inbox/*.txt. Exit non-zero only on a crash.
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { itemToCandidates, finalize } from "./lib/pipeline.js";
import { createGeocoder } from "./lib/geocode.js";
import { setVerbose, warn, info } from "./lib/log.js";
import mato from "./adapters/mato.js";
import luma from "./adapters/luma.js";
import eventbrite from "./adapters/eventbrite.js";
import ics from "./adapters/ics.js";
import website from "./adapters/website.js";
import marketspread from "./adapters/marketspread.js";
import manual, { parsePaste, readInbox, matchSource } from "./adapters/manual.js";
import instagram from "./adapters/instagram-graph.js";
import tiktok from "./adapters/tiktok.js";
import { oembed } from "./adapters/oembed.js";
import { readReview, promote } from "./lib/review.js";
import { readEvents } from "./lib/write.js";
import { pullApproved } from "./lib/intake.js";

if (process.argv.slice(2).some((x) => x === "--help" || x === "-h")) {
  console.log(["npm run ingest [-- flags]", "  --source <id>   one source only", "  --paste [--file <path>]   read pasted text", "  --inbox   data/inbox/*.txt only", "  --no-fetch   no network", "  --dry   write nothing", "  --verbose   more logging", "  --no-art   skip illustration", "  --help, -h   this text"].join("\n"));
  process.exit(0);
}

const ADAPTERS = [mato, luma, eventbrite, marketspread, ics, website, manual]; // first match reads a source
const EXTRA = [instagram, tiktok];                    // wired, off without keys

function args(argv) {
  const a = { flags: new Set(), source: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") a.source = argv[++i];
    else if (argv[i] === "--file") a.file = argv[++i];
    else if (argv[i].startsWith("--")) a.flags.add(argv[i].slice(2));
  }
  return a;
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function main() {
  const a = args(process.argv.slice(2));
  setVerbose(a.flags.has("verbose"));
  const dry = a.flags.has("dry");
  const now = new Date();
  const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
  const fetcher = createFetcher({ noFetch: a.flags.has("no-fetch") });
  const geocoder = createGeocoder({ noFetch: a.flags.has("no-fetch") });
  const ctx = { fetcher, now, env: process.env };
  const pasteOnly = a.flags.has("paste"), inboxOnly = a.flags.has("inbox");
  const crawl = !pasteOnly && !inboxOnly;

  // 0. Approved self-serve submissions -> data/inbox (off unless INTAKE_URL and INTAKE_TOKEN are set; never fails the run).
  if (!dry && process.env.INTAKE_URL && process.env.INTAKE_TOKEN) {
    try { const r = await pullApproved({ baseUrl: process.env.INTAKE_URL, token: process.env.INTAKE_TOKEN, log: warn }); info(`intake: ${r.written.length} new paste file(s), ${r.consumed} consumed`); }
    catch (e) { warn(`intake skipped: ${e.message}`); }
  }

  const candidates = [];
  const live = [];
  const rows = [];

  // 1. Crawl sources.
  if (crawl) {
    const list = sources.filter((s) => s.active && (!a.source || s.id === a.source));
    if (a.source && !list.length) warn(`no active source with id "${a.source}"`);
    for (const s of list) {
      const adapter = ADAPTERS.find((x) => x.matches(s));
      const row = { id: s.id, adapter: adapter ? adapter.name : "none", items: 0, kept: 0, note: "" };
      rows.push(row);
      if (!adapter) { row.note = "no adapter"; continue; }
      try {
        let items = await adapter.fetch(s, ctx);
        for (const x of EXTRA) if (x.matches(s)) {
          try { items = items.concat(await x.fetch(s, ctx)); } catch (e) { row.note = `${x.name}: ${e.message}`; }
        }
        row.items = items.length;
        if (adapter !== manual) live.push(s.id);
        for (const raw of items) {
          for (const c of await itemToCandidates(raw, s, now, null)) { candidates.push(c); row.kept++; }
        }
      } catch (e) {
        row.note = `failed: ${e.message}`;
        warn(`${s.id}: ${e.message}`);
      }
    }
  }

  // 2. Manual: --paste (stdin or --file) and the inbox.
  const manualRaws = [];
  if (pasteOnly) {
    const text = a.file ? fs.readFileSync(a.file, "utf8") : fs.readFileSync(0, "utf8");
    manualRaws.push({ name: "paste", raw: parsePaste(text) });
  }
  if (inboxOnly || crawl) for (const f of readInbox()) manualRaws.push({ name: f.file, raw: f.raw });
  for (const { name, raw } of manualRaws) {
    const row = { id: `${name}`, adapter: "manual", items: 1, kept: 0, note: "" };
    rows.push(row);
    try {
      const o = await oembed(raw.source_url);
      if (o) { raw.text = `${raw.text} ${o.text}`.trim(); raw.handle = o.handle; raw.image_url = raw.image_url || o.image_url || null; }
      const m = matchSource(raw, sources, { file: name });
      if (!m) { row.note = "no source matched (add its handle to sources.json)"; continue; }
      raw.handle = raw.handle || m.handle;
      for (const c of await itemToCandidates(raw, m.source, now, m.handle)) { candidates.push(c); row.kept++; }
    } catch (e) { row.note = `failed: ${e.message}`; warn(`${name}: ${e.message}`); }
  }

  // 2b. The review folder (data/review/: every crawler's finds and the hand-written sweep files): confirmed and likely items that pass
  // the quality rules; one that is an event already held merges into it (ingest/lib/review.js). --no-review skips it.
  if (crawl && !a.source && !a.flags.has("no-review")) {
    const rv = promote(readReview(), readEvents(), { sources, now });
    candidates.push(...rv.candidates);
    const d = Object.entries(rv.stats.dropped).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
    info(`review: ${rv.stats.read} items, ${rv.stats.promoted} new, ${rv.stats.merged} merged into events held, ${rv.stats.duplicates} duplicates, ${rv.stats.unsure} left for a human (${rv.stats.hedged} hedged in notes), ${rv.stats.past} past, dropped: ${d}`);
  }

  // 3 and 4. Dedupe, geocode, merge, write (shared with `npm run watch`).
  const { merged } = await finalize(candidates, { now, geocoder, fetcher, liveSourceIds: live, dry });

  for (const r of rows) info(`${pad(r.id, 28)} ${pad(r.adapter, 16)} items ${pad(r.items, 3)} events ${pad(r.kept, 3)} ${r.note}`);
  const up = merged.events.filter((e) => e.status === "upcoming");
  const located = up.filter((e) => typeof e.lat === "number");
  info(`\n${rows.length} lines, ${candidates.length} candidates, ${merged.events.length} events total (+${merged.stats.added} new, ${merged.stats.updated} updated, ${merged.stats.decayed} decayed, ${merged.stats.dropped} dropped), ${up.length} upcoming, ${located.length} upcoming with coordinates`);

  if (dry) {
    for (const e of merged.events) info(`${e.start}  ${pad(e.confidence, 9)} ${pad(e.brand, 24)} ${e.venue || e.address} | ${e.city}, ${e.state} | ${e.lat},${e.lng} ${e.geocode_source}`);
    info("(dry run: nothing written)");
    return;
  }
  info("wrote data/events.json and site/data/events.json");
  // Draw a cartoon for new drinks and photo-less events (tools/illustrate; never fails the ingest).
  if (!a.flags.has("no-art")) { const o = await (await import("./lib/art.js")).renderMissingArt({ events: merged.events, sources }); if (o) info(o.line); }
  // Keep the static city and brand pages in step with the data (never from watch).
  try { const { run } = await import("../tools/gen-pages.js"); const o = run(); info(`pages: ${o.counts.cities} city, ${o.counts.brands} brand`); }
  catch (e) { warn(`pages not regenerated: ${e.message}`); }
  // Calendar and RSS feeds, and one shareable page per upcoming event.
  try { const { run } = await import("../tools/gen-feeds.js"); const o = run(); info(`feeds: ${o.counts.cities} city, ${o.counts.events} event, ${o.counts.fresh} new`); }
  catch (e) { warn(`feeds not regenerated: ${e.message}`); }
  try { const { run } = await import("../tools/gen-event-pages.js"); const o = run(); info(`event pages: ${o.counts.pages}`); }
  catch (e) { warn(`event pages not regenerated: ${e.message}`); }
  // "This weekend" pages and per-city preview cards, brand extras, then the sitemap additions (last: it reads what the others wrote).
  try { const { generate } = await import("../tools/gen-weekend.js"); const o = await generate(); info(`weekend: ${o.counts.cities} city pages${o.cards ? `, ${o.cards.rendered} cards` : ""}`); }
  catch (e) { warn(`weekend pages not regenerated: ${e.message}`); }
  try { const { run } = await import("../tools/gen-brand-extras.js"); const o = run(); info(`brand extras: ${o.count}`); }
  catch (e) { warn(`brand extras not regenerated: ${e.message}`); }
  try { const { run } = await import("../tools/gen-sitemap-extras.js"); const o = run(); info(`sitemap: +${o.added} urls`); }
  catch (e) { warn(`sitemap extras not added: ${e.message}`); }
}

main().catch((e) => { console.error("ingest crashed:", e); process.exit(1); });
