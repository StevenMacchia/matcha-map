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
import marketspread from "./adapters/marketspread.js";
import manual from "./adapters/manual.js";
import { recheckTiktok, recheckInstagram, loadBudget, saveBudget } from "./lib/sites/social-search.js";
import graph, { creds } from "./adapters/instagram-graph.js";

const ADAPTERS = [mato, luma, eventbrite, marketspread, ics, website, manual];
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

  // Search checks cost one Tavily credit each. Caps per step (env WATCH_IG_CAP / WATCH_TT_CAP, default 60 / 40), highest priority first:
  // accounts with a hit, then watching, then candidates, oldest last_checked first. Accounts past the cap stay due for the next run.
  const budget = loadBudget(undefined, now);
  const caps = { instagram: +(env.WATCH_IG_CAP ?? 60), tiktok: +(env.WATCH_TT_CAP ?? 40) };
  const queue = new Set([...wlib.pickForSearch(due, "instagram", caps.instagram), ...wlib.pickForSearch(due, "tiktok", caps.tiktok)].map((a) => a));
  const order = new Map(wlib.prioritize(due).map((a, i) => [a, i]));
  due.sort((a, b) => order.get(a) - order.get(b));
  const stat = { instagram: { checked: 0, posts: 0, events: 0, credits: 0 }, tiktok: { checked: 0, posts: 0, events: 0, credits: 0 } };
  const known = new Set(readEvents().map((e) => e.id));
  const candidates = [], live = [], notes = new Map();
  for (const acc of due) {
    let source = sources.find((s) => s.id === acc.source_id) || wlib.pseudoSource(acc);
    let items = [], ran = false, searchOnly = false;
    try {
      const search = !noFetch && queue.has(acc) && (acc.platform === "tiktok" || acc.platform === "instagram");
      if (search) {
        // Never opened: a Tavily query `"<handle>" matcha` over the platform's domain (1 credit), plus TikTok's open oEmbed.
        const before = budget.used_run;
        const found = await (acc.platform === "tiktok" ? recheckTiktok : recheckInstagram)(acc, { now, env, sources, budget });
        const st = stat[acc.platform];
        st.credits += budget.used_run - before;
        if (found) { st.checked++; st.posts += found.seen || 0; st.events += found.length; items = items.concat(found); ran = true; searchOnly = true; if (found[0]?.source_hint) source = found[0].source_hint; }
      }
      if (acc.platform === "instagram" && igOn && !noFetch) { items = items.concat(await graph.fetch(source, ctx)); ran = true; searchOnly = false; }
      const adapter = source.schedule_url ? ADAPTERS.find((x) => x.matches(source)) : null;
      if (adapter && adapter !== manual) { items = items.concat(await adapter.fetch(source, ctx)); ran = true; searchOnly = false; }
    } catch (e) { warn(`${acc.handle}: ${e.message}`); notes.set(acc.handle, `failed: ${e.message}`); continue; }
    if (!ran) { notes.set(acc.handle, queue.has(acc) ? "search failed or cap reached" : igOn ? "nothing to check" : "over the search cap or no source"); continue; }
    if (!searchOnly) live.push(source.id); // search snippets are not a full listing: a missing post must not decay its events
    const { candidates: cs, popupAt } = await processItems(items, source, { now, handle: source.instagram ?? (wlib.readNote(acc.notes) ? null : acc.handle) });
    const ids = new Set(dedupeCandidates(cs, now).map((c) => c.id));
    const fresh = [...ids].filter((id) => !known.has(id)).length;
    candidates.push(...cs);
    wlib.recordCheck(acc, { now, hitCount: fresh, foundCount: ids.size, popupAt: ids.size ? popupAt : null });
    notes.set(acc.handle, `${items.length} items, ${ids.size} dated`);
  }

  saveBudget(budget, undefined, now); // credits are spent even on --dry
  const { merged } = await finalize(candidates, { now, geocoder, fetcher, liveSourceIds: live, dry });
  for (const k of ["instagram", "tiktok"]) info(`by-handle ${k}: ${stat[k].checked} accounts checked, ${stat[k].posts} posts of theirs seen, ${stat[k].events} dated events, ${stat[k].credits} credits`);
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
