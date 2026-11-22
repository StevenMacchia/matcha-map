// TikTok and Instagram discovery through search snippets. We never open tiktok.com, instagram.com or facebook.com pages.
//
// How it works (rung 19, 2026-11-22):
//   search    Tavily Search API (POST https://api.tavily.com/search, Bearer TAVILY_API_KEY, search_depth basic = 1 credit),
//             include_domains ["tiktok.com","instagram.com"], time_range "month", max_results 20. Per run: 6 cities (rotating by the
//             6-hour slot) x 3 query shapes, plus 4 city-less hashtag-style queries = 40 credits. Local budget in
//             data/tavily-budget.json (120 credits per run, 900 per calendar month); when a cap is reached the crawler logs it and stops.
//   TikTok    a video result goes to TikTok's open oEmbed (https://www.tiktok.com/oembed?url=..., 1 request per second) for the full
//             caption, author_name, author_unique_id and thumbnail. The post time is decoded from the video id (id >> 32 is Unix seconds).
//   Instagram the snippet and title only (handle from the URL, the "(@handle)" in the title, or an @mention).
//   events    caption text goes through the normal extractor; kept only with a real calendar date, a city (named in the text, never
//             taken from a hashtag) and a start in the future. Confidence is "likely" at most, "unsure" without a time or an address
//             (capConfidence in index.js). Pseudo-sources tiktok:<author_unique_id> and instagram:<handle>, or the real source that owns the handle.
//   watch list every author or handle in a matcha pop-up result becomes a candidate (platform tiktok or instagram, found_via search,
//             found_from tavily). A TikTok account due on the watch cadence is re-checked by a Tavily query `"<handle>" matcha`
//             (include_domains ["tiktok.com"], 1 credit), never by opening tiktok.com (see recheckTiktok, called by ingest/watch.js).
import "../env.js";
import fs from "node:fs";
import { extract, findDates } from "../extract.js";
import { hasMatcha } from "../../adapters/mato.js";
import { httpUrl } from "../html.js";
import { UA } from "../fetch.js";
import { CITY_STATE, looksLikeHandle, slugify, skipped } from "./common.js";
import { info, warn, debug } from "../log.js";

export const name = "social-search";
export const host = "api.tavily.com";
export const BUDGET_FILE = "data/tavily-budget.json";
export const SEEN_FILE = ".cache/social-seen.json";
export const SEEN_DAYS = 14;
export const MAX_AGE_DAYS = 45;
export const CITIES_PER_RUN = 6;
export const SHAPES = ["matcha pop up {city}", "matcha popup {city} this weekend", "{city} matcha cart OR matcha stand"];
export const TAG_QUERIES = ["#matchapopup", "#matchapopups", "matcha pop up tour 2026", "matcha pop up december"];
const DAY = 86400000;

