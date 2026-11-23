// npm run discover: find new candidate accounts and add them to data/watchlist.json as "candidate".
// Every source is a small function returning [{handle, found_via, found_from, evidence}] and is
// open or official: @mentions and hashtag posts through `npm run watch` (ingest/lib/hashtags.js), Brave Search API (key), public MATO and
// Luma pages (robots.txt respected), @mentions in captions we already hold (inbox, cache).
// No scraping behind a login, no cookies, no headless browser. Flags: --dry, --no-fetch, --verbose, --no-<site> (skip one site:
// mato, luma, eventbrite, dostuff, meetup, linktree, allevents, social-search) and --only <site> (run just that site; the Graph, Brave and
// mention steps are skipped), --cities <name,name,...> (names as in data/cities.json, a trailing state allowed: "Phoenix AZ,Mesa,Denver";
// eventbrite, allevents and meetup ask exactly those cities, leaving their saved cursor and skip list alone; luma and mato have no
// city list and ignore it). The per-site crawlers live in ingest/lib/sites (mato's in mato-city.js).
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./fetch.js";
import { htmlToLines } from "./html.js";
import { setVerbose, warn, warnOnce, info } from "./log.js";
import * as wlib from "./watchlist.js";
import { readInbox } from "../adapters/manual.js";
import { crawlMato } from "./mato-city.js";
import { crawlCities, searchLabels, resolveCityNames } from "./cities.js";
import { createGeocoder } from "./geocode.js";
import { processItems, finalize } from "./pipeline.js";
import { readEvents } from "./write.js";
import { runSites, parseFlags, siteOn, summaryLine, dedupeItems, skipDominated, capConfidence, NAMES, REVIEW_ONLY } from "./sites/index.js";
import { pseudoSource } from "./sites/common.js";
import { matchaPopup } from "./sites/textfind.js";
import { cityFromText } from "./sites/bluesky.js";
import { judge } from "./quality.js";
import { toItem, writeReview, PROMOTE } from "./review.js";
import { newRow, table, writeReport } from "./yield.js";

// ---- @mentions -------------------------------------------------------------------------------
const POPUP_WORDS = /pop[\s-]?ups?\b|\bcart\b|\bmarket\b|\bcollab|take[\s-]?over|matcha/i;
const NOT_HANDLES = new Set(["media", "import", "font", "keyframes", "supports", "charset", "context", "type", "id", "graph", "everyone", "here", "all", "channel", "instagram", "tiktok"]);
const RE_AT = /(?<![\w.@/+-])@([A-Za-z0-9][A-Za-z0-9._]{1,28})/g;

// Handles mentioned within ~100 characters of a pop-up word. Skips `self` and email-like text.
// Returns [{handle, evidence}] with handles unique and without trailing dots.
export function extractMentions(text, { self = null } = {}) {
  const t = String(text || "").replace(/\s+/g, " ");
  const seen = new Set(), out = [];
  const me = self ? String(self).toLowerCase() : null;
  for (const m of t.matchAll(RE_AT)) {
    const handle = m[1].replace(/\.+$/, "");
    const low = handle.toLowerCase();
    if (handle.length < 3 || !/[a-z]/i.test(handle) || NOT_HANDLES.has(low) || low === me || seen.has(low)) continue;
    const from = Math.max(0, m.index - 100), to = Math.min(t.length, m.index + m[0].length + 100);
    const win = t.slice(from, to);
    // The window must hold a pop-up word that is not just the handle itself.
    if (!POPUP_WORDS.test(win.replace(m[0], " "))) continue;
    seen.add(low);
    out.push({ handle, evidence: win.trim() });
  }
  return out;
}

// ---- Brave results ---------------------------------------------------------------------------
const RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about", "popular", "tags", "locations", "web", "legal", "developer", "directory", "challenge", "emails", "oauth", "api"]);

// A result URL -> {type:"handle", handle} | {type:"post", shortcode, handle|null} | null.
export function parseSearchUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
  const seg = u.pathname.split("/").filter(Boolean);
  if (!seg.length) return null;
  if (["p", "reel", "tv"].includes(seg[0]) && seg[1]) return { type: "post", shortcode: seg[1], handle: null };
  if (RESERVED.has(seg[0].toLowerCase())) return null;
  if (!/^[A-Za-z0-9._]+$/.test(seg[0])) return null;
  if (["p", "reel", "tv"].includes((seg[1] || "").toLowerCase()) && seg[2]) return { type: "post", shortcode: seg[2], handle: seg[0] };
  return { type: "handle", handle: seg[0] };
}

