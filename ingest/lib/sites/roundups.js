// Newsletter and press roundups (data/roundups.json): weekly or monthly pieces that list many pop-ups in one body ("This week in Seattle
// pop-ups"). The feeds reader (feeds.js) keeps only items whose HEADLINE names a brand, so a roundup, whose headline names none, was dropped.
// This reader takes each item's whole body (RSS content, plus back issues from a Substack archive page), keeps the lines with a matcha word,
// finds the brand at the front of the line ("Nicho's Matcha Cafe at Hiroshi's, Sat 11/28") and hands the line, with the line before it for
// context, to the extractor with the issue's date as the reference day. A line with no brand, no future date or no US place is dropped:
// no event is invented. Pseudo-source `roundups:<brand-slug>`, confidence at most "likely" (a date and a place, rarely a street address);
// ingest promotes likely items; unsure ones wait in data/review/.
// The recall study (docs/DISCOVERY-RECALL.md) found local press and newsletters carried 22 of 44 pop-ups and caused the in-window misses
// (two Oct 31 pop-ups in an older Let It Simmer issue). robots.txt is read for every host; only public pages and feeds are fetched.
import fs from "node:fs";
import { parseFeed } from "../feed-xml.js";
import { htmlToLines } from "../html.js";
import { siteBudget, gate, finish, CAP, slugify } from "./common.js";
import { usable, tagKinds } from "./textfind.js";
import { brandFromTitle } from "./feeds.js";
import { hasMatcha } from "../../adapters/mato.js";

export const name = "roundups";
export const host = "substack.com";