// ---- budget ----------------------------------------------------------------------------------
export function loadBudget(file = BUDGET_FILE, now = new Date()) {
  let b = {};
  try { b = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const month = new Date(now).toISOString().slice(0, 7);
  return { note: "Tavily credits counted locally (basic search = 1, advanced = 2). Free tier is about 1,000 a month.", per_run: 120, per_month: 900, ...b, month, used_month: b.month === month ? b.used_month || 0 : 0, used_run: 0 };
}
export function canSpend(b, cost = 1) {
  if (b.used_run + cost > b.per_run) return "per-run cap";
  if (b.used_month + cost > b.per_month) return "monthly cap";
  return null;
}
export function spend(b, cost = 1) { b.used_run += cost; b.used_month += cost; }
export function saveBudget(b, file = BUDGET_FILE, now = new Date()) {
  const { used_run, ...rest } = b;
  fs.writeFileSync(file, JSON.stringify({ ...rest, last_run_credits: used_run, updated: new Date(now).toISOString() }, null, 2) + "\n");
}

// ---- queries ---------------------------------------------------------------------------------
export function citiesForSlot(cities, now = new Date(), perRun = CITIES_PER_RUN) {
  if (!cities.length) return [];
  const slot = Math.floor(new Date(now).getTime() / (6 * 3600000));
  const start = (slot * perRun) % cities.length;
  return Array.from({ length: Math.min(perRun, cities.length) }, (_, i) => cities[(start + i) % cities.length]);
}
export function buildQueries(cities, now = new Date()) {
  const q = [];
  for (const city of citiesForSlot(cities, now)) SHAPES.forEach((s, i) => q.push({ q: s.replace("{city}", city), city, shape: i }));
  for (const t of TAG_QUERIES) q.push({ q: t, city: null, shape: "tag" });
  return q;
}

// ---- Tavily ----------------------------------------------------------------------------------
export async function tavilySearch(query, { key, domains = ["tiktok.com", "instagram.com"], http = fetch, max = 20 } = {}) {
  const r = await http("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "User-Agent": UA },
    body: JSON.stringify({ query, search_depth: "basic", max_results: max, include_domains: domains, time_range: "month", include_raw_content: false }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) { const e = new Error(`Tavily HTTP ${r.status}`); e.status = r.status; throw e; }
  const j = await r.json();
  return Array.isArray(j.results) ? j.results : [];
}

// ---- URLs ------------------------------------------------------------------------------------
const IG_RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about", "popular", "tags", "locations", "web", "legal", "developer", "directory", "challenge", "emails", "oauth", "api"]);

// A result URL -> {platform, kind: "video"|"post"|"profile"|"short", handle, id, url} | null. Never fetches anything.
export function parseSocialUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const h = u.hostname.replace(/^www\./, "").toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) {
    if (["vm.tiktok.com", "vt.tiktok.com"].includes(h) && seg[0]) return { platform: "tiktok", kind: "short", handle: null, id: null, url: `https://${h}/${seg[0]}` };
    if (seg[0] === "t" && seg[1]) return { platform: "tiktok", kind: "short", handle: null, id: null, url: `https://www.tiktok.com/t/${seg[1]}` };
    const m = /^@([A-Za-z0-9._]{2,40})$/.exec(seg[0] || "");
    if (!m) return null;
    if (seg[1] === "video" && /^\d{8,}$/.test(seg[2] || "")) return { platform: "tiktok", kind: "video", handle: m[1], id: seg[2], url: `https://www.tiktok.com/@${m[1]}/video/${seg[2]}` };
    return seg.length === 1 ? { platform: "tiktok", kind: "profile", handle: m[1], id: null, url: `https://www.tiktok.com/@${m[1]}` } : null;
  }
  if (h === "instagram.com") {
    if (!seg.length) return null;
    if (["p", "reel", "tv"].includes(seg[0]) && seg[1]) return { platform: "instagram", kind: "post", handle: null, id: seg[1], url: `https://www.instagram.com/${seg[0]}/${seg[1]}/` };
    if (IG_RESERVED.has(seg[0].toLowerCase()) || !/^[A-Za-z0-9._]+$/.test(seg[0])) return null;
    if (["p", "reel", "tv"].includes((seg[1] || "").toLowerCase()) && seg[2]) return { platform: "instagram", kind: "post", handle: seg[0], id: seg[2], url: `https://www.instagram.com/${seg[1].toLowerCase()}/${seg[2]}/` };
    return seg.length === 1 ? { platform: "instagram", kind: "profile", handle: seg[0], id: null, url: `https://www.instagram.com/${seg[0]}/` } : null;
  }
  return null;
}

// Unix time of a TikTok video from its id (the high 32 bits are seconds), as an ISO string; null when out of range.
export function tiktokTime(id) {
  try {
    const s = Number(BigInt(id) >> 32n);
    return s > 1.4e9 && s < 2.5e9 ? new Date(s * 1000).toISOString() : null;
  } catch { return null; }
}

// The Instagram handle behind a result: URL, "Name (@handle) ..." or "handle on Instagram:" in the title, else the first @mention in the snippet.
export function igHandle(parsed, title = "", content = "") {
  if (parsed?.handle) return parsed.handle;
  const t = String(title || "");
  const cands = [/\(@([A-Za-z0-9._]{3,30})\)/.exec(t)?.[1], /^([A-Za-z0-9._]{3,30}) on Instagram/i.exec(t)?.[1], /^@([A-Za-z0-9._]{3,30})\b/.exec(t)?.[1], /(?<![\w.@/+-])@([A-Za-z0-9][A-Za-z0-9._]{2,29})/.exec(String(content || ""))?.[1]];
  const h = cands.find((x) => x && looksLikeHandle(x.replace(/\.+$/, "")) && !IG_RESERVED.has(x.toLowerCase()));
  return h ? h.replace(/\.+$/, "") : null;
}

