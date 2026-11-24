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
import { dayKey, addDays, loadCities, makeCityLocator, weekendWindow, inWindow } from "../gen-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HISTORY_FILE = path.join(ROOT, "tools", "brand", "outbox", "history.json");
export const CAPTION_MAX = 2200;
export const REPEAT_DAYS = 7;
export const BANNED = /(kawaii|uwu|\bcute|cutesy|girly)/i;
export const HANDLE = /^(?!\.)[a-z0-9._]{2,30}(?<!\.)$/;
export const FEED_TIMES = ["10:00", "13:00", "17:00"];
export const STORY_TIMES = ["08:30", "12:00", "16:00"];
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
  const shops = (readJson(path.join(root, "site", "data", "shops.json"), { shops: [] }).shops) || [];
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
  return { srcById, locate, shopByName, brandByName };
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
    lines.push(list.map((v) => `${v.brand}${at(v.handle)}, ${kind === "weekend" ? dayWords(v.day).split(",")[0] + " " : ""}${v.time.toLowerCase()}${v.venue ? `, ${v.venue}${at(v.venueHandle)}` : v.venueHandle ? `, at @${v.venueHandle}` : ""}`).join("\n") + (more ? `\nand ${more} more on the map` : ""));
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
function captionSeries(v, link, tags, date) {
  const next = v.day === date ? `today, ${dayWords(v.day)}` : dayWords(v.day);
  return [`${v.series}: ${v.brand}${at(v.handle)} ${whereOf(v)}, ${v.time.toLowerCase()}.`, `Next one: ${next}.`,
    `Schedules change; check their page before you go.`, `More matcha in ${v.city}: ${link}`, tags.join(" ")].join("\n\n") + "\n";
}

// ---- the plan ----
function historyBefore(history, date) {
  const blocked = new Set(), shopsEver = new Set(), from = addDays(date, -(REPEAT_DAYS - 1));
  for (const [d, h] of Object.entries(history || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= date) continue;
    if (d >= from) for (const b of h.brands || []) blocked.add(b);
    for (const s of h.shops || []) shopsEver.add(s);
  }
  return { blocked, shopsEver };
}

