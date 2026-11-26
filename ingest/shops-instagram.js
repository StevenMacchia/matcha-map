// npm run shops:instagram -- [--in places.ndjson] [--held held-*.json ...] [--limit 120] [--dry] [--out data/shops-zz-instagram-triangle.json]
// Instagram-menu reader (Graph API only). For restaurants, bars and cafes with an Instagram handle that is a business or creator account, read the last 30
// public posts through business_discovery (the same call the watch uses), count distinct matcha drink names in the captions with the repo's drink dictionary
// (ingest/lib/shops/instagram-menus.js), and write tier "serves" rows with confirmed_via "instagram-posts" (see docs/HOSTED-MENUS.md, evidence levels).
// No instagram.com page is fetched and no picture is copied; accounts the Graph API cannot return are recorded as errors and skipped for a week.
// Handles come from the Overture places file (socials), from the held lists of the menu reader (a handle printed on the place's own site), and from the
// watch list. After a read, a handle whose captions name matcha joins data/watchlist.json as a candidate (found_via "overture"); "Invalid user id" marks it unreadable.
// Calls share the hourly budget in .cache/ig-rate.json with the watch (HOURLY_LIMIT 200, 20 left for hand runs); --limit caps one run.
import "./lib/env.js";
import fs from "node:fs";
import { readPlaces, usable, igHandle, ownSite, stateOf } from "./shops-overture.js";
import { creds, createRate, graph, Stop, BASE, runAllowance } from "./adapters/instagram-graph.js";
import * as wlib from "./lib/watchlist.js";
import { drinksFromPosts, rowFromPosts, POSTS_READ } from "./lib/shops/instagram-menus.js";
import { readCuratedFiles } from "./lib/shops/curated.js";
import { info, warn } from "./lib/log.js";

const CHECKED = "data/instagram-menus-checked.json"; // handle -> { checked, posts, with_matcha, drinks: [{name, permalink, timestamp}] } or { checked, error }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www./, ""); } catch { return null; } };
const KEEP_OUT = /starbucks|dunkin|mcdonald|dutch bros|tim hortons|7-eleven|panera|subway|krispy/i;

