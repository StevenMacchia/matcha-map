// Linktree and Beacons pages of brands we already know (sources whose website or schedule_url is on linktr.ee or beacons.ai).
//
// Public structure (read 2026-11-22):
//   robots.txt     https://linktr.ee/robots.txt names search bots one by one (Applebot, Bingbot ...) and ends with a fallback group
//                  "User-agent: *  Disallow: /  # Fallback, disallow scraping". We are not a named bot, so linktr.ee is SKIPPED by
//                  the robots gate (checked 2026-11-22; the three known brands on linktr.ee stay unread). The page structure
//                  below is kept for the day that changes. https://beacons.ai/robots.txt: "User-agent: *" with nothing disallowed,
//                  so Beacons pages are read; no source is on beacons.ai today.
//   linktree page  https://linktr.ee/<username> is Next.js. <script id="__NEXT_DATA__"> holds props.pageProps = {account{username,
//                  pageTitle,...}, description (the bio line, often null), links[{id,title,url,type,position,locked,
//                  scheduleStart,...}], pinnedLinks[], socialLinks[{type,url}] ...}. Everything is public; no login.
//   beacons page   https://beacons.ai/<username> is client-rendered; only plain <a href> anchors can be read (the link text and url).
// What is kept: (a) a link title or bio line that has a date AND a pop-up word becomes a RawItem for the brand's own source
// (handle = its Instagram handle); no event is made from a bare link. (b) schedule-like links (MATO venue, Luma, Eventbrite, Partiful,
// Posh, Shopify events pages) become leads under the source id, so a human can set schedule_url. Nothing here is a candidate.
import { findDates, refDate } from "../extract.js";
import { tzFor } from "../tz.js";
import { decode } from "../html.js";
import { needsMatchaFilter } from "../../adapters/mato.js";
import { siteBudget, gate, skipped, CAP, hasMatcha } from "./common.js";

export const name = "linktree";
export const host = "linktr.ee";
const HOSTS = /(^|\.)(linktr\.ee|beacons\.ai)$/i;
const POPUP = /pop[\s-]?ups?\b|\bcart\b|\bmarket\b|\bcollab|take[\s-]?over|matcha|\btasting|\bworkshop|\bclass\b|\bevent/i;

export const onLinkPage = (s) => [s.schedule_url, s.website].filter(Boolean).find((u) => { try { return HOSTS.test(new URL(u).host); } catch { return false; } }) || null;

// Which kind of schedule a link url looks like, or null.
export function scheduleKind(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const h = u.host.replace(/^www\./, "").toLowerCase(), p = u.pathname.toLowerCase();
  if (h === "ma.to" && /^\/venue\//.test(p)) return "mato";
  if (h === "luma.com" || h === "lu.ma") return "luma";
  if (/(^|\.)eventbrite\.[a-z.]+$/.test(h) && /^\/(o|e)\//.test(p)) return "eventbrite";
  if (h === "partiful.com") return "partiful";
  if (h === "posh.vip") return "posh";
  if (/(^|\.)myshopify\.com$/.test(h) || /\/(pages|collections)\/[a-z-]*events?\b/.test(p)) return "shopify-events";
  return null;
}

// Page html -> {title, bio, links:[{title,url}]}.
export function parseLinkPage(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (m) {
    try {
      const pp = JSON.parse(m[1])?.props?.pageProps || {};
      const links = [...(pp.pinnedLinks || []), ...(pp.links || [])].flatMap((l) => [l, ...(l.children || [])]).filter((l) => l && l.url).map((l) => ({ title: String(l.title || "").trim(), url: l.url }));
      const bio = [pp.description, pp.account?.description].find((x) => typeof x === "string" && x.trim()) || "";
      return { title: pp.pageTitle || "", bio, links };
    } catch { /* fall through to anchors */ }
  }
  const links = [...String(html).matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((a) => ({ title: decode(a[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(), url: decode(a[1]) }));
  return { title: "", bio: "", links };
}

// One page -> {items, leads} for a source. now is the reference day for year-less dates.
export function readPage(parsed, source, pageUrl, now = new Date()) {
  const tz = tzFor({ city: source.home_city, state: source.home_state }) || "America/New_York";
  const ref = refDate(now, tz);
  const items = [], leads = [], seenText = new Set(), seenUrl = new Set();
  const lines = [parsed.bio, ...parsed.links.map((l) => l.title)].filter(Boolean);
  for (const t of lines) {
    const text = String(t).replace(/\s+/g, " ").trim();
    if (seenText.has(text) || text.length > 300 || !POPUP.test(text) || !findDates(text, ref).length) continue;
    if (needsMatchaFilter(source) && !hasMatcha(text, source.brand)) continue;
    seenText.add(text);
    items.push({ source_url: pageUrl, text, maxAheadDays: 60, handle: source.instagram || null, source_hint: source });
  }
  for (const l of parsed.links) {
    const kind = scheduleKind(l.url);
    if (!kind || seenUrl.has(l.url) || (source.schedule_url && l.url.replace(/\/+$/, "") === source.schedule_url.replace(/\/+$/, ""))) continue;
    seenUrl.add(l.url);
    leads.push({ source_id: source.id, url: l.url, kind, found_via: "search", found_from: `linktree:${source.id}`, evidence: `${l.title || "link"} (${kind}) on ${pageUrl}`.slice(0, 200) });
  }
  return { items, leads };
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const items = [], leads = [];
  const stats = { sources: 0, pages: 0, skipped: [] };
  const gates = new Map();
  for (const s of sources) {
    const url = onLinkPage(s);
    if (!url || s.active === false) continue;
    if (b.st.stopped || b.left() <= 0) break;
    stats.sources++;
    const h = new URL(url).host;
    if (!gates.has(h)) { const g = await gate(b, h); gates.set(h, g); if (!g.ok) stats.skipped.push(`${h}: ${g.reason}`); }
    if (!gates.get(h).ok) continue;
    const r = await b.get(url);
    if (!r.ok) continue;
    stats.pages++;
    const out = readPage(parseLinkPage(r.text), s, url, now);
    items.push(...out.items); leads.push(...out.leads);
  }
  if (!stats.sources) return skipped("no source is on linktr.ee or beacons.ai");
  return { items, candidates: [], leads, stats: { ...stats, skipped: undefined, skippedHosts: stats.skipped, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
