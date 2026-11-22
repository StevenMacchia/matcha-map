// oEmbed for ONE pasted public post URL. Only the manual path calls this; it never crawls.
// TikTok: GET https://www.tiktok.com/oembed?url=<post url> (open) -> {title, author_name, author_unique_id}.
// Instagram: GET https://graph.facebook.com/v21.0/instagram_oembed?url=<post url>&access_token=<token>
//   needs a Meta app token in INSTAGRAM_OEMBED_TOKEN; off without it.
import { UA } from "../lib/fetch.js";
import { httpUrl } from "../lib/html.js";
import { debug, warnOnce } from "../lib/log.js";

// Returns { text, handle, image_url } or null.
export async function oembed(url, { env = process.env, fetchFn = fetch } = {}) {
  if (!url) return null;
  let host;
  try { host = new URL(url).host.replace(/^www\./, ""); } catch { return null; }
  try {
    if (host.endsWith("tiktok.com")) {
      const r = await fetchFn(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const j = await r.json();
      return { text: j.title || "", handle: j.author_unique_id || null, image_url: httpUrl(j.thumbnail_url) };
    }
    if (host.endsWith("instagram.com")) {
      if (!env.INSTAGRAM_OEMBED_TOKEN) { warnOnce("ig-oembed", "off: no INSTAGRAM_OEMBED_TOKEN (paste the caption instead)"); return null; }
      const r = await fetchFn(`https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${env.INSTAGRAM_OEMBED_TOKEN}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const j = await r.json();
      return { text: String(j.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), handle: j.author_name || null, image_url: httpUrl(j.thumbnail_url) };
    }
  } catch (e) { debug("oembed failed", e.message); }
  return null;
}

export default { name: "oembed", matches: () => false, async fetch() { return []; } };
