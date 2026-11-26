// Matcha drink names from a business or creator account's recent Instagram captions (Graph API only; nothing is scraped, no picture is copied).
// Evidence level "instagram-posts": three or more distinct matcha drink names across the account's last 30 posts make a tier "serves" row, source_url
// the permalink of the newest post that names one. One or two make a "Menu mentions matcha" row. The words come from the same dictionary that reads
// event menus (ingest/lib/menu-terms.js, ingest/lib/extract.js menuFromText).
import { menuFromText } from "../extract.js";
import { FLAVORS } from "../menu-terms.js";
import { drinkLooksOk } from "./drinks.js";

export const MIN_POST_DRINKS = 3;
export const POSTS_READ = 30;
const FLAV = FLAVORS.flatMap((f) => f.split("|")).filter((w) => !/^(oat|almond|hazelnut|espresso|dirty|sparkling|iced|cloud|orange|mint|ginger|apple|pear|melon|cinnamon|maple)$/.test(w)).sort((a, b) => b.length - a.length).join("|");
const NOUN = "latte|soda|tonic|lemonade|cold foam|cold brew|float|affogato|frappe|shot|bowl|milk tea|cream|smoothie|spritz|mojito|espresso|cloud|fizz|refresher|shake|slush|boba|bubble tea|flight|mocha";
const NAMED = new RegExp(`\\b(?:(?:${FLAV})\\s+)?(?:(?:iced|hot|cold)\\s+)?matcha\\s+(?:${NOUN})\\b|\\b(?:${FLAV})\\s+matcha\\b|\\bmatcha\\s+(?:${FLAV})\\b`, "gi");
const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9 +&'-]+/g, " ").replace(/\b(iced|hot|cold)\s+/g, "").replace(/\s+/g, " ").trim();
const title = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// "rose matcha" and "rose matcha soda" are one drink: a name that is the start of a longer one goes.
const dropPrefixes = (names) => names.filter((n) => !names.some((m) => m !== n && m.startsWith(n + " ")));

// Distinct drink names ("rose matcha soda") named in one caption: menu-list items and "<flavor> matcha <drink>" phrases that contain the word matcha.
export function drinksFromCaption(text) {
  const t = String(text || "");
  if (!/matcha/i.test(t)) return [];
  const out = new Set();
  for (const m of menuFromText(t)) if (/matcha/i.test(m)) out.add(clean(m));
  for (const m of t.matchAll(NAMED)) out.add(clean(m[0]));
  return dropPrefixes([...out].filter((n) => n !== "matcha" && n.includes("matcha") && drinkLooksOk(title(n))));
}

// Posts [{caption, permalink, timestamp}] -> {posts, with_matcha, drinks: [{name, permalink, timestamp}]} (a drink keeps the newest post that names it).
export function drinksFromPosts(posts) {
  const list = [...(posts || [])].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const seen = new Map();
  let withMatcha = 0;
  for (const p of list) {
    const ds = drinksFromCaption(p.caption);
    if (ds.length) withMatcha++;
    for (const d of ds) if (!seen.has(d)) seen.set(d, { name: title(d), permalink: p.permalink || null, timestamp: p.timestamp || null });
  }
  const keep = new Set(dropPrefixes([...seen.keys()]));
  return { posts: list.length, with_matcha: withMatcha, drinks: [...seen].filter(([k]) => keep.has(k)).map(([, v]) => v) };
}

// The row for a place (Overture-shaped candidate) from what its captions say, or null when no caption names a matcha drink.
export function rowFromPosts(place, summary, { read = new Date().toISOString().slice(0, 10), instagram } = {}) {
  const ds = summary?.drinks || [];
  if (!ds.length) return null;
  const strong = ds.length >= MIN_POST_DRINKS;
  const link = ds[0].permalink;
  if (!link) return null;
  return {
    name: place.name, address: place.address, city: place.city, state: place.state, zip: place.zip || null,
    website: place.website || null, instagram: instagram || place.instagram || null, phone: place.phone || null, opening_hours: null,
    menu_url: link, image_url: null, image_credit: null, source_url: link, read, confirmed_via: "instagram-posts", tier: "serves",
    menu_matcha: ds.slice(0, 12).map((d) => ({ name: d.name, price: null })),
    ...(strong ? {} : { note: `Menu mentions matcha: ${ds.length} drink named in recent posts` }),
    notes: `Read from the last ${summary.posts} public posts of @${instagram || place.instagram} through the Instagram Graph API (${summary.with_matcha} name matcha); source_url is the newest post that names a drink.`,
    ...(place.overture_id ? { overture_id: place.overture_id, lat: place.lat, lng: place.lng, overture_sources: place.overture_sources || [] } : {}),
  };
}
