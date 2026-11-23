// npm run outreach: the host outreach kit's data. Writes data/outreach/brands.csv (every brand with a brand page: handle, city, kind,
// last dated post we saw, claimed or not, a personal claim link) and data/outreach/top100.csv (the hundred most worth a first message).
// Brands are the ones gen-pages gives a page: every active source plus every named, not-dropped Instagram account on the watch list.
// Claims are read from the site's own moderator queue (GET /api/queue?kinds=claim, INTAKE_URL and INTAKE_TOKEN from .env) when the token
// exists; only the fact of a claim is kept (a brand slug or name matched), never an email. Without the token the column reads "unknown".
// Sending is Steven's, by hand, from his own accounts: nothing here messages anyone.
import "../ingest/lib/env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { handleSlug } from "./gen-pages.js";
import { SITE_URL as SITE } from "./site-url.js";

export { SITE };
const DAY = 86400000;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";

// The personal link: the claim form reads ?brand= and ?handle= into its two fields (site/add/add.js).
export const claimLink = (name, handle) => `${SITE}/claim/?brand=${encodeURIComponent(String(name).slice(0, 80))}${handle ? `&handle=${encodeURIComponent("@" + handle)}` : ""}`;

const day = (iso) => (iso ? String(iso).slice(0, 10) : "");
const later = (a, b) => (!a ? b : !b ? a : a >= b ? a : b);

// brands, events, watchlist, sources -> rows. now: ms.
export function buildRows({ sources, events, watchlist, claims = null, now = Date.now() }) {
  const brands = new Map();
  const srcById = new Map(sources.map((s) => [s.id, s]));
  for (const s of sources) {
    if (s.active === false) continue;
    const slug = handleSlug(s.instagram, s.id);
    if (!slug || brands.has(slug)) continue;
    brands.set(slug, { slug, name: s.brand, handle: s.instagram ? handleSlug(s.instagram) : "", platform: s.instagram ? "instagram" : s.tiktok ? "tiktok" : "", website: s.website || "", city: s.home_city || "", state: s.home_state || "", kind: s.kind || "", category: s.category || "", ids: new Set([s.id]), sourced: "sources.json", followers: "", watch: "", lastPost: "", events: [] });
  }
  for (const a of watchlist.accounts || []) {
    if (!a.name || a.status === "dropped" || (a.platform && a.platform !== "instagram")) continue;
    const slug = handleSlug(a.handle);
    if (!slug) continue;
    let b = brands.get(slug);
    if (!b) { b = { slug, name: a.name, handle: slug, platform: "instagram", website: a.website || "", city: "", state: "", kind: "", category: "", ids: new Set(a.source_id ? [a.source_id] : []), sourced: "watchlist", followers: "", watch: "", lastPost: "", events: [] }; brands.set(slug, b); }
    b.followers = a.followers_count || b.followers;
    b.watch = a.status || "";
    b.lastPost = later(b.lastPost, day(a.last_post_with_popup));
    b.website = b.website || a.website || "";
  }
  const bySource = new Map();
  for (const b of brands.values()) for (const id of b.ids) if (!bySource.has(id)) bySource.set(id, b);
  for (const e of events) {
    const h = e.handle || (srcById.get(e.source_id) || {}).instagram;
    const b = brands.get(handleSlug(h)) || bySource.get(e.source_id);
    if (b) b.events.push(e);
  }
  // upcoming pop-ups per city: where the map is thin comes first
  const upcoming = (e) => String(e.end || e.start || "").slice(0, 10) >= new Date(now).toISOString().slice(0, 10);
  const cityUp = new Map();
  for (const e of events) if (upcoming(e) && e.city) { const k = `${e.city}, ${e.state}`; cityUp.set(k, (cityUp.get(k) || 0) + 1); }
  const claimed = (b) => {
    if (!claims) return "unknown";
    const norm = (x) => String(x || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "");
    return claims.some((c) => norm(c.handle) === norm(b.handle) && b.handle || norm(c.brand) === norm(b.name) || norm(c.brand) === norm(b.slug)) ? "yes" : "no";
  };
  const rows = [];
  for (const b of brands.values()) {
    const dated = b.events.map((e) => day(e.start)).sort();
    const lastSeen = later(b.lastPost, dated.length ? dated[dated.length - 1] : "");
    const up = b.events.filter(upcoming).length;
    const city = b.city || (b.events.find((e) => e.city) || {}).city || "";
    const state = b.state || (b.events.find((e) => e.state) || {}).state || "";
    const cityUpcoming = cityUp.get(`${city}, ${state}`) || 0;
    const ageDays = lastSeen ? Math.floor((now - Date.parse(lastSeen + "T12:00:00Z")) / DAY) : null;
    const popupish = ["popup", "organizer", "festival"].includes(b.kind) ? 1 : 0;
    const active = ageDays !== null && ageDays <= 60 || up > 0;
    // Score: active with dated posts first, then thin metros (fewer upcoming in the city), then pop-up kinds, then reach.
    const score = (active ? 100 : 0) + (up > 0 ? 25 : 0) + Math.max(0, 30 - Math.min(30, cityUpcoming * 3)) + popupish * 15 + (b.watch === "watching" ? 10 : 0) + Math.min(10, Math.log10(1 + (+b.followers || 0)) * 2) - (city && state ? 0 : 60);
    rows.push({
      brand: b.name, handle: b.handle, platform: b.platform, city, state, kind: b.kind || "unknown", category: b.category, website: b.website,
      instagram_url: b.handle && b.platform === "instagram" ? `https://www.instagram.com/${b.handle}/` : "", followers: b.followers, watch_status: b.watch,
      last_dated_post_seen: lastSeen, upcoming_events: up, city_upcoming: cityUpcoming, active: active ? "yes" : "no",
      has_claim: claimed(b), claim_link: claimLink(b.name, b.handle), brand_page: b.handle ? `${SITE}/brand/${b.slug}/` : "", score: Math.round(score * 10) / 10,
    });
  }
  return rows.sort((a, z) => z.score - a.score || String(a.brand).localeCompare(z.brand));
}

