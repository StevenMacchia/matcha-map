// node tools/social/plan.js [--date YYYY-MM-DD] [--json]: the day's @matchamap.app posts, chosen from the data.
// The date is the day the posts go out (default tomorrow in America/New_York, since the daily run makes the next day's
// outbox). 2 to 3 feed posts and 2 to 3 stories, in this order of value: the day's pop-ups in the city with the most,
// "This weekend in <City>" (posting days Thursday and Friday), a new-shop spotlight, a series reminder, then other
// cities' pop-ups that day. No brand is featured twice within 7 days (tools/brand/outbox/history.json); handles come
// only from our data (events, sources.json, brands.json, shops.json), never made up. Same date + same data + same
// history = the same plan: history entries on or after the date are ignored, so a re-run of a day is identical.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "../site-url.js";
import { brandOf, placeOf } from "../../ingest/lib/names.js";
import { whatTheyPour } from "./drinks.js";
import { assignStyles, activeStyles } from "./styles.js";
import { dayKey, addDays, loadCities, makeCityLocator, weekendWindow, inWindow } from "../gen-pages.js";
import { readSiteShops } from "../../ingest/lib/site-shops.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HISTORY_FILE = path.join(ROOT, "tools", "brand", "outbox", "history.json");
export const CAPTION_MAX = 2200;
export const REPEAT_DAYS = 7;
export const BANNED = /(kawaii|uwu|\bcute|cutesy|girly)/i;
export const HANDLE = /^(?!\.)[a-z0-9._]{2,30}(?<!\.)$/;
export const FEED_TIMES = ["10:00", "13:00", "17:00"];
// Stories run in location groups (a title story, then up to two of that place's), up to three groups a day; each group's
// stories go out close together: morning, midday, afternoon.
export const STORY_TIMES = ["08:00", "08:30", "09:00", "11:30", "12:00", "12:30", "15:30", "16:00", "16:30"];
export const MAX_GROUPS = 2, GROUP_CONTENT = 2;      // the one knob: groups a day (a title and up to two stories each: 6 stories at most)
const STATE_FULL = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
// Regions that get a post of their own every week even when their data is thin (Steven, 2026-11-23: "1-2 a week from
// NC triangle area too"): when the last six days had no feed post from the region, today's second feed post is its own;
// when they had no story, one story slot is. What that post is comes from what there is, in this order: today's
// pop-ups there, the coming weekend there, a shop there never featured, the next pop-up there within two weeks, a
// weekly one there. Handles are tagged only when our data has them, like every other post.
export const REGIONS = { triangle: { name: "the Triangle", state: "NC", cities: ["Raleigh", "Durham", "Chapel Hill", "Cary", "Apex", "Morrisville", "Carrboro", "Wake Forest", "Holly Springs"] } };
export function regionOf(city, state) {
  const c = norm(city);
  for (const [k, r] of Object.entries(REGIONS)) if (r.state === state && r.cities.some((x) => norm(x) === c)) return k;
  return null;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const OK_KINDS = new Set(["popup", "cafe", "organizer", "festival", "tea-brand"]);

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
export function hash(s) { let h = 5381; s = String(s || ""); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
export const slug = (s) => String(s || "x").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
export const cleanHandle = (h) => { const s = String(h || "").trim().replace(/^@/, "").toLowerCase(); return HANDLE.test(s) ? s : null; };
const profileHandle = (url) => { const m = /instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/.exec(String(url || "")); return m && !["p", "reel", "explore", "stories"].includes(m[1].toLowerCase()) ? cleanHandle(m[1]) : null; };

// ---- dates and times, in words ----
export const tomorrowNY = (now = Date.now()) => addDays(dayKey(now, "America/New_York"), 1);
const dowOf = (k) => new Date(k + "T12:00:00Z").getUTCDay();
export const dayWords = (k) => { const d = new Date(k + "T12:00:00Z"); return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
function clock(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(ms).map((x) => [x.type, x.value]));
  const ap = String(p.dayPeriod || "").toLowerCase().replace(/\./g, "");
  return { text: (p.minute === "00" ? p.hour : `${p.hour}:${p.minute}`) + " " + ap, midnight: p.hour === "12" && p.minute === "00" && ap === "am" };
}
export function timeWords(e) {
  const tz = e.tz || "America/New_York", st = Date.parse(e.start);
  if (e.all_day || isNaN(st)) return "All day";
  const a = clock(st, tz);
  if (a.midnight) return "Time on their post";
  const en = e.end ? Date.parse(e.end) : NaN;
  if (isNaN(en) || en <= st) return `From ${a.text}`;
  const b = clock(en, tz);
  return b.text === a.text ? a.text : `${a.text} to ${b.text}`;
}
const eventDay = (e) => dayKey(Date.parse(e.start), e.tz || "America/New_York");
const weekdayRule = (days) => {
  const d = [...new Set(days)].filter((x) => x >= 0 && x <= 6).sort();
  if (!d.length) return null;
  if (d.length === 7) return "Every day";
  const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (run && d.length >= 3) return `${DAYS[d[0]]} to ${DAYS[d[d.length - 1]]}`;
  const names = d.map((x) => DAYS[x]);
  return "Every " + (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);
};

// ---- data ----
export function loadData(root = ROOT) {
  const events = (readJson(path.join(root, "site", "data", "events.json"), { events: [] }).events) || [];
  const shops = readSiteShops(root).shops || []; // every field (site/data/shops.json is the slim file)
  const brands = (readJson(path.join(root, "site", "data", "brands.json"), { brands: [] }).brands) || [];
  const sources = readJson(path.join(root, "data", "sources.json"), []);
  const hashtags = readJson(path.join(root, "tools", "social", "hashtags.json"), { always: ["matcha", "matchapopup"], city: [], rotating: [] });
  const cities = loadCities(root);
  const hasCityPage = (c) => fs.existsSync(path.join(root, "site", "city", c.state.toLowerCase(), c.slug, "index.html"));
  return { events, shops, brands, sources, hashtags, cities, hasCityPage };
}

// Every handle our data knows, so a test (and the reader) can check that nothing tagged was made up.
export function knownHandles(data) {
  const s = new Set();
  const add = (h) => { const c = cleanHandle(h); if (c) s.add(c); };
  for (const e of data.events) { add(e.handle); add(profileHandle(e.links && e.links.instagram)); if (String(e.venue || "").startsWith("@")) add(e.venue); }
  for (const x of data.sources) add(x.instagram);
  for (const b of data.brands) add(b.handle);
  for (const x of data.shops) add(x.instagram);
  return s;
}

function context(data) {
  const srcById = new Map(data.sources.map((s) => [s.id, s]));
  const locate = makeCityLocator(data.cities);
  const shopByName = new Map();
  for (const s of data.shops) if (s.name && cleanHandle(s.instagram)) shopByName.set(`${norm(s.name)}|${norm(s.city)}`, cleanHandle(s.instagram));
  const brandByName = new Map();
  for (const b of data.brands) if (b.name && cleanHandle(b.handle)) brandByName.set(norm(String(b.name).split("|")[0]), cleanHandle(b.handle));
  const pourByKey = new Map();
  for (const s of data.shops) {
    if (!s.name || !Array.isArray(s.menu_matcha) || !s.menu_matcha.length) continue;
    const pour = whatTheyPour(s.menu_matcha, 5);
    if (!pour.items.length) continue;
    const h = cleanHandle(s.instagram);
    if (h) pourByKey.set("h:" + h, pour);
    pourByKey.set(`n:${norm(s.name)}|${norm(s.city)}`, pour);
  }
  return { srcById, locate, shopByName, brandByName, pourByKey };
}

// The drinks a pop-up names: its own menu text first (a pop-up's menu lines are drinks), else the brand's own shop row.
function eventPour(e, handle, brand, ctx) {
  const own = whatTheyPour((Array.isArray(e.menu) ? e.menu : []).map((m) => String(m).trim()), 5, undefined, true);
  if (own.items.length) return own;
  return (handle && ctx.pourByKey.get("h:" + handle)) || ctx.pourByKey.get(`n:${norm(brand)}|${norm(e.city)}`) || null;
}

// One event, as the posts need it: the brand as shown, its handle, the venue and the venue's handle when our data has one.
function view(e, ctx) {
  const src = ctx.srcById.get(e.source_id);
  const handle = cleanHandle(e.handle) || profileHandle(e.links && e.links.instagram) || cleanHandle(src && src.instagram);
  // an Instagram display name ("Name | tagline") keeps the name
  const brand = String(brandOf({ brand: e.brand, handle, auto_name: src && src.auto_name }) || "").split(/\s+[|•·]\s+/)[0].replace(/\s+/g, " ").trim();
  const v = String(e.venue || "").trim();
  let venue = "", venueHandle = null;
  if (v.startsWith("@")) venueHandle = cleanHandle(v);
  else if (placeOf({ ...e, handle }) === v) { venue = v; venueHandle = ctx.shopByName.get(`${norm(v)}|${norm(e.city)}`) || ctx.brandByName.get(norm(v)) || null; }
  if (venueHandle === handle) venueHandle = null;
  if (venue && norm(venue) === norm(brand)) venue = "";
  const c = ctx.locate(e);
  const city = c ? c.name : e.city, state = c ? c.state : e.state;
  return {
    id: e.id, brand, handle, key: handle || norm(brand), venue, venueHandle, address: String(e.address || "").trim(),
    city, state, cityObj: c, day: eventDay(e), time: timeWords(e),
    pour: eventPour(e, handle, brand, ctx),
    menu: (Array.isArray(e.menu) ? e.menu : []).map((m) => String(m).trim()).filter((m) => m && m.length <= 40).slice(0, 4),
    series: e.series && Array.isArray(e.series.weekdays) ? weekdayRule(e.series.weekdays) : null, kind: e.kind,
  };
}
const eligible = (e) => e && e.status !== "cancelled" && OK_KINDS.has(e.kind) && e.category === "matcha" && e.confidence !== "unsure" && e.start && e.city && e.state;

function cityLink(v, data) {
  const c = v.cityObj;
  return c && data.hasCityPage(c) ? `${SITE_URL}/city/${c.state.toLowerCase()}/${c.slug}/` : `${SITE_URL}/`;
}
function hashtagsFor(city, data, date, n) {
  const H = data.hashtags, c = norm(city);
  const rot = H.rotating || [];
  const start = rot.length ? ((Math.round(new Date(date + "T12:00:00Z").getTime() / 864e5) * 2 + n * 2) % rot.length) : 0;
  const pick = rot.length ? [rot[start], rot[(start + 1) % rot.length]] : [];
  const tags = [...(H.always || []), ...(c ? (H.city || []).map((t) => t.replace("{city}", c)) : []), ...pick].map((t) => "#" + norm(t)).filter((t) => t.length > 1);
  return [...new Set(tags)].slice(0, 8);
}
const at = (h) => (h ? ` (@${h})` : "");
const whereOf = (v) => (v.venue ? `at ${v.venue}${at(v.venueHandle)} in ` : v.venueHandle ? `at @${v.venueHandle} in ` : v.address ? `at ${v.address}, ` : "in ") + `${v.city}, ${v.state}`;

// ---- captions ----
function captionEvents(kind, title, list, link, tags, date, more = 0) {
  const lines = [];
  if (list.length === 1) {
    const v = list[0];
    const day = v.day === date ? `today, ${dayWords(v.day)}` : dayWords(v.day);
    lines.push(`${title}. ${v.brand}${at(v.handle)} is popping up ${whereOf(v)}, ${day}, ${v.time.toLowerCase()}.`);
    if (v.menu.length) lines.push(`On the menu: ${v.menu.join(", ")}.`);
  } else {
    lines.push(`${title}: ${list.length} matcha pop-ups.`);
    lines.push(list.map((v) => `${v.brand}${at(v.handle)}, ${kind === "weekend" || kind === "soon" ? dayWords(v.day).split(",")[0] + " " : ""}${v.time.toLowerCase()}${v.venue ? `, ${v.venue}${at(v.venueHandle)}` : v.venueHandle ? `, at @${v.venueHandle}` : ""}`).join("\n") + (more ? `\nand ${more} more on the map` : ""));
  }
  lines.push(`Times and places come from each brand's own posts; check their page before you go.`);
  lines.push(`Every pop-up in ${list[0].city} on the map: ${link}`);
  lines.push(tags.join(" "));
  return lines.join("\n\n") + "\n";
}
function captionShop(s, link, tags) {
  const lines = [`New on the map: ${s.name}${at(s.handle)} in ${s.city}, ${s.state}.${s.address ? " " + s.address + "." : ""}`];
  if (s.drinks.length) lines.push(`Matcha on the menu: ${s.drinks.join(", ")}.`);
  lines.push(`Find it and more matcha spots in ${s.city}: ${link}`);
  lines.push(tags.join(" "));
  return lines.join("\n\n") + "\n";
}
function captionFeatured(s, link, tags) {
  const names = s.pour.items.map((i) => i.name);
  const lines = [`Featured: ${s.name}${at(s.handle)} in ${s.city}, ${s.state}.${s.address ? " " + s.address + "." : ""}`];
  if (names.length) lines.push(`What they pour: ${names.join(", ")}${s.pour.more ? `, and ${s.pour.more} more` : ""}.`);
  lines.push(`Find it and more matcha spots in ${s.city}: ${link}`);
  lines.push(tags.join(" "));
  return lines.join("\n\n") + "\n";
}
function captionCity(c, tags) {
  const list = c.events.map((v) => `${v.brand}${at(v.handle)}`).join(", ");
  return [`New on the map in ${c.city}, ${c.state}: ${list}${c.more ? `, and ${c.more} more` : ""}.`, `Every matcha spot in ${c.city}: ${c.link}`, tags.join(" ")].join("\n\n") + "\n";
}
function captionSeries(v, link, tags, date) {
  const next = v.day === date ? `today, ${dayWords(v.day)}` : dayWords(v.day);
  return [`${v.series}: ${v.brand}${at(v.handle)} ${whereOf(v)}, ${v.time.toLowerCase()}.`, `Next one: ${next}.`,
    `Schedules change; check their page before you go.`, `More matcha in ${v.city}: ${link}`, tags.join(" ")].join("\n\n") + "\n";
}

// ---- the plan ----
function historyBefore(history, date) {
  const blocked = new Set(), shopsEver = new Set(), from = addDays(date, -(REPEAT_DAYS - 1)), regionWeek = {};
  for (const k of Object.keys(REGIONS)) regionWeek[k] = { feed: 0, story: 0 };
  for (const [d, h] of Object.entries(history || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= date) continue;
    if (d >= from) for (const b of h.brands || []) blocked.add(b);
    if (d >= from) for (const [k, n] of Object.entries(h.regions || {})) if (regionWeek[k]) { regionWeek[k].feed += +(n && n.feed) || 0; regionWeek[k].story += +(n && n.story) || 0; }
    for (const s of h.shops || []) shopsEver.add(s);
  }
  let lastMetro = null, lastD = "", lastFeedStyle = null, lastSD = "";
  const feat60 = new Set(), cityRecent = new Set(), f60 = addDays(date, -60), c14 = addDays(date, -14);
  for (const [d, h] of Object.entries(history || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < date && d > lastSD && h.styles && h.styles.feed && h.styles.feed.length) { lastSD = d; lastFeedStyle = h.styles.feed[h.styles.feed.length - 1]; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= date || !h.feat) continue;
    if (h.feat.metro && d > lastD) { lastD = d; lastMetro = h.feat.metro; }
    if (d >= f60 && h.feat.shop) feat60.add(h.feat.shop);
    if (d >= c14 && h.feat.city) cityRecent.add(h.feat.city);
  }
  return { blocked, shopsEver, regionWeek, lastMetro, feat60, cityRecent, lastFeedStyle };
}

export function plan({ date, data, history = {}, styles = activeStyles() }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  const ctx = context(data);
  const { blocked, shopsEver, regionWeek, lastMetro, feat60, cityRecent, lastFeedStyle } = historyBefore(history, date);
  const used = new Set();
  const free = (k) => k && !blocked.has(k) && !used.has(k);
  const clean = (s) => !BANNED.test(s);
  const all = data.events.filter(eligible).map((e) => view(e, ctx)).filter((v) => v.brand && clean(v.brand + " " + v.venue + " " + v.menu.join(" ")));
  const groupBy = (list) => {
    const m = new Map();
    for (const v of list) { const k = v.cityObj ? `${v.cityObj.state}/${v.cityObj.slug}` : `${v.state}/${slug(v.city)}`; (m.get(k) || m.set(k, []).get(k)).push(v); }
    return [...m.entries()];
  };
  // one row per brand, and one per slot: the same day, time and place listed under two names is one pop-up
  const firstPerBrand = (list) => {
    const seen = new Set();
    return list.filter((v) => {
      const slot = v.venue || v.address ? `${v.day}|${v.time}|${norm(v.venue || v.address)}` : null;
      if (!free(v.key) || seen.has(v.key) || (slot && seen.has(slot))) return false;
      seen.add(v.key); if (slot) seen.add(slot); return true;
    });
  };
  const rank = (groups) => groups.map(([k, l]) => [k, firstPerBrand(l.sort((a, b) => a.day.localeCompare(b.day) || hash(date + a.id) - hash(date + b.id)))])
    .filter(([, l]) => l.length)
    .sort((a, b) => b[1].length - a[1].length || tagCount(b[1]) - tagCount(a[1]) || hash(date + a[0]) - hash(date + b[0]));
  const tagCount = (l) => l.reduce((n, v) => n + (v.handle ? 1 : 0) + (v.venueHandle ? 1 : 0), 0);
  const cands = [];
  const take = (c) => { c.brands.forEach((b) => used.add(b)); cands.push(c); };
  const eventCand = (kind, list, title, tag) => ({ kind, title, tag, city: list[0].city, state: list[0].state, events: list.slice(0, 4), more: Math.max(0, list.length - 4), brands: list.slice(0, 4).map((v) => v.key), link: cityLink(list[0], data) });

  // 1. the day's pop-ups, the city with the most first
  const today = all.filter((v) => v.day === date && !v.series);
  const todayGroups = rank(groupBy(today));
  if (todayGroups.length) { const l = todayGroups[0][1]; take(eventCand("today", l, `Today in ${l[0].city}`, "Today")); }

  // 2. this weekend in <City>, posted Thursday and Friday
  const dow = dowOf(date);
  const wkKeys = weekendWindow(new Date(date + "T16:00:00Z").getTime()).keys;
  const wk = data.events.filter(eligible).filter((e) => inWindow(e, wkKeys, "America/New_York")).map((e) => view(e, ctx)).filter((v) => v.brand && clean(v.brand + " " + v.venue + " " + v.menu.join(" ")));
  if (dow === 4 || dow === 5) {
    const g = rank(groupBy(wk)).find(([, l]) => l.length >= 2);
    if (g) { const wc = eventCand("weekend", g[1], `This weekend in ${g[1][0].city}`, "This weekend"); wc.feedOnly = true; wc.why = "weekend roundup"; take(wc); }
  }

  // 3. a new shop: first read in the last 7 days, else the one with the most matcha drinks; never one featured before
  let shopPool = [], shopCand = () => null, featuredC = null;
  const metroOf = (s) => (s.cityObj ? s.cityObj.state + "/" + s.cityObj.slug : s.state + "/" + slug(s.city));
  const richness = (s) => (s.tier === "shop" ? 1e6 : 0) + s.pour.items.length * 1e4 + Math.min(s.drinks.length, 40) * 100 + (s.handle ? 50 : 0);
  {
    const from = addDays(date, -REPEAT_DAYS);
    const drinksOf = (s) => {
      const out = [];
      for (const x of Array.isArray(s.menu_matcha) ? s.menu_matcha : []) if (x && x.name) out.push(String(x.name));
      for (const x of (s.menu && Array.isArray(s.menu.items)) ? s.menu.items : []) if (x && x.name && /matcha/i.test(x.name + " " + (x.note || ""))) out.push(String(x.name));
      return [...new Map(out.map((n) => [norm(n), n.replace(/\s+/g, " ").trim()])).values()].filter((n) => n.length <= 32 && clean(n));
    };
    shopPool = data.shops.filter((s) => s.verified !== false && s.name && s.city && s.state && (s.tier === "shop" || s.tier === "serves" || s.tier == null) && !shopsEver.has(s.id) && clean(s.name))
      .map((s) => { const handle = cleanHandle(s.instagram), c = ctx.locate({ city: s.city, state: s.state, lat: s.lat, lng: s.lng });
        return { id: s.id, name: String(s.name).replace(/\s+/g, " ").trim(), handle, key: handle || norm(s.name), city: c ? c.name : s.city, state: c ? c.state : s.state, cityObj: c, address: String(s.address || "").trim(), drinks: drinksOf(s), pour: whatTheyPour(s.menu_matcha, 5), tier: s.tier || "shop", seen: String(s.read || s.fetched || "").slice(0, 10) }; })
      .filter((s) => free(s.key));
    const order = (a, b) => b.pour.items.length - a.pour.items.length || b.drinks.length - a.drinks.length || (b.handle ? 1 : 0) - (a.handle ? 1 : 0) || hash(date + a.id) - hash(date + b.id);
    // a new shop we can tag comes first: the post is for them
    shopCand = (pool) => {
      pool = pool.filter((s) => free(s.key));
      const fresh = pool.filter((s) => s.seen >= from && s.seen < date).sort((a, b) => (b.handle ? 1 : 0) - (a.handle ? 1 : 0) || order(a, b));
      const s = fresh[0] || pool.slice().sort(order)[0];
      return s ? { kind: "shop", title: s.name, tag: "New on the map", city: s.city, state: s.state, shop: { ...s, drinks: s.drinks.slice(0, 4) }, brands: [s.key], shopId: s.id, link: cityLink(s, data) } : null;
    };
    // 3a. the day's featured shop: the post for the grid. Richest first: core tier, most distinct drinks drawn, most menu
    // drinks, a handle we can tag; never one featured in the last 60 days; the metro rotates (not yesterday's); a region
    // owed its weekly feed post (REGIONS) gets its own pick first.
    {
      const fpool = shopPool.filter((s) => free(s.key) && s.pour.items.length >= 3 && !feat60.has(s.id));
      const rank2 = (list) => list.slice().sort((a, b) => richness(b) - richness(a) || hash(date + a.id) - hash(date + b.id));
      let pick = null;
      for (const k of Object.keys(REGIONS)) if (!pick && (regionWeek[k] || {}).feed === 0) pick = rank2(fpool.filter((s) => regionOf(s.city, s.state) === k))[0] || null;
      if (!pick) { const other = fpool.filter((s) => metroOf(s) !== lastMetro); pick = rank2(other.length ? other : fpool)[0] || null; }
      if (pick) {
        used.add(pick.key);
        featuredC = { kind: "featured-shop", why: "featured shop", title: pick.name, tag: "Featured shop", city: pick.city, state: pick.state, region: regionOf(pick.city, pick.state), metro: metroOf(pick),
          shop: { ...pick, drinks: pick.drinks.slice(0, 4) }, brands: [pick.key], shopId: pick.id, link: cityLink(pick, data) };
      }
    }
    const c = shopCand(shopPool);
    if (c) take(c);
  }

  // 4. a series reminder: the next weekly date within a week, soonest first
  {
    const end = addDays(date, 6);
    const ser = firstPerBrand(all.filter((v) => v.series && v.day >= date && v.day <= end).sort((a, b) => a.day.localeCompare(b.day) || hash(date + a.id) - hash(date + b.id)));
    if (ser[0]) { const v = ser[0]; take({ kind: "series", title: v.series, tag: v.series, city: v.city, state: v.state, events: [v], more: 0, brands: [v.key], link: cityLink(v, data) }); }
  }

  // 5. other cities' pop-ups that day, as extras (stories first)
  const shownCity = (l) => cands.some((c) => c.kind === "today" && c.city === l[0].city && c.state === l[0].state);
  for (const [, l] of rank(groupBy(today.filter((v) => !used.has(v.key))))) {
    if (cands.length >= 5) break;
    if (shownCity(l)) continue;
    take(eventCand("today", l, `Today in ${l[0].city}`, "Today"));
  }

  // 5b. with no featured shop, today's pop-up with the fullest menu (3 or more drinks drawn) is the featured piece
  if (!featuredC) {
    const v = today.filter((x) => free(x.key) && x.pour && x.pour.items.length >= 3).sort((a, b) => b.pour.items.length - a.pour.items.length || hash(date + a.id) - hash(date + b.id))[0];
    if (v) { used.add(v.key); featuredC = { kind: "featured-popup", why: "featured pop-up", title: v.brand, tag: "Featured pop-up", city: v.city, state: v.state, region: regionOf(v.city, v.state), metro: metroOf(v),
      events: [v], more: 0, brands: [v.key], link: cityLink(v, data) }; }
  }
  // 5c. a city feature: a metro that gained 3 or more shops this week (first read in the last 7 days), not featured in 14 days
  let cityC = null;
  {
    const from = addDays(date, -REPEAT_DAYS), by = new Map();
    for (const s of shopPool) if (s.seen >= from && s.seen < date && free(s.key) && !cityRecent.has(metroOf(s))) { const k = metroOf(s); (by.get(k) || by.set(k, []).get(k)).push(s); }
    const g = [...by.values()].filter((l) => l.length >= 3).sort((a, b) => b.length - a.length || hash(date + a[0].id) - hash(date + b[0].id))[0];
    if (g) {
      const top = g.slice().sort((a, b) => richness(b) - richness(a) || hash(date + a.id) - hash(date + b.id)).slice(0, 4);
      cityC = { kind: "city", why: "city feature", title: `New in ${top[0].city}`, tag: "City feature", city: top[0].city, state: top[0].state, region: regionOf(top[0].city, top[0].state), metro: metroOf(top[0]),
        events: top.map((s) => ({ id: s.id, brand: s.name, handle: s.handle, kind: "cafe", venue: "", venueHandle: null, address: "", city: s.city, state: s.state, day: date, time: "New on the map", menu: [], series: null, pour: s.pour })),
        more: Math.max(0, g.length - 4), brands: top.map((s) => s.key), shopIds: top.map((s) => s.id), link: cityLink(top[0], data) };
    }
  }

  // 6. a region's week (REGIONS): with no feed post from the region in the last six days, one of its own becomes the
  // second feed post today; with no story, one story slot is its own (below). Thin data gives a shorter post, never none.
  const byDay = (a, b) => a.day.localeCompare(b.day) || hash(date + a.id) - hash(date + b.id);
  const regionCand = (rk, r) => {
    const inR = (v) => regionOf(v.city, v.state) === rk;
    const td = firstPerBrand(today.filter(inR).sort(byDay));
    if (td.length) return eventCand("today", td, `Today in ${td[0].city}`, "Today");
    const wr = dow === 4 || dow === 5 || dow === 6 || dow === 0 ? firstPerBrand(wk.filter(inR).filter((v) => v.day >= date).sort(byDay)) : []; // a weekend roundup from Thursday on; earlier in the week those dates read as "Coming up"
    if (wr.length) return eventCand("weekend", wr, `This weekend in ${new Set(wr.map((v) => v.city)).size > 1 ? r.name : wr[0].city}`, "This weekend");
    const sc = shopCand(shopPool.filter(inR));
    if (sc) return sc;
    const soon = firstPerBrand(all.filter(inR).filter((v) => !v.series && v.day > date && v.day <= addDays(date, 14)).sort(byDay));
    if (soon.length) return eventCand("soon", soon, `Coming up in ${new Set(soon.map((v) => v.city)).size > 1 ? r.name : soon[0].city}`, "Coming up");
    const ser = firstPerBrand(all.filter(inR).filter((v) => v.series && v.day >= date && v.day <= addDays(date, 13)).sort(byDay));
    if (ser[0]) { const v = ser[0]; return { kind: "series", title: v.series, tag: v.series, city: v.city, state: v.state, events: [v], more: 0, brands: [v.key], link: cityLink(v, data) }; }
    return null;
  };
  cands.forEach((c) => { c.region = regionOf(c.city, c.state); });
  const regionOwn = {};
  for (const [rk, r] of Object.entries(REGIONS)) {
    const week = regionWeek[rk] || { feed: 0, story: 0 };
    let own = cands.find((c) => c.region === rk);
    if (!own && week.story === 0) { own = regionCand(rk, r); if (own) { own.region = rk; take(own); } }
    if (!own) continue;
    regionOwn[rk] = own;
  }

  // feed: the first three. Stories run by location: every story candidate (the day's pop-ups, the weekend, the shop, the series,
  // a region's own) is filed under its place, and each place opens with a title story. A city with two or more stories (or a
  // region such as the Triangle) is a group of its own; single ones share their state. The biggest groups go first, three at
  // most, a title and up to two stories each; a city with one story gets a shop of its own that pours matcha, if there is one.
  // Feed posts are featured pieces only (1 to 2 a day): the featured shop or pop-up, the Friday weekend roundup, a city feature.
  // Everything time-bound or routine (today's pop-ups, new on the map, a series reminder, a region's own) is a story.
  const weekendC = cands.find((c) => c.feedOnly);
  const feed = [featuredC, weekendC, cityC].filter(Boolean).slice(0, 2);
  const content = cands.filter((c) => !c.feedOnly);
  if (feed.includes(cityC)) cityC.brands.forEach((b) => used.add(b));
  for (const [rk, own] of Object.entries(regionOwn)) if ((regionWeek[rk] || {}).story === 0 && !content.includes(own)) content.unshift(own);
  const placeKey = (c) => (c.region ? "r:" + c.region : "c:" + c.state + "/" + norm(c.city));
  const countBy = (list) => { const m = new Map(); for (const c of list) m.set(placeKey(c), (m.get(placeKey(c)) || 0) + 1); return m; };
  for (const [k, n] of countBy(content)) {
    if (n !== 1 || content.length >= MAX_GROUPS * GROUP_CONTENT) continue;
    const mate = content.find((c) => placeKey(c) === k);
    const extra = shopCand(shopPool.filter((s) => (mate.region ? regionOf(s.city, s.state) === mate.region : s.city === mate.city && s.state === mate.state) && s.pour.items.length && s.id !== mate.shopId));
    if (extra) { take(extra); extra.region = mate.region || null; content.push(extra); }
  }
  const cityN = countBy(content);
  const groups = new Map();
  for (const c of content) {
    const k = cityN.get(placeKey(c)) >= 2 ? placeKey(c) : "s:" + c.state;
    (groups.get(k) || groups.set(k, { key: k, list: [] }).get(k)).list.push(c);
  }
  const ranked = [...groups.values()].map((g, i) => ({ ...g, i })).sort((a, b) => b.list.length - a.list.length || a.i - b.i);
  const order = ranked.slice(0, MAX_GROUPS);
  // a region owed its weekly story keeps its group even when the day has bigger ones
  for (const [rk, own] of Object.entries(regionOwn)) {
    if ((regionWeek[rk] || {}).story !== 0 || order.some((g) => g.list.includes(own))) continue;
    const g = ranked.find((x) => x.list.includes(own));
    if (g) order[order.length - 1] = g;
  }
  const KIND_RANK = { today: 0, weekend: 1, soon: 2, shop: 3, series: 4 };
  const VERB = { today: "Today in", weekend: "This weekend in", soon: "Coming up in", shop: "New in", series: "This week in" };
  const storyList = [];
  for (const g of order) {
    const list = g.list.slice(0, GROUP_CONTENT), first = list[0];
    const place = g.key.startsWith("r:") ? REGIONS[g.key.slice(2)].name : g.key.startsWith("s:") ? STATE_FULL[first.state] || first.state : first.city;
    const lead = list.slice().sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9))[0];
    const title = `${VERB[lead.kind] || "Today in"} ${place}`;
    const names = list.map((c) => (c.kind === "shop" ? c.shop.name : c.kind === "series" ? c.events[0].brand : c.events.slice(0, 3).map((v) => v.brand).join(", ")));
    const dn = (pour) => ((pour && pour.items) || []).slice(0, 2).map((i) => i.name);
    const rows = list.flatMap((c) => (c.kind === "shop" ? [{ id: c.shopId, brand: c.shop.name, kind: "cafe", sub: c.shop.city + ", " + c.shop.state, drinks: dn(c.shop.pour) }]
      : c.events.slice(0, 3).map((v) => ({ id: v.id, brand: v.brand, kind: v.kind, sub: (c.kind === "weekend" || c.kind === "soon" ? dayWords(v.day).split(",")[0] + " " : "") + v.time, drinks: dn(v.pour) })))).slice(0, 3);
    const group = { key: g.key, rows, place, title, n: order.indexOf(g) + 1, of: order.length, names };
    storyList.push({ kind: "location", title, tag: lead.kind === "shop" ? "New on the map" : lead.kind === "weekend" ? "This weekend" : lead.kind === "soon" ? "Coming up" : lead.kind === "series" ? "This week" : "Today",
      city: first.city, state: first.state, region: first.region || null, link: first.link, events: [], more: 0, brands: [], group, role: "title" });
    for (const c of list) storyList.push({ ...c, group, role: "content" });
  }
  const items = [];
  const finish = (c, slot, i, ti = i) => {
    const tags = hashtagsFor(c.city, data, date, i + (slot === "story" ? 3 : 0));
    const caption = c.kind === "featured-shop" ? captionFeatured(c.shop, c.link, tags) : c.kind === "city" ? captionCity(c, tags) : c.kind === "location" ? `${c.title}: ${c.group.names.join("; ")}.

More matcha in ${c.group.place}: ${c.link}

${tags.join(" ")}
`
      : c.kind === "shop" ? captionShop(c.shop, c.link, tags) : c.kind === "series" ? captionSeries(c.events[0], c.link, tags, date) : captionEvents(c.kind, c.title, c.events, c.link, tags, date, c.more);
    const handles = c.kind === "location" ? [] : c.kind === "shop" || c.kind === "featured-shop" ? [c.shop.handle] : c.events.flatMap((v) => [v.handle, v.venueHandle]);
    const tagList = [...new Set(handles.filter(Boolean))].slice(0, 20);
    const time = (slot === "feed" ? FEED_TIMES : STORY_TIMES)[ti];
    return {
      slot, kind: c.kind, time, title: c.title, tag: c.tag, date, city: c.city, state: c.state, region: c.region || null, link: c.link, hashtags: tags, caption,
      user_tags: slot === "feed" ? tagList.map((username) => ({ username, x: 0.5, y: 0.5 })) : [],
      mentions: tagList, brands: c.brands, shopId: c.shopId || null, group: c.group || null, role: c.role || null, why: c.why || null, metro: c.metro || null,
      events: (c.events || []).map(({ cityObj, key, ...v }) => v), more: c.more || 0, shop: c.shop ? (({ cityObj, key, ...s }) => s)(c.shop) : null,
    };
  };
  feed.forEach((c, i) => items.push(finish(c, "feed", i)));
  let gi = -1, within = 0;
  storyList.forEach((c, i) => { if (c.role === "title") { gi++; within = 0; } items.push(finish(c, "story", i, gi * 3 + within)); within++; });
  items.sort((a, b) => a.time.localeCompare(b.time));
  items.forEach((it, i) => { it.n = String(i + 1).padStart(2, "0"); it.name = `${it.n}-${it.slot}-${it.kind}-${slug(it.kind === "shop" || it.kind === "featured-shop" ? it.shop.name : it.kind === "location" ? it.group.place : it.city)}`; });
  const looks = assignStyles(items, { date, lastFeed: lastFeedStyle, styles });      // one look per feed post and per story group (styles.js)
  for (const it of items) {
    if (it.caption.length > CAPTION_MAX) it.caption = it.caption.slice(0, CAPTION_MAX - 1).replace(/\s+\S*$/, "") + "\n";
    if (BANNED.test(it.caption + " " + JSON.stringify(it.events) + " " + it.title)) throw new Error(`banned word in ${it.name}`);
  }
  const regions = Object.fromEntries(Object.keys(REGIONS).map((k) => [k, { feed: items.filter((it) => it.slot === "feed" && it.region === k).length, story: items.filter((it) => it.slot === "story" && it.role !== "title" && it.region === k).length }]));
  return { date, items, featured: { brands: [...used].sort(), shops: [...cands, ...feed].filter((c) => c.shopId).map((c) => c.shopId).concat(feed.includes(cityC) ? cityC.shopIds : []), regions, styles: looks,
    feat: { shop: featuredC && featuredC.shopId || null, metro: featuredC ? featuredC.metro : null, city: feed.includes(cityC) ? cityC.metro : null } } };
}

// The history entry for the date replaces any earlier run of that date; entries older than 90 days are dropped.
export function recordHistory(history, p) {
  const out = {};
  const cut = addDays(p.date, -90);
  for (const [d, h] of Object.entries(history || {})) if (d >= cut && d !== p.date) out[d] = h;
  out[p.date] = { brands: p.featured.brands, shops: p.featured.shops, regions: p.featured.regions || {}, feat: p.featured.feat || null, styles: p.featured.styles || null };
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
export const readHistory = (file = HISTORY_FILE) => readJson(file, {});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const i = a.findIndex((x) => x === "--date" || x.startsWith("--date="));
  const date = i < 0 ? tomorrowNY() : a[i].includes("=") ? a[i].split("=")[1] : a[i + 1];
  const p = plan({ date, data: loadData(), history: readHistory() });
  if (a.includes("--json")) console.log(JSON.stringify(p, null, 2));
  else for (const it of p.items) console.log(`${it.time} ${it.slot.padEnd(5)} ${it.kind.padEnd(7)} ${it.title} | ${it.mentions.map((h) => "@" + h).join(" ") || "no tags"}`);
}
