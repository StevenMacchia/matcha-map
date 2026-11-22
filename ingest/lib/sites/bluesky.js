// Bluesky public search: posts about matcha pop-ups from Bluesky's open AppView API, no key and no login.
//
// Endpoint (checked 2026-11-22): GET https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=<query>&limit=100&sort=latest
//   The same call on public.api.bsky.app (the cached host) answers HTTP 403 for search today, so the official AppView host
//   api.bsky.app is used; its robots.txt is "User-agent: * Allow: /" and says up to a handful of concurrent requests is fine
//   (we send one at a time, 1 per second). A 403 or 429 stops the run for this site.
//   Post fields used: uri (rkey for the bsky.app url), author.handle, author.displayName, record.text, record.createdAt,
//   embed.images[].fullsize or embed.external.thumb. Four queries: "matcha pop up", "#matchapopup", "matcha popup", "matcha cart".
// A post is kept when it has a matcha word and a pop-up word, is under 45 days old, and the extractor finds a future date in it
// and a US place (a street address, "City, ST", or a known city name such as Brooklyn, NYC, LA). published_at = createdAt, so
// "this Saturday" resolves against the day of the post. Pseudo-source `bluesky:<handle>`, brand = the display name (else the
// handle), kind popup, category matcha; posts.other = the bsky.app post URL. Volume is low and that is expected.
import { siteBudget, gate, finish, CAP, CITY_STATE } from "./common.js";
import { matchaPopup, usable, tagKinds } from "./textfind.js";
import { slugify } from "./common.js";

export const name = "bluesky";
export const host = "api.bsky.app";

export const QUERIES = ["matcha pop up", "#matchapopup", "matcha popup", "matcha cart"];
export const searchUrl = (q) => `https://${host}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=100&sort=latest`;
const MAX_AGE_DAYS = 45;
const ALIASES = { NYC: ["New York", "NY"], LA: ["Los Angeles", "CA"], SF: ["San Francisco", "CA"], DC: ["Washington", "DC"], ATX: ["Austin", "TX"], PDX: ["Portland", "OR"], CHI: ["Chicago", "IL"], "San Fran": ["San Francisco", "CA"], "D.C.": ["Washington", "DC"] };
const STATE_NAMES = { California: "CA", "New York": "NY", Texas: "TX", Washington: "WA", Florida: "FL", Illinois: "IL", Georgia: "GA", Oregon: "OR", Colorado: "CO", Massachusetts: "MA", Pennsylvania: "PA", "North Carolina": "NC" };

// "…in Brooklyn…" / "NYC" / "Austin, TX" -> {city, state} or null. Case-sensitive for the short aliases.
export function cityFromText(text) {
  const t = String(text || "");
  const cs = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*([A-Z]{2})\b/.exec(t);
  if (cs && Object.values(CITY_STATE).includes(cs[2])) return { city: cs[1], state: cs[2] };
  for (const [k, [c, s]] of Object.entries(ALIASES)) if (new RegExp(`(?<![A-Za-z])${k.replace(/\./g, "\\.")}(?![A-Za-z])`).test(t)) return { city: c, state: s };
  for (const [c, s] of Object.entries(CITY_STATE)) if (c !== "Washington DC" && new RegExp(`\\b${c.replace(/\./g, "\\.")}\\b`).test(t)) return { city: c, state: s };
  void STATE_NAMES;
  return null;
}

// One searchPosts response -> [RawItem] (not yet checked for a date: discover() does that with usable()).
export function postsToRaw(json, now = new Date()) {
  const out = [];
  for (const p of json?.posts || []) {
    const text = String(p.record?.text || "").replace(/\s+/g, " ").trim();
    const handle = p.author?.handle;
    const rkey = String(p.uri || "").split("/").pop();
    if (!text || !handle || !rkey || !matchaPopup(text)) continue;
    const created = p.record?.createdAt || p.indexedAt;
    const t = Date.parse(created || "");
    if (!Number.isFinite(t) || now.getTime() - t > MAX_AGE_DAYS * 86400000) continue;
    const img = p.embed?.images?.[0]?.fullsize || p.embed?.external?.thumb || p.embed?.media?.images?.[0]?.fullsize || null;
    out.push({
      source_url: `https://bsky.app/profile/${handle}/post/${rkey}`, text, description: null, image_url: /^https?:\/\//.test(img || "") ? img : null,
      published_at: new Date(t).toISOString(), maxAheadDays: 120, tags: null,
      organizer: { name: String(p.author?.displayName || "").trim() || handle, url: `https://bsky.app/profile/${handle}` },
      hints: {}, bsky: { handle },
    });
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, queries = QUERIES } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  const stats = { queries: 0, posts: 0, popupPosts: 0, kept: 0 };
  if (!g.ok) return { items: [], candidates: [], stats: { skipped: g.reason, fetches: b.st.used, pages: 0 } };
  const seen = new Set(), raws = [];
  for (const q of queries) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(searchUrl(q));
    if (!r.ok) continue;
    stats.queries++;
    let j; try { j = JSON.parse(r.text); } catch { continue; }
    stats.posts += (j.posts || []).length;
    for (const raw of postsToRaw(j, now)) {
      if (seen.has(raw.source_url)) continue;
      seen.add(raw.source_url);
      stats.popupPosts++;
      const place = cityFromText(raw.text);
      if (place) raw.hints = { city: place.city, state: place.state };
      const src = { id: `${name}:${slugify(raw.bsky.handle)}`, brand: raw.organizer.name, home_city: place?.city || "", home_state: place?.state || "" };
      if (!usable(raw, src, now)) continue;
      raws.push(raw);
      stats.kept++;
    }
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  // The pseudo-source id is the handle, not the display name (finish() slugs the organizer name).
  for (const r of out.items) { r.source_hint.id = `${name}:${slugify(r.bsky.handle)}`; r.source_hint.brand = r.organizer.name; }
  for (const c of out.candidates) c.found_from = name;
  return { ...out, stats: { ...stats, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
