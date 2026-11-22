// npm run watch: check every account on data/watchlist.json whose last check is older than its cadence.
// Flags: --all (ignore cadence) | --handle <h> | --dry | --promote | --no-fetch | --verbose
// Instagram accounts go through the Graph adapter when the token exists. Otherwise (or as well) the
// source's own schedule_url is read by its non-Instagram adapter. Events go through the same
// extractor, geocoder and writer as `npm run ingest`.
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { createGeocoder } from "./lib/geocode.js";
import { processItems, dedupeCandidates, finalize } from "./lib/pipeline.js";
import { readEvents } from "./lib/write.js";
import { setVerbose, warn, info } from "./lib/log.js";
import * as wlib from "./lib/watchlist.js";
import mato from "./adapters/mato.js";
import luma from "./adapters/luma.js";
import eventbrite from "./adapters/eventbrite.js";
import ics from "./adapters/ics.js";
import website from "./adapters/website.js";
import manual from "./adapters/manual.js";
import { recheckTiktok } from "./lib/sites/social-search.js";
import graph, { creds } from "./adapters/instagram-graph.js";

const ADAPTERS = [mato, luma, eventbrite, ics, website, manual];
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function main() {
  const argv = process.argv.slice(2);
  setVerbose(argv.includes("--verbose"));
  const has = (f) => argv.includes(f);
  const only = argv.includes("--handle") ? wlib.norm(argv[argv.indexOf("--handle") + 1]).toLowerCase() : null;
  const dry = has("--dry"), all = has("--all"), noFetch = has("--no-fetch");
  const now = new Date(), env = process.env;
  const igOn = !!creds(env);
  if (!igOn) info("Instagram Graph: off (set INSTAGRAM_TOKEN and INSTAGRAM_BUSINESS_ID; see docs/INSTAGRAM-SETUP.md)");

  const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
  const wl = wlib.load();
  wlib.seedFromSources(sources, wl, now); // new Instagram sources join the list as "watching"
  const fetcher = createFetcher({ noFetch });
  const geocoder = createGeocoder({ noFetch });
  const ctx = { fetcher, now, env };

  const due = wl.accounts.filter((a) => (only ? a.handle.toLowerCase() === only : all ? a.status !== "dropped" : wlib.isDue(a, now)));
  if (only && !due.length) warn(`no account "${only}" on the watch list`);
  info(`${due.length} of ${wl.accounts.length} accounts to check`);

  const known = new Set(readEvents().map((e) => e.id));
  const candidates = [], live = [], notes = new Map();
  for (const acc of due) {
    let source = sources.find((s) => s.id === acc.source_id) || wlib.pseudoSource(acc);
    let items = [], ran = false, searchOnly = false;
    try {
      if (acc.platform === "tiktok" && !noFetch) {
        // TikTok is never opened: a Tavily query `"<handle>" matcha` over tiktok.com plus the open oEmbed (1 credit).
        const found = await recheckTiktok(acc, { now, env, sources });
        if (found) { items = items.concat(found); ran = true; searchOnly = true; if (found[0]?.source_hint) source = found[0].source_hint; }
      }
      if (acc.platform === "instagram" && igOn && !noFetch) { items = items.concat(await graph.fetch(source, ctx)); ran = true; searchOnly = false; }
      const adapter = source.schedule_url ? ADAPTERS.find((x) => x.matches(source)) : null;
      if (adapter && adapter !== manual) { items = items.concat(await adapter.fetch(source, ctx)); ran = true; searchOnly = false; }
    } catch (e) { warn(`${acc.handle}: ${e.message}`); notes.set(acc.handle, `failed: ${e.message}`); continue; }
    if (!ran) { notes.set(acc.handle, igOn ? "nothing to check" : "needs token"); continue; }
    if (!searchOnly) live.push(source.id); // search snippets are not a full listing: a missing post must not decay its events
    const { candidates: cs, popupAt } = await processItems(items, source, { now, handle: source.instagram ?? (wlib.readNote(acc.notes) ? null : acc.handle) });
    const ids = new Set(dedupeCandidates(cs, now).map((c) => c.id));
    const fresh = [...ids].filter((id) => !known.has(id)).length;
    candidates.push(...cs);
    wlib.recordCheck(acc, { now, hitCount: fresh, foundCount: ids.size, popupAt: ids.size ? popupAt : null });
    notes.set(acc.handle, `${items.length} items, ${ids.size} dated`);
  }

  const { merged } = await finalize(candidates, { now, geocoder, fetcher, liveSourceIds: live, dry });
  info(`${candidates.length} candidates, ${merged.events.length} events total (+${merged.stats.added} new, ${merged.stats.updated} updated)`);

  if (has("--promote")) {
    const { sources: next, promoted } = wlib.promote(wl, sources, { now, graphOn: igOn });
    info(`promote: ${promoted.length} account(s) -> sources.json${promoted.length ? ` (${promoted.join(", ")})` : ""}`);
    if (!dry && promoted.length) fs.writeFileSync("data/sources.json", JSON.stringify(next, null, 2) + "\n");
  }

  info(`\n${pad("handle", 28)} ${pad("status", 9)} ${pad("hits", 5)} ${pad("next check", 17)} note`);
  for (const a of due.slice(0, 60)) info(`${pad("@" + a.handle, 28)} ${pad(a.status, 9)} ${pad(a.hits, 5)} ${pad((wlib.nextCheck(a, now) || "-").slice(0, 16).replace("T", " "), 17)} ${notes.get(a.handle) || ""}`);
  if (due.length > 60) info(`... and ${due.length - 60} more`);
  if (dry) { info("(dry run: nothing written)"); return; }
  wlib.save(wl, { now });
  info("wrote data/watchlist.json");
}

main().catch((e) => { console.error("watch crashed:", e); process.exit(1); });
