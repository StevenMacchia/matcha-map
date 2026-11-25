// npm run shops:fill [-- --overture] [-- --sites] [-- --limit n] [-- --dry] [-- --refresh] [-- --blank-hours]
// Fills the blanks on a storefront card from sources we may store, into data/shops-extra.json (the overlay `attachExtras` applies; only empty
// fields on the row are ever filled, and the loop that rewrites data/shops-zz-overture-serves.json never loses them):
//   --overture  the Overture place behind the row (by overture_id, or the same name within 150 m for a hand-researched row): its own website
//               (never a Yelp, Facebook, Instagram, TripAdvisor or ordering-site URL: ownSite()), Instagram handle from its socials, phone.
//   --sites     the shop's own site: home, /contact, /hours, /locations, /visit, /about, /menu, until the missing fields are found. Hours from
//               schema.org JSON-LD (openingHoursSpecification / openingHours) or a plain hours block, a phone from JSON-LD or a tel: link, the
//               Instagram handle linked on the page, a menu link on the shop's own host (or its Toast / Square order page), and the og:image under the
//               image rules in docs/SHOPS-WORKER.md (own site only, credit "Photo: <shop> website", never an Instagram or Facebook CDN).
// Rows already read (entry `fill` date) are skipped for 30 days unless --refresh. robots.txt respected, one request a second a host.
import "./lib/env.js";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { readPage } from "../tools/shop-read.js";
import { ownSite, igHandle, readPlaces, RELEASE, stateOf } from "./shops-overture.js";
import { hostOf, attachExtras } from "./lib/shops/menus.js";
import { metres } from "./lib/shops/merge.js";
import { nameKey } from "./lib/shops/providers.js";
import { shown } from "../tools/card-completeness.mjs";
import { hoursFromText, normalizeHours } from "./lib/shops/hours.js";
import { htmlToLines } from "./lib/html.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const today = new Date().toISOString().slice(0, 10);
const FIELDS = ["website", "opening_hours", "phone", "instagram", "image_url", "menu_url"];
const BAD_IMAGE = /cdninstagram|fbcdn|scontent|instagram\.com|facebook\.com|yelp|googleusercontent|gstatic|tripadvisor/i;
const ORDER_HOSTS = /(^|\.)(toasttab\.com|square\.site|squareup\.com|ordering\.chownow\.com|order\.online|clover\.com|olo\.com)$/i;
const PATHS = ["/", "/contact", "/hours", "/locations", "/visit", "/about", "/menu"];

const registrable = (h) => String(h).replace(/^www\./, "").split(".").slice(-2).join(".");
// A menu link counts when it stays on the shop's site or goes to the shop's own order page (Toast, Square, Chownow, Clover).
export function menuLinkOk(href, siteHost) {
  let u; try { u = new URL(href); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  return registrable(u.host) === registrable(siteHost) || ORDER_HOSTS.test(u.host);
}
export const imageOk = (u) => !!u && /^https?:\/\//i.test(u) && !BAD_IMAGE.test(u);

// ---- Overture carry ------------------------------------------------------------------------------------------------------------------
function overtureIndex(release = RELEASE) {
  const file = `.cache/overture/${release}/places-us.ndjson`;
  if (!fs.existsSync(file)) { console.error(`no Overture cache at ${file}`); return null; }
  const places = readPlaces(file);
  const byId = new Map(), cells = new Map();
  for (const p of places) {
    byId.set(p.id, p);
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const k = `${Math.round(p.lat * 100)}|${Math.round(p.lng * 100)}`;
    (cells.get(k) || cells.set(k, []).get(k)).push(p);
  }
  return { byId, near(s) {
    const out = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(cells.get(`${Math.round(s.lat * 100) + a}|${Math.round(s.lng * 100) + b}`) || []));
    return out;
  } };
}

export function overtureFacts(p) {
  // A listing whose "website" is the shop's Instagram page still tells us the handle (the URL is not stored as a website).
  return { website: ownSite(p.website), instagram: igHandle(p.socials) || igHandle([p.website]), phone: p.phone || null };
}

function carryOverture(shops, extra) {
  const idx = overtureIndex();
  if (!idx) return {};
  const got = { website: 0, instagram: 0, phone: 0, rows: 0, matchedByName: 0 };
  for (const s of shops) {
    if (!shown(s)) continue;
    const need = ["website", "instagram", "phone"].filter((k) => !s[k] && !(extra[s.id] || {})[k]);
    if (!need.length) continue;
    let p = s.overture_id ? idx.byId.get(s.overture_id) : null;
    if (!p && !s.overture_id && Number.isFinite(s.lat)) {
      const k = nameKey(s.name);
      p = idx.near(s).find((q) => nameKey(q.name) === k && metres(s, q) <= 150);
      if (p) got.matchedByName++;
    }
    if (!p) continue;
    const f = overtureFacts(p), e = { ...(extra[s.id] || {}) };
    let any = false;
    for (const k of need) if (f[k]) { e[k] = f[k]; got[k]++; any = true; }
    if (any) { got.rows++; e.overture_read = today; extra[s.id] = e; }
  }
  return got;
}

