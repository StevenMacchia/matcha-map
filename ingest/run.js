// npm run ingest: sources -> adapters -> extractor -> geocoder -> writer.
// Flags: --source <id> | --paste [--file <path>] | --inbox | --no-fetch | --dry | --verbose
// Default run = every active source, then data/inbox/*.txt. Exit non-zero only on a crash.
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { extract } from "./lib/extract.js";
import { improve } from "./lib/llm.js";
import { createGeocoder } from "./lib/geocode.js";
import { eventId, mergeEvents, readEvents, writeEvents, endMs, KEEP_PAST_DAYS } from "./lib/write.js";
import { setVerbose, warn, info } from "./lib/log.js";
import mato from "./adapters/mato.js";
import luma from "./adapters/luma.js";
import ics from "./adapters/ics.js";
import website from "./adapters/website.js";
import manual, { parsePaste, readInbox, matchSource } from "./adapters/manual.js";
import instagram from "./adapters/instagram-graph.js";
import tiktok from "./adapters/tiktok.js";
import { oembed } from "./adapters/oembed.js";

const ADAPTERS = [mato, luma, ics, website, manual]; // first match reads a source
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

// One RawItem -> geocode-ready candidates for a source.
async function itemToCandidates(raw, source, now, handle) {
  let cands = extract(raw, { source, now });
  cands = await improve(cands, raw, { now });
  return cands.map((c) => ({ ...c, brand: source.brand, source_id: source.id, handle: raw.handle || handle || null }));
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
      if (o) { raw.text = `${raw.text} ${o.text}`.trim(); raw.handle = o.handle; }
      const m = matchSource(raw, sources);
      if (!m) { row.note = "no source matched (add its handle to sources.json)"; continue; }
      raw.handle = raw.handle || m.handle;
      for (const c of await itemToCandidates(raw, m.source, now, m.handle)) { candidates.push(c); row.kept++; }
    } catch (e) { row.note = `failed: ${e.message}`; warn(`${name}: ${e.message}`); }
  }

  // 3. Dedupe by id (best confidence wins), drop long-past, geocode.
  const CONF = ["unsure", "likely", "confirmed"];
  const byId = new Map();
  for (const c of candidates) {
    c.id = eventId(c);
    if (now.getTime() - endMs(c) > KEEP_PAST_DAYS * 86400000) continue;
    const p = byId.get(c.id);
    if (!p || CONF.indexOf(c.confidence) > CONF.indexOf(p.confidence)) byId.set(c.id, c);
  }
  const final = [];
  for (const c of byId.values()) final.push(await geocoder.geocode(c));
  if (!dry) geocoder.save();

  // 4. Merge and write.
  const existing = readEvents();
  let decay = {};
  try { decay = JSON.parse(fs.readFileSync("data/decay.json", "utf8")); } catch { /* first run */ }
  const merged = mergeEvents(existing, final, { now, liveSourceIds: live, decay });

  for (const r of rows) info(`${pad(r.id, 28)} ${pad(r.adapter, 16)} items ${pad(r.items, 3)} events ${pad(r.kept, 3)} ${r.note}`);
  const up = merged.events.filter((e) => e.status === "upcoming");
  const located = up.filter((e) => typeof e.lat === "number");
  info(`\n${rows.length} lines, ${candidates.length} candidates, ${merged.events.length} events total (+${merged.stats.added} new, ${merged.stats.updated} updated, ${merged.stats.decayed} decayed, ${merged.stats.dropped} dropped), ${up.length} upcoming, ${located.length} upcoming with coordinates`);

  if (dry) {
    for (const e of merged.events) info(`${e.start}  ${pad(e.confidence, 9)} ${pad(e.brand, 24)} ${e.venue || e.address} | ${e.city}, ${e.state} | ${e.lat},${e.lng} ${e.geocode_source}`);
    info("(dry run: nothing written)");
    return;
  }
  writeEvents(merged.events, { now });
  fs.writeFileSync("data/decay.json", JSON.stringify(merged.decay, null, 2) + "\n");
  info("wrote data/events.json and site/data/events.json");
}

main().catch((e) => { console.error("ingest crashed:", e); process.exit(1); });
