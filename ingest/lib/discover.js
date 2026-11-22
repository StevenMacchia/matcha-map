// npm run discover: find new candidate accounts and add them to data/watchlist.json as "candidate".
// Every source is a small function returning [{handle, found_via, found_from, evidence}] and is
// open or official: Instagram Graph hashtags (token), Brave Search API (key), public MATO and
// Luma pages (robots.txt respected), @mentions in captions we already hold (inbox, cache).
// No scraping behind a login, no cookies, no headless browser.
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./fetch.js";
import { htmlToLines } from "./html.js";
import { setVerbose, warn, warnOnce, info } from "./log.js";
import * as wlib from "./watchlist.js";
import { readInbox } from "../adapters/manual.js";
import graph from "../adapters/instagram-graph.js";

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

// ---- MATO and Luma (public pages, robots.txt respected by the fetcher) ---------------------------
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

async function discoverMato(fetcher) {
  const out = { candidates: [], leads: [] };
  const home = await fetcher.get("https://ma.to/");
  if (!home.ok) { warn(`ma.to: ${home.blocked ? "blocked by robots.txt" : `HTTP ${home.status || "error"}`}`); return out; }
  const pages = [home.text];
  const first = fromMatoHtml(home.text);
  for (const c of first.cities.slice(0, 8)) {
    const r = await fetcher.get(`https://ma.to/events/${c}`);
    if (r.ok) pages.push(r.text);
  }
  const venues = new Set(), events = new Set();
  for (const p of pages) { const f = fromMatoHtml(p); f.venues.forEach((v) => venues.add(v)); f.events.forEach((e) => events.add(e)); }
  for (const v of venues) out.candidates.push({ handle: v, found_via: "search", found_from: "ma.to", evidence: `MATO venue /venue/${v} (slug matches matcha; handle unverified)` });
  let n = 0;
  for (const e of events) {
    if (n++ >= 10) break;
    const r = await fetcher.get(`https://ma.to/event/${e}`);
    const v = r.ok ? /href="\/venue\/([a-z0-9._-]+)"/i.exec(r.text)?.[1] : null;
    if (v) out.candidates.push({ handle: v, found_via: "search", found_from: "ma.to", evidence: `MATO event /event/${e}` });
    else out.leads.push({ url: `https://ma.to/event/${e}`, found_via: "search", found_from: "ma.to", evidence: e });
  }
  return out;
}

async function discoverLuma(fetcher) {
  const r = await fetcher.get("https://luma.com/discover");
  if (!r.ok) { warn(`luma.com/discover: ${r.blocked ? "blocked by robots.txt" : `HTTP ${r.status || "error"}`}`); return { candidates: [], leads: [] }; }
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(r.text);
  if (!m) return { candidates: [], leads: [] };
  try { return fromLumaData(JSON.parse(m[1])); } catch { return { candidates: [], leads: [] }; }
}

// ---- Brave Search ----------------------------------------------------------------------------
// 10 cities per run, rotating by 6-hour slot, so 40 cities x 4 runs a day stays inside the free plan.
export function citiesForRun(cities, now = new Date(), perRun = 10) {
  if (!cities.length) return [];
  const slot = Math.floor(new Date(now).getTime() / (6 * 3600000));
  const start = (slot * perRun) % cities.length;
  return Array.from({ length: Math.min(perRun, cities.length) }, (_, i) => cities[(start + i) % cities.length]);
}

async function discoverBrave(env, now, { perRun = 10, http = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const out = { candidates: [], leads: [] };
  if (!env.BRAVE_API_KEY) { warnOnce("brave", "Brave search: off (set BRAVE_API_KEY to search instagram.com for pop-up accounts)"); return out; }
  let cities = [];
  try { cities = JSON.parse(fs.readFileSync("data/cities-discover.json", "utf8")).cities || []; } catch { warn("data/cities-discover.json missing"); }
  for (const city of citiesForRun(cities, now, perRun)) {
    const q = `site:instagram.com "matcha pop up" ${city}`;
    try {
      const r = await http(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&country=US`, { headers: { "X-Subscription-Token": env.BRAVE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { warn("Brave search: rate limited, stopping"); break; }
      if (!r.ok) { warn(`Brave search "${city}": HTTP ${r.status}`); continue; }
      const f = fromBraveResults(await r.json(), city);
      out.candidates.push(...f.candidates); out.leads.push(...f.leads);
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
    const acc = wlib.addCandidate(wl, { handle: c.handle, found_via: c.found_via, found_from: c.found_from, notes: (c.evidence || "").slice(0, 160) }, now);
    if (acc) added.push(acc);
  }
  return added;
}

async function main() {
  const argv = process.argv.slice(2);
  setVerbose(argv.includes("--verbose"));
  const dry = argv.includes("--dry"), noFetch = argv.includes("--no-fetch");
  const now = new Date(), env = process.env;
  const fetcher = createFetcher({ noFetch });
  const wl = wlib.load();
  try { wlib.seedFromSources(JSON.parse(fs.readFileSync("data/sources.json", "utf8")), wl, now); } catch { /* no sources yet */ }

  const found = [], leads = [], counts = {};
  const take = (name, list) => { counts[name] = list.length; found.push(...list); };

  take("graph hashtags + mentions", fromGraphItems(await graph.discover({ env, fetcher })));
  take("inbox mentions", fromInbox());
  take("cache mentions", fromCache());
  const brave = await discoverBrave(env, now, { perRun: 10 });
  take("brave search", brave.candidates); leads.push(...brave.leads);
  for (const [name, fn] of [["ma.to", discoverMato], ["luma.com", discoverLuma]]) {
    if (noFetch) { counts[name] = 0; continue; }
    try { const r = await fn(fetcher); take(name, r.candidates); leads.push(...r.leads); } catch (e) { warn(`${name}: ${e.message}`); counts[name] = 0; }
  }

  const added = addAll(wl, found, now);
  for (const [k, v] of Object.entries(counts)) info(`${k.padEnd(26)} ${v} found`);
  info(`\n${added.length} new candidates (${wl.accounts.length} accounts on the list), ${leads.length} post leads`);
  for (const a of added.slice(0, 40)) info(`  + @${a.handle.padEnd(26)} ${a.found_via.padEnd(8)} ${String(a.found_from).slice(0, 60)}`);
  if (added.length > 40) info(`  ... and ${added.length - 40} more`);
  if (dry) { info("(dry run: nothing written)"); return; }
  wlib.save(wl, { now });
  if (leads.length) {
    const file = "data/discover-leads.json";
    let old = []; try { old = JSON.parse(fs.readFileSync(file, "utf8")).leads || []; } catch { /* first */ }
    const seen = new Set(old.map((l) => l.url));
    const all = old.concat(leads.filter((l) => !seen.has(l.url))).slice(-200);
    fs.writeFileSync(file, JSON.stringify({ updated: now.toISOString(), note: "Post URLs found without a usable handle. Paste the caption into data/inbox to read one.", leads: all }, null, 2) + "\n");
  }
  info("wrote data/watchlist.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error("discover crashed:", e); process.exit(1); });
}