// ---- own-site read -------------------------------------------------------------------------------------------------------------------
export async function readSite(s, fetcher, need) {
  const base = new URL(s.website);
  const out = {}, tried = [];
  for (const path of PATHS) {
    if (!need.some((k) => out[k] == null)) break;
    let u; try { u = new URL(path, base).href; } catch { continue; }
    let r; try { r = await fetcher.get(u); } catch { tried.push("error"); continue; }
    if (r.blocked) { tried.push("robots"); if (path === "/") break; continue; }
    if (!r.ok) { tried.push(r.status); continue; }
    const rd = readPage(r.text, u);
    tried.push("ok");
    if (need.includes("opening_hours") && !out.opening_hours) { const h = normalizeHours(rd.hours_osm) || hoursFromText(htmlToLines(r.text)); if (h) out.opening_hours = h; }
    if (need.includes("phone") && !out.phone && rd.phone) out.phone = rd.phone;
    if (need.includes("instagram") && !out.instagram && rd.instagram) out.instagram = rd.instagram;
    if (need.includes("image_url") && !out.image_url && imageOk(rd.image)) out.image_url = rd.image;
    if (need.includes("menu_url") && !out.menu_url && rd.menu_url && menuLinkOk(rd.menu_url, base.host)) out.menu_url = rd.menu_url;
    if (need.includes("menu_url") && !out.menu_url && path === "/menu") out.menu_url = u; // the shop's own /menu page answered
  }
  return { facts: out, tried };
}

async function readSites(shops, extra, { limit, refresh, blankHours }) {
  const fetcher = createFetcher({});
  const rows = shops.filter((s) => shown(s) && s.website && ownSite(s.website) && FIELDS.some((k) => k !== "website" && !s[k] && !(extra[s.id] || {})[k]))
    .filter((s) => refresh || !(extra[s.id] || {}).fill || (Date.parse(today) - Date.parse(extra[s.id].fill)) > 30 * 864e5 || (blankHours && !s.opening_hours && (extra[s.id] || {}).fill_status !== "read"))
    .slice(0, limit);
  const filled = { opening_hours: 0, phone: 0, instagram: 0, image_url: 0, menu_url: 0 }, status = {};
  let next = 0, done = 0, gained = 0;
  const hostBusy = new Map();
  const work = async () => {
    while (next < rows.length) {
      const s = rows[next++];
      const need = ["opening_hours", "phone", "instagram", "image_url", "menu_url"].filter((k) => !s[k] && !(extra[s.id] || {})[k]);
      const { facts, tried } = await readSite(s, fetcher, need).catch((e) => ({ facts: {}, tried: ["error"] }));
      const e = { ...(extra[s.id] || {}), fill: today };
      let any = false;
      for (const [k, v] of Object.entries(facts)) { e[k] = v; filled[k]++; any = true; if (k === "image_url") { e.image_credit = `Photo: ${s.name} website`; } }
      if (any) { gained++; e.read = e.read || today; e.source_url = e.source_url || s.website; }
      const key = tried.includes("ok") ? "read" : tried[0] ? `unreadable (${tried[0]})` : "unreadable"; status[key] = (status[key] || 0) + 1;
      e.fill_status = tried.includes("ok") ? "read" : "unreadable";
      extra[s.id] = e;
      if (++done % 100 === 0) console.log(`  ${done}/${rows.length} sites, ${gained} rows gained fields`);
    }
  };
  await Promise.all(Array.from({ length: +opt("--conc", 10) }, work));
  return { sites: rows.length, rowsGained: gained, filled, status };
}

async function main() {
  const doOv = flag("--overture") || !flag("--sites"), doSites = flag("--sites") || !flag("--overture");
  const shops = JSON.parse(fs.readFileSync("data/shops.json", "utf8")).shops;
  const file = "data/shops-extra.json";
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { shops: {} };
  const extra = { ...(prev.shops || {}) };
  // Hours already filled by an earlier run are re-checked against the clean OSM shape; one that does not parse is dropped.
  for (const e of Object.values(extra)) if (e.fill && e.opening_hours) { const h = normalizeHours(e.opening_hours); if (h) e.opening_hours = h; else delete e.opening_hours; }
  const save = () => { if (!flag("--dry")) fs.writeFileSync(file, JSON.stringify({ about: "Fields read from each shop's own public site (npm run shops:deepen, npm run shops:fill) or carried from the Overture place behind the row; only empty fields on the shop row are filled.", shops: extra }, null, 1) + "\n"); };
  if (doOv) { const g = carryOverture(shops, extra); console.log("overture carry:", JSON.stringify(g)); save(); }
  if (doSites) {
    // the Overture fields carried above count as present for the site read
    const merged = attachExtras(shops, extra);
    const r = await readSites(merged, extra, { limit: +opt("--limit", 100000), refresh: flag("--refresh"), blankHours: flag("--blank-hours") });
    console.log("own-site read:", JSON.stringify(r));
    save();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