// Brave web results -> {candidates, leads}. Keeps only results that talk about matcha or pop-ups.
export function fromBraveResults(json, city = null) {
  const candidates = [], leads = [];
  for (const r of json?.web?.results || []) {
    const hit = parseSearchUrl(r.url);
    if (!hit) continue;
    const evidence = `${r.title || ""} | ${r.description || ""}`.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!/matcha|pop[\s-]?up/i.test(evidence)) continue;
    const fromTitle = /\(@([A-Za-z0-9._]+)\)/.exec(r.title || "")?.[1];
    const handle = hit.handle || fromTitle || null;
    if (handle && !RESERVED.has(handle.toLowerCase())) candidates.push({ handle, found_via: "search", found_from: r.url, evidence, city });
    else leads.push({ url: r.url, found_via: "search", found_from: city ? `brave: ${city}` : "brave", evidence });
  }
  return { candidates, leads };
}

// Brave results that are posts announcing a matcha pop-up -> RawItems (the snippet is the text; page_age is the post date, without
// it relative words are not used). They join the instagram: pseudo-source path, so capConfidence keeps them likely at most.
export function braveItems(json, city = null) {
  const out = [];
  for (const r of json?.web?.results || []) {
    const hit = parseSearchUrl(r.url);
    if (!hit || hit.type !== "post") continue;
    const title = String(r.title || "").replace(/<[^>]+>/g, ""), desc = String(r.description || "").replace(/<[^>]+>/g, "");
    const handle = hit.handle || /\(@([A-Za-z0-9._]+)\)/.exec(title)?.[1] || null;
    if (!handle || !matchaPopup(title, desc)) continue;
    const place = cityFromText(`${title} ${desc}`) || cityFromText(city || "");
    const age = Date.parse(r.page_age || "");
    out.push({
      source_url: r.url.split("?")[0], text: `${title}. ${desc}`, handle, organizer: { name: handle, url: null }, hints: place ? { city: place.city, state: place.state } : {},
      published_at: Number.isFinite(age) ? new Date(age).toISOString() : null, noRelative: !Number.isFinite(age), maxAheadDays: 60, evidence: [r.url],
    });
  }
  return out;
}

// ---- MATO and Luma data helpers (the crawls themselves: mato-city.js and sites/luma.js) ---------------------------
const MATCHA_SLUG = /matcha/i;

export function fromMatoHtml(html) {
  const venues = [...new Set([...html.matchAll(/href="\/venue\/([a-z0-9._-]+)"/gi)].map((m) => m[1]))].filter((s) => MATCHA_SLUG.test(s));
  const events = [...new Set([...html.matchAll(/href="\/event\/([a-z0-9-]+)"/g)].map((m) => m[1]))].filter((s) => MATCHA_SLUG.test(s));
  const cities = [...new Set([...html.matchAll(/href="\/events\/([a-z-]+)"/g)].map((m) => m[1]))];
  return { venues, events, cities };
}

// Walk Luma's embedded JSON: any object whose name mentions matcha, plus the Instagram handle in its subtree.
export function fromLumaData(data) {
  const candidates = [], leads = [];
  const igIn = (n, d = 0) => {
    if (!n || typeof n !== "object" || d > 6) return null;
    for (const [k, v] of Object.entries(n)) {
      if (/^instagram(_handle)?$/.test(k) && typeof v === "string" && /^[A-Za-z0-9._]+$/.test(v.replace(/^@/, ""))) return v.replace(/^@/, "");
      const f = igIn(v, d + 1);
      if (f) return f;
    }
    return null;
  };
  const walk = (n, d = 0) => {
    if (!n || typeof n !== "object" || d > 12) return;
    if (!Array.isArray(n)) {
      const name = n.name || n.title;
      if (typeof name === "string" && MATCHA_SLUG.test(name)) {
        const handle = igIn(n);
        const url = n.url ? `https://luma.com/${String(n.url).replace(/^\//, "")}` : null;
        if (handle) candidates.push({ handle, found_via: "search", found_from: "luma.com", evidence: name.slice(0, 200) });
        else if (url) leads.push({ url, found_via: "search", found_from: "luma.com", evidence: name.slice(0, 200) });
      }
    }
    for (const v of Object.values(n)) walk(v, d + 1);
  };
  walk(data);
  return { candidates, leads };
}

