// News search for matcha pop-up stories, then the local-press articles themselves.
//
// Google News RSS (https://news.google.com/rss/search?q=%22matcha%22+%22pop-up%22+when:30d&hl=en-US&gl=US&ceid=US:en, and per-city
// variants): news.google.com/robots.txt is "User-agent: *  Disallow: /" with Allow lines only for /, /home, /topics/, /publications/,
// /stories/ (checked 2026-11-22), so /rss/search is disallowed and is NOT read; the module checks the path against robots.txt on
// every run and starts using it if that ever changes. Bing News RSS is not used either: its feed carries a personal,
// non-commercial-use-only notice.
// What runs instead: the GDELT DOC 2.0 API (api.gdeltproject.org, open, no key, no robots.txt; it asks for one request every 5 s,
// which this module keeps, and a "Please limit requests" reply ends the run). One national query plus `CITIES_PER_RUN` of the 40
// metros (metros.js, rotating every 6 h). Article URLs from it are followed when they look like local press (not a portal,
// aggregator or social host), through the shared fetcher (robots.txt, 1 req/s/host, cache), at most `ARTICLES_PER_RUN` a run.
// The article's matcha paragraphs go to the extractor; it must find a future date and a US place, and the brand must come from the
// headline (feeds.js brandFromTitle) or an @mention: no event is made from a story that names no one. Pseudo-source
// `gnews:<brand slug>`, confidence capped at likely.
import { parseRobots, robotsAllows } from "../fetch.js";
import { parseFeed } from "../feed-xml.js";
import { htmlToLines, metaContent } from "../html.js";
import { siteBudget, gate, finish, slugify, CAP } from "./common.js";
import { matchaPopup, usable, tagKinds } from "./textfind.js";
import { cityFromText } from "./bluesky.js";
import { brandFromTitle } from "./feeds.js";
import { hasMatcha } from "../../adapters/mato.js";
import { METROS, rotate } from "./metros.js";

export const name = "gnews";
export const host = "news.google.com";
export const GDELT = "api.gdeltproject.org";
const CITIES_PER_RUN = 4, ARTICLES_PER_RUN = 25, GDELT_GAP_MS = 5500, MAX_AGE_DAYS = 45;
// Not local press: portals, aggregators, social and video hosts, and the sites other crawlers already read.
export const NOT_PRESS = /(^|\.)(google|bing|yahoo|msn|aol|apple|newsbreak|ground\.news|flipboard|smartnews|youtube|facebook|instagram|tiktok|twitter|x|reddit|pinterest|linkedin|eventbrite|allevents|luma|meetup|amazon|etsy)\.[a-z.]+$/i;

export const googleUrl = (city = null) => `https://${host}/rss/search?q=${encodeURIComponent(`"matcha" "pop-up"${city ? ` "${city}"` : ""} when:30d`).replace(/%20/g, "+")}&hl=en-US&gl=US&ceid=US:en`;
export const gdeltUrl = (city = null) => `https://${GDELT}/api/v2/doc/doc?query=${encodeURIComponent(`matcha (pop-up OR popup OR "pop up")${city ? ` "${city}"` : ""} sourcecountry:US sourcelang:english`)}&mode=artlist&format=json&maxrecords=75&timespan=30d&sort=datedesc`;

// GDELT "20261120T153000Z" -> ISO.
const gdeltDate = (s) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || "")); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null; };

