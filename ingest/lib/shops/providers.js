// Keyed place search for storefronts: Yelp Fusion and Foursquare Places. OFF until YELP_API_KEY / FOURSQUARE_API_KEY exist in .env.
//
// How the terms are respected: a provider answer is used to FIND a candidate (name, address, website, phone, categories), and is kept only in
// the gitignored cache for 24 hours. A row reaches data/ only after the shop's own public site confirms it (confirmCandidate: the site prints
// the same street number and the shop's menu or name says matcha), so what we store comes from the shop's own pages; from the provider we
// keep only its place id (yelp_id / fsq_id) and the attribution line the terms require. No rating, review text, photo or provider URL is stored.
// Yelp Fusion gives no website, so a Yelp candidate stays in the cache for a worker to confirm by name (it never becomes a row on its own).
//
//   Yelp:       GET https://api.yelp.com/v3/businesses/search?term=matcha&location=<city, ST>&categories=<aliases>&limit=50   (Bearer key; free 500 calls a day)
//   Foursquare: GET https://places-api.foursquare.com/places/search?query=matcha&near=<city, ST>&limit=50   (Bearer service key,
//               X-Places-Api-Version header; fields fsq_place_id, name, location, latitude, longitude, categories, website, tel, social_media)
import fs from "node:fs";
import { UA } from "../fetch.js";
import { BRAND_NAMES } from "./brands.js";
import { htmlToLines } from "../html.js";
import { readPage } from "../../../tools/shop-read.js";

export const YELP_BASE = "https://api.yelp.com/v3/businesses/search";
export const FSQ_BASE = "https://places-api.foursquare.com/places/search";
export const FSQ_VERSION = "2025-06-17";
export const ATTRIBUTION = { yelp: "Places found with Yelp Fusion", foursquare: "Places found with Foursquare" };
export const DAILY_CAP = { yelp: 400, foursquare: 300 };
const TTL_MS = 24 * 3600 * 1000;
const CACHE = ".cache/keyed-places.json";

// ---- parsing ---------------------------------------------------------------------------------------------------------------------------
export function parseYelp(json) {
  return (json?.businesses || []).filter((b) => b && b.name && !b.is_closed).map((b) => ({
    provider: "yelp", provider_id: b.id, name: b.name,
    address: b.location?.address1 || null, city: b.location?.city || null, state: b.location?.state || null, zip: b.location?.zip_code || null,
    lat: b.coordinates?.latitude ?? null, lng: b.coordinates?.longitude ?? null, phone: b.phone || null, website: null, instagram: null,
    categories: (b.categories || []).map((c) => String(c.alias || c.title || "").toLowerCase()),
  }));
}

export function parseFoursquare(json) {
  return (json?.results || []).filter((p) => p && p.name && !p.date_closed).map((p) => ({
    provider: "foursquare", provider_id: p.fsq_place_id || p.fsq_id, name: p.name,
    address: p.location?.address || null, city: p.location?.locality || null, state: p.location?.region || null, zip: p.location?.postcode || null,
    lat: p.latitude ?? p.geocodes?.main?.latitude ?? null, lng: p.longitude ?? p.geocodes?.main?.longitude ?? null,
    phone: p.tel || null, website: /^https?:/i.test(p.website || "") ? p.website : null, instagram: p.social_media?.instagram || null,
    categories: (p.categories || []).map((c) => String(c.name || "").toLowerCase()),
  }));
}

