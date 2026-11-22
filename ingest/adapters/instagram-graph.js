// Instagram Graph API adapter. OFF until INSTAGRAM_TOKEN exists. No scraping, no cookies.
// The call it would make (Meta business_discovery, needs a connected Instagram business or
// creator account and a Meta app; INSTAGRAM_USER_ID is that account's id):
//   GET https://graph.facebook.com/v21.0/{INSTAGRAM_USER_ID}
//       ?fields=business_discovery.username({handle}){media.limit(12){caption,permalink,timestamp}}
//       &access_token={INSTAGRAM_TOKEN}
// Each media item with a caption becomes one RawItem (text = caption, published_at = timestamp).
import { UA } from "../lib/fetch.js";
import { warnOnce, debug } from "../lib/log.js";

export default {
  name: "instagram-graph",
  matches: (source) => !!source.instagram,
  async fetch(source, ctx) {
    const env = ctx.env || process.env;
    if (!env.INSTAGRAM_TOKEN) { warnOnce("ig", "instagram-graph off: no INSTAGRAM_TOKEN"); return []; }
    if (ctx.fetcher?.noFetch) return [];
    const uid = env.INSTAGRAM_USER_ID;
    if (!uid) { warnOnce("ig-uid", "instagram-graph off: no INSTAGRAM_USER_ID"); return []; }
    const fields = `business_discovery.username(${source.instagram}){media.limit(12){caption,permalink,timestamp}}`;
    const url = `https://graph.facebook.com/v21.0/${uid}?fields=${encodeURIComponent(fields)}&access_token=${env.INSTAGRAM_TOKEN}`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Graph API HTTP ${r.status}`);
    const j = await r.json();
    const media = j.business_discovery?.media?.data || [];
    debug("instagram media", source.instagram, media.length);
    return media.filter((m) => m.caption).map((m) => ({ source_url: m.permalink, text: m.caption, published_at: m.timestamp, handle: source.instagram }));
  },
};
