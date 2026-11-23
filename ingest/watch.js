// npm run watch: the hourly pass. First the hashtag harvest (ingest/lib/hashtags.js), then every account on data/watchlist.json
// that is due: past its cadence, or an Instagram account the Graph API has never read.
// Graph calls per run are capped at HOURLY_LIMIT - 20 (hashtags first, then accounts by priority); accounts past the cap stay
// due and are not marked checked, and a Meta rate limit ends the Graph reads cleanly.
// Flags: --all (ignore cadence) | --handle <h> | --dry (plan only, no network) | --promote | --no-fetch | --verbose
// Instagram accounts go through the Graph adapter when the token exists. Otherwise (or as well) the
// source's own schedule_url is read by its non-Instagram adapter. Events go through the same
// extractor, geocoder and writer as `npm run ingest`.
import "./lib/env.js";
import fs from "node:fs";
import { createFetcher } from "./lib/fetch.js";
import { createGeocoder } from "./lib/geocode.js";
import { processItems, dedupeCandidates, finalize } from "./lib/pipeline.js";
import { readEvents, writeEvents, passesWatchRule, hasPopupIntent } from "./lib/write.js";
import { harvest, RUN_CALLS, funnelLine, loadConfig, weekTags, planTags } from "./lib/hashtags.js";
import { planWatch, formatPlan, hashtagBudget } from "./lib/plan.js";
import { hasMatcha } from "./adapters/mato.js";
import { setVerbose, warn, info } from "./lib/log.js";
import * as wlib from "./lib/watchlist.js";
import mato from "./adapters/mato.js";
import luma from "./adapters/luma.js";
import eventbrite from "./adapters/eventbrite.js";
import ics from "./adapters/ics.js";
import website from "./adapters/website.js";
import marketspread from "./adapters/marketspread.js";
import manual from "./adapters/manual.js";
import { recheckTiktok, recheckInstagram, loadBudget, saveBudget, budgetLine } from "./lib/sites/social-search.js";
import graph, { creds, createRate, runAllowance } from "./adapters/instagram-graph.js";
import { brandOf } from "./lib/names.js";
import { buildBrands, writeBrands } from "./lib/enrich/brands.js";
import { enrich as yelpEnrich, fillApproxFromYelp, createYelp, PLACES_FILE } from "./lib/enrich/yelp.js";

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
  const migrated = wlib.migrateUnreadable(wl.accounts); // an old "Invalid user id" error becomes status "unreadable" (saved with the list on a real run)
  if (migrated) info(`${migrated} accounts with an old "Invalid user id" error are now unreadable: no more Graph reads of them`);
  if (dry) {
    // Plan only: reads the local watch list, hashtag config and rate file; no Meta, Tavily or other network call, nothing written.
    const rate0 = createRate(), cfg = loadConfig();
    const tags = planTags(cfg, rate0, now);
    const p = planWatch({ accounts: wl.accounts, now, used: rate0.used(), tags, hashtagCalls: tags.length ? RUN_CALLS : 0, graphOn: true, guessCap: +(env.WATCH_GUESS_CAP ?? 15), all });
    info(formatPlan(p));
    info(igOn ? "token: present in the environment" : "token: not in the environment (a real run would skip Graph)");
    return;
  }
  const fetcher = createFetcher({ noFetch });
  const geocoder = createGeocoder({ noFetch });

  // Graph budget for this run: HOURLY_LIMIT - 20 (runAllowance), less what earlier runs in the same rolling hour already used.
  // `counted` is the rate counter that also counts what this run takes, so hashtags and account reads share one allowance.
  const rate = createRate();
  const allowance = runAllowance(rate.used());
  let spent = 0;
  const counted = { ...rate, take() { const ok = rate.take(); if (ok) spent++; return ok; } };
  const room = () => spent < allowance;
  const ctx = { fetcher, now, env, rate: counted };
  const stat = { instagram: { checked: 0, posts: 0, events: 0, credits: 0 }, tiktok: { checked: 0, posts: 0, events: 0, credits: 0 } };
  const sourceIds = new Set(sources.map((s) => s.id));

  // Step 1: hashtag posts become events and their brands join the watch list, so the account reads below pick them up.
  const candidates = [], live = [], notes = new Map();
  let tagStats = null;
  if (igOn && !noFetch && !only) {
    // Hashtags take a small share of the run (HASHTAG_SHARE calls) while the never-read backlog is large; accounts get the rest.
    const hashCap = hashtagBudget(wlib.graphBacklog(wl.accounts, now), RUN_CALLS);
    const h = await harvest({ now, env, rate: counted, room: () => spent < Math.min(allowance, hashCap), wl, sources, events: readEvents(), dry });
    tagStats = h.stats;
    candidates.push(...h.candidates);
    for (const a of h.accounts) wlib.addCandidate(wl, { handle: a.handle, found_via: a.found_via, found_from: a.found_from, notes: a.evidence, guess: a.guess }, now);
  }

  const due = wl.accounts.filter((a) => (only ? a.handle.toLowerCase() === only : all ? a.status !== "dropped" : wlib.isDue(a, now, { graphOn: igOn })));
  if (only && !due.length) warn(`no account "${only}" on the watch list`);
  info(`${due.length} of ${wl.accounts.length} accounts to check`);

  // Search checks cost one Tavily credit each. Caps per step (env WATCH_IG_CAP / WATCH_TT_CAP, default 60 / 40), highest priority first:
  // accounts with a hit, then watching, then candidates, oldest last_checked first. Accounts past the cap stay due for the next run.
  const budget = loadBudget(undefined, now);
  const caps = { instagram: +(env.WATCH_IG_CAP ?? 60), tiktok: +(env.WATCH_TT_CAP ?? 40) };
  const queue = new Set([...wlib.pickForSearch(due, "instagram", caps.instagram), ...wlib.pickForSearch(due, "tiktok", caps.tiktok)].map((a) => a));
  const order = new Map(wlib.graphOrder(due).map((a, i) => [a, i])); // Graph reads: never-read accounts first, then the longest since their last read
  due.sort((a, b) => order.get(a) - order.get(b));
  const known = new Set(readEvents().map((e) => e.id));
  let waiting = 0, graphErrors = 0, unreadable = 0, dropped = 0, namesSet = 0, inGraph = false, guessReads = 0;
  const GUESS_CAP = +(env.WATCH_GUESS_CAP ?? 15); // guessed handles read per run; the rest wait so real brands get the hour's calls
  for (const acc of due) {
    const real = sources.find((s) => s.id === acc.source_id);
    let source = real || wlib.pseudoSource(acc);
    let wantsGraph = acc.platform === "instagram" && igOn && !noFetch && !wlib.graphSkipped(acc, now);
    if (wantsGraph && acc.guess) { if (guessReads >= GUESS_CAP) { waiting++; continue; } guessReads++; }
    // Past the Graph budget, or Meta said stop: the account stays due and is not marked checked.
    if (wantsGraph && (ctx.rateStopped || !room())) { waiting++; continue; }
    let items = [], ran = false, searchOnly = false, facts = null;
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
      if (wantsGraph) {
        inGraph = true;
        const got = await graph.fetch(source, ctx);
        inGraph = false;
        if (ctx.rateStopped) { waiting++; continue; }
        facts = got.facts || null;
        items = items.concat(got);
        ran = true; searchOnly = false;
      }
      const adapter = source.schedule_url ? ADAPTERS.find((x) => x.matches(source)) : null;
      if (adapter && adapter !== manual) { items = items.concat(await adapter.fetch(source, ctx)); ran = true; searchOnly = false; }
    } catch (e) {
      // Meta answered no for this account (personal, deleted, renamed): remember it and leave Graph alone for a week.
      // "Invalid user id" (HTTP 400): the business_discovery edge cannot read this account, so it is marked unreadable and never retried by Graph.
      if (inGraph && e.api && wlib.isInvalidUserId(e.message) && !acc.guess) { wlib.markUnreadable(acc, e.message, now); unreadable++; notes.set(acc.handle, `unreadable by Graph: ${e.message}`); inGraph = false; continue; }
      if (inGraph && e.api) { wlib.recordGraphError(acc, e.message, now); graphErrors++; if (acc.guess) { acc.status = "dropped"; acc.dropped_at = new Date(now).toISOString(); acc.notes = "guessed handle, Graph does not know it"; } notes.set(acc.handle, `graph error: ${e.message}`); inGraph = false; continue; }
      inGraph = false;
      warn(`${acc.handle}: ${e.message}`); notes.set(acc.handle, `failed: ${e.message}`); continue;
    }
    if (wantsGraph && ran) {
      wlib.recordGraph(acc, facts, now);
      if (real && wlib.setAutoName(real, acc)) namesSet++;
      if (wlib.dropIfNoMatcha(acc, items, hasMatcha, now)) { dropped++; notes.set(acc.handle, acc.notes); continue; }
    }
    if (!real && acc.name) source = { ...source, brand: brandOf({ brand: source.brand, handle: acc.handle, auto_name: acc.name }) };
    else if (real) source = { ...source, brand: brandOf({ brand: real.brand, handle: real.instagram, auto_name: real.auto_name }) };
    if (!ran) { notes.set(acc.handle, queue.has(acc) ? "search failed or cap reached" : igOn ? "nothing to check" : "over the search cap or no source"); continue; }
    if (!searchOnly) live.push(source.id); // search snippets are not a full listing: a missing post must not decay its events
    // An account that is not a source is written only when a post has a matcha term, pop-up intent and a place.
    const watchOnly = !real && !wlib.readNote(acc.notes);
    if (watchOnly) items = items.filter((r) => hasMatcha(r.text) && hasPopupIntent(r.text));
    let { candidates: cs, popupAt } = await processItems(items, source, { now, handle: source.instagram ?? (wlib.readNote(acc.notes) ? null : acc.handle) });
    if (watchOnly) cs = cs.filter((c) => passesWatchRule([c.title, c.description], c));
    // No post picture: the account's profile picture stands in.
    if (acc.profile_picture_url) for (const c of cs) if (!c.image_url && !c.image) c.image_url = acc.profile_picture_url;
    const ids = new Set(dedupeCandidates(cs, now).map((c) => c.id));
    const fresh = [...ids].filter((id) => !known.has(id)).length;
    candidates.push(...cs);
    wlib.recordCheck(acc, { now, hitCount: fresh, foundCount: ids.size, popupAt: ids.size ? popupAt : null });
    notes.set(acc.handle, `${items.length} items, ${ids.size} dated`);
  }

  saveBudget(budget, undefined, now); // credits are spent even on --dry
  const { merged } = await finalize(candidates, { now, geocoder, fetcher, liveSourceIds: live, dry, sourceIds });
  for (const k of ["instagram", "tiktok"]) info(`by-handle ${k}: ${stat[k].checked} accounts checked, ${stat[k].posts} posts of theirs seen, ${stat[k].events} dated events, ${stat[k].credits} credits`);
  info(`graph: ${spent} of ${allowance} calls this run${tagStats ? ` (hashtags: ${tagStats.tags} tags, ${funnelLine(tagStats.funnel)})` : ""}; ${unreadable} newly unreadable (Invalid user id, never retried), ${graphErrors} other accounts with a Graph error (skipped for ${wlib.GRAPH_RETRY_DAYS} days), ${dropped} dropped for no matcha, ${namesSet} names set`);
  if (waiting) info(`${waiting} accounts wait for the next hour`);
  info(budgetLine(budget));
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
  if (namesSet) fs.writeFileSync("data/sources.json", JSON.stringify(sources, null, 2) + "\n");
  info("wrote data/watchlist.json");
  // Brand facts for the cards (site/data/brands.json), then Yelp places and the coordinates they give approximate pins (off without YELP_API_KEY).
  const brandData = buildBrands(wl, sources, now);
  writeBrands(brandData);
  info(`wrote site/data/brands.json (${brandData.brands.length} accounts)`);
  await yelpStep();
}

async function yelpStep() {
  let shops = [];
  try { shops = JSON.parse(fs.readFileSync("site/data/shops.json", "utf8")).shops || []; } catch { /* none */ }
  const yelp = createYelp();
  const events = readEvents();
  const r = await yelpEnrich({ events, shops, yelp });
  let places = yelp.places();
  if (!r.on) { try { places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf8")).places || []; } catch { places = []; } }
  const moved = fillApproxFromYelp(events, places);
  if (moved.length) { writeEvents(events); info(`Yelp: ${moved.length} approximate pin(s) moved to the venue`); }
}

main().catch((e) => { console.error("watch crashed:", e); process.exit(1); });
