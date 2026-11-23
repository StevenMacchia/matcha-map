// Hashtag harvest: public Instagram posts under matcha pop-up hashtags become events, and every brand they name joins the watch list.
// Official Graph API only (ig_hashtag_search, recent_media, top_media); never a page of instagram.com.
//
// The API returns no username for hashtag media, so a post's brand comes from its caption: an @mention, a brand-looking
// hashtag, a bare handle (Meta strips the "@" from captions on these edges) or a name before "pop-up". A post with none of
// those makes no event. Every brand found becomes a watch-list candidate (found_via "hashtag", found_from the permalink), which
// is the main value of the harvest: business_discovery reads those accounts on the next hourly run.
// A post is kept as an event only when its caption yields a dated pop-up on or after today in a US place (an address, "City, ST",
// a city, a place hashtag such as #austinmatcha or #madisonwi, or the account's own home city). Each kept post is one RawItem under
// the pseudo-source `hashtag:<brand slug>` (matcha-only, replaced when a real read of the same brand finds the same day, decays
// like the others). The slug, not the tag, is in the id so two brands under one tag never share an event id.
//
// Cost: ids are cached in data/hashtags.json, so a tag is 1 call per page of recent_media (up to 3) plus 1 for top_media once
// a day. A tag is re-read at most every HARVEST_GAP_HOURS (recent_media only reaches back 24 hours). Every ig_hashtag_search counts
// toward the 30-per-7-days budget, a miss included, until a live run shows otherwise.
import fs from "node:fs";
import { shortcodeOf, hashtagId, hashtagEdge, creds, Stop } from "../adapters/instagram-graph.js";
import { hasMatcha } from "../adapters/mato.js";
import { processItems } from "./pipeline.js";
import { parseAddress, refDate } from "./extract.js";
import { STATES } from "./tz.js";
import { TEXT_CITY_STATE } from "./sites/common.js";
import { loadCities, findCity, EXTRA_CITIES } from "./cities.js";
import { prettyHandle } from "./names.js";
import { slug } from "./watchlist.js";
import { warn, info } from "./log.js";

export const FILE = "data/hashtags.json";
const HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;
export const HARVEST_GAP_HOURS = 6;
export const MAX_PAGES = 3;
// The hashtag step may spend at most this many calls of a watch run; the rest of the run's budget goes to account reads.
export const RUN_CALLS = 90;
// Week 0 of the rotation (a Monday). Weeks advance the city cursor.
const EPOCH = Date.UTC(2026, 10, 16);
// 30 unique hashtags a rolling 7 days: the general tags every week, the rest of the slots walk the city tags.
export const WEEK_SLOTS = 30;
// A city tag that yields nothing (no accounts added, no events kept) this many reads in a row goes to the back of the walk.
export const PARK_AFTER = 2;

