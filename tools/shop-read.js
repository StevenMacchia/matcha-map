// node tools/shop-read.js <url> [--paths home,/contact,/locations] (use "home" for the front page: Git Bash rewrites a bare "/"): read a storefront's own public pages (robots.txt respected, 1 request a second,
// 6-hour disk cache) and print what a shop row needs as JSON: street address, phone, opening hours in OpenStreetMap syntax, Instagram
// handle, menu link, photo, and how many times "matcha" appears. Read-only; it never invents a field (a field it cannot find is null).
// Used by the storefront research workers (docs/SHOPS-WORKER.md) to confirm a shop on its own site before it goes into data/shops-*.json.
import { pathToFileURL } from "node:url";
import { createFetcher } from "../ingest/lib/fetch.js";
import { extractAddress } from "../ingest/lib/shops/brandsites.js";
import { jsonLd, htmlToLines, metaContent, httpUrl } from "../ingest/lib/html.js";

const DAY2 = { Monday: "Mo", Tuesday: "Tu", Wednesday: "We", Thursday: "Th", Friday: "Fr", Saturday: "Sa", Sunday: "Su", Mon: "Mo", Tue: "Tu", Wed: "We", Thu: "Th", Fri: "Fr", Sat: "Sa", Sun: "Su" };
const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const hhmm = (t) => { const m = /^(\d{1,2}):?(\d{2})?/.exec(String(t || "")); return m ? `${m[1].padStart(2, "0")}:${m[2] || "00"}` : null; };

// schema.org openingHoursSpecification[] or openingHours (string or strings) -> "Mo-Fr 08:00-17:00; Sa 09:00-15:00", or null.
export function hoursToOsm(ld) {
  if (!ld) return null;
  const spec = [].concat(ld.openingHoursSpecification || []).filter((x) => x && typeof x === "object");
  if (spec.length) {
    const byDay = {};
    for (const sp of spec) {
      const o = hhmm(sp.opens), c = hhmm(sp.closes);
      if (!o || !c) continue;
      for (const d of [].concat(sp.dayOfWeek || [])) { const k = DAY2[String(d).split("/").pop()]; if (k) (byDay[k] = byDay[k] || new Set()).add(`${o}-${c}`); }
    }
    const groups = new Map();
    for (const d of ORDER) if (byDay[d]) { const key = [...byDay[d]].sort().join(","); groups.set(key, [...(groups.get(key) || []), d]); }
    const parts = [...groups].map(([span, days]) => `${days.length > 2 && ORDER.indexOf(days[days.length - 1]) - ORDER.indexOf(days[0]) === days.length - 1 ? `${days[0]}-${days[days.length - 1]}` : days.join(",")} ${span}`);
    if (parts.length) return parts.join("; ");
  }
  const oh = [].concat(ld.openingHours || []).map((x) => String(x).trim()).filter(Boolean);
  return oh.length ? oh.join("; ") : null;
}

export function pickLd(html) {
  const nodes = [];
  const walk = (n, d = 0) => { if (!n || typeof n !== "object" || d > 5) return; if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1)); nodes.push(n); if (n["@graph"]) walk(n["@graph"], d + 1); };
  for (const x of jsonLd(html)) walk(x);
  const biz = nodes.filter((n) => [].concat(n["@type"] || []).some((t) => /Restaurant|CafeOrCoffeeShop|FoodEstablishment|Store|LocalBusiness|Bakery|TeaHouse|Cafe/i.test(String(t))));
  return biz.find((n) => n.address || n.openingHoursSpecification || n.openingHours) || biz[0] || null;
}

export function readPage(html, url) {
  const ld = pickLd(html);
  const text = htmlToLines(html).join("\n");
  const addr = extractAddress(html);
  const ig = [...String(html).matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})(?=["'\/?#\s])/gi)].map((m) => m[1].toLowerCase()).filter((h) => !/^(p|reel|reels|explore|accounts|tv|stories|share)$/.test(h));
  const tel = (ld && ld.telephone) || (/tel:([+\d()\-\s.]{7,20})/i.exec(html) || [])[1] || null;
  const menu = [...String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)].map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })).filter((l) => /menu/i.test(l.text) || /\/menu\b/i.test(l.href)).map((l) => { try { return new URL(l.href, url).href; } catch { return null; } }).filter(Boolean);
  return {
    url, title: (/<title[^>]*>([^<]*)/i.exec(html) || [])[1]?.trim() || null,
    address: addr ? addr.address : null, city: addr ? addr.city : null, state: addr ? addr.state : null, zip: addr ? addr.zip : null,
    phone: tel ? String(tel).trim() : addr?.phone || null, hours_osm: hoursToOsm(ld) || (addr && addr.hours) || null,
    instagram: ig[0] || null, menu_url: menu[0] || null, image: httpUrl(metaContent(html, "og:image")),
    matcha_mentions: (text.match(/matcha/gi) || []).length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv.find((a) => /^https?:/.test(a));
  if (!url) { console.error("usage: node tools/shop-read.js <url> [--paths home,/contact]"); process.exit(2); }
  const pi = argv.indexOf("--paths");
  const paths = pi >= 0 ? argv[pi + 1].split(",") : ["/", "/contact", "/locations", "/visit", "/about", "/menu"];
  const f = createFetcher({});
  const out = { site: url, pages: [], merged: {} };
  for (const p of paths) {
    let u; try { u = new URL(p === "home" || p === "." ? "/" : p, url).href; } catch { continue; }
    let r; try { r = await f.get(u); } catch (e) { out.pages.push({ url: u, error: e.message }); continue; }
    if (r.blocked) { out.pages.push({ url: u, blocked: "robots.txt" }); continue; }
    if (!r.ok) { out.pages.push({ url: u, status: r.status }); continue; }
    const rd = readPage(r.text, u);
    out.pages.push({ url: u, matcha_mentions: rd.matcha_mentions, address: rd.address });
    for (const [k, v] of Object.entries(rd)) if (v && k !== "url" && k !== "title" && (out.merged[k] == null || k === "matcha_mentions")) out.merged[k] = k === "matcha_mentions" ? (out.merged[k] || 0) + v : v;
  }
  console.log(JSON.stringify(out, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
