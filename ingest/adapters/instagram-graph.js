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
//  3. Hashtag media:
//       GET /{hashtag-id}/recent_media | /{hashtag-id}/top_media
//           ?user_id={INSTAGRAM_BUSINESS_ID}&fields=caption,permalink,timestamp,media_type&limit=50
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
import { warnOnce, warn, debug } from "../lib/log.js";

export const VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;
export const HOURLY_LIMIT = 200;
export const HASHTAG_LIMIT = 30;
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

// business_discovery response -> RawItem[] (captioned media only).
export function mapBusinessDiscovery(json, handle) {
  const media = json?.business_discovery?.media?.data || [];
  return media.filter((m) => m.caption && m.permalink).map((m) => ({
    source_url: m.permalink, text: m.caption, published_at: m.timestamp, handle, media_type: m.media_type || null,
  }));
}

// Hashtag edge response -> RawItem[]. handle is null unless the API returned a username.
export function mapHashtagMedia(json, tag, edge = "recent_media") {
  return (json?.data || []).filter((m) => m.permalink).map((m) => ({
    source_url: m.permalink, text: m.caption || "", published_at: m.timestamp, handle: m.username || null,
    media_type: m.media_type || null, shortcode: shortcodeOf(m.permalink), hashtag: tag, edge,
  }));
}

// ---- HTTP ------------------------------------------------------------------------------------
class Stop extends Error {}
async function graph(url, rate, http) {
  if (!rate.take()) throw new Stop(`Instagram Graph: stopped early, ${HOURLY_LIMIT} calls this hour used (counter in .cache/ig-rate.json)`);
  const r = await http(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    if ([4, 17, 80002].includes(e.code)) throw new Stop(`Instagram Graph: Meta rate limit (code ${e.code}); stopping`);
    const err = new Error(`Graph API HTTP ${r.status}${e.message ? `: ${e.message}` : ""}`);
    err.code = e.code;
    throw err;
  }
  return j;
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
    const fields = `business_discovery.username(${source.instagram}){media.limit(25){caption,permalink,timestamp,media_type}}`;
    const url = `${BASE}/${c.id}?fields=${encodeURIComponent(fields)}&access_token=${c.token}`;
    try {
      const j = await graph(url, rate, ctx.http || fetch);
      const items = mapBusinessDiscovery(j, source.instagram);
      debug("instagram media", source.instagram, items.length);
      return items;
    } catch (e) {
      if (e instanceof Stop) { warnOnce("ig-stop", e.message); return []; }
      throw e;
    }
  },

  // discover(ctx) -> RawItem[] from the hashtags in data/hashtags.json (recent_media + top_media).
  async discover(ctx) {
    const c = creds(ctx.env || process.env);
    if (!c) { warnOnce("ig", OFF_LINE); return []; }
    if (ctx.fetcher?.noFetch) return [];
    const rate = ctx.rate || createRate();
    const http = ctx.http || fetch;
    let tags = [];
    try { tags = JSON.parse(fs.readFileSync(ctx.hashtagsFile || "data/hashtags.json", "utf8")).hashtags || []; } catch { warn("data/hashtags.json missing or invalid"); }
    const out = [];
    for (const tag of tags) {
      if (!rate.hashtagOk(tag)) { warn(`Instagram Graph: skipping #${tag}, 30 unique hashtags per 7 days reached`); continue; }
      try {
        const s = await graph(`${BASE}/ig_hashtag_search?user_id=${c.id}&q=${encodeURIComponent(tag)}&access_token=${c.token}`, rate, http);
        const hid = s.data?.[0]?.id;
        rate.hashtagUsed(tag);
        if (!hid) continue;
        for (const edge of ["recent_media", "top_media"]) {
          const j = await graph(`${BASE}/${hid}/${edge}?user_id=${c.id}&fields=caption,permalink,timestamp,media_type&limit=50&access_token=${c.token}`, rate, http);
          out.push(...mapHashtagMedia(j, tag, edge));
        }
      } catch (e) {
        if (e instanceof Stop) { warn(e.message); break; }
        warn(`#${tag}: ${e.message}`);
      }
    }
    return out;
  },
};