export const COLS = ["brand", "handle", "platform", "city", "state", "kind", "category", "website", "instagram_url", "followers", "watch_status", "last_dated_post_seen", "upcoming_events", "city_upcoming", "active", "has_claim", "claim_link", "brand_page", "score"];

export async function fetchClaims(env = process.env) {
  if (!env.INTAKE_URL || !env.INTAKE_TOKEN) return null;
  try {
    const r = await fetch(`${env.INTAKE_URL.replace(/\/$/, "")}/api/queue?kinds=claim`, { headers: { authorization: `Bearer ${env.INTAKE_TOKEN}`, "user-agent": "matcha-map-outreach/0.1" } });
    if (!r.ok) return null;
    const j = await r.json();
    const list = j.claim || j.items || j.claims || (Array.isArray(j) ? j : []);
    return list.map((x) => ({ brand: x.brand || x.data?.brand || "", handle: x.handle || x.data?.handle || "" }));
  } catch { return null; }
}

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  const rows = buildRows({ sources: read(path.join(root, "data/sources.json")), events: read(path.join(root, "data/events.json")).events, watchlist: read(path.join(root, "data/watchlist.json")), claims: await fetchClaims() });
  const out = path.join(root, "data/outreach");
  fs.mkdirSync(out, { recursive: true });
  // The hundred: active, a dated post or a coming pop-up, not claimed yet, a handle to message.
  const top = rows.filter((r) => r.active === "yes" && r.has_claim !== "yes" && r.handle).slice(0, 100).map((r, i) => ({ rank: i + 1, ...r }));
  fs.writeFileSync(path.join(out, "brands.csv"), toCsv(rows, COLS));
  fs.writeFileSync(path.join(out, "top100.csv"), toCsv(top, ["rank", ...COLS]));
  const n = (f) => rows.filter(f).length;
  console.log(`outreach: ${rows.length} brands, ${n((r) => r.active === "yes")} active, ${n((r) => r.has_claim === "yes")} claimed, claims ${rows[0]?.has_claim === "unknown" ? "unknown (no token)" : "read"}; top100 written (${top.length})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
