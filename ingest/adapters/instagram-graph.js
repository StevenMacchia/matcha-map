// Instagram Graph API adapter. OFF until INSTAGRAM_TOKEN and INSTAGRAM_BUSINESS_ID exist.
// Official API only: no scraping, no cookies, no headless browser, no scraper proxies.
//
// Endpoints (confirmed against Meta's docs, 2026-11-22; Graph API version in VERSION below):
//  1. Business Discovery, one public professional account's media:
//       GET https://graph.facebook.com/{VERSION}/{INSTAGRAM_BUSINESS_ID}
//           ?fields=business_discovery.username({handle}){media.limit(25){caption,permalink,timestamp,media_type}}
//           &access_token={INSTAGRAM_TOKEN}
//     Docs: instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
//     Permissions: instagram_basic, instagram_manage_insights, pages_read_engagement
//     (plus ads_management or ads_read if the Page role came through Business Manager).
//     Cursor paging (before/after). Age-gated accounts return nothing; personal accounts are not covered.
//     The docs page shows only count fields as examples and points to the IG Media reference for
//     caption, permalink, timestamp, media_type; those are the public media fields used here.
//  2. Hashtag search (id lookup):
//       GET /ig_hashtag_search?user_id={INSTAGRAM_BUSINESS_ID}&q={hashtag}
//     Feature: Instagram Public Content Access. Permission: instagram_basic
//     (plus pages_read_engagement or business_management for Business Manager roles).
//     Limit: 30 unique hashtags per rolling 7 days per account.
//  3. Hashtag media (read by ingest/lib/hashtags.js through hashtagId and hashtagEdge below):
//       GET /{hashtag-id}/recent_media | /{hashtag-id}/top_media
//           ?user_id={INSTAGRAM_BUSINESS_ID}&fields=caption,permalink,timestamp,media_type,media_url,thumbnail_url,children{...}&limit=50
//     recent_media: max 50 per page, only media from the last 24 hours. The `username` field
//     CANNOT be requested here, so owners are found by @mentions in the caption or later by hand.
//
// Rate limits: Business Discovery and Hashtag Search fall under Meta "Platform Rate Limits"
// (error codes 4 and 17), not the 4800-per-impression BUC limit. For app tokens the formula is
// 200 calls per hour x number of users, rolling. We keep our own conservative counter of
// 200 calls per hour in .cache/ig-rate.json and stop early. Error codes 4, 17 and 80002 also stop the run.
import fs from "node:fs";
import path from "node:path";
import { UA } from "../lib/fetch.js";
import { warnOnce, debug } from "../lib/log.js";

export const VERSION = "v21.0";
export const BASE = `https://graph.facebook.com/${VERSION}`;
export const HOURLY_LIMIT = 200;
export const HASHTAG_LIMIT = 30;
// One watch run spends at most this many calls (hashtags first, then accounts), less what the rolling hour already used:
// the last 20 of the hour's 200 are left for hand runs.
export const runAllowance = (usedThisHour = 0) => Math.max(0, HOURLY_LIMIT - 20 - usedThisHour);
const HOUR = 3600000, WEEK = 7 * 86400000;
export const OFF_LINE = "Instagram Graph: off (set INSTAGRAM_TOKEN and INSTAGRAM_BUSINESS_ID; see docs/INSTAGRAM-SETUP.md)";

export function creds(env = process.env) {
  const token = env.INSTAGRAM_TOKEN, id = env.INSTAGRAM_BUSINESS_ID || env.INSTAGRAM_USER_ID;
  return token && id ? { token, id } : null;
}

// ---- rate counter ---------------------------------------------------------------------------
export function createRate({ file = ".cache/ig-rate.json", now = () => Date.now() } = {}) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
  const write = (o) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(o)); } catch { /* cache only */ } };
  return {
    used() { return (read().calls || []).filter((t) => now() - t < HOUR).length; },
    // Take one call from the budget. false = budget spent (caller stops).
    take() {
      const o = read();
      const calls = (o.calls || []).filter((t) => now() - t < HOUR);
      if (calls.length >= HOURLY_LIMIT) return false;
      calls.push(now());
      write({ ...o, calls });
      return true;
    },
    // True if one more unique hashtag fits in the 7-day window (or this one is already counted).
    hashtagOk(tag) {
      const h = read().hashtags || {};
      const live = Object.entries(h).filter(([, t]) => now() - t < WEEK);
      return live.some(([k]) => k === tag) || live.length < HASHTAG_LIMIT;
    },
    // The tags counted in the last 7 days, and how many new unique ones still fit.
    hashtagsCounted() { return Object.entries(read().hashtags || {}).filter(([, t]) => now() - t < WEEK).map(([k]) => k); },
    hashtagFree() { return Math.max(0, HASHTAG_LIMIT - this.hashtagsCounted().length); },
    hashtagUsed(tag) {
      const o = read();
      const h = Object.fromEntries(Object.entries(o.hashtags || {}).filter(([, t]) => now() - t < WEEK));
      if (!(tag in h)) h[tag] = now();
      write({ ...o, hashtags: h });
    },
  };
}

// ---- response shapes -> RawItems --------------------------------------------------------------
export const shortcodeOf = (permalink) => /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(permalink || "")?.[1] || null;

// The picture to show: a video's thumbnail, a photo's own url, or the first photo of a carousel.
const imageOf = (m) => m.thumbnail_url || (m.media_type !== "VIDEO" ? m.media_url : null) || (m.children?.data || []).find((c) => c.media_type === "IMAGE" && c.media_url)?.media_url || null;

