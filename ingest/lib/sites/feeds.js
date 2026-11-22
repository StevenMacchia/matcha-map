// RSS / Atom feeds of city food and events outlets (the curated list in data/feeds.json) and Google Alerts feeds the owner adds.
// An item is kept when its title or text has a matcha word AND a pop-up word, it was published in the last 60 days, and the
// extractor finds a future date and a US place in it (the item text is handed to the extractor: published_at is the reference
// day for "this Saturday"). The brand comes from the headline ("Cha Cha Matcha's pop-up ..."); an item whose headline gives no
// brand is dropped, no event is invented. Pseudo-source `feeds:<brand-slug>`, kind popup (organizer when the title says class,
// workshop, meetup, tasting, 101 or club), category matcha. Confidence: the extractor's, which a news item reaches "likely" at
// most in practice (a date and a city; the street address is rarely there). Pages fetched: only the feed files, never the articles.
//
// Feed files checked 2026-11-22 (HTTP 200, robots.txt allows /feed, /rss): Eater (11 cities), Secret NYC, LA, SF, Chicago,
// Houston, Atlanta, Miami, Hoboken Girl, Greenpointers, Brokelyn, We Like LA, SFist, Capitol Hill Seattle Blog, Block Club
// Chicago, Chicago Reader, Houstonia, Gothamist, Miami New Times. No public feed found for Time Out, The Infatuation or Thrillist;
// do512.com answers 403; see data/feeds.json "notFound". Google Alerts: README, "Google Alerts".
import fs from "node:fs";
import { parseFeed } from "../feed-xml.js";
import { siteBudget, gate, finish, CAP, slugify } from "./common.js";
import { matchaPopup, usable, tagKinds } from "./textfind.js";

export const name = "feeds";
export const host = "eater.com";

const MAX_AGE_DAYS = 60;
const GENERIC = /^(the|a|an|new|this|these|best|where|what|how|why|here|there|where|when|these|our|your|3|4|5|6|7|8|9|10|\d+)\b/i;
const VERB = /(?:['’]s\b| is | are | opens?\b| launche[sd]?\b| debuts?\b| brings?\b| hosts?\b| teams? up\b| partners?\b| returns?\b| pops?\b| popping\b| announces?\b| unveils?\b| serves?\b| collab)/i;

// "Cha Cha Matcha's holiday pop-up ..." -> "Cha Cha Matcha"; null when the headline gives no brand.
export function brandFromTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = VERB.exec(t);
  if (!m || m.index < 3) return null;
  const b = t.slice(0, m.index).replace(/^["“'‘]|["”'’]$/g, "").trim();
  const words = b.split(" ");
  if (!b || words.length > 6 || GENERIC.test(b) || /^[a-z]/.test(b) || /[:?!]/.test(b)) return null;
  return b;
}

// A Google Alerts link is https://www.google.com/url?...&url=<real article>&ct=...
export const realLink = (link) => {
  try { const u = new URL(link); if (/(^|\.)google\.com$/.test(u.host) && u.pathname === "/url") return u.searchParams.get("url") || u.searchParams.get("q") || link; } catch { /* keep */ }
  return link;
};

// Feed xml + the feed's config -> [RawItem] for the matcha pop-up items (not yet checked for a date: see usableItems()).
export function feedItems(xml, feed, now = new Date()) {
  const { items } = parseFeed(xml);
  const out = [];
  for (const it of items) {
    const body = [it.summary, it.content].filter(Boolean).join(" ").slice(0, 3000);
    if (!matchaPopup(it.title, body)) continue;
    const t = Date.parse(it.published || "");
    if (Number.isFinite(t) && now.getTime() - t > MAX_AGE_DAYS * 86400000) continue;
    const brand = brandFromTitle(it.title);
    if (!brand) continue;
    out.push({
      source_url: realLink(it.link || feed.url), text: `${it.title}. ${body}`.slice(0, 3500), description: it.summary ? it.summary.slice(0, 400) : null,
      image_url: it.image || null, published_at: it.published, maxAheadDays: 120, tags: null,
      organizer: { name: brand, url: null }, hints: { title: null },
      feed: { name: feed.name, city: feed.city, state: feed.state },
    });
  }
  return out;
}

export function loadFeeds(file = "data/feeds.json") {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).feeds || []; } catch { return []; }
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, feeds = loadFeeds() } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const raws = [];
  const stats = { feeds: 0, skippedHosts: [], items: 0, kept: 0 };
  const okHost = new Map();
  for (const f of feeds) {
    if (b.st.stopped || b.left() <= 0) break;
    let h; try { h = new URL(f.url).host; } catch { continue; }
    if (!okHost.has(h)) okHost.set(h, await gate(b, h));
    if (!okHost.get(h).ok) { stats.skippedHosts.push(`${h}: ${okHost.get(h).reason}`); continue; }
    const r = await b.get(f.url);
    if (!r.ok) continue;
    stats.feeds++;
    const items = feedItems(r.text, f, now);
    stats.items += items.length;
    for (const raw of items) {
      const src = { id: `${name}:${slugify(raw.organizer.name)}`, brand: raw.organizer.name, home_city: f.city || "", home_state: f.state || "" };
      const c = usable(raw, src, now);
      if (!c) continue;
      raw.hints = { title: null };
      raws.push(raw);
      stats.kept++;
    }
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  // The outlet's city is the place when the item names none.
  const feedOf = new Map(out.items.map((r) => [r.source_hint.id, r.feed]));
  for (const r of out.items) if (!r.source_hint.home_city) { r.source_hint.home_city = r.feed?.city || ""; r.source_hint.home_state = r.feed?.state || ""; }
  for (const c of out.candidates) { const f = feedOf.get(`${name}:${c.evidence.match(/org=([^;]+);/)?.[1]}`); if (f && !c.city) { c.city = f.city; c.state = f.state; } }
  return { ...out, stats: { ...stats, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