export const postsUrl = (c, handle) => `${BASE}/${c.id}?fields=${encodeURIComponent(`business_discovery.username(${handle}){media.limit(${POSTS_READ}){caption,permalink,timestamp,media_type}}`)}&access_token=${c.token}`;
export const mediaOf = (j) => (j?.business_discovery?.media?.data || []).map((m) => ({ caption: m.caption || "", permalink: m.permalink, timestamp: m.timestamp }));

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d = null) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const all = (k) => { const i = argv.indexOf(k); if (i < 0) return []; const v = []; for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) v.push(argv[j]); return v; };
  const file = arg("--in", ".cache/overture/2026-11-18.0/places-triangle-wide.ndjson");
  const out = arg("--out", "data/shops-zz-instagram-triangle.json");
  const dry = argv.includes("--dry");
  const places = fs.existsSync(file) ? readPlaces(file) : [];
  const byId = new Map(places.map((p) => [p.id, p]));
  const targets = new Map(); // handle -> candidate place
  // A handle that carries a city name ("chahousecary") belongs to the store in that city, never to the chain's other stores.
  const CITY_WORDS = ["cary", "raleigh", "durham", "chapelhill", "apex", "morrisville", "carrboro", "garner", "wakeforest", "hillsborough", "pittsboro", "fuquay", "hollysprings", "knightdale", "cary"];
  const otherCity = (h, p) => { const city = String(p.city || "").toLowerCase().replace(/[^a-z]/g, ""); return CITY_WORDS.some((w) => h.replace(/[^a-z]/g, "").includes(w) && !city.includes(w) && !w.includes(city)); };
  const put = (h, p) => { if (h && p && usable(p) && !KEEP_OUT.test(p.name) && !otherCity(h.toLowerCase(), p) && !targets.has(h.toLowerCase())) targets.set(h.toLowerCase(), p); };
  for (const p of places) put(igHandle(p.socials), p);
  const mentions = new Map(); // place id -> times the place's own site said matcha (from the menu reader's held list): read those handles first
  for (const f of all("--held")) for (const h of readJson(f, [])) {
    const hd = h.instagram && String(h.instagram).toLowerCase();
    put(hd, byId.get(h.id));
    if (h.matcha_mentions) mentions.set(h.id, h.matcha_mentions);
    // A chain's store-specific handle ("chahousecary") also goes to the place in that city that shares the chain's website.
    if (hd && h.website) for (const q of places) if (q.id !== h.id && hostOf(q.website) === hostOf(h.website)) put(hd, q);
  }
  // Rows that already exist: no second row for the same Overture place or the same name and street.
  const have = new Set(), haveOv = new Set();
  for (const { file: f, row } of readCuratedFiles()) {
    if (out.endsWith(f)) continue; // this reader's own rows are rebuilt each run
    have.add(`${row.name}|${row.address}`.toLowerCase()); if (row.overture_id) haveOv.add(row.overture_id);
  }
  const fresh = [...targets].filter(([, p]) => !haveOv.has(p.id) && !have.has(`${p.name}|${String(p.street).trim()}`.toLowerCase()));
  info(`instagram menus: ${targets.size} handles on usable places, ${fresh.length} without a row yet`);

  const c = creds(process.env);
  if (!c) { warn("Instagram Graph is off (INSTAGRAM_TOKEN and INSTAGRAM_BUSINESS_ID)"); return; }
  const rate = createRate();
  const checked = readJson(CHECKED, {});
  const now = new Date();
  const RANK = { tea_room: 0, bubble_tea_shop: 0, tea_shop: 0, dessert_shop: 1, japanese_restaurant: 1, coffee_roastery: 2, cafe: 3, coffee_shop: 3, bakery: 3, juice_bar: 4, smoothie_juice_bar: 4, ice_cream_shop: 4, breakfast_and_brunch_restaurant: 4 };
  const rank = ([, p]) => (mentions.has(p.id) ? -1 : RANK[p.tax] ?? 5);
  const due = fresh.sort((a, b) => rank(a) - rank(b)).filter(([h]) => { const k = checked[h]; return !k || (k.error && now - Date.parse(k.checked) > 7 * 86400000) || (!k.error && now - Date.parse(k.checked) > 14 * 86400000); });
  const cap = Math.min(+arg("--limit", 120), runAllowance(rate.used()));
  info(`instagram menus: ${due.length} due, ${cap} calls allowed this run (${rate.used()} used this hour)`);
  let calls = 0, ok = 0, errs = 0;
  for (const [h] of due) {
    if (calls >= cap || dry) break;
    calls++;
    try {
      const j = await graph(postsUrl(c, h), rate, fetch);
      const s = drinksFromPosts(mediaOf(j));
      checked[h] = { checked: now.toISOString(), posts: s.posts, with_matcha: s.with_matcha, drinks: s.drinks };
      ok++;
    } catch (e) {
      if (e instanceof Stop) { warn(e.message); break; }
      checked[h] = { checked: now.toISOString(), error: String(e.message).slice(0, 100) };
      errs++;
    }
  }
  if (!dry && calls) {
    const wl = wlib.load();
    for (const [h, p] of due.slice(0, calls)) {
      const k = checked[h]; if (!k) continue;
      let acc = wl.accounts.find((a) => a.platform === "instagram" && a.handle.toLowerCase() === h);
      if (!acc && !k.error && k.with_matcha > 0) acc = wlib.addCandidate(wl, { handle: h, found_via: "overture", found_from: ownSite(p.website) || "https://docs.overturemaps.org/guides/places/", notes: `${p.city}, ${stateOf(p)} | ${p.name} (${p.tax}); Triangle gap lane, ${k.with_matcha} of ${k.posts} recent posts name matcha` });
      if (acc && k.error) (wlib.isInvalidUserId(k.error) ? wlib.markUnreadable : wlib.recordGraphError)(acc, k.error, now);
    }
    wlib.save(wl);
  }
  if (!dry) fs.writeFileSync(CHECKED, JSON.stringify(checked, null, 1) + "\n");
  // Rows from everything read so far (this run and earlier ones).
  const rows = [];
  for (const [h, p] of fresh) {
    const k = checked[h];
    if (!k || k.error) continue;
    const row = rowFromPosts({ name: p.name, address: String(p.street).trim(), city: p.city, state: stateOf(p), zip: p.zip, website: ownSite(p.website), phone: p.phone, overture_id: p.id, lat: p.lat, lng: p.lng, overture_sources: [] }, k, { instagram: h, read: k.checked.slice(0, 10) });
    if (row) rows.push(row);
  }
  if (!dry) fs.writeFileSync(out, JSON.stringify({ generated: now.toISOString(), group: "instagram-triangle", shops: rows }, null, 1) + "\n");
  const read = Object.values(checked), strong = rows.filter((r) => !r.note).length;
  info(`instagram menus: ${calls} read this run (${ok} ok, ${errs} Graph errors); in total ${read.length} handles read, ${read.filter((k) => k.error).length} unreadable; rows ${rows.length} (${strong} with three or more drinks, ${rows.length - strong} "Menu mentions matcha")`);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) main().catch((e) => { console.error(e); process.exit(1); });