// MATO: every US city page plus the sitemap (see ingest/lib/mato-city.js). Returns candidates and the events found.
async function discoverMato(fetcher, { now, sources }) {
  const r = await crawlMato(fetcher, { now, sources });
  const s = r.stats;
  info(`ma.to: ${s.cities} cities (${s.usCities} US), ${s.cityPages} city pages, ${s.matchaCards} matcha cards, ${s.sitemapPages} sitemap pages (${s.sitemapMatches} matcha slugs), ${s.eventPages} event pages, ${s.kept} matcha events kept, ${s.fetches} fetches${s.stopped429 ? ", stopped on 429" : ""}`);
  return { candidates: r.candidates, leads: [], items: r.items, kept: r.kept, stats: s };
}

// ---- Brave Search ----------------------------------------------------------------------------
// 10 cities per run, rotating by 6-hour slot over the biggest cities of data/cities.json (SEARCH_CITIES_POOL, default 100), so the
// number of searches per run stays inside the free plan however long the city list is.
export function citiesForRun(cities, now = new Date(), perRun = 10) {
  if (!cities.length) return [];
  const slot = Math.floor(new Date(now).getTime() / (6 * 3600000));
  const start = (slot * perRun) % cities.length;
  return Array.from({ length: Math.min(perRun, cities.length) }, (_, i) => cities[(start + i) % cities.length]);
}

