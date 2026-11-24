// The per-site crawlers wired into `npm run discover`: one module per site, each exporting
// { name, host, discover(ctx) -> { items, candidates, leads?, stats } }. Run order is also the duplicate priority.
// Flags (discover.js): --no-<name> skips one site, --only <name> runs just that site (mato counts as a site name).
//
// Checked and used:      luma (discover places + public paging API), eventbrite (city search pages + event pages; organizer pages
//                        through adapters/eventbrite.js), dostuff (16 city sites, 3 skipped), meetup (public event search),
//                        allevents (city pages), linktree (Linktree / Beacons pages of known brands).
// Checked and skipped (2026-11-22):
//   Yelp events        robots.txt: "User-Agent: *  Disallow: /" (only named search bots are allowed). Skipped; Yelp's official Fusion events API is
//                      used instead when YELP_API_KEY is set (yelp-events.js, rung N2). Rechecked 2026-11-22: still "Disallow: /".
//   Posh (posh.vip)    the explore and city pages are client-rendered: no JSON-LD and no embedded event data in the HTML, and the
//                      data calls go to /api/ and /next-bff/, which its robots.txt disallows. Skipped.
//   Partiful           events are private invite links; there is no public listing or search, and the robots.txt only names a few
//                      search bots. Skipped.
//   Resident Advisor   a club-music listing (ra.co); no matcha events, and /api/ is disallowed. Skipped.
//   social-search       TikTok and Instagram through Tavily search snippets and TikTok's open oEmbed (social-search.js); no page of those hosts is opened.
//   TikTok, Instagram, Facebook pages: never crawled (README, "Not covered").
import * as luma from "./luma.js";
import * as eventbrite from "./eventbrite.js";
import * as dostuff from "./dostuff.js";
import * as meetup from "./meetup.js";
import * as linktree from "./linktree.js";
import * as allevents from "./allevents.js";
import * as socialSearch from "./social-search.js";
import * as roundups from "./roundups.js";
import { SITE_ORDER, dupKey, titleKey } from "./common.js";
import { info, warn } from "../log.js";

export const SITES = [luma, eventbrite, dostuff, meetup, linktree, allevents, roundups, socialSearch];
export const NAMES = ["mato", ...SITES.map((s) => s.name)];

// argv -> {only, off:Set}. Unknown --only names are reported by the caller.
export function parseFlags(argv) {
  const only = argv.includes("--only") ? String(argv[argv.indexOf("--only") + 1] || "").toLowerCase() : null;
  const off = new Set(NAMES.filter((n) => argv.includes(`--no-${n}`)));
  const cities = argv.includes("--cities") ? String(argv[argv.indexOf("--cities") + 1] || "").split(",").map((x) => x.trim()).filter(Boolean) : null;
  return { only, off, cities };
}
export const siteOn = (name, { only, off }, noFetch = false) => !noFetch && (!only || only === name) && !off.has(name);

// Run the selected crawlers one after the other. -> [{name, host, items, candidates, leads, stats}]
export async function runSites(ctx, flags, { sites = SITES } = {}) {
  const out = [];
  for (const s of sites) {
    if (!siteOn(s.name, flags, ctx.fetcher?.noFetch)) continue;
    let r;
    try { r = await s.discover(ctx); } catch (e) { warn(`${s.name}: ${e.message}`); r = { items: [], candidates: [], stats: { skipped: `crashed: ${e.message}` } }; }
    out.push({ name: s.name, host: s.host, items: r.items || [], candidates: r.candidates || [], leads: r.leads || [], stats: r.stats || {} });
  }
  return out;
}

// One line per site for the discover summary.
export function summaryLine(r, extra = {}) {
  const s = r.stats || {};
  if (s.skipped) return `${r.name.padEnd(11)} skipped: ${s.skipped}`;
  const bits = [`${s.fetches ?? 0} fetches`, `${s.pages ?? 0} pages ok`, `${r.items.length} matcha events`, `${r.candidates.length} candidates`];
  if (r.leads?.length) bits.push(`${r.leads.length} leads`);
  if (extra.new !== undefined) bits.push(`${extra.new} new`);
  if (s.skippedHosts?.length) bits.push(`skipped ${s.skippedHosts.length} hosts (${s.skippedHosts.map((x) => x.split(":")[0]).join(", ")})`);
  if (s.stopped) bits.push(`stopped on HTTP ${s.stopped}`);
  if (s.hitCap) bits.push("hit the fetch cap");
  return `${r.name.padEnd(11)} ${bits.join(", ")}`;
}