// business_discovery response -> RawItem[] (captioned media only).
export function mapBusinessDiscovery(json, handle) {
  const media = json?.business_discovery?.media?.data || [];
  return media.filter((m) => m.caption && m.permalink).map((m) => ({
    source_url: m.permalink, text: m.caption, published_at: m.timestamp, handle, media_type: m.media_type || null,
    image_url: imageOf(m), posts: { instagram: m.permalink },
  }));
}

// business_discovery response -> the account's own facts (name, site, picture, followers), or null.
export function mapAccountFacts(json) {
  const b = json?.business_discovery;
  if (!b) return null;
  const recent = recentPosts(b.media?.data);
  return { name: b.name || null, website: b.website || null, profile_picture_url: b.profile_picture_url || null, followers_count: Number.isFinite(b.followers_count) ? b.followers_count : null, biography: b.biography || null, ...(recent.length ? { recent } : {}) };
}

// The newest three posts that have a picture: {permalink, image_url, timestamp, caption (first 80 chars)}. Urls only, nothing downloaded.
export function recentPosts(media) {
  return (media || []).map((m) => ({ permalink: m.permalink, image_url: imageOf(m), timestamp: m.timestamp || null, caption: String(m.caption || "").replace(/\s+/g, " ").trim().slice(0, 80) }))
    .filter((m) => m.permalink && m.image_url)
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))).slice(0, 3);
}

// Hashtag edge response -> RawItem[]. handle is null unless the API returned a username.
export function mapHashtagMedia(json, tag, edge = "recent_media") {
  return (json?.data || []).filter((m) => m.permalink).map((m) => ({
    source_url: m.permalink, text: m.caption || "", published_at: m.timestamp, handle: m.username || null,
    media_type: m.media_type || null, image_url: imageOf(m), posts: { instagram: m.permalink }, shortcode: shortcodeOf(m.permalink), hashtag: tag, edge,
  }));
}

// ---- HTTP ------------------------------------------------------------------------------------
export class Stop extends Error {}
export async function graph(url, rate, http) {
  if (!rate.take()) throw new Stop(`Instagram Graph: stopped early, ${HOURLY_LIMIT} calls this hour used (counter in .cache/ig-rate.json)`);
  const r = await http(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    if ([4, 17, 80002].includes(e.code)) throw new Stop(`Instagram Graph: Meta rate limit (code ${e.code}); stopping`);
    const err = new Error(`Graph API HTTP ${r.status}${e.message ? `: ${e.message}` : ""}`);
    err.code = e.code;
    err.api = r.status < 500; // Meta answered and said no (personal account, renamed, deleted): not a network blip
    throw err;
  }
  return j;
}

// Hashtag id lookup: one call per tag, cached by the caller (data/hashtags.json ids). -> id or null.
export async function hashtagId(tag, c, rate, http = fetch) {
  const s = await graph(`${BASE}/ig_hashtag_search?user_id=${c.id}&q=${encodeURIComponent(tag)}&access_token=${c.token}`, rate, http);
  return s.data?.[0]?.id || null;
}

// One hashtag edge (recent_media or top_media), up to `pages` pages while a page comes back full and has a next cursor.
// `room()` is asked before every call so the caller's per-run budget holds; it returns false to stop.
// Hashtag media supports fewer fields than a user's media: no thumbnail_url, and children only as ids. Asking for either
// fails the whole call with "(#100) Please read documentation for supported fields" (seen live 2026-11-22).
export const HASHTAG_FIELDS = "caption,permalink,timestamp,media_type,media_url";
export async function hashtagEdge(hid, edge, c, rate, { http = fetch, pages = 1, room = () => true } = {}) {
  const out = [];
  let url = `${BASE}/${hid}/${edge}?user_id=${c.id}&fields=${encodeURIComponent(HASHTAG_FIELDS)}&limit=50&access_token=${c.token}`;
  for (let n = 0; n < pages && url && room(); n++) {
    const j = await graph(url, rate, http);
    out.push(...(j.data || []));
    url = j.paging?.next && (j.data || []).length >= 50 ? j.paging.next : null;
  }
  return out;
}

export default {
  name: "instagram-graph",
  matches: (source) => !!source.instagram,

  // fetch(source, ctx) -> RawItem[]: last 25 media of a public professional account.
  async fetch(source, ctx) {
    const c = creds(ctx.env || process.env);
    if (!c) { warnOnce("ig", OFF_LINE); return []; }
    if (ctx.fetcher?.noFetch) return [];
    const rate = ctx.rate || createRate();
    const fields = `business_discovery.username(${source.instagram}){name,profile_picture_url,website,biography,followers_count,media.limit(25){caption,permalink,timestamp,media_type,media_url,thumbnail_url}}`;
    const url = `${BASE}/${c.id}?fields=${encodeURIComponent(fields)}&access_token=${c.token}`;
    try {
      const j = await graph(url, rate, ctx.http || fetch);
      const items = mapBusinessDiscovery(j, source.instagram);
      items.facts = mapAccountFacts(j);
      debug("instagram media", source.instagram, items.length);
      return items;
    } catch (e) {
      if (e instanceof Stop) { ctx.rateStopped = true; warnOnce("ig-stop", e.message); return []; }
      throw e;
    }
  },
};