// ---- the core versus serves test (names and categories only; the shop's own site decides) -----------------------------------------------
const CHAIN = new RegExp("^(" + [...BRAND_NAMES, "Matcha Cafe Maiko", "Premium Matcha Cafe Maiko", "Sorate", "Kyo Matcha", "Meccha Matcha", "Aoko Matcha", "Kijitora", "Nippon Cha", "Spot of Tea", "Cafe Matcha"].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");
const TEAISH = /tea|matcha|japanese|cafe|coffee|kissa|bakery|dessert|juice|boba|bubble/;
const NOT_A_SHOP = /bar\b|pub\b|brewery|nightlife|lounge|night ?club|gas station|convenience|grocery|supermarket|pharmacy|hotel|school|university|studio|gym|salon|spa\b|florist|restaurant(?!.*tea)/;

// -> "core" (name says matcha or a known chain), "serves-check" (a coffee or tea place: its own menu must show three matcha drinks), or null.
export function tierHint(c) {
  if (!c?.name) return null;
  if (/matcha/i.test(c.name) || CHAIN.test(c.name.trim())) return "core";
  const cats = (c.categories || []).join(" ");
  if (NOT_A_SHOP.test(cats) && !/tea|coffee|cafe|bakery|dessert/.test(cats)) return null;
  return TEAISH.test(cats) ? "serves-check" : null;
}

// ---- reading the shop's own site -----------------------------------------------------------------------------------------------------
const streetNumber = (a) => (/^\s*(\d{1,6})/.exec(a || "") || [])[1] || null;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Distinct matcha drink lines on a menu page's text: short lines with "matcha", names only (a trailing price is split off).
export function matchaDrinks(html) {
  const seen = new Set(), out = [];
  for (const line of htmlToLines(html)) {
    if (line.length > 70 || line.length < 5 || !/matcha/i.test(line) || /[.!?]\s+[A-Z]/.test(line) || /\b(our|we|your|you|the best|shop|buy|order online|subscribe)\b/i.test(line)) continue;
    const m = /^(.*?)(?:\s*[-–·:]?\s*(\$\s?\d+(?:\.\d{2})?\+?))?$/.exec(line.trim());
    const name = (m?.[1] || line).replace(/\s+/g, " ").trim();
    if (name.length < 5 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, price: m?.[2] || null });
  }
  return out;
}

// Candidate + the shop's own pages -> a curated row (data/shops-*.json shape) or { held: reason }. `get(url)` -> {ok, text}.
export async function confirmCandidate(c, get, { read = new Date().toISOString().slice(0, 10) } = {}) {
  if (!c.website) return { held: "no website from the provider (a worker confirms it by name)" };
  let base; try { base = new URL(c.website); } catch { return { held: "website not a url" }; }
  if (/instagram\.com|facebook\.com|linktr\.ee|ubereats|doordash|grubhub|toasttab|yelp\.com/i.test(base.host)) return { held: "provider website is a social or ordering page" };
  const pages = [];
  for (const p of ["/", "/menu", "/locations", "/contact", "/about"]) {
    let r; try { r = await get(new URL(p, base).href); } catch { continue; }
    if (r?.ok) pages.push({ url: new URL(p, base).href, html: r.text, rd: readPage(r.text, new URL(p, base).href) });
  }
  if (!pages.length) return { held: "own site not readable" };
  const rd = (k) => pages.map((p) => p.rd[k]).find(Boolean) || null;
  const mentions = pages.reduce((n, p) => n + p.rd.matcha_mentions, 0);
  // The site must print the same street number (or the provider's zip) as the candidate.
  const num = streetNumber(c.address);
  const printed = pages.map((p) => p.rd).filter((r) => r.address);
  const sameSpot = printed.find((r) => (num && streetNumber(r.address) === num) || (c.zip && r.zip && r.zip.slice(0, 5) === String(c.zip).slice(0, 5)));
  if (!sameSpot) return { held: "own site prints no matching street address" };
  const menuPage = pages.find((p) => /menu/i.test(p.url) && p.rd.matcha_mentions) || pages.find((p) => p.rd.matcha_mentions);
  const hint = tierHint(c);
  let tier = null, menu_matcha = null;
  if (hint === "core" && mentions >= 3) tier = "shop";
  else {
    const drinks = menuPage ? matchaDrinks(menuPage.html) : [];
    if (drinks.length >= 3) { tier = "serves"; menu_matcha = drinks.slice(0, 12); }
  }
  if (!tier) return { held: hint === "core" ? "own site barely mentions matcha" : "fewer than three matcha drinks on the site's own menu page" };
  const best = (k) => sameSpot[k] || rd(k);
  return {
    row: {
      name: c.name, address: sameSpot.address, city: sameSpot.city || c.city, state: (sameSpot.state || c.state || "").toUpperCase(), zip: sameSpot.zip || c.zip || null,
      website: c.website, instagram: best("instagram") || (c.instagram ? String(c.instagram).replace(/^@/, "") : null), phone: best("phone") || c.phone || null,
      opening_hours: rd("hours_osm"), menu_url: tier === "serves" && menuPage ? menuPage.url : rd("menu_url"),
      image_url: rd("image"), image_credit: rd("image") ? `Photo: ${c.name} website` : null,
      source_url: sameSpot.url || pages[0].url, read, confirmed_via: "own-site", tier, ...(menu_matcha ? { menu_matcha } : {}),
      provider: c.provider, provider_id: c.provider_id, attribution: ATTRIBUTION[c.provider],
    },
  };
}