// GDELT artlist JSON or a news RSS feed -> [{url, title, published}] whose title names matcha. Pure.
export function articleList(text) {
  let rows = [];
  try { rows = (JSON.parse(text).articles || []).map((a) => ({ url: a.url, title: a.title, published: gdeltDate(a.seendate) })); }
  catch { rows = parseFeed(text).items.map((i) => ({ url: i.link, title: i.title, published: i.published })); }
  return rows.filter((a) => /^https?:\/\//.test(a.url || "") && hasMatcha(a.title));
}

export const looksLocal = (url) => { try { return !NOT_PRESS.test(new URL(url).hostname); } catch { return false; } };

// An article page -> RawItem or null: the headline and the paragraphs that name matcha (plus the one after each). Pure.
export function articleToRaw(html, a, now = new Date()) {
  const lines = htmlToLines(html);
  const keep = [];
  const head = String(a.title || "").trim();
  lines.forEach((l, i) => { if (hasMatcha(l) && l.length > 30 && l.trim() !== head) keep.push(l, lines[i + 1] || ""); });
  const body = [...new Set(keep)].join(" ").replace(/\s+/g, " ").slice(0, 3000);
  const title = a.title || metaContent(html, "og:title") || "";
  if (!matchaPopup(title, body)) return null;
  const t = Date.parse(a.published || "");
  if (Number.isFinite(t) && now.getTime() - t > MAX_AGE_DAYS * 86400000) return null;
  const mention = /(?<![\w.@])@([A-Za-z0-9._]{3,30})/.exec(body)?.[1] || null;
  const brand = brandFromTitle(title) || mention;
  if (!brand) return null;
  const place = cityFromText(`${title} ${body}`);
  return {
    source_url: a.url, text: `${title}. ${body}`, description: metaContent(html, "og:description") || null, image_url: metaContent(html, "og:image") || null,
    published_at: Number.isFinite(t) ? new Date(t).toISOString() : null, maxAheadDays: 120, organizer: { name: brand, url: null },
    hints: place ? { city: place.city, state: place.state } : {}, handle: mention, evidence: [a.url],
  };
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const stats = { google: "unread", queries: 0, articlesListed: 0, articlesRead: 0, kept: 0, skippedHosts: [] };
  const cities = [null, ...rotate(METROS, now, ctx.perRun ?? CITIES_PER_RUN, { salt: 2 }).map((m) => m.label)];
  const listed = new Map();
  // 1. Google News RSS, only while its robots.txt allows /rss/search.
  const rg = await b.get(`https://${host}/robots.txt`, { robots: false, isRobots: true });
  const googleOk = rg.ok && robotsAllows(parseRobots(rg.text), "/rss/search");
  stats.google = googleOk ? "read" : "robots.txt disallows /rss/search";
  for (const city of googleOk ? cities : []) {
    const r = await b.get(googleUrl(city));
    if (r.ok) { stats.queries++; for (const a of articleList(r.text)) listed.set(a.url, a); }
  }
  // 2. GDELT DOC API.
  const gg = await gate(b, GDELT);
  if (!gg.ok) stats.skippedHosts.push(`${GDELT}: ${gg.reason}`);
  for (const city of gg.ok ? cities : []) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(gdeltUrl(city), { robots: false });
    if (!r.fromCache) await wait(GDELT_GAP_MS);
    if (/^Please limit requests/i.test(r.text || "")) { stats.stopped = "GDELT rate limit"; break; }
    if (!r.ok) continue;
    stats.queries++;
    for (const a of articleList(r.text)) if (!listed.has(a.url)) listed.set(a.url, a);
  }
  stats.articlesListed = listed.size;
  // 3. The articles (local press only).
  const raws = [];
  for (const a of [...listed.values()].filter((x) => looksLocal(x.url)).slice(0, ArticlesCap(ctx))) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(a.url);
    if (!r.ok) continue;
    stats.articlesRead++;
    const raw = articleToRaw(r.text, a, now);
    if (!raw) continue;
    const src = { id: `${name}:${slugify(raw.organizer.name)}`, brand: raw.organizer.name, home_city: raw.hints.city || "", home_state: raw.hints.state || "" };
    if (!usable(raw, src, now)) continue;
    raws.push(raw);
    stats.kept++;
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  return { ...out, stats: { ...stats, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: stats.stopped || b.st.stopped } };
}
const ArticlesCap = (ctx) => ctx.articles ?? ARTICLES_PER_RUN;

export default { name, host, discover };
