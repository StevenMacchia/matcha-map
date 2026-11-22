// TikTok Display API adapter. OFF until TIKTOK_KEY exists. No scraping, no cookies.
// The call it would make (needs an approved TikTok app and the account owner's OAuth
// access token, which TIKTOK_KEY holds; the Display API lists the AUTHORIZED user's videos):
//   POST https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url
//   Authorization: Bearer {TIKTOK_KEY}      body: {"max_count": 12}
// Each video with a title becomes one RawItem (text = title, published_at = create_time).
import { UA } from "../lib/fetch.js";
import { warnOnce } from "../lib/log.js";

export default {
  name: "tiktok",
  matches: (source) => !!source.tiktok,
  async fetch(source, ctx) {
    const env = ctx.env || process.env;
    if (!env.TIKTOK_KEY) { warnOnce("tt", "tiktok off: no TIKTOK_KEY"); return []; }
    if (ctx.fetcher?.noFetch) return [];
    const r = await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,cover_image_url", {
      method: "POST",
      headers: { "User-Agent": UA, Authorization: `Bearer ${env.TIKTOK_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ max_count: 12 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Display API HTTP ${r.status}`);
    const j = await r.json();
    const vids = j.data?.videos || [];
    return vids.filter((v) => v.title).map((v) => ({ source_url: v.share_url, text: v.title, published_at: new Date(v.create_time * 1000).toISOString(), handle: source.tiktok, image_url: v.cover_image_url || null, posts: { tiktok: v.share_url } }));
  },
};
