// npm run shops:deepen: fill what a storefront's own public pages print and its row lacks: opening hours, phone, Instagram handle,
// a photo (the shop's own og/JSON-LD image, with credit), and a menu page link. Result: data/shops-extra.json keyed by shop id, applied
// onto the shop rows (ingest/lib/shops/menus.js attachExtras) by this command and by every `npm run shops`.
// Only empty fields are filled, only from the shop's own website (robots respected, 1 request a second a host). Nothing is guessed:
// hours come only from JSON-LD openingHours / openingHoursSpecification; a phone only from JSON-LD telephone or a tel: link.
//   npm run shops:deepen [-- --dry] [-- --only <host>]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { jsonLd, metaContent, ldImage } from "./lib/html.js";
import { hostOf } from "./lib/shops/menus.js";
import { attachExtras } from "./lib/shops/menus.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DAY = { monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su" };
const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const asArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const day2 = (d) => DAY[String(d).replace(/^.*\//, "").toLowerCase()] || (ORDER.includes(String(d).slice(0, 2)) ? String(d).slice(0, 2) : null);
const hm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };

// JSON-LD openingHoursSpecification / openingHours -> "Mo-Sa 10:00-17:00; Su 13:00-17:00" (the OSM style the shop rows already use), or null.
export function hoursFromLd(node) {
  const lines = [];
  for (const o of asArr(node.openingHoursSpecification)) {
    const open = hm(o.opens), close = hm(o.closes);
    const days = asArr(o.dayOfWeek).map(day2).filter(Boolean);
    if (open && close && days.length) lines.push([days, `${open}-${close}`]);
  }
  if (!lines.length) {
    for (const s of asArr(node.openingHours)) {
      const m = /^([A-Za-z]{2}(?:-[A-Za-z]{2})?(?:,[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(s).trim());
      if (m) lines.push([[m[1]], `${hm(m[2])}-${hm(m[3])}`]);
    }
    if (lines.length) return lines.map(([d, t]) => `${d.join(",")} ${t}`).join("; ");
  }
  if (!lines.length) return null;
  const byTime = new Map();
  for (const [days, t] of lines) for (const d of days) byTime.set(t, [...(byTime.get(t) || []), d]);
  return [...byTime.entries()].map(([t, ds]) => {
    const idx = [...new Set(ds)].map((d) => ORDER.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
    const runs = []; for (const i of idx) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); }
    return `${runs.map(([a, b]) => (a === b ? ORDER[a] : b === a + 1 ? `${ORDER[a]},${ORDER[b]}` : `${ORDER[a]}-${ORDER[b]}`)).join(",")} ${t}`;
  }).join("; ");
}

const BUSINESS = /(?:LocalBusiness|Restaurant|CafeOrCoffeeShop|FoodEstablishment|Store|Organization)$/i;
const IGNORE_IG = /^(p|reel|reels|explore|accounts|stories|tv|share|sharer)$/i;

// Facts from one page's HTML: { hours, phone, instagram, image_url, menu_link }.
export function facts(html, base) {
  const out = { hours: null, phone: null, instagram: null, image_url: null, menu_link: null };
  const nodes = jsonLd(html).filter((n) => [n["@type"]].flat().some((t) => BUSINESS.test(String(t))));
  for (const n of nodes) {
    out.hours = out.hours || hoursFromLd(n);
    const tel = String(n.telephone || "").trim();
    if (!out.phone && /\d{3}\D*\d{3}\D*\d{4}/.test(tel)) out.phone = tel;
    out.image_url = out.image_url || ldImage(n.image);
    for (const u of asArr(n.sameAs)) { const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(String(u)); if (m && !IGNORE_IG.test(m[1])) out.instagram = out.instagram || m[1]; }
  }
  if (!out.phone) { const m = /href=["']tel:([+\d\-().\s%]+)["']/i.exec(html); if (m && /\d{3}\D*\d{3}\D*\d{4}/.test(decodeURIComponent(m[1]))) out.phone = decodeURIComponent(m[1]).trim(); }
  if (!out.instagram) for (const m of html.matchAll(/href=["']https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?["']/gi)) if (!IGNORE_IG.test(m[1])) { out.instagram = m[1]; break; }
  out.image_url = out.image_url || metaContent(html, "og:image");
  if (out.image_url) { try { out.image_url = new URL(out.image_url, base).href; } catch { out.image_url = null; } }
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,60}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (/^\/?menu\b|\/menu\/?$|\/pages\/menu|\/menus?\b/i.test(m[1]) || /^(our )?menu$/i.test(text)) { try { out.menu_link = new URL(m[1], base).href; } catch { /* skip */ } break; }
  }
  return out;
}

async function main() {
  const shops = JSON.parse(fs.readFileSync("data/shops.json", "utf8")).shops;
  const prev = fs.existsSync("data/shops-extra.json") ? JSON.parse(fs.readFileSync("data/shops-extra.json", "utf8")).shops || {} : {};
  const f = createFetcher();
  const extra = { ...prev };
  const hostCache = new Map();
  let read = 0, failed = 0;
  for (const s of shops) {
    if (!s.website || !s.verified) continue;
    const host = hostOf(s.website);
    if (opt("--only") && host !== opt("--only")) continue;
    const need = ["opening_hours", "phone", "instagram", "image_url", "menu_url"].filter((k) => !s[k]);
    if (!need.length) continue;
    let fa = hostCache.get(host);
    if (!fa) {
      try { const r = await f.get(s.website); read++; fa = r.ok ? facts(r.text, s.website) : (failed++, {}); } catch { failed++; fa = {}; }
      hostCache.set(host, fa);
    }
    const when = new Date().toISOString().slice(0, 10);
    const e = { ...(extra[s.id] || {}) };
    if (!s.opening_hours && fa.hours) e.opening_hours = fa.hours;
    if (!s.phone && fa.phone) e.phone = fa.phone;
    if (!s.instagram && fa.instagram) e.instagram = fa.instagram;
    if (!s.image_url && fa.image_url) { e.image_url = fa.image_url; e.image_credit = host; }
    if (!s.menu_url && fa.menu_link) e.menu_url = fa.menu_link;
    if (Object.keys(e).length) { e.read = when; e.source_url = s.website; extra[s.id] = e; }
  }
  const filled = {};
  for (const e of Object.values(extra)) for (const k of Object.keys(e)) if (!["read", "source_url", "image_credit"].includes(k)) filled[k] = (filled[k] || 0) + 1;
  console.log(`read ${read} sites (${failed} not readable); ${Object.keys(extra).length} shops gained fields: ${JSON.stringify(filled)}`);
  if (flag("--dry")) return;
  fs.writeFileSync("data/shops-extra.json", JSON.stringify({ about: "Fields read from each shop's own public site by npm run shops:deepen; only empty fields on the shop row are filled.", shops: extra }, null, 1) + "\n");
  for (const file of ["data/shops.json", "site/data/shops.json"]) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    j.shops = attachExtras(j.shops, extra);
    fs.writeFileSync(file, file.startsWith("site/") ? JSON.stringify(j) + "\n" : JSON.stringify(j, null, 1) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