// ---- oEmbed ----------------------------------------------------------------------------------
// TikTok oEmbed JSON -> {caption, author, handle, image_url, id, url}. The embed html carries the canonical video id.
export function mapTiktokOembed(j) {
  if (!j || typeof j !== "object") return null;
  const id = /data-video-id="(\d+)"/.exec(j.html || "")?.[1] || (/^\d{8,}$/.test(String(j.embed_product_id || "")) ? String(j.embed_product_id) : null);
  const handle = j.author_unique_id || /tiktok\.com\/@([A-Za-z0-9._]+)/.exec(j.author_url || "")?.[1] || null;
  return { caption: String(j.title || "").trim(), author: j.author_name || null, handle, image_url: httpUrl(j.thumbnail_url), id, url: handle && id ? `https://www.tiktok.com/@${handle}/video/${id}` : null };
}
export async function tiktokOembed(url, { http = fetch } = {}) {
  try {
    const r = await http(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return mapTiktokOembed(await r.json());
  } catch (e) { debug("tiktok oembed failed", e.message); return null; }
}

// ---- noise -----------------------------------------------------------------------------------
const POPUP_WORD = /pop[\s-]?ups?\b|\bcart\b|\bstand\b|\bmarket\b|\bcollab|take[\s-]?over|\btour\b|\bevent\b|\bfestival\b|where to find/i;
const NOISE = /how to make|\brecipe\b|\breview\b|\branking\b|\btier list\b|best matcha in|taste test|\btrying\b|matcha haul|day in my life|\bgrwm\b|\bvs\.? |\bhomemade\b|\bunboxing\b/i;
const strip = (s) => String(s || "").replace(/#\w+/g, " ").replace(/\s+/g, " ").trim();
const cityRe = (c) => new RegExp(`\\b${c.replace(/\./g, "\\.")}\\b`, "i");
export const hasPlaceWord = (text) => Object.keys(CITY_STATE).some((c) => cityRe(c).test(text));
const dated = (t, ref) => findDates(t, { y: ref.getUTCFullYear(), mo: ref.getUTCMonth() + 1, d: ref.getUTCDate() }).some((g) => ["md", "dm", "num"].includes(g.kind));
// {drop, reason}: no matcha word; or a recipe/review/ranking-style post that does not also carry a date and a place.
export function noise(text, ref = new Date()) {
  const t = strip(text);
  if (!hasMatcha(t)) return { drop: true, reason: "no matcha" };
  if (NOISE.test(t) && !(dated(t, new Date(ref)) && (hasPlaceWord(t) || /\b\d{2,5}\s+[A-Z][a-z]+/.test(t)))) return { drop: true, reason: "recipe/review/ranking" };
  return { drop: false };
}
export const looksLikePopup = (text) => POPUP_WORD.test(strip(text));

// First known city named in the text (hashtags removed first, so a hashtag alone never gives a place).
export function cityIn(text) {
  const t = strip(text);
  let best = null;
  for (const c of Object.keys(CITY_STATE)) {
    const m = cityRe(c).exec(t);
    if (m && (!best || m.index < best.index)) best = { city: c, index: m.index };
  }
  return best ? { city: best.city, state: CITY_STATE[best.city] } : null;
}

// ---- results -> RawItems ---------------------------------------------------------------------
// Pseudo-source, or the real source that owns the handle. tiktok -> id tiktok:<handle>; instagram -> instagram:<handle>.
export function sourceFor(platform, handle, brand, place, sources = []) {
  const low = String(handle).toLowerCase();
  const known = (sources || []).find((s) => (s[platform] || "").toLowerCase() === low);
  if (known) return known;
  return {
    id: `${platform}:${slugify(handle).replace(/-/g, "_") || low}`, brand: brand || handle, home_city: place?.city || "", home_state: place?.state || "",
    website: null, instagram: platform === "instagram" ? handle : null, tiktok: platform === "tiktok" ? handle : null,
    schedule_url: null, schedule_kind: "manual", adapter: "manual", active: true, kind: "popup", category: "matcha",
  };
}

// One search result (+ optional TikTok oEmbed) -> {raw|null, reason, who|null}. who = {platform, handle, brand} for a matcha pop-up
// result (a watch-list candidate). raw is a RawItem with source_hint, returned only when the extractor finds a real, upcoming, placed event.
export function resultToItem(res, { oembed = null, now = new Date(), sources = [], query = "" } = {}) {
  const p = parseSocialUrl(res.url);
  if (!p) return { raw: null, reason: "url", who: null };
  const published = (p.id && p.platform === "tiktok" ? tiktokTime(p.id) : null) || (oembed?.id && tiktokTime(oembed.id)) || (res.published_date && !Number.isNaN(Date.parse(res.published_date)) ? new Date(res.published_date).toISOString() : null);
  if (published && now - Date.parse(published) > MAX_AGE_DAYS * DAY) return { raw: null, reason: "old", who: null };
  const text = [res.title, res.content, oembed?.caption].filter(Boolean).join(" \n ").replace(/\s+/g, " ").trim();
  const n = noise(text, now);
  if (n.drop) return { raw: null, reason: n.reason, who: null };
  const handle = oembed?.handle || (p.platform === "instagram" ? igHandle(p, res.title, res.content) : p.handle);
  const who = handle && looksLikePopup(text) ? { platform: p.platform, handle, brand: oembed?.author || handle } : null;
  if (!handle) return { raw: null, reason: "no handle", who };
  const place = cityIn(text);
  if (!place) return { raw: null, reason: "no city", who };
  const canonical = oembed?.url || p.url;
  const clean = strip(text);
  const raw = {
    source_url: canonical, text: clean, description: clean, // the caption is the brand's own words; the matcha-word keep rule (write.js keepMatoEvent) reads it
    published_at: published, handle: p.platform === "instagram" ? handle : undefined,
    image_url: oembed?.image_url || null, maxAheadDays: 150, posts: { [p.platform]: p.kind === "profile" ? null : canonical },
    hints: { city: place.city, state: place.state },
  };
  const source = sourceFor(p.platform, handle, oembed?.author || handle, place, sources);
  if (!dated(clean, new Date(published || now))) return { raw: null, reason: "no date", who };
  const cands = extract(raw, { source: { ...source, home_city: place.city, home_state: place.state }, now }).filter((c) => !c.cityInferred && c.start.slice(0, 10) >= new Date(now).toISOString().slice(0, 10));
  if (!cands.length) return { raw: null, reason: "no upcoming date", who };
  raw.source_hint = source;
  return { raw, reason: "ok", who };
}

// ---- the crawler -----------------------------------------------------------------------------
function loadSeen(now) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); } catch { /* none */ }
  for (const [u, t] of Object.entries(s)) if (now - Date.parse(t) > SEEN_DAYS * DAY) delete s[u];
  return s;
}
function saveSeen(s) { try { fs.mkdirSync(".cache", { recursive: true }); fs.writeFileSync(SEEN_FILE, JSON.stringify(s)); } catch { /* cache only */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set([401, 403, 429, 432, 433]);

export async function discover(ctx) {
  const env = ctx.env || process.env, now = new Date(ctx.now || Date.now());
  const key = env.TAVILY_API_KEY;
  if (!key) return skipped("no TAVILY_API_KEY (set it in .env)");
  const http = ctx.http || fetch, wait = ctx.wait || sleep;
  const cities = ctx.cities || Object.keys(CITY_STATE);
  const budget = loadBudget(ctx.budgetFile, now);
  const seen = ctx.noSeen ? {} : loadSeen(now);
  const stats = { credits: 0, queries: 0, byShape: {}, tiktok: 0, instagram: 0, oembedOk: 0, oembedUseful: 0, oembedFail: 0, noise: 0, events: 0, fetches: 0, pages: 0 };
  const results = new Map();
  let capHit = null;
  for (const q of buildQueries(cities, now)) {
    capHit = canSpend(budget, 1);
    if (capHit) { warn(`social-search: ${capHit} reached (${budget.used_run} credits this run, ${budget.used_month} this month); skipping the rest`); break; }
    let rs;
    try { rs = await tavilySearch(q.q, { key, http }); } catch (e) {
      if (STOP.has(e.status)) { warn(`social-search: ${e.message}, stopping`); stats.stopped = e.status; break; }
      warn(`social-search "${q.q}": ${e.message}`); continue;
    }
    spend(budget, 1); stats.queries++;
    stats.byShape[q.shape] = (stats.byShape[q.shape] || 0) + rs.length;
    for (const r of rs) {
      const p = r?.url ? parseSocialUrl(r.url) : null;
      if (!p) continue;
      stats[p.platform]++;
      const k = p.url.toLowerCase();
      if (seen[k] || results.has(k)) continue;
      results.set(k, { res: r, query: q.q, city: q.city, p });
    }
  }
  stats.credits = budget.used_run;
  const raws = [], who = new Map();
  let oembeds = 0;
  for (const [k, { res, query, city, p }] of results) {
    seen[k] = now.toISOString();
    let oe = null;
    if (p.platform === "tiktok" && (p.kind === "video" || p.kind === "short") && !noise(`${res.title} ${res.content}`, now).drop && oembeds < 150 && !(oembeds >= 8 && !stats.oembedUseful)) {
      oembeds++; stats.fetches++;
      oe = ctx.oembed ? await ctx.oembed(p.url) : await tiktokOembed(p.url, { http });
      oe ? stats.oembedOk++ : stats.oembedFail++;
      if (oe && (oe.caption || oe.author || oe.image_url)) stats.oembedUseful++;
      await wait(1000);
    }
    const r = resultToItem(res, { oembed: oe, now, sources: ctx.sources, query });
    if (r.reason === "no matcha" || r.reason === "recipe/review/ranking") stats.noise++;
    if (r.who) { const id = `${r.who.platform}:${r.who.handle.toLowerCase()}`; if (!who.has(id)) who.set(id, { ...r.who, query, city }); }
    if (r.raw) raws.push(r.raw);
  }
  stats.pages = stats.queries;
  saveSeen(seen);
  if (!ctx.noBudgetWrite) saveBudget(budget, ctx.budgetFile, now);
  const candidates = [...who.values()].map((w) => ({
    handle: w.handle, platform: w.platform, found_via: "search", found_from: "tavily", city: w.city || "",
    evidence: `q="${w.query}"${w.city ? `; city=${w.city}` : ""}`,
  }));
  stats.events = raws.length;
  info(`social-search: ${stats.credits} credits this run (${budget.used_month}/${budget.per_month} this month), ${stats.queries} queries, ${results.size} new results (tiktok ${stats.tiktok}, instagram ${stats.instagram} listed), oEmbed ${stats.oembedOk} answered (${stats.oembedUseful} with a caption, author or thumbnail) / ${stats.oembedFail} failed, ${raws.length} dated events, ${candidates.length} accounts`);
  return { items: raws, candidates, leads: [], stats: { ...stats, hitCap: !!capHit } };
}

// A TikTok account on the watch list, due for its check: one Tavily query `"<handle>" matcha` (1 credit), tiktok.com only.
// -> RawItems (with source_hint), or null when it could not run (no key, budget reached, error).
export async function recheckTiktok(acc, ctx = {}) {
  const env = ctx.env || process.env, now = new Date(ctx.now || Date.now());
  if (!env.TAVILY_API_KEY) return null;
  const budget = ctx.budget || loadBudget(ctx.budgetFile, now);
  const why = canSpend(budget, 1);
  if (why) { warn(`tiktok recheck @${acc.handle}: ${why} reached, skipped`); return null; }
  const http = ctx.http || fetch;
  let rs;
  try { rs = await tavilySearch(`"${acc.handle}" matcha`, { key: env.TAVILY_API_KEY, domains: ["tiktok.com"], http }); } catch (e) { warn(`tiktok recheck @${acc.handle}: ${e.message}`); return null; }
  spend(budget, 1);
  if (!ctx.budget) saveBudget(budget, ctx.budgetFile, now);
  const out = [];
  for (const res of rs) {
    const p = parseSocialUrl(res.url);
    if (!p || p.kind !== "video" || p.handle?.toLowerCase() !== String(acc.handle).toLowerCase()) continue;
    if (!hasMatcha(res.title, res.content)) continue;
    const oe = ctx.oembed ? await ctx.oembed(p.url) : await tiktokOembed(p.url, { http });
    if (!ctx.oembed) await (ctx.wait || sleep)(1000);
    const r = resultToItem(res, { oembed: oe, now, sources: ctx.sources || [], query: `"${acc.handle}" matcha` });
    if (r.raw) out.push(r.raw);
  }
  return out;
}

export default { name, host, discover };
