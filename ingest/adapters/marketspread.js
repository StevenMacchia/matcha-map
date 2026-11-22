// MarketSpread vendor profiles (marketspread.com/vendor/<id>/<slug>/), rung 22.
// robots.txt (2026-11-22): `User-agent: * / Disallow:` (nothing disallowed), so public pages may be read at 1 request per second.
// What the site shows: a vendor profile lists the MARKETS the vendor belongs to (name, address) but no dates. A market page lists its
// event days; an event page lists the attending vendors only once they are confirmed ("currently tentative and are not being
// displayed" otherwise). So an event is created only when the event page itself links the vendor's profile: the vendor is confirmed
// for that day. A vendor that is merely a member of a market never gets a guessed date.
// Per vendor: 1 vendor page + up to MAX_MARKETS market pages + up to MAX_EVENTS event pages (the next days), only days in the next 45.
import { decode } from "../lib/html.js";
import { findTime, parseAddress } from "../lib/extract.js";
import { zonedIso, tzFor } from "../lib/tz.js";

const BASE = "https://marketspread.com";
export const MAX_MARKETS = 3, MAX_EVENTS = 5, WINDOW_DAYS = 45;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const text = (h) => decode(String(h || "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export const vendorId = (url) => /marketspread\.com\/vendor\/(\d+)/.exec(String(url || ""))?.[1] || null;

// Vendor page -> [{id, url, name, address}] markets.
export function parseMarkets(html) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*href="\s*(\/market\/(\d+)\/[a-z0-9-]+\/?)\s*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const name = text(/<h3[^>]*card-title[^>]*>([\s\S]*?)<\/h3>/i.exec(m[3])?.[1]);
    const address = text(/fa-map-marker[^>]*><\/i>\s*<div[^>]*>([\s\S]*?)<\/div>/i.exec(m[3])?.[1]);
    if (name) out.push({ id: m[2], url: BASE + m[1].replace(/\/?$/, "/"), name, address });
  }
  return out;
}

// Market page -> event page URLs in listed order (the market's next days).
export function parseEventLinks(html) {
  const out = [];
  for (const m of String(html).matchAll(/href="(\/market\/\d+\/[a-z0-9-]+\/events\/\d+\/)"/gi)) if (!out.includes(BASE + m[1])) out.push(BASE + m[1]);
  return out;
}

// Event page -> {attending: [vendor ids], tentative, start:{y,mo,d,h,mi}|null, end, address, title}.
export function parseEvent(html) {
  const body = String(html).slice(String(html).indexOf("<body"));
  const t = text(body);
  const attending = [...new Set([...body.matchAll(/href="\/vendor\/(\d+)\//g)].map((m) => m[1]))];
  const d = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\s*@\s*(.{0,30})/.exec(t);
  const time = d ? findTime(d[4]) : null;
  const addr = parseAddress(/Location\s+(.{10,120}?)\s+(?:Contact|Around the web)/.exec(t)?.[1] || "");
  return {
    attending, tentative: /currently tentative|not being displayed/i.test(t),
    date: d ? { y: +d[3], mo: MONTHS[d[1].toLowerCase()], d: +d[2] } : null, time,
    address: addr, title: text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1]),
    market: text(/<h2[^>]*>\s*<strong>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(body)?.[1]),
  };
}

export function eventToRaw(ev, url, source, marketName) {
  if (!ev.date) return null;
  const state = ev.address?.state || source.home_state || null, city = ev.address?.city || source.home_city || null;
  const tz = tzFor({ city, state }) || "America/New_York";
  const { y, mo, d } = ev.date;
  const start = ev.time ? zonedIso(tz, y, mo, d, ev.time.start.h, ev.time.start.mi) : zonedIso(tz, y, mo, d, 0, 0);
  return {
    source_url: url, text: `${source.brand} at ${marketName || ev.market}`, handle: source.instagram || null,
    hints: {
      start, end: ev.time?.end ? zonedIso(tz, y, mo, d, ev.time.end.h, ev.time.end.mi) : null, tz, all_day: !ev.time,
      venue: marketName || ev.market || null, address: ev.address?.address || null, city, state, title: `${source.brand} at ${marketName || ev.market}`,
    },
  };
}

export default {
  name: "marketspread",
  matches(source) { try { return new URL(source.schedule_url).hostname.replace(/^www\./, "") === "marketspread.com"; } catch { return false; } },
  async fetch(source, ctx) {
    const id = vendorId(source.schedule_url);
    if (!id) return [];
    const page = await ctx.fetcher.get(source.schedule_url);
    if (!page.ok) throw new Error(page.blocked ? "blocked by robots.txt" : `HTTP ${page.status || "error"}`);
    const now = new Date(ctx.now || Date.now()), limit = now.getTime() + WINDOW_DAYS * 86400000;
    const out = [];
    let events = 0;
    for (const mk of parseMarkets(page.text).slice(0, MAX_MARKETS)) {
      const mp = await ctx.fetcher.get(mk.url);
      if (!mp.ok) continue;
      for (const url of parseEventLinks(mp.text)) {
        if (events >= MAX_EVENTS) break;
        const ep = await ctx.fetcher.get(url);
        events++;
        if (!ep.ok) continue;
        const ev = parseEvent(ep.text);
        if (!ev.date || !ev.attending.includes(id) || ev.tentative && !ev.attending.length) continue;
        const t = Date.UTC(ev.date.y, ev.date.mo - 1, ev.date.d, 12);
        if (t < now.getTime() - 86400000 || t > limit) continue;
        const raw = eventToRaw({ ...ev, address: ev.address?.address ? ev.address : parseAddress(mk.address) }, url, source, mk.name);
        if (raw) out.push(raw);
      }
    }
    return out;
  },
};
