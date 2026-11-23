// Reddit: posts about matcha pop-ups in r/matcha, r/tea and the subreddits of the 40 biggest metros (metros.js).
//
// robots.txt (checked 2026-11-22): www.reddit.com answers "User-agent: *  Disallow: /", so the public .json pages
// (www.reddit.com/r/<sub>/search.json?q=matcha+popup&restrict_sr=1&sort=new&t=month) are NOT read: the gate skips the site.
// The official route is Reddit's Data API with an app-only OAuth token: set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a free
// "script" app at reddit.com/prefs/apps; 100 queries a minute). Then the same search runs on oauth.reddit.com/r/<sub>/search.
// Either way: User-Agent `matcha-map/0.1 (+https://matchamap-cu7.pages.dev)`, one request every 2 s, an HTTP 429 stops the run.
// A post is kept when its title + selftext name matcha and a pop-up word, it is under 45 days old, and the extractor finds a future
// date and a US place (a city sub supplies its city when the text names none). A post that links an Instagram, TikTok or
// Eventbrite URL also yields a lead with that URL. Pseudo-source `reddit:<brand slug>`; confidence capped at likely, and unsure
// when no brand could be read (the review folder holds those for a human).
import { siteBudget, gate, finish, skipped, slugify, CAP } from "./common.js";
import { matchaPopup, usable, tagKinds } from "./textfind.js";
import { cityFromText } from "./bluesky.js";
import { brandFromTitle } from "./feeds.js";
import { METROS, rotate, metroOfSub } from "./metros.js";

export const name = "reddit";
export const host = "www.reddit.com";
export const UA = "matcha-map/0.1 (+https://matchamap-cu7.pages.dev)";
export const GLOBAL_SUBS = ["matcha", "tea"];
export const SUBS = [...GLOBAL_SUBS, ...METROS.map((m) => m.sub)];
export const QUERY = "matcha popup";
const GAP_MS = 2000, MAX_AGE_DAYS = 45, CITY_SUBS_PER_RUN = 10;
const LEAD = /^https?:\/\/(?:www\.)?(?:instagram\.com|tiktok\.com|(?:www\.)?eventbrite\.com)\//i;

export const searchPath = (sub, q = QUERY) => `/r/${sub}/search${"?"}q=${encodeURIComponent(q).replace(/%20/g, "+")}&restrict_sr=1&sort=new&t=month&raw_json=1`;
const MENTION = /(?<![\w.@])@([A-Za-z0-9._]{3,30})/;

// One listing (search.json or the OAuth search) -> {raws, leads}. Pure.
export function postsToRaw(json, sub, now = new Date()) {
  const raws = [], leads = [];
  const metro = metroOfSub(sub);
  for (const ch of json?.data?.children || []) {
    const p = ch?.data || {};
    const title = String(p.title || "").trim(), self = String(p.selftext || "").trim();
    if (!title || !p.permalink || !matchaPopup(title, self)) continue;
    const t = (p.created_utc || 0) * 1000;
    if (!t || now.getTime() - t > MAX_AGE_DAYS * 86400000) continue;
    const url = `https://www.reddit.com${p.permalink}`;
    const link = typeof p.url === "string" && /^https?:\/\//.test(p.url) && !p.url.includes("reddit.com") ? p.url : null;
    const inText = (self.match(/https?:\/\/[^\s)\]]+/g) || []).filter((u) => LEAD.test(u));
    for (const u of [link, ...inText].filter((u) => u && LEAD.test(u))) leads.push({ url: u, found_via: "search", found_from: `reddit r/${sub}`, evidence: title.slice(0, 200) });
    const text = `${title}. ${self}${link ? ` ${link}` : ""}`.replace(/\s+/g, " ").slice(0, 3000);
    const handle = MENTION.exec(text)?.[1] || null;
    const brand = brandFromTitle(title) || (handle ? handle : null);
    const place = cityFromText(text) || (metro ? { city: metro.city, state: metro.state } : null);
    raws.push({
      source_url: url, text, description: self ? self.slice(0, 400) : null, image_url: null, published_at: new Date(t).toISOString(), maxAheadDays: 120,
      organizer: { name: brand || `r/${sub} post`, url: null }, hints: place ? { city: place.city, state: place.state } : {},
      evidence: [url, link, ...inText].filter(Boolean), reddit: { sub, brand: !!brand, handle },
    });
  }
  return { raws, leads };
}

// App-only OAuth token (client_credentials). -> token|null
export async function appToken(env, http = fetch) {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return null;
  const auth = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64");
  const r = await http("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { Authorization: `Basic ${auth}`, "User-Agent": UA, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  return (await r.json())?.access_token || null;
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, env = {}, http = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  let base = `https://${host}`, headers = { "User-Agent": UA }, robots = true;
  if (!g.ok) {
    const token = env.REDDIT_CLIENT_ID ? await appToken(env, http).catch(() => null) : null;
    if (!token) return skipped(`${g.reason}; set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for the official API`, { fetches: b.st.used });
    base = "https://oauth.reddit.com"; headers = { ...headers, Authorization: `bearer ${token}` }; robots = false;
  }
  const subs = [...GLOBAL_SUBS, ...rotate(METROS, now, ctx.perRun ?? CITY_SUBS_PER_RUN, { salt: 1 }).map((m) => m.sub)];
  const stats = { subs: 0, posts: 0, popupPosts: 0, kept: 0, via: robots ? "public json" : "oauth api" };
  const raws = [], leads = [], seen = new Set();
  for (const sub of subs) {
    if (b.st.stopped || b.left() <= 0) break;
    const path = searchPath(sub).replace("/search?", robots ? "/search.json?" : "/search?");
    const r = await b.get(base + path, { headers, robots });
    if (!r.fromCache) await wait(GAP_MS);
    if (!r.ok) continue;
    let j; try { j = JSON.parse(r.text); } catch { continue; }
    stats.subs++;
    stats.posts += (j?.data?.children || []).length;
    const got = postsToRaw(j, sub, now);
    leads.push(...got.leads);
    for (const raw of got.raws) {
      if (seen.has(raw.source_url)) continue;
      seen.add(raw.source_url);
      stats.popupPosts++;
      const src = { id: `${name}:${slugify(raw.organizer.name)}`, brand: raw.organizer.name, home_city: raw.hints.city || "", home_state: raw.hints.state || "" };
      if (!usable(raw, src, now)) continue;
      raws.push(raw);
      stats.kept++;
    }
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  // "r/<sub> post" is a placeholder organizer, not an account: no watch-list candidate for it.
  return { ...out, candidates: out.candidates.filter((c) => !/^r_/.test(c.handle)), leads, stats: { ...stats, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