// ---- config ----------------------------------------------------------------------------------
export function loadConfig(file = FILE) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch { warn("data/hashtags.json missing or invalid"); }
  return { note: "", active: [], rotation: [], ids: {}, stats: {}, missing: [], ...c };
}
export function saveConfig(cfg, file = FILE) { fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n"); }

// Yield of a tag per read: events kept plus accounts added. A tag never read yields 0.
export const yieldOf = (cfg, tag) => { const s = cfg.stats?.[tag]; return s && s.runs ? ((s.kept || 0) + (s.accounts || 0)) / s.runs : 0; };

const weekId = (now) => Math.floor((new Date(now).getTime() - EPOCH) / WEEK);

// The next week's city tags from a cursor: skips tags known missing and tags already general; wraps once around the list.
function pickCities(cfg, cursor) {
  const cities = cfg.cities || [], slots = Math.max(0, WEEK_SLOTS - cfg.general.length), skip = new Set([...(cfg.missing || []), ...cfg.general]);
  const tags = [];
  let n = 0, i = cities.length ? ((cursor % cities.length) + cities.length) % cities.length : 0;
  while (tags.length < slots && n < cities.length) { const t = cities[i]; if (!skip.has(t) && !tags.includes(t)) tags.push(t); i = (i + 1) % cities.length; n++; }
  return { tags, cursor: i };
}

// The tags for a week. New shape: cfg.general (read every week) plus the city tags from cfg.cursor onward, which advances a week at a time;
// the week's list is fixed once the harvest starts it (cfg.week). Old shape: cfg.active with rotation lists that swap out the lowest-yield city tags.
export function weekTags(cfg, now = new Date()) {
  if (cfg.general) {
    if (cfg.week?.id === weekId(now)) return cfg.week.tags.slice();
    return cfg.general.concat(pickCities(cfg, cfg.cursor || 0).tags);
  }
  const rot = cfg.rotation || [];
  if (rot.length < 2) return cfg.active.slice();
  const w = weekId(now), slot = ((w % rot.length) + rot.length) % rot.length;
  if (slot === 0) return cfg.active.slice();
  const incoming = rot[slot].filter((t) => !cfg.active.includes(t));
  const city = new Set(rot[0]);
  const out = cfg.active.slice();
  const order = out.map((t, i) => [t, i]).filter(([t]) => city.has(t)).sort((a, b) => yieldOf(cfg, a[0]) - yieldOf(cfg, b[0]) || b[1] - a[1]);
  incoming.slice(0, order.length).forEach((t, k) => { out[out.indexOf(order[k][0])] = t; });
  return out;
}

// Fix this week's list and move the cursor on (once per week). Returns the tags; a no-op for the old shape.
export function startWeek(cfg, now = new Date()) {
  if (!cfg.general) return weekTags(cfg, now);
  const w = weekId(now);
  if (cfg.week?.id !== w) { const p = pickCities(cfg, cfg.cursor || 0); cfg.week = { id: w, tags: cfg.general.concat(p.tags) }; cfg.cursor = p.cursor; }
  return cfg.week.tags.slice();
}

// The tags to read now, in priority order, stopping where the 30-per-7-days budget is full (tags already counted still fit). Missing tags are never queried.
export function planTags(cfg, rate, now = new Date()) {
  const counted = new Set(rate.hashtagsCounted()), missing = new Set(cfg.missing || []);
  let free = rate.hashtagFree();
  return weekTags(cfg, now).filter((t) => !missing.has(t)).filter((t) => counted.has(t) || (free > 0 && free--));
}

// A tag is not on Instagram: remember it, never ask again.
export function markMissing(cfg, tag) { if (!cfg.missing.includes(tag)) cfg.missing.push(tag); }

// After a read: count what the tag gave. A city tag with no yield PARK_AFTER reads in a row moves to the back of the walk.
export function recordYield(cfg, tag, { kept = 0, accounts = 0 }) {
  const st = cfg.stats[tag] ||= { runs: 0, posts: 0, kept: 0, accounts: 0, last_run: null, last_top: null };
  st.kept = st.kept || 0; st.accounts = (st.accounts || 0) + accounts;
  const i = (cfg.cities || []).indexOf(tag);
  if (i < 0) return;
  st.zero = kept + accounts > 0 ? 0 : (st.zero || 0) + 1;
  if (st.zero >= PARK_AFTER) {
    cfg.cities.splice(i, 1); cfg.cities.push(tag);
    if (i < (cfg.cursor || 0)) cfg.cursor--;
    st.zero = 0; st.parked = (st.parked || 0) + 1;
  }
}

// ---- brand from a caption --------------------------------------------------------------------
const GENERIC = new Set(["matcha", "matchapopup", "matchapopups", "matchaevent", "matchaevents", "popup", "popups", "popupshop", "food", "foodie", "foodies", "coffee", "cafe", "cafes", "smallbusiness", "smallbiz", "explore", "explorepage", "fyp", "foryou", "foryoupage", "viral", "trending", "reels", "instagood", "love", "tea", "teatime", "barista", "coffeeshop", "matchalatte", "matchalover", "matchalovers", "matchatime", "matchagirl", "matchagirls", "matchaaddict", "matchaobsessed", "matchaholic", "matchagram", "matchalife", "matchaday", "matchaseason", "matchacommunity", "matchadrink", "matchatea", "matchacafe", "matchalatteart", "matchalove", "matchacoffee", "matchaeverything", "matchacart", "matchabar", "matchafest", "matchamarket", "matchatruck", "matchastand", "popupmatcha", "matchapopupshop", "supportsmallbusiness", "shoplocal", "weekend", "sunday", "saturday", "matchamap", "matchamoment", "matchamonday", "matchamania", "matchamadness", "matchavibes", "matchalattes", "icedmatcha", "icedmatchalatte", "matchaaesthetic", "matchareels", "matchamilk", "matchapowder", "matcharecipe", "matcharecipes", "matchadessert", "matchacake", "matchacookies", "matchasweets", "popupevent", "popupevents", "popupmarket", "popupexperience", "coffeepopup", "cafepopup", "coffeecart", "coffeebar", "privateevents", "events", "marketplace", "vendor", "vendors", "localbusiness", "ootd", "grwm", "outfit", "christmas", "christmasmenu", "wintermenu", "holiday", "holidays", "thanksgiving", "halloween", "fall", "winter", "summer", "spring", "vegan", "plantbased", "healthy", "wellness", "aesthetic", "pilates", "hojicha", "chai", "latte", "lattes", "yummy", "delicious", "tasty", "recipe", "recipes", "homemade", "baking", "bakery", "dessert", "desserts", "sweets", "mocktails", "mocktail", "drinks", "pourtoi", "japan", "japanese", "korean", "filipino", "vietnamese", "indonesian", "asian"]);
// Hashtags made of a flavour, a drink or a mood are not a business.
const MENU_WORD = /latte|bread|cake|foam|recipe|menu|season|flavou?r|lover|girl|boy|obsess|addict|mom|dad|vibe|drink|dessert|milk|cream|powder|whisk|aesthetic|ceremonial|cookie|sweet|cold|iced|fizz|hojicha|ube|mango|banana|strawberry|biscoff|caramel|vanilla|sesame|lemon|coconut|pumpkin|boba|affogato|tiramisu|raspberry|berry|fruit|chinese|japanese|korean|thai|mobile|nonalcoholic|pilates|coffeb/;
const STATE_NAMES = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", newhampshire: "NH", newjersey: "NJ", newmexico: "NM", northcarolina: "NC", northdakota: "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", rhodeisland: "RI", southcarolina: "SC", southdakota: "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", westvirginia: "WV", wisconsin: "WI", wyoming: "WY" };
// State abbreviations that are also ordinary tags (#in, #me, #or, #hi, #ok); never read as a place.
const ABBR_SKIP = new Set(["in", "me", "or", "hi", "ok", "oh", "id", "de", "ma", "pa", "co", "al", "ar", "mo", "ms", "mt", "nd", "sd", "la", "wa", "ne", "wv", "ks", "ky"]);
const BRAND_LOOK = /matcha|cafe|tea|bar|co$|^co(?!ffee|ok|mmunity|ntent)/;
const NAME_STOP = new Set(["our", "this", "the", "a", "an", "my", "your", "first", "next", "new", "weekend", "matcha", "every", "last", "another", "big", "special", "monthly", "summer", "winter", "spring", "fall", "holiday", "sunday", "saturday", "friday", "monday", "tuesday", "wednesday", "thursday", "join", "visit", "see", "come", "at", "for", "to", "and", "with", "from", "pop", "we", "were", "hey", "hosting"]);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const letters = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const STATE_SET = new Set(STATES);

// ---- place hashtags --------------------------------------------------------------------------
// City nicknames people tag with, each tied to the place it stands for.
const NICK = {
  nyc: ["New York", "NY"], newyork: ["New York", "NY"], newyorkcity: ["New York", "NY"], la: ["Los Angeles", "CA"], losangeles: ["Los Angeles", "CA"], sf: ["San Francisco", "CA"], atl: ["Atlanta", "GA"], htx: ["Houston", "TX"], dtx: ["Dallas", "TX"],
  dfw: ["Dallas", "TX"], dmv: ["Washington DC", "DC"], dc: ["Washington DC", "DC"], bayarea: ["San Francisco", "CA"], oc: ["Santa Ana", "CA"], sd: ["San Diego", "CA"], pdx: ["Portland", "OR"], stl: ["St. Louis", "MO"], kc: ["Kansas City", "MO"],
  nola: ["New Orleans", "LA"], philly: ["Philadelphia", "PA"], vegas: ["Las Vegas", "NV"], oahu: ["Honolulu", "HI"], chi: ["Chicago", "IL"], sac: ["Sacramento", "CA"], cincy: ["Cincinnati", "OH"], indy: ["Indianapolis", "IN"], okc: ["Oklahoma City", "OK"],
  abq: ["Albuquerque", "NM"], slc: ["Salt Lake City", "UT"], nj: ["Newark", "NJ"],
};
// Bare names that are also towns abroad or common words: a bare #paris is not Paris, Texas. With a state or a matcha/food word they count.
const CLASH = new Set(["paris", "london", "glasgow", "melbourne", "rotterdam", "manchester", "bradford", "vancouver", "birmingham", "athens", "florence", "lima", "moscow", "berlin", "dublin", "cairo", "odessa", "victoria", "sydney", "brisbane", "perth", "nelson", "hamilton", "cambridge", "oxford", "newcastle", "windsor", "kingston", "durham", "bristol", "plymouth", "lancaster", "leicester", "cardiff", "barrie", "richmond", "orange", "mobile", "independence", "surprise", "hollywood", "ontario", "lincoln", "columbia", "salem", "jackson", "auburn", "concord", "marion", "vista", "monroe", "clinton", "franklin", "washington", "king", "kent", "provo", "normal", "buffalo", "milton", "santa", "reading", "cary", "rome", "troy", "sandy", "alexandria", "mission", "newport", "bend", "eugene", "sterling", "warren"]);
// The ones that, even with a matcha or food word on them (#vancouvermatcha, #melbournematcha, #mobilematcha), are as likely abroad or not a place.
const HARD = new Set(["paris", "london", "glasgow", "melbourne", "rotterdam", "manchester", "bradford", "vancouver", "birmingham", "athens", "florence", "lima", "moscow", "berlin", "dublin", "cairo", "odessa", "victoria", "sydney", "brisbane", "perth", "hamilton", "cambridge", "oxford", "newcastle", "windsor", "kingston", "bristol", "cardiff", "barrie", "ontario", "mobile", "orange", "surprise", "independence", "king", "normal", "reading", "mission", "sandy", "santa"]);
// Words added around a place in a tag: matcha, popup, food words. Longest first.
const AFFIX = ["thingstodoin", "farmersmarket", "thrifting", "nightlife", "wellness", "events", "event", "metro", "matchapopups", "matchapopup", "popupmatcha", "matchabar", "matchacafe", "matchaevents", "matchaevent", "foodies", "foodie", "popups", "popup", "matcha", "coffee", "cafes", "cafe", "foods", "food", "eats", "eat", "tea", "drinks", "brunch", "market"];

let cityMap = null;
const byName = () => {
  if (cityMap) return cityMap;
  cityMap = new Map();
  for (const c of loadCities()) {
    if (c.pop < 20000) continue;
    const keys = [letters(c.name), letters(c.name.replace(/^St\.?\s/, "Saint ")), letters(c.name.replace(/^Saint\s/, "St "))];
    if (c.state === "DC") keys.push("washingtondc");
    for (const k of keys) if (k && !cityMap.has(k)) cityMap.set(k, c.name);
  }
  for (const c of EXTRA_CITIES) cityMap.set(letters(c.name), c.name);
  return cityMap;
};
const cityHit = (name, st) => { const c = findCity(name, st); return c ? { city: c.state === "DC" ? "Washington DC" : c.name, state: c.state } : null; };
const asCity = (key, st = null, bare = false) => {
  if (!key) return null;
  if (!st && NICK[key]) { const n = NICK[key]; return cityHit(n[0], n[1]) || { city: n[0], state: n[1] }; }
  const name = byName().get(key);
  if (!name || (bare && !st && CLASH.has(key))) return null;
  return cityHit(name, st);
};
const tagCity = (key, bare = true) => {
  if (!key || key.length < 2) return null;
  if (!bare && HARD.has(key)) return null;
  const direct = asCity(key, null, bare);
  if (direct) return direct;
  // madisonwi, austintx: the state appended
  const m = /^(.{3,})([a-z]{2})$/.exec(key);
  if (m && STATE_SET.has(m[2].toUpperCase())) return asCity(m[1], m[2].toUpperCase());
  return null;
};

// A hashtag that names a place -> {city, state, kind:"city"} | {city:"", state, kind:"state"} | null. Cities of 20,000 people or more;
// a name two cities share needs its state (findCity's rule), so #springfield is nothing and #springfieldil is Springfield, IL.
export function placeOfTag(tag) {
  const raw = String(tag).toLowerCase().replace(/^#/, "");
  if (!/^[a-z]+$/.test(raw)) return null;
  const hit = tagCity(raw);
  if (hit) return { ...hit, kind: "city" };
  for (const a of AFFIX) {
    for (const rest of [raw.startsWith(a) ? raw.slice(a.length) : null, raw.endsWith(a) ? raw.slice(0, -a.length) : null]) {
      if (!rest || rest.length < 2) continue;
      const c = tagCity(rest, false);
      if (c) return { ...c, kind: "city" };
      if (STATE_NAMES[rest]) return { city: "", state: STATE_NAMES[rest], kind: "state" };
    }
  }
  // littlerockarkansas: the state's name appended
  for (const [n, st] of Object.entries(STATE_NAMES)) {
    const c = raw.length > n.length + 3 && raw.endsWith(n) ? asCity(raw.slice(0, -n.length), st) : null;
    if (c) return { ...c, kind: "city" };
  }
  if (STATE_NAMES[raw]) return { city: "", state: STATE_NAMES[raw], kind: "state" };
  if (raw.length === 2 && STATE_SET.has(raw.toUpperCase()) && !ABBR_SKIP.has(raw)) return { city: "", state: raw.toUpperCase(), kind: "state" };
  return null;
}

// Is a hashtag a generic or queried term, or a place, not a brand?
export function isGenericTag(tag, queried = []) {
  const t = String(tag).toLowerCase().replace(/^#/, "");
  return GENERIC.has(t) || queried.includes(t) || /^matchapopup/.test(t) || /^popup/.test(t) || !!STATE_NAMES[t] || !!placeOfTag(t);
}

// A brand-looking hashtag: not generic, and either carries a brand word (matcha, cafe, tea, bar, co) or reappears capitalised in the caption.
function brandTag(caption, queried) {
  for (const m of caption.matchAll(/#([A-Za-z0-9_]{3,40})/g)) {
    const t = m[1].toLowerCase();
    if (isGenericTag(t, queried) || MENU_WORD.test(t)) continue;
    const word = new RegExp(`(?<![#\\w])${t}(?![\\w])`, "i");
    if (word.test(caption) || (BRAND_LOOK.test(t) && !/^matcha/.test(t))) return t;
  }
  return null;
}

// Words after the last one that ends a sentence ("... across America. Every" -> "Every"); stop words at either end go.
function afterSentence(words) {
  const cut = words.map((w, i) => (/[.!?]$/.test(w) ? i : -1)).filter((i) => i >= 0).at(-1);
  const out = cut >= 0 ? words.slice(cut + 1) : words.slice();
  while (out.length && NAME_STOP.has(out.at(-1).toLowerCase())) out.pop();
  return out;
}

// A capitalised name directly before "pop-up", "popup" or "pop up".
function nameBeforePopup(caption) {
  const m = /((?:[A-Z][\w'&.-]*)(?:\s+(?:&\s+)?[A-Z][\w'&.-]*){0,3})\s+[Pp]op[\s-]?[Uu]p/.exec(caption);
  if (!m) return null;
  const words = afterSentence(m[1].split(/\s+/));
  while (words.length && NAME_STOP.has(words[0].toLowerCase())) words.shift();
  while (words.length && NAME_STOP.has(words.at(-1).toLowerCase())) words.pop();
  const name = words.join(" ");
  return name.length >= 3 ? name : null;
}

// ---- bare mentions: Meta strips the "@" from captions on the hashtag edges ---------------------
const BRAND_END = /(?:matcha|cafe|tea|bakery|coffee|bar|shop|studio|kitchen)$/;
const HANDLE_CHARS = /^[a-z_][a-z0-9._]{3,29}$/;
const NOT_BARE = new Set(["matchabar", "matchacafe", "matchatea", "icedtea", "greentea", "bubbletea", "milktea", "teabar", "coffeebar", "juicebar", "sushibar", "saladbar", "snackbar", "dessertbar", "pilatesbar", "coffeeshop", "workshop", "teashop", "barbershop", "bakery", "instagram", "tiktok", "facebook", "sugarcoffee", "matchamatcha"]);
// The shape of a handle: digits, dots or underscores inside it, or a brand word on its end. "co" counts only in a "pop-up at ..." slot.
function handleShape(tok, { allowCo = false } = {}) {
  if (!HANDLE_CHARS.test(tok) || /\.\./.test(tok) || /^www\./.test(tok) || /\.(?:com|net|org|us|io|edu)$/.test(tok)) return false;
  if (NOT_BARE.has(tok) || GENERIC.has(tok)) return false;
  if (/[._]|\d/.test(tok)) return /[a-z]{3}/.test(tok);
  return (tok.length >= 6 && BRAND_END.test(tok)) || (allowCo && /[a-z]{3}co$/.test(tok)) || (allowCo && tok.length >= 7 && /matcha|cafe/.test(tok));
}
const BEFORE = /^\s*[-–—]?\s*(?:pop[\s-]?ups?|x)\b/i;
const AFTER = /(?:\b(?:at|from|with|by)|thanks to|thank you)\s+$/i;

// -> {token, why} | null. why: "known" (on the watch list or in sources), "tag" (also a hashtag in this caption), "slot" (in a pop-up slot), "shape" (looks like a handle).
function bareMention(text, known, hashtags) {
  const toks = [];
  for (const m of text.matchAll(/(?<![\w.@#/+-])([a-z_][a-z0-9._]{2,29})(?![\w@])/g)) {
    const tok = m[1].replace(/[._]+$/, "");
    toks.push({ tok, i: m.index, end: m.index + tok.length });
  }
  for (const t of toks) if (known.has(t.tok) && t.tok.length >= 4 && !GENERIC.has(t.tok)) return { token: t.tok, why: "known" };
  for (const t of toks) if (hashtags.has(t.tok) && t.tok.length >= 4 && !GENERIC.has(t.tok) && !placeOfTag(t.tok)) return { token: t.tok, why: "tag" };
  for (const t of toks) {
    const slot = BEFORE.test(text.slice(t.end, t.end + 14)) || AFTER.test(text.slice(Math.max(0, t.i - 14), t.i));
    if (slot && handleShape(t.tok, { allowCo: true })) return { token: t.tok, why: "slot" };
  }
  for (const t of toks) if (handleShape(t.tok)) return { token: t.tok, why: "shape" };
  return null;
}

// A name before a verb that announces an appearance: "Shizucha Matcha is popping up", "KĒKI is back".
function nameBeforeVerb(caption) {
  const m = /((?:[A-ZĀ-ſ][\w'&.Ā-ſ-]*)(?:\s+(?:&\s+)?[A-Z][\w'&.-]*){0,3})\s+(?:is|are|will be|returns?|just)\s+(?:popping|pop|back|open(?:ing)?|heading|hosting|serving|bringing|joining|coming|here)/.exec(caption);
  if (!m) return null;
  const name = afterSentence(m[1].split(/\s+/)).join(" ");
  return name.length >= 3 && !/^(?:we|they|it|there|this|that|who|what)$/i.test(name) ? name : null;
}
// "Matcha Junkie by Ari", "Yasumino Matcha", "Just Matcha": a capitalised word next to a capitalised Matcha, that is not a flavour or a sentence start.
function nameWithMatcha(caption) {
  for (const m of caption.matchAll(/(?<![\w'])(?:([A-Z][\w'&-]{2,})\s+Matcha|Matcha\s+([A-Z][\w'&-]{2,}))(?![\w])/g)) {
    const w = m[1] || m[2], name = m[1] ? `${w} Matcha` : `Matcha ${w}`;
    if (NAME_STOP.has(w.toLowerCase()) || MENU_WORD.test(w.toLowerCase()) || /^(?:Matcha|Latte|Tea|Powder|Lovers?|Bar|Pop|Popup|Menu|Map|Fest|Day|Time|Monday|Season|Soda|Cream|Drinks?)$/i.test(w) || /^(?:Iced|Hot|Salted|Fresh|Mango|Pandan|Black|Banana|Cold|Strawberry|Ceremonial|Classic|Hojicha|Dirty|Double|Single|Premium|Local|Japanese|Free|Real|Good|Best|Pure|Organic|Sweet|Daily)$/i.test(w)) continue;
    return name;
  }
  return null;
}
// The last resort: a hashtag that is no common word, place or flavour and is not one we search (#hefshaus, #emkari). A guess.
function weakTag(caption, queried) {
  for (const m of caption.matchAll(/#([a-z][a-z0-9_]{5,24})(?![A-Za-z0-9_])/gi)) {
    const t = m[1].toLowerCase();
    if (isGenericTag(t, queried) || MENU_WORD.test(t) || /matcha$|popup|^(?:best|top|my|our|new|how|why|things|small|start|build|entre)/.test(t) || /^[a-z]+(?:ing|ers|ness|life|owned|goals|lover|tips|club|love|time|day)$/.test(t)) continue;
    return t;
  }
  return null;
}

const handleOfName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);

// attribute(caption, {known, queried, names}) -> {handle, brand, how, candidate} | null.
// known: lowercase handles from the watch list and sources.json. queried: the hashtags we search (never brands).
// how: "known mention" | "mention" | "hashtag" | "bare" | "name". candidate = {handle, guess}: the account to put on the watch list; a name
// written as words becomes its letters run together and is marked guess (a parked guess is dropped, not retried).
// handle is set only for an @mention or a bare token that is already on a list; the others are brands without a confirmed account.
export function attribute(caption, { known = new Set(), queried = [], names = new Map() } = {}) {
  const text = String(caption || "");
  const mentions = [...text.matchAll(/(?<![\w.@/+-])@([A-Za-z0-9][A-Za-z0-9._]{1,28})/g)].map((m) => m[1].replace(/\.+$/, "")).filter((h) => h.length >= 3 && /[a-z]/i.test(h));
  const onList = mentions.find((h) => known.has(h.toLowerCase()));
  const handle = onList || mentions[0];
  if (handle) return { handle, brand: names.get(handle.toLowerCase()) || prettyHandle(handle), how: onList ? "known mention" : "mention", candidate: { handle, guess: false } };
  const tag = brandTag(text, queried);
  if (tag) return { handle: null, brand: names.get(tag) || prettyHandle(tag), how: "hashtag", candidate: { handle: tag, guess: false } };
  const hashtags = new Set([...text.matchAll(/#([A-Za-z0-9_]{3,40})/g)].map((m) => m[1].toLowerCase()));
  const bare = bareMention(text.replace(/#[A-Za-z0-9_]+/g, " "), known, hashtags);
  if (bare) return { handle: bare.why === "known" ? bare.token : null, brand: names.get(bare.token) || prettyHandle(bare.token), how: "bare", candidate: { handle: bare.token, guess: false } };
  const name = nameBeforePopup(text);
  const named = name || nameBeforeVerb(text) || nameWithMatcha(text);
  if (named) { const h = handleOfName(named); return { handle: null, brand: named, how: "name", candidate: h.length >= 4 ? { handle: h, guess: true } : null }; }
  const weak = weakTag(text, queried);
  if (weak) return { handle: null, brand: names.get(weak) || prettyHandle(weak), how: "hashtag", candidate: { handle: weak, guess: true } };
  return null;
}

// ---- a US place from a caption ---------------------------------------------------------------
const EXTRA_CITIES_TEXT = {
  "San Antonio": "TX", "Fort Worth": "TX", Plano: "TX", Irvine: "CA", "Santa Monica": "CA", Pasadena: "CA", "Long Beach": "CA", "Santa Ana": "CA", Anaheim: "CA",
  "Jersey City": "NJ", Hoboken: "NJ", Newark: "NJ", Scottsdale: "AZ", Tempe: "AZ", Tucson: "AZ", Queens: "NY", Manhattan: "NY", Boulder: "CO", Cambridge: "MA",
  Somerville: "MA", Arlington: "VA", Alexandria: "VA", Charleston: "SC", Savannah: "GA", Richmond: "VA", Louisville: "KY", Memphis: "TN", Milwaukee: "WI",
  Madison: "WI", Albuquerque: "NM", Gallup: "NM", "Fort Lauderdale": "FL", "St. Petersburg": "FL", Berkeley: "CA", "Palo Alto": "CA", "Santa Barbara": "CA", Cincinnati: "OH",
};
const ALIASES = { NYC: ["New York", "NY"], "New York City": ["New York", "NY"], "Bay Area": ["San Francisco", "CA"], DC: ["Washington DC", "DC"], ATL: ["Atlanta", "GA"], Philly: ["Philadelphia", "PA"], Vegas: ["Las Vegas", "NV"] };
const CITIES = new Map([...Object.entries(TEXT_CITY_STATE), ...Object.entries(EXTRA_CITIES_TEXT)].map(([c, s]) => [c, [c, s]]).concat(Object.entries(ALIASES)));
const CITY_RE = new RegExp(`(?<![\\w#@])(${[...CITIES.keys()].sort((a, b) => b.length - a.length).map((c) => c.replace(/[.]/g, "\\.")).join("|")})(?![\\w])`);
const CITY_ST = new RegExp(`\\b([A-Z][A-Za-z.'-]+(?:\\s[A-Z][A-Za-z.'-]+){0,2}),\\s*(${STATES.join("|")})\\b`);

// A home city from an account's biography: "City, ST", a city we know, or a place hashtag.
export function homeFromText(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  const cs = CITY_ST.exec(t);
  if (cs && findCity(cs[1], cs[2])) return { city: cs[1], state: cs[2] };
  const c = CITY_RE.exec(t);
  if (c) { const [city, state] = CITIES.get(c[1]); return { city, state }; }
  for (const m of t.matchAll(/#([A-Za-z]{2,40})/g)) { const p = placeOfTag(m[1]); if (p?.kind === "city") return { city: p.city, state: p.state }; }
  return null;
}

// usPlace(caption, tag, home) -> {city, state, address, from} | null. from: "address" | "city-state" | "city" | "tag" | "tag-state" | "home".
// Positive US evidence only: a street address, "City, ST", a city we know, a place hashtag (the caption's own, then the one we searched),
// or the identified account's home city. Winnipeg, Manila and Paris match nothing. "tag-state" has a state and no city.
export function usPlace(caption, tag = "", home = null) {
  const text = String(caption || "").replace(/\s+/g, " ");
  const a = parseAddress(text);
  if (a?.state && STATE_SET.has(a.state)) return { city: a.city, state: a.state, address: a.address, from: "address" };
  const cs = CITY_ST.exec(text);
  if (cs) return { city: cs[1], state: cs[2], address: a?.address || "", from: "city-state" };
  const c = CITY_RE.exec(text);
  if (c) { const [city, state] = CITIES.get(c[1]); return { city, state, address: a?.address || "", from: "city" }; }
  const tags = [...text.matchAll(/#([A-Za-z]{2,40})(?![A-Za-z0-9_])/g)].map((m) => m[1]).concat(tag ? [String(tag)] : []).map(placeOfTag).filter(Boolean);
  const t = tags.find((p) => p.kind === "city") || tags[0];
  if (t) return { city: t.city, state: t.state, address: a?.address || "", from: t.kind === "city" ? "tag" : "tag-state" };
  if (home?.state) return { city: home.city || "", state: home.state, address: a?.address || "", from: "home" };
  return null;
}

// ---- posts -> events -------------------------------------------------------------------------
const CONF = ["unsure", "likely", "confirmed"];
const SOFT_PLACE = new Set(["tag", "tag-state", "home"]);

// A thank-you or a recap ("Thank you Gallup for showing up for our Sunday pop-up") names a weekday that has gone by, not one to come.
// It is not an event unless the caption also carries a calendar date or a word that points ahead.
const PAST_CUE = /\bthank(?:s| you)\b|\byesterday\b|\brecap\b|\bwrap[- ]?up\b|\blast (?:night|week(?:end)?)\b|\bthrowback\b|\bhad (?:such )?a (?:blast|great|amazing)\b|\bwas (?:such )?an? (?:success|blast)\b/i;
const FUTURE_CUE = /\b(?:tomorrow|tonight|upcoming|next (?:pop|week|sat|sun|fri|mon|tue|wed|thu|one|event)|this (?:coming |sat|sun|fri|weekend)|coming (?:soon|up)|see you (?:there|then|on|this))/i;
const EXPLICIT_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\b/i;
export const pastNote = (caption) => PAST_CUE.test(caption) && !FUTURE_CUE.test(caption) && !EXPLICIT_DATE.test(caption);

// What a post says: {matcha, who, place, item}. ctx = {known, queried, names, home}; home(handle) -> {city, state} | null for the account's own city.
// item is the event to extract ({source, raw, how, placeFrom}) or null (no matcha word, no brand, or no US place).
export function analyze(post, tag, { known, queried, names, home } = {}) {
  const caption = post.caption || "";
  const matcha = hasMatcha(caption) || /#[a-z]*matcha/i.test(caption); // a matcha hashtag counts: the post sits under one
  const who = caption ? attribute(caption, { known, queried, names }) : null;
  const place = caption ? usPlace(caption, tag, who ? home?.(who.handle || who.candidate?.handle) || null : null) : null;
  let item = null;
  // A state-only place (#texas) still names the brand for the watch list but makes no event: an event needs a city to sit on.
  if (matcha && post.permalink && who && place && place.city && !pastNote(caption)) {
    const source = {
      id: `hashtag:${slug(who.handle || who.brand) || "post"}`, brand: who.brand, home_city: place.city || "", home_state: place.state, website: null, instagram: who.handle, tiktok: null,
      schedule_url: null, schedule_kind: "manual", adapter: "manual", active: true, kind: "popup", category: "matcha",
    };
    const raw = {
      source_url: post.permalink, text: caption, published_at: post.timestamp, handle: who.handle, media_type: post.media_type || null,
      image_url: post.image_url || null, posts: { instagram: post.permalink }, shortcode: shortcodeOf(post.permalink), hashtag: tag,
      hints: { city: place.city || undefined, state: place.state }, ...(hasMatcha(caption) ? {} : { tags: "matcha" }),
    };
    item = { source, raw, how: who.how, placeFrom: place.from };
  }
  return { matcha, who, place, item };
}

// One hashtag post -> {source, raw, how, placeFrom} or null (no brand, not matcha, no US place).
export const postToItem = (post, tag, ctx) => analyze(post, tag, ctx).item;

// Rules on what the extractor made of a post: dated today or later, confidence by what is known (never above likely), the matcha word in the title.
export function settle(cands, { now, placeFrom }) {
  const out = [];
  for (const c of cands) {
    const t = refDate(now, c.tz), day = `${t.y}-${String(t.mo).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    if (String(c.start).slice(0, 10) < day) continue;
    let conf = c.venue || c.address ? "likely" : "unsure";
    if (SOFT_PLACE.has(placeFrom)) conf = "unsure";
    if (CONF.indexOf(c.confidence) < CONF.indexOf(conf)) conf = c.confidence;
    out.push({ ...c, confidence: conf, title: hasMatcha(c.title) ? c.title : c.title.replace(/ pop-up/, " matcha pop-up") });
  }
  return out;
}

// The picture of a hashtag post: a video's thumbnail, a photo's url, or the first photo of a carousel.
const pictureOf = (p) => p.thumbnail_url || (p.media_type !== "VIDEO" ? p.media_url : null) || (p.children?.data || []).find((x) => x.media_type === "IMAGE" && x.media_url)?.media_url || null;

export const funnelLine = (f) => `funnel: ${f.posts} posts, ${f.matcha} matcha, ${f.brand} brand, ${f.place} place, ${f.dated} dated, ${f.kept} kept, ${f.accounts} accounts added`;

// ---- the harvest -----------------------------------------------------------------------------
// harvest({now, env, http, rate, room, file, wl, sources, events, dry}) -> {candidates, accounts, stats}
//  room(): false once this run's call budget is spent. events: the events we hold (a post already attached to a brand-read event is skipped).
//  accounts: every brand the posts name, {handle, found_via:"hashtag", found_from: permalink, evidence, guess}, for the watch list.
export async function harvest({ now = new Date(), env = process.env, http = fetch, rate, room = () => true, file = FILE, wl = { accounts: [] }, sources = [], events = [], dry = false } = {}) {
  const funnel = { posts: 0, matcha: 0, brand: 0, place: 0, dated: 0, kept: 0, accounts: 0 };
  const stats = { tags: 0, skipped: 0, posts: 0, kept: 0, stopped: false, funnel };
  const c = creds(env);
  if (!c) return { candidates: [], accounts: [], stats };
  const cfg = loadConfig(file);
  startWeek(cfg, now);
  const plan = planTags(cfg, rate, now);
  const queried = weekTags(cfg, now);
  const known = new Set([...wl.accounts.map((a) => a.handle.toLowerCase()), ...sources.map((s) => (s.instagram || "").toLowerCase()).filter(Boolean)]);
  const names = new Map(wl.accounts.filter((a) => a.name).map((a) => [a.handle.toLowerCase(), a.name]));
  const homes = new Map();
  for (const s of sources) if (s.instagram && s.home_state) homes.set(s.instagram.toLowerCase(), { city: s.home_city || "", state: s.home_state });
  for (const a of wl.accounts) {
    const h = a.handle.toLowerCase();
    if (!homes.has(h)) { const home = a.state ? { city: a.city || "", state: a.state } : homeFromText(a.bio); if (home) homes.set(h, home); }
  }
  const home = (handle) => homes.get(String(handle || "").toLowerCase()) || null;
  // Posts already attached to an event of a real source: that brand's own read owns them.
  const owned = new Set(events.filter((e) => !String(e.source_id).startsWith("hashtag:")).map((e) => shortcodeOf(e.posts?.instagram)).filter(Boolean));
  const seen = new Set(), candidates = [], accounts = [], added = new Set();

  for (const tag of plan) {
    if (!room()) break;
    const st = cfg.stats[tag] ||= { runs: 0, posts: 0, kept: 0, accounts: 0, last_run: null, last_top: null };
    if (st.last_run && new Date(now) - Date.parse(st.last_run) < HARVEST_GAP_HOURS * HOUR) { stats.skipped++; continue; }
    let posts = [];
    try {
      if (!cfg.ids[tag]) {
        const hid = await hashtagId(tag, c, rate, http);
        rate.hashtagUsed(tag);
        st.last_run = new Date(now).toISOString();
        if (!hid) { markMissing(cfg, tag); continue; }
        cfg.ids[tag] = hid;
      }
      posts = await hashtagEdge(cfg.ids[tag], "recent_media", c, rate, { http, pages: MAX_PAGES, room });
      if ((!st.last_top || new Date(now) - Date.parse(st.last_top) >= DAY) && room()) {
        posts = posts.concat(await hashtagEdge(cfg.ids[tag], "top_media", c, rate, { http, pages: 1, room }));
        st.last_top = new Date(now).toISOString();
      }
    } catch (e) {
      if (e instanceof Stop) { warn(e.message); stats.stopped = true; break; }
      warn(`#${tag}: ${e.message}`);
      continue;
    }
    stats.tags++; stats.posts += posts.length;
    let kept = 0, fresh = 0;
    for (const p of posts) {
      const sc = shortcodeOf(p.permalink);
      if (!sc || seen.has(sc) || owned.has(sc)) continue;
      seen.add(sc);
      funnel.posts++;
      const a = analyze({ ...p, image_url: pictureOf(p) }, tag, { known, queried, names, home });
      if (a.matcha) funnel.matcha++;
      if (a.who) {
        funnel.brand++;
        const h = a.who.candidate?.handle, key = String(h || "").toLowerCase();
        if (h && !known.has(key) && !added.has(key)) {
          added.add(key); fresh++; funnel.accounts++;
          accounts.push({ handle: h, found_via: "hashtag", found_from: p.permalink, evidence: String(p.caption || "").slice(0, 160), guess: a.who.candidate.guess });
        }
      }
      if (a.place) funnel.place++;
      if (!a.item) continue;
      const { candidates: cs } = await processItems([a.item.raw], a.item.source, { now, handle: a.item.source.instagram });
      if (cs.length) funnel.dated++;
      const good = settle(cs, { now, placeFrom: a.item.placeFrom });
      if (!good.length) continue;
      kept++; funnel.kept++;
      candidates.push(...good);
    }
    st.runs++; st.posts += posts.length; st.kept += kept; st.last_run = new Date(now).toISOString();
    recordYield(cfg, tag, { kept, accounts: fresh });
    stats.kept += kept;
  }
  // City tags the week's budget could not fit stay first in line: the walk resumes at the first one left unread.
  if (cfg.general && cfg.week) {
    const planned = new Set(plan), missing = new Set(cfg.missing);
    const left = cfg.week.tags.filter((t) => !cfg.general.includes(t) && !planned.has(t) && !missing.has(t));
    const first = left.length ? cfg.cities.indexOf(left[0]) : -1;
    if (first >= 0) { cfg.cursor = first; cfg.week.tags = cfg.week.tags.filter((t) => !left.includes(t)); }
  }
  if (!dry) saveConfig(cfg, file);
  info(`hashtags: ${stats.tags} read, ${stats.skipped} read within ${HARVEST_GAP_HOURS}h, ${stats.posts} posts, ${stats.kept} dated US posts${stats.stopped ? " (rate limit: stopped)" : ""}`);
  info(funnelLine(funnel));
  return { candidates, accounts, stats };
}
