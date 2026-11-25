// A pop-up brand's own website: the "Upcoming Events" block (the Saikō Matcha House shape, found 2026-11-23: a home page with an
// "Upcoming Events" heading and dated lines such as "Nov 27, 10am-2pm: MODE, The Village District").
//
// Which sources: every active source with an http `website` that is not a social, link-in-bio or marketplace page and that the `website`
// adapter does not already read (schedule_kind "website" with a schedule_url). Pages read per source: the home page and up to two same-host
// pages the home page links as events, upcoming, schedule, calendar, pop-ups or "find us" (at most three requests, robots.txt respected,
// one gate per host through the shared site budget).
// What is kept: only lines under an events-type heading (up to the next heading, at most 14 lines), and only a line that carries a date the
// extractor can read; a short date line borrows the line before it and the line after it (the venue and time often sit on their own lines).
// A dated line outside such a block (a blog post, a copyright year, a sale end date) is not an event. Nothing here sets a date, a place or
// a time that the page does not print; `npm run ingest` still promotes only confirmed or likely items (docs/LANES.md).
import { findDates, refDate } from "../extract.js";
import { tzFor } from "../tz.js";
import { htmlToLines, decode } from "../html.js";
import { needsMatchaFilter } from "../../adapters/mato.js";
import { siteBudget, gate, skipped, CAP, hasMatcha } from "./common.js";

export const name = "ownsites";
export const host = "own sites";

const SKIP_HOST = /(^|\.)(instagram\.com|facebook\.com|tiktok\.com|linktr\.ee|beacons\.ai|youtube\.com|x\.com|twitter\.com|eventbrite\.[a-z.]+|ma\.to|lu\.ma|luma\.com|partiful\.com|posh\.vip|amazon\.com|etsy\.com)$/i;
const HEADING = /^(?:upcoming\s+)?(?:events?|pop[\s-]?ups?|markets?|appearances?|schedule|calendar|where to find us|come say hi|next up|what'?s next|upcoming)(?:\s+(?:events?|pop[\s-]?ups?|dates|appearances|schedule|calendar|markets?))?\s*:?$/i;
const NEXT_SECTION = /^(?:about(?: us)?|shop|contact(?: us)?|menu|faq|our story|follow us|newsletter|subscribe|sign up|past events?|previous events?|catering|private events?|book(?:ing)?|gallery|press|reviews?|testimonials?|footer|cart|policies|shipping|returns|careers|blog|journal)\s*:?$/i;
const EVENT_LINK = /(?:events?|upcoming|schedule|calendar|pop-?ups?|find-?us|markets?|appearances)/i;
const BLOCK_LINES = 14;
const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\bnoon\b/i;

export const ownSiteUrl = (s) => {
  if (!s || s.active === false || !s.website) return null;
  if (s.schedule_kind === "website" && s.schedule_url) return null; // read by adapters/website.js
  let u; try { u = new URL(s.website); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || SKIP_HOST.test(u.hostname)) return null;
  return u.href;
};

// Same-host links on a page whose address or text names an events page, home first, at most two.
export function eventLinks(html, pageUrl) {
  let base; try { base = new URL(pageUrl); } catch { return []; }
  const out = [];
  for (const m of String(html || "").matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let u; try { u = new URL(decode(m[1]), base); } catch { continue; }
    if (u.host.replace(/^www\./, "") !== base.host.replace(/^www\./, "") || !/^https?:$/.test(u.protocol)) continue;
    const text = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!(EVENT_LINK.test(u.pathname) || /^(?:upcoming )?(?:events?|pop[\s-]?ups?|schedule|calendar|find us)$/i.test(text))) continue;
    if (/\.(?:jpe?g|png|gif|pdf|webp|svg)$/i.test(u.pathname) || u.pathname === base.pathname) continue;
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out.slice(0, 2);
}

// A page's lines -> the lines inside events-type blocks (heading excluded).
export function eventBlocks(lines) {
  const blocks = [];
  // A heading is a line that stands once on the page: a menu link repeated in the header and the footer is navigation, not a section.
  const count = new Map();
  for (const l of lines) count.set(l.trim().toLowerCase(), (count.get(l.trim().toLowerCase()) || 0) + 1);
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING.test(lines[i].trim()) || count.get(lines[i].trim().toLowerCase()) > 1) continue;
    const block = [];
    for (let j = i + 1; j < lines.length && block.length < BLOCK_LINES; j++) {
      const l = lines[j].trim();
      if (HEADING.test(l) || NEXT_SECTION.test(l)) break;
      block.push(l);
    }
    if (block.length) blocks.push(block);
  }
  return blocks;
}

// One page -> RawItems for a source. now is the reference day for year-less dates.
export function readOwnPage(html, source, pageUrl, now = new Date()) {
  const tz = tzFor({ city: source.home_city, state: source.home_state }) || "America/New_York";
  const ref = refDate(now, tz);
  const items = [], seen = new Set();
  for (const block of eventBlocks(htmlToLines(html))) {
    block.forEach((l, i) => {
      if (l.length > 300 || !findDates(l, ref).length) return;
      // The venue and the time often stand on their own lines: borrow the line before (if it has no date) and the one after (if it has none).
      const before = i > 0 && !findDates(block[i - 1], ref).length && block[i - 1].length < 120 ? block[i - 1] : "";
      const after = i + 1 < block.length && !findDates(block[i + 1], ref).length && block[i + 1].length < 120 ? block[i + 1] : "";
      const text = [before, l, after].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      // A date alone is not an event: the printed text must also carry a time of day.
      if (seen.has(text) || !TIME.test(text)) return;
      if (needsMatchaFilter(source) && !hasMatcha(text, source.brand)) return;
      seen.add(text);
      items.push({ source_url: pageUrl, text, maxAheadDays: 60, handle: source.instagram || null, source_hint: source });
    });
  }
  return items;
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const items = [];
  const stats = { sources: 0, pages: 0, withBlock: 0, skipped: [] };
  const gates = new Map();
  for (const s of sources) {
    const url = ownSiteUrl(s);
    if (!url) continue;
    if (b.st.stopped || b.left() <= 0) break;
    stats.sources++;
    const h = new URL(url).host;
    if (!gates.has(h)) { const g = await gate(b, h); gates.set(h, g); if (!g.ok) stats.skipped.push(`${h}: ${g.reason}`); }
    if (!gates.get(h).ok) continue;
    const home = await b.get(url);
    if (!home.ok) continue;
    stats.pages++;
    let found = readOwnPage(home.text, s, url, now);
    for (const link of eventLinks(home.text, url)) {
      if (b.st.stopped || b.left() <= 0) break;
      const r = await b.get(link);
      if (!r.ok) continue;
      stats.pages++;
      found = found.concat(readOwnPage(r.text, s, link, now));
    }
    if (found.length) stats.withBlock++;
    items.push(...found);
  }
  if (!stats.sources) return skipped("no source has a website of its own that is not already read");
  return { items, candidates: [], leads: [], stats: { ...stats, skipped: undefined, skippedHosts: stats.skipped, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