// ---- searching -----------------------------------------------------------------------------------------------------------------------------
export function createProviders({ env = process.env, http = fetch, now = () => Date.now(), cachePath = CACHE, gapMs = 1100 } = {}) {
  let cache = { days: {}, q: {} };
  try { cache = { days: {}, q: {}, ...JSON.parse(fs.readFileSync(cachePath, "utf8")) }; } catch { /* first run */ }
  const keys = { yelp: env.YELP_API_KEY || "", foursquare: env.FOURSQUARE_API_KEY || "" };
  const stopped = new Set();
  let last = 0;
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const used = (p) => cache.days[day()]?.[p] || 0;
  const save = () => { try { fs.mkdirSync(".cache", { recursive: true }); fs.writeFileSync(cachePath, JSON.stringify(cache)); } catch { /* cache only */ } };

  async function search(provider, city, state) {
    const key = keys[provider];
    if (!key || stopped.has(provider)) return { candidates: [], skipped: key ? "stopped" : "no key" };
    const q = `${provider}|${city}|${state}`.toLowerCase();
    const hit = cache.q[q];
    if (hit && now() - hit.at < TTL_MS) return { candidates: hit.candidates, cached: true };
    if (used(provider) >= DAILY_CAP[provider]) { stopped.add(provider); return { candidates: [], skipped: "daily cap" }; }
    const wait = last + gapMs - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = now();
    cache.days[day()] = { ...(cache.days[day()] || {}), [provider]: used(provider) + 1 };
    const place = `${city}, ${state}`;
    const url = provider === "yelp"
      ? `${YELP_BASE}?term=matcha&location=${encodeURIComponent(place)}&categories=${encodeURIComponent("tea,coffee,cafes,bubbletea,juicebars,desserts,japanese")}&limit=50&sort_by=best_match`
      : `${FSQ_BASE}?query=matcha&near=${encodeURIComponent(place)}&limit=50&fields=${encodeURIComponent("fsq_place_id,name,location,latitude,longitude,categories,website,tel,social_media,date_closed")}`;
    const headers = provider === "yelp" ? { Authorization: `Bearer ${key}`, "User-Agent": UA, Accept: "application/json" } : { Authorization: `Bearer ${key}`, "X-Places-Api-Version": FSQ_VERSION, "User-Agent": UA, Accept: "application/json" };
    const r = await http(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { if (r.status === 429 || r.status === 401 || r.status === 403) stopped.add(provider); save(); return { candidates: [], skipped: `HTTP ${r.status}` }; }
    const candidates = (provider === "yelp" ? parseYelp : parseFoursquare)(await r.json()).map((c) => ({ ...c, hint: tierHint(c) })).filter((c) => c.hint);
    cache.q[q] = { at: now(), candidates };
    save();
    return { candidates };
  }
  return { search, save, enabled: (p) => !!keys[p], used };
}