// ---- duplicates ---------------------------------------------------------------------------------
export const prefixOf = (id) => (String(id).includes(":") ? String(id).split(":")[0] : null);
// Real sources rank -1 (best), then the order of SITE_ORDER.
export const rankOf = (id) => { const p = prefixOf(id); return p === null ? -1 : SITE_ORDER.includes(p) ? SITE_ORDER.indexOf(p) : -1; };

const itemKey = (raw) => dupKey(raw.hints?.title || raw.text, raw.hints?.start);

// [{source, raw}] in priority order -> the same list without events another entry already has (same title and day).
export function dedupeItems(list) {
  const seen = new Set();
  return list.filter(({ raw }) => {
    const k = itemKey(raw);
    if (!raw.hints?.start || !titleKey(raw.hints?.title || "")) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Candidates (events) -> without those an existing event from a better-or-equal ranked, different source already has.
export function skipDominated(cands, existing) {
  const have = new Map();
  for (const e of existing) { const k = dupKey(e.title, e.start); if (!have.has(k)) have.set(k, []); have.get(k).push(e.source_id); }
  return cands.filter((c) => !(have.get(dupKey(c.title, c.start)) || []).some((sid) => sid !== c.source_id && rankOf(sid) <= rankOf(c.source_id)));
}

// Allevents lists events that come from elsewhere, so nothing from it is "confirmed".
export const capConfidence = (c) => {
  // Search-snippet finds (a tiktok.com or instagram.com post URL): "likely" at most, "unsure" without a time or an address.
  if (/^https?:\/\/(?:www\.)?(?:tiktok|instagram)\.com\//i.test(c.source_url || "") && c.confidence !== "unsure") return { ...c, confidence: c.timed && c.hasAddress ? "likely" : "unsure" };
  // Aggregator, feed, permit and Bluesky finds: "likely" at most (no human-checked time or address).
  // Reddit, Mastodon and news finds the source gave no brand for ("r/nyc post") stay unsure: a human reads them in data/review/.
  if (/^(reddit|mastodon|gnews):/.test(String(c.source_id)) && String(c.brand || "").startsWith("r/")) return { ...c, confidence: "unsure" };
  return /^(allevents|feeds|roundups|bluesky|embed|permits|reddit|mastodon|gnews|yelpevents):/.test(String(c.source_id)) && c.confidence === "confirmed" ? { ...c, confidence: "likely" } : c;
};

void info;

// Rung 23: sources nobody else uses (open-data permits, market rosters, news feeds, Bluesky). Appended registrations; run order is after the
// event sites. Pseudo-source prefixes: permits:, markets:, feeds:, bluesky:. Each reads only public JSON, XML or pages behind robots.txt.
import * as permits from "./permits.js";
import * as markets from "./markets.js";
import * as feeds from "./feeds.js";
import * as bluesky from "./bluesky.js";
SITES.push(permits, markets, feeds, bluesky);
NAMES.push(permits.name, markets.name, feeds.name, bluesky.name);

// Rung N2 (web discovery engine): keyless social and news crawlers, then key-gated official APIs (each skips with "off (set ...)"
// until its key is in .env). Pseudo-source prefixes: reddit:, mastodon:, gnews:, ticketmaster:, yelpevents:; eventbrite-api files
// under eventbrite:. Their finds are written to data/review/ only (REVIEW_ONLY); `npm run ingest` promotes the confirmed and
// likely ones. Reddit's robots.txt disallows everything, so reddit runs only with REDDIT_CLIENT_ID/SECRET (official OAuth API).
import * as reddit from "./reddit.js";
import * as mastodon from "./mastodon.js";
import * as gnews from "./gnews.js";
import * as ticketmaster from "./ticketmaster.js";
import * as eventbriteApi from "./eventbrite-api.js";
import * as yelpEvents from "./yelp-events.js";
const N2 = [reddit, mastodon, gnews, ticketmaster, eventbriteApi, yelpEvents];
SITES.push(...N2);
NAMES.push(...N2.map((s) => s.name));
export const REVIEW_ONLY = new Set(["reddit", "mastodon", "gnews", "yelpevents", "roundups"]);