async function discoverBrave(env, now, { perRun = 10, http = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const out = { candidates: [], leads: [], items: [] };
  if (!env.BRAVE_API_KEY) { warnOnce("brave", "Brave search: off (set BRAVE_API_KEY to search instagram.com for pop-up accounts)"); return out; }
  const cities = searchLabels();
  if (!cities.length) warn("data/cities.json missing");
  for (const city of citiesForRun(cities, now, perRun)) {
    const q = `site:instagram.com "matcha pop up" ${city}`;
    try {
      const r = await http(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&country=US`, { headers: { "X-Subscription-Token": env.BRAVE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { warn("Brave search: rate limited, stopping"); break; }
      if (!r.ok) { warn(`Brave search "${city}": HTTP ${r.status}`); continue; }
      const json = await r.json();
      const f = fromBraveResults(json, city);
      out.candidates.push(...f.candidates); out.leads.push(...f.leads); out.items.push(...braveItems(json, city));
    } catch (e) { warn(`Brave search "${city}": ${e.message}`); }
    await wait(1100); // free plan: 1 request per second
  }
  return out;
}

// ---- mentions in captions we already hold ----------------------------------------------------
export function fromInbox(files = readInbox()) {
  const out = [];
  for (const f of files) {
    const from = f.raw.source_url || `data/inbox/${f.file}`;
    const self = /instagram\.com\/([A-Za-z0-9._]+)\//.exec(f.raw.source_url || "")?.[1];
    for (const m of extractMentions(f.raw.text, { self })) out.push({ handle: m.handle, found_via: "mention", found_from: from, evidence: m.evidence });
  }
  return out;
}

export function fromCache(dir = ".cache") {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("ig-")); } catch { return out; }
  for (const f of files) {
    let c;
    try { c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!c || c.status >= 400 || typeof c.body !== "string" || !c.url) continue;
    const text = /<html|<body|<!doctype/i.test(c.body.slice(0, 500)) ? htmlToLines(c.body).join("\n") : c.body;
    for (const m of extractMentions(text)) out.push({ handle: m.handle, found_via: "mention", found_from: c.url, evidence: m.evidence });
  }
  return out;
}

// Mentions and hashtag owners from Graph RawItems.
export function fromGraphItems(items) {
  const out = [];
  for (const raw of items) {
    const tag = raw.hashtag ? `#${raw.hashtag}` : raw.source_url;
    if (raw.handle) out.push({ handle: raw.handle, found_via: "hashtag", found_from: tag, evidence: String(raw.text || "").slice(0, 200) });
    for (const m of extractMentions(raw.text, { self: raw.handle })) out.push({ handle: m.handle, found_via: raw.hashtag ? "hashtag" : "mention", found_from: raw.source_url, evidence: m.evidence });
  }
  return out;
}

// Add found candidates to a watchlist object. Skips known handles. Returns the new accounts.
export function addAll(wl, found, now = new Date()) {
  const added = [];
  for (const c of found) {
    const acc = wlib.addCandidate(wl, { handle: c.handle, platform: c.platform, found_via: c.found_via, found_from: c.found_from, notes: (c.evidence || "").slice(0, 160) }, now);
    if (acc) added.push(acc);
  }
  return added;
}

async function main() {
  const argv = process.argv.slice(2);
  setVerbose(argv.includes("--verbose"));
  const dry = argv.includes("--dry"), noFetch = argv.includes("--no-fetch");
  const flags = parseFlags(argv);
  // --dry: the Instagram parts (Brave site:instagram.com searches, Tavily social-search) are planned, not run; the other sites still read.
  if (dry) flags.off.add("social-search");
  if (flags.only && !NAMES.includes(flags.only)) { console.error(`--only needs one of: ${NAMES.join(", ")}`); process.exit(2); }
  const now = new Date(), env = process.env;
  const fetcher = createFetcher({ noFetch });
  const wl = wlib.load();
  try { wlib.seedFromSources(JSON.parse(fs.readFileSync("data/sources.json", "utf8")), wl, now); } catch { /* no sources yet */ }

  const found = [], leads = [], counts = {};
  const report = argv.includes("--report");
  let brave = { items: [] };
  const take = (name, list) => { counts[name] = list.length; found.push(...list); };

  if (!flags.only) {
    take("inbox mentions", fromInbox());
    take("cache mentions", fromCache());
    if (dry) {
      const q = env.BRAVE_API_KEY ? citiesForRun(searchLabels(), now, 10) : [];
      info(`dry: Instagram parts planned, not run. Graph calls: none (discover never calls Meta; hashtags run in watch). Brave: ${env.BRAVE_API_KEY ? `${q.length} searches this slot (${q.join(", ")})` : "off, no key"}. Tavily social-search: skipped (see data/tavily-budget.json for credits left).`);
    } else brave = await discoverBrave(env, now, { perRun: 10 });
    take("brave search", brave.candidates); leads.push(...brave.leads);
  }
  let sources = [];
  try { sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8")); } catch { /* none */ }
  // Every listed city, biggest first: the per-city crawlers walk it with their own cursors (CRAWL_CITIES_PER_RUN a run each).
  // The Tavily search takes its own short rotation (ctx.searchCities) from the same file.
  const cities = crawlCities();

  // Events found on the sites, as [{source, raw}] in priority order: MATO first, then ingest/lib/sites/index.js order.
  let list = [], matoFetches = null;
  if (siteOn("mato", flags, noFetch)) {
    try {
      const mato = await discoverMato(fetcher, { now, sources });
      take("ma.to", mato.candidates);
      matoFetches = mato.stats.fetches || 0;
      list.push(...mato.items);
    } catch (e) { warn(`ma.to: ${e.message}`); counts["ma.to"] = 0; }
  }
  let only = null;
  if (flags.cities) {
    const r = resolveCityNames(flags.cities);
    for (const n of r.missing) warn(`--cities: no city "${n}" in data/cities.json`);
    only = r.cities;
    info(`--cities: ${only.map((c) => `${c.name} ${c.state}`).join(", ")}`);
    if (!only.length) { console.error("--cities matched no city"); process.exit(2); }
  }
  const results = await runSites({ fetcher, now, sources, cities, only, searchCities: searchLabels(), env }, flags);
  for (const r of results) {
    take(r.name, r.candidates); leads.push(...r.leads);
    for (const raw of r.items) list.push({ source: raw.source_hint, raw, site: r.name });
  }
  for (const raw of brave.items || []) { raw.source_hint = pseudoSource("instagram", raw, sources); list.push({ source: raw.source_hint, raw, site: "brave" }); }
  for (const x of list) x.site = x.site || "mato";
  list = dedupeItems(list);

  const added = addAll(wl, found, now);
  for (const [k, v] of Object.entries(counts)) info(`${k.padEnd(26)} ${v} found`);
  info(`
${added.length} new candidates (${wl.accounts.length} accounts on the list), ${leads.length} leads`);
  for (const a of added.slice(0, 40)) info(`  + @${a.handle.padEnd(26)} ${a.found_via.padEnd(8)} ${String(a.found_from).slice(0, 60)}`);
  if (added.length > 40) info(`  ... and ${added.length - 40} more`);
  if (dry) { for (const r of results) info(summaryLine(r)); info("(dry run: nothing written)"); return; }
  wlib.save(wl, { now });
  const rows = new Map();
  const row = (site) => { if (!rows.has(site)) rows.set(site, newRow(site)); return rows.get(site); };
  if (matoFetches !== null) row("mato").fetched = matoFetches;
  for (const r of results) Object.assign(row(r.name), { fetched: r.stats.fetches || 0, note: r.stats.skipped || "" });
  if (env.BRAVE_API_KEY) row("brave");
  if (list.length) {
    // Every matcha event the sites listed goes through the same extractor, geocoder and writer as every other source.
    const bySource = new Map();
    for (const { source, raw, site } of list) { const k = `${site}|${source.id}`; if (!bySource.has(k)) bySource.set(k, { source, site, items: [] }); bySource.get(k).items.push(raw); }
    let cands = [];
    for (const { source, site, items } of bySource.values()) for (const c of (await processItems(items, source, { now, handle: source.instagram })).candidates) cands.push({ ...c, _site: site });
    cands = cands.map(capConfidence);
    // Quality rules (ingest/lib/quality.js): a listing that does not name matcha as its point is dropped, with the reason counted.
    const geocoder = createGeocoder({ noFetch });
    const today = now.getTime() - 86400000, kept = [];
    for (const c of cands) {
      const r = row(c._site);
      r.candidates++;
      if (Date.parse(c.end || c.start) >= today) r.dated++;
      const q = judge(c);
      if (!q.keep) { r.dropped[q.reason] = (r.dropped[q.reason] || 0) + 1; continue; }
      if (q.kind) c.kind = "organizer";
      if (!c.state) { r.dropped["no state"] = (r.dropped["no state"] || 0) + 1; continue; }
      await geocoder.geocode(c);
      if (c.lat != null && !c.approx) r.geocoded++;
      kept.push(c);
    }
    // Every kept candidate goes to today's review file; the review-only crawlers stop there (ingest promotes their confirmed and likely finds).
    const direct = kept.filter((c) => !REVIEW_ONLY.has(c._site));
    const held = skipDominated(direct, readEvents());
    const heldSet = new Set(held);
    for (const c of direct) if (!heldSet.has(c)) { c.drop = "better source has it"; const r = row(c._site); r.dropped["better source has it"] = (r.dropped["better source has it"] || 0) + 1; }
    const rev = writeReview(kept.map((c) => toItem(c, c._site)), { now });
    info(`review: ${kept.length} candidates written to ${rev.file} (${rev.count} in the file)`);
    for (const c of kept.filter((x) => REVIEW_ONLY.has(x._site))) if (PROMOTE.has(c.confidence)) row(c._site).promoted++;
    const before = new Set(readEvents().map((e) => e.id));
    const { merged, final } = await finalize(held, { now, geocoder, fetcher, liveSourceIds: [], dry: false });
    const ids = new Set(merged.events.map((e) => e.id));
    for (const c of final) if (ids.has(c.id) && PROMOTE.has(c.confidence)) row(c._site).promoted++;
    const fresh = (name) => final.filter((c) => c._site === name && !before.has(c.id)).length;
    info(`site events: ${cands.length} candidates, ${merged.events.length} events total (+${merged.stats.added} new, ${merged.stats.updated} updated)`);
    for (const r of results) info(summaryLine(r, { new: fresh(r.name) }));
  } else for (const r of results) info(summaryLine(r, { new: 0 }));
  if (report) {
    const all = [...rows.values()];
    info("\n" + table(all));
    const tot = (k) => all.reduce((n, r) => n + r[k], 0);
    info(`wrote ${writeReport(all, { now, totals: { fetched: tot("fetched"), candidates: tot("candidates"), dated: tot("dated"), geocoded: tot("geocoded"), promoted: tot("promoted") } })}`);
  }
  if (leads.length) {
    const file = "data/discover-leads.json";
    let old = []; try { old = JSON.parse(fs.readFileSync(file, "utf8")).leads || []; } catch { /* first */ }
    const seen = new Set(old.map((l) => l.url));
    const all = old.concat(leads.filter((l) => !seen.has(l.url))).slice(-200);
    fs.writeFileSync(file, JSON.stringify({ updated: now.toISOString(), note: "Post URLs found without a usable handle (paste the caption into data/inbox to read one), and schedule links found on Linktree pages (set the source's schedule_url from them).", leads: all }, null, 2) + "\n");
  }
  info("wrote data/watchlist.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error("discover crashed:", e); process.exit(1); });
}