const MAX_AGE_DAYS = 120;
const GENERIC = /^(the|a|an|new|this|these|best|where|what|how|why|here|there|our|your|join|come|visit|see|plus|also|and|or|but|on|in|at|for|from|with|\d+)\b/i;
const FRONT = /^(?:[-•*▪●]\s*)?([A-Z][\p{L}0-9'’&.\- ]{2,44}?)\s*(?:\bat\b|@|—|–| - |:|,|\bpop[\s-]?up\b)/u;

// "Nicho's Matcha Cafe at Hiroshi's (Beacon Hill), Sat 11/28" -> "Nicho's Matcha Cafe"; null when the line gives no brand.
export function brandFromLine(line) {
  const t = String(line || "").replace(/\s+/g, " ").trim();
  const m = FRONT.exec(t);
  if (!m) return null;
  const b = m[1].trim().replace(/[.,]$/, "");
  const words = b.split(" ");
  if (!b || words.length > 6 || GENERIC.test(b) || /^(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(b)) return null;
  return b;
}

// A roundup issue often arrives as one long paragraph of entries shaped "CATEGORY | NEIGHBORHOOD — Brand is popping up ... Sat 10/31,
// 11am-3pm at Venue ." Split on those headings; otherwise the lines are the entries.
const ENTRY = /(?<=[.!?])\s+(?=\*?[A-Z][A-Z0-9 &.,'\u2019*\/-]{2,48}\s\|\s[A-Z][A-Z0-9 .'\u2019&-]{2,34}\s\u2014\s)/u;
export function entries(lines) {
  const out = [];
  for (const l of lines) {
    const parts = l.length > 600 ? l.split(ENTRY) : [l];
    for (const p of parts) out.push(p.trim());
  }
  return out;
}

// "MATCHA & HOJICHA | FREMONT \u2014 Nicho's Matcha Cafe is popping up ..." -> "Nicho's Matcha Cafe"
export function brandFromEntry(entry) {
  const m = /\|\s[A-Z][A-Z0-9 .'\u2019&-]{2,34}\s\u2014\s(.+)$/su.exec(entry);
  if (!m) return null;
  const rest = m[1];
  // The verb after the name comes first ("Nicho’s Matcha Cafe is popping up"): a possessive would cut the name short.
  const v = /^(.{3,60}?)\s+(?:is|are|will be|serves?|hosts?|popping|pops|returns?|opens?|brings?|teams?|joins?|takes?|has|launche[sd]?)\b/u.exec(rest);
  if (v && !GENERIC.test(v[1]) && v[1].split(" ").length <= 6) return v[1].replace(/[.,]$/, "");
  return brandFromTitle(rest.slice(0, 160)) || brandFromLine(rest.slice(0, 160));
}

const WEEKLY = /\bevery (?:week|day|(?:mon|tues?|wednes|thurs?|fri|satur|sun)day)s?\b|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|\u2013|to|through)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(?:mon|tues?|wednes|thurs?|fri|satur|sun)days\b/i;

// One item's body -> raw items (one per matcha line that names a brand).
export function bodyItems(body, item, source, now = new Date()) {
  const lines = entries(htmlToLines(/<[a-z][\s\S]*>/i.test(body) ? body : `<p>${body}</p>`).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean));
  const out = [], seen = new Set();
  lines.forEach((line, i) => {
    if (line.length < 12 || line.length > 600 || !hasMatcha(line)) return;
    // Events lane findings (2026-11-24): a closure range is not an event ("closed 11/25-11/29", "closed on Thanksgiving 11/26"); the issue's
    // own title or subtitle is not a brand ("Melon matcha, butternut kale ..."); a weekly residency line with no dated day is a shop, not an item.
    if (/\b(?:will be |is |are )?closed\b|\bclosing\b/i.test(line)) return;
    if (item.title && (line.startsWith(item.title.slice(0, 40)) || item.title.startsWith(line.slice(0, 40)))) return;
    if (WEEKLY.test(line) && !/\b\d{1,2}\/\d{1,2}\b/.test(line)) return;
    const eb = brandFromEntry(line);
    const brand = eb || brandFromLine(line) || (i > 0 && lines[i - 1].length < 70 ? brandFromLine(lines[i - 1]) : null);
    if (!brand) return;
    const text = (eb ? line : `${i > 0 && lines[i - 1].length < 120 ? lines[i - 1] + ". " : ""}${line}`).slice(0, 900);
    const k = `${brand}|${line}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      source_url: item.link || source.url, text, description: line.slice(0, 300), image_url: null, published_at: item.published, maxAheadDays: 60, tags: null,
      organizer: { name: brand, url: null }, hints: { title: null }, feed: { name: source.name, city: source.city, state: source.state },
    });
  });
  return out;
}

// Lines of an issue that report a place closing for good ("Kaya Cafe has permanently closed", "closed its doors after 6 years"). They are not
// events, so bodyItems drops them; the shop liveness step (ingest/shops-liveness.js) matches them against our storefronts by name.
const CLOSURE = /\b(?:permanently closed|closed permanently|has closed|have closed|closed (?:its|their|our) doors|closing (?:its|their) doors|closed for good|shut(?:ting)? down|has shuttered|shuttered|going out of business|final day of business)\b/i;
export function closureLines(body, item = {}, source = {}) {
  const out = [];
  for (const line of entries(htmlToLines(/<[a-z][\s\S]*>/i.test(body) ? body : `<p>${body}</p>`).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean))) {
    if (line.length < 20 || line.length > 400 || !CLOSURE.test(line)) continue;
    out.push({ line: line.slice(0, 300), source: source.name || null, source_url: item.link || source.url || null, published: item.published || null });
  }
  return out;
}

export function loadRoundups(file = "data/roundups.json") {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).sources || []; } catch { return []; }
}

// Substack-style archive page -> post URLs (newest first).
export function archiveLinks(html, base) {
  const urls = [...String(html).matchAll(/href="((?:https?:\/\/[^"\/]+)?\/p\/[a-z0-9-]+)"/gi)].map((m) => (m[1].startsWith("http") ? m[1] : new URL(m[1], base).href));
  return [...new Set(urls)];
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, roundups = loadRoundups() } = ctx;
  // One budget per source: an HTTP 429 or 403 from one outlet must not stop the others.
  let b = siteBudget(fetcher, name, cap);
  const spent = { used: 0, pages: 0, hitCap: false, stopped: null };
  const raws = [];
  const stats = { sources: 0, skippedHosts: [], items: 0, kept: 0, back: 0 };
  const closures = [];
  const okHost = new Map();
  const gateFor = async (url) => { const h = new URL(url).host; if (!okHost.has(h)) okHost.set(h, await gate(b, h)); if (!okHost.get(h).ok) stats.skippedHosts.push(`${h}: ${okHost.get(h).reason}`); return okHost.get(h).ok; };
  const take = (items, s) => {
    for (const raw of items) {
      const src = { id: `${name}:${slugify(raw.organizer.name)}`, brand: raw.organizer.name, home_city: s.city || "", home_state: s.state || "" };
      if (!usable(raw, src, now)) continue;
      raw.hints = { title: null };
      raws.push(raw);
      stats.kept++;
    }
  };
  for (const s of roundups) {
    spent.used += b.st.used; spent.pages += b.st.pages; spent.hitCap ||= b.st.hitCap; spent.stopped = b.st.stopped || spent.stopped;
    b = siteBudget(fetcher, name, cap);
    let ok = false; try { ok = await gateFor(s.url); } catch { continue; }
    if (!ok) continue;
    const r = await b.get(s.url);
    if (!r.ok) continue;
    stats.sources++;
    const seenLinks = new Set();
    for (const it of parseFeed(r.text).items) {
      const t = Date.parse(it.published || "");
      if (Number.isFinite(t) && now.getTime() - t > MAX_AGE_DAYS * 86400000) continue;
      seenLinks.add(it.link);
      const body = [it.title, it.summary, it.content].filter(Boolean).join("\n");
      stats.items++;
      closures.push(...closureLines(body, it, s));
      take(bodyItems(body, it, s, now), s);
    }
    // Back issues: the archive page lists more posts than the feed carries; read the ones the feed did not.
    if (s.archive && !b.st.stopped) {
      const a = await b.get(s.archive);
      if (a.ok) {
        for (const link of archiveLinks(a.text, s.archive).filter((l) => !seenLinks.has(l)).slice(0, s.back || 8)) {
          if (b.st.stopped || b.left() <= 0) break;
          const p = await b.get(link);
          if (!p.ok) continue;
          stats.back++;
          const title = (/<title[^>]*>([^<]*)/i.exec(p.text) || [])[1] || "";
          const published = (/"datePublished":"([^"]+)"/.exec(p.text) || /property="article:published_time" content="([^"]+)"/.exec(p.text) || [])[1] || null;
          const t = Date.parse(published || "");
          if (Number.isFinite(t) && now.getTime() - t > MAX_AGE_DAYS * 86400000) continue;
          closures.push(...closureLines(p.text, { link, published, title }, s));
          take(bodyItems(p.text, { link, published, title }, s, now), s);
        }
      }
    }
  }
  saveClosures(closures, now);
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  for (const r of out.items) if (!r.source_hint.home_city) { r.source_hint.home_city = r.feed?.city || ""; r.source_hint.home_state = r.feed?.state || ""; }
  return { ...out, stats: { ...stats, fetches: spent.used + b.st.used, pages: spent.pages + b.st.pages, hitCap: spent.hitCap || b.st.hitCap, stopped: spent.stopped || b.st.stopped } };
}

// data/roundup-closures.json: the closure lines seen so far (newest 300), merged by line; written only by this reader.
export function saveClosures(found, now = new Date(), file = "data/roundup-closures.json") {
  if (!found.length || process.env.MATCHA_NO_WRITE) return;
  let prev = []; try { prev = JSON.parse(fs.readFileSync(file, "utf8")).closures || []; } catch { /* first run */ }
  const by = new Map(prev.map((c) => [c.line, c]));
  for (const c of found) if (!by.has(c.line)) by.set(c.line, { ...c, seen: now.toISOString().slice(0, 10) });
  const all = [...by.values()].sort((a, b) => String(b.published || b.seen).localeCompare(String(a.published || a.seen))).slice(0, 300);
  fs.writeFileSync(file, JSON.stringify({ note: "Lines in press and newsletter roundups that report a place closing; read by ingest/shops-liveness.js.", closures: all }, null, 1) + "\n");
}

export default { name, host, discover };