export function plan({ date, data, history = {} }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  const ctx = context(data);
  const { blocked, shopsEver } = historyBefore(history, date);
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
  if (dow === 4 || dow === 5) {
    const keys = weekendWindow(new Date(date + "T16:00:00Z").getTime()).keys;
    const wk = data.events.filter(eligible).filter((e) => inWindow(e, keys, "America/New_York")).map((e) => view(e, ctx)).filter((v) => v.brand && clean(v.brand + " " + v.venue + " " + v.menu.join(" ")));
    const g = rank(groupBy(wk)).find(([, l]) => l.length >= 2);
    if (g) take(eventCand("weekend", g[1], `This weekend in ${g[1][0].city}`, "This weekend"));
  }

  // 3. a new shop: first read in the last 7 days, else the one with the most matcha drinks; never one featured before
  {
    const from = addDays(date, -REPEAT_DAYS);
    const drinksOf = (s) => {
      const out = [];
      for (const x of Array.isArray(s.menu_matcha) ? s.menu_matcha : []) if (x && x.name) out.push(String(x.name));
      for (const x of (s.menu && Array.isArray(s.menu.items)) ? s.menu.items : []) if (x && x.name && /matcha/i.test(x.name + " " + (x.note || ""))) out.push(String(x.name));
      return [...new Map(out.map((n) => [norm(n), n.replace(/\s+/g, " ").trim()])).values()].filter((n) => n.length <= 32 && clean(n));
    };
    const pool = data.shops.filter((s) => s.verified !== false && s.name && s.city && s.state && (s.tier === "shop" || s.tier === "serves" || s.tier == null) && !shopsEver.has(s.id) && clean(s.name))
      .map((s) => { const handle = cleanHandle(s.instagram), c = ctx.locate({ city: s.city, state: s.state, lat: s.lat, lng: s.lng });
        return { id: s.id, name: String(s.name).replace(/\s+/g, " ").trim(), handle, key: handle || norm(s.name), city: c ? c.name : s.city, state: c ? c.state : s.state, cityObj: c, address: String(s.address || "").trim(), drinks: drinksOf(s), tier: s.tier || "shop", seen: String(s.read || s.fetched || "").slice(0, 10) }; })
      .filter((s) => free(s.key));
    const order = (a, b) => b.drinks.length - a.drinks.length || (b.handle ? 1 : 0) - (a.handle ? 1 : 0) || hash(date + a.id) - hash(date + b.id);
    // a new shop we can tag comes first: the post is for them
    const fresh = pool.filter((s) => s.seen >= from && s.seen < date).sort((a, b) => (b.handle ? 1 : 0) - (a.handle ? 1 : 0) || order(a, b));
    const s = fresh[0] || pool.sort(order)[0];
    if (s) take({ kind: "shop", title: s.name, tag: "New on the map", city: s.city, state: s.state, shop: { ...s, drinks: s.drinks.slice(0, 4) }, brands: [s.key], shopId: s.id, link: cityLink(s, data) });
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

  // feed: the first three; stories: the first, then the extras, padded with the second and third
  const feed = cands.slice(0, 3);
  const story = [cands[0], ...cands.slice(3, 5), cands[1], cands[2]].filter(Boolean).filter((c, i, a) => a.indexOf(c) === i).slice(0, 3);
  const items = [];
  const finish = (c, slot, i) => {
    const tags = hashtagsFor(c.city, data, date, i + (slot === "story" ? 3 : 0));
    const caption = c.kind === "shop" ? captionShop(c.shop, c.link, tags) : c.kind === "series" ? captionSeries(c.events[0], c.link, tags, date) : captionEvents(c.kind, c.title, c.events, c.link, tags, date, c.more);
    const handles = c.kind === "shop" ? [c.shop.handle] : c.events.flatMap((v) => [v.handle, v.venueHandle]);
    const tagList = [...new Set(handles.filter(Boolean))].slice(0, 20);
    const time = (slot === "feed" ? FEED_TIMES : STORY_TIMES)[i];
    return {
      slot, kind: c.kind, time, title: c.title, tag: c.tag, date, city: c.city, state: c.state, link: c.link, hashtags: tags, caption,
      user_tags: slot === "feed" ? tagList.map((username) => ({ username, x: 0.5, y: 0.5 })) : [],
      mentions: tagList, brands: c.brands, shopId: c.shopId || null,
      events: (c.events || []).map(({ cityObj, key, ...v }) => v), more: c.more || 0, shop: c.shop ? (({ cityObj, key, ...s }) => s)(c.shop) : null,
    };
  };
  feed.forEach((c, i) => items.push(finish(c, "feed", i)));
  story.forEach((c, i) => items.push(finish(c, "story", i)));
  items.sort((a, b) => a.time.localeCompare(b.time));
  items.forEach((it, i) => { it.n = String(i + 1).padStart(2, "0"); it.name = `${it.n}-${it.slot}-${it.kind}-${slug(it.kind === "shop" ? it.shop.name : it.city)}`; });
  for (const it of items) {
    if (it.caption.length > CAPTION_MAX) it.caption = it.caption.slice(0, CAPTION_MAX - 1).replace(/\s+\S*$/, "") + "\n";
    if (BANNED.test(it.caption + " " + JSON.stringify(it.events) + " " + it.title)) throw new Error(`banned word in ${it.name}`);
  }
  return { date, items, featured: { brands: [...used].sort(), shops: cands.filter((c) => c.shopId).map((c) => c.shopId) } };
}

// The history entry for the date replaces any earlier run of that date; entries older than 90 days are dropped.
export function recordHistory(history, p) {
  const out = {};
  const cut = addDays(p.date, -90);
  for (const [d, h] of Object.entries(history || {})) if (d >= cut && d !== p.date) out[d] = h;
  out[p.date] = { brands: p.featured.brands, shops: p.featured.shops };
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
