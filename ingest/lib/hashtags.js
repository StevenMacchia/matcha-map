// Hashtag harvest: public Instagram posts under matcha pop-up hashtags become events.
// Official Graph API only (ig_hashtag_search, recent_media, top_media); never a page of instagram.com.
//
// The API returns no username for hashtag media, so a post's brand comes from its caption: an @mention, a brand-looking
// hashtag, or a name before "pop-up". A post with none of those is skipped (no anonymous events). A post is kept only when
// its caption yields a dated pop-up on or after today in a US place. Each kept post is one RawItem under the pseudo-source
// `hashtag:<brand slug>` (matcha-only, replaced when a real read of the same brand finds the same day, decays like the others).
// The slug, not the tag, is in the id so two brands under one tag never share an event id.
//
// Cost: ids are cached in data/hashtags.json, so a tag is 1 call per page of recent_media (up to 3) plus 1 for top_media once
// a day. A tag is re-read at most every HARVEST_GAP_HOURS (recent_media only reaches back 24 hours).
import fs from "node:fs";
import { shortcodeOf, hashtagId, hashtagEdge, creds, Stop } from "../adapters/instagram-graph.js";
import { hasMatcha } from "../adapters/mato.js";
import { processItems } from "./pipeline.js";
import { parseAddress, refDate } from "./extract.js";
import { STATES } from "./tz.js";
import { CITY_STATE } from "./sites/common.js";
import { prettyHandle } from "./names.js";
import { slug } from "./watchlist.js";
import { warn, info } from "./log.js";

export const FILE = "data/hashtags.json";
const HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;
export const HARVEST_GAP_HOURS = 6;
export const MAX_PAGES = 3;
// The hashtag step may spend at most this many calls of a watch run; the rest of the run's budget goes to account reads.
export const RUN_CALLS = 90;
// Week 0 of the rotation (a Monday). Weeks alternate through cfg.rotation.
const EPOCH = Date.UTC(2026, 10, 16);

// ---- config ----------------------------------------------------------------------------------
export function loadConfig(file = FILE) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch { warn("data/hashtags.json missing or invalid"); }
  return { note: "", active: [], rotation: [], ids: {}, stats: {}, ...c };
}
export function saveConfig(cfg, file = FILE) { fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n"); }

// Kept posts per run, the yield that decides which city tags rotate out. A tag never read yields 0.
export const yieldOf = (cfg, tag) => { const s = cfg.stats?.[tag]; return s && s.runs ? s.kept / s.runs : 0; };

// The tags for a week. Rotation lists: [0] is the city tags this week starts with, each later list swaps in on its own week,
// replacing the lowest-yield city tags (ties: the later in the active list goes first).
export function weekTags(cfg, now = new Date()) {
  const rot = cfg.rotation || [];
  if (rot.length < 2) return cfg.active.slice();
  const w = Math.floor((new Date(now).getTime() - EPOCH) / WEEK), slot = ((w % rot.length) + rot.length) % rot.length;
  if (slot === 0) return cfg.active.slice();
  const incoming = rot[slot].filter((t) => !cfg.active.includes(t));
  const city = new Set(rot[0]);
  const out = cfg.active.slice();
  const order = out.map((t, i) => [t, i]).filter(([t]) => city.has(t)).sort((a, b) => yieldOf(cfg, a[0]) - yieldOf(cfg, b[0]) || b[1] - a[1]);
  incoming.slice(0, order.length).forEach((t, k) => { out[out.indexOf(order[k][0])] = t; });
  return out;
}

// The tags to read now, in priority order, stopping where the 30-per-7-days budget is full (tags already counted still fit).
export function planTags(cfg, rate, now = new Date()) {
  const counted = new Set(rate.hashtagsCounted());
  let free = rate.hashtagFree();
  return weekTags(cfg, now).filter((t) => counted.has(t) || (free > 0 && free--));
}

// ---- brand from a caption --------------------------------------------------------------------
const GENERIC = new Set(["matcha", "matchapopup", "matchapopups", "matchaevent", "matchaevents", "popup", "popups", "popupshop", "food", "foodie", "foodies", "coffee", "cafe", "cafes", "smallbusiness", "smallbiz", "explore", "explorepage", "fyp", "foryou", "foryoupage", "viral", "trending", "reels", "instagood", "love", "tea", "teatime", "barista", "coffeeshop", "matchalatte", "matchalover", "matchalovers", "matchatime", "matchagirl", "matchaaddict", "matchaobsessed", "matchaholic", "matchagram", "matchalife", "matchaday", "matchaseason", "matchacommunity", "matchadrink", "matchatea", "matchacafe", "matchalatteart", "matchalove", "matchacoffee", "matchaeverything", "matchacart", "matchabar", "matchafest", "matchamarket", "matchatruck", "matchastand", "popupmatcha", "matchapopupshop", "supportsmallbusiness", "shoplocal", "weekend", "sunday", "saturday"]);
const CITY_WORDS = new Set([...Object.keys(CITY_STATE).map((c) => c.toLowerCase().replace(/[^a-z]/g, "")), "nyc", "la", "sf", "atl", "dc", "bayarea", "oc", "nj", "philly", "losangeles", "newyork", "newyorkcity"]);
const BRAND_LOOK = /matcha|cafe|tea|bar|co$|^co(?!ffee|ok|mmunity|ntent)/;
const NAME_STOP = new Set(["our", "this", "the", "a", "an", "my", "your", "first", "next", "new", "weekend", "matcha", "every", "last", "another", "big", "special", "monthly", "summer", "winter", "spring", "fall", "holiday", "sunday", "saturday", "friday", "monday", "tuesday", "wednesday", "thursday", "join", "visit", "see", "come", "at", "for", "to", "and", "with", "from", "pop"]);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Is a hashtag a generic or queried term (or a city), not a brand?
export function isGenericTag(tag, queried = []) {
  const t = String(tag).toLowerCase().replace(/^#/, "");
  return GENERIC.has(t) || CITY_WORDS.has(t) || queried.includes(t) || /^matchapopup/.test(t) || /^popup/.test(t);
}

// A brand-looking hashtag: not generic, and either carries a brand word (matcha, cafe, tea, bar, co) or reappears capitalised in the caption.
function brandTag(caption, queried) {
  for (const m of caption.matchAll(/#([A-Za-z0-9_]{3,40})/g)) {
    const t = m[1].toLowerCase();
    if (isGenericTag(t, queried)) continue;
    const word = new RegExp(`(?<![#\\w])${cap(t)}(?![\\w])`);
    if (BRAND_LOOK.test(t) || word.test(caption)) return t;
  }
  return null;
}

// A capitalised name directly before "pop-up", "popup" or "pop up".
function nameBeforePopup(caption) {
  const m = /((?:[A-Z][\w'&.-]*)(?:\s+(?:&\s+)?[A-Z][\w'&.-]*){0,3})\s+[Pp]op[\s-]?[Uu]p/.exec(caption);
  if (!m) return null;
  const words = m[1].split(/\s+/);
  while (words.length && NAME_STOP.has(words[0].toLowerCase())) words.shift();
  while (words.length && NAME_STOP.has(words.at(-1).toLowerCase())) words.pop();
  const name = words.join(" ");
  return name.length >= 3 ? name : null;
}

// attribute(caption, {known, queried, names}) -> {handle, brand, how} | null.
// known: lowercase handles from the watch list and sources.json. queried: the hashtags we search (never brands).
export function attribute(caption, { known = new Set(), queried = [], names = new Map() } = {}) {
  const text = String(caption || "");
  const mentions = [...text.matchAll(/(?<![\w.@/+-])@([A-Za-z0-9][A-Za-z0-9._]{1,28})/g)].map((m) => m[1].replace(/\.+$/, "")).filter((h) => h.length >= 3 && /[a-z]/i.test(h));
  const onList = mentions.find((h) => known.has(h.toLowerCase()));
  const handle = onList || mentions[0];
  if (handle) return { handle, brand: names.get(handle.toLowerCase()) || prettyHandle(handle), how: onList ? "known mention" : "mention" };
  const tag = brandTag(text, queried);
  if (tag) return { handle: null, brand: prettyHandle(tag), how: "hashtag" };
  const name = nameBeforePopup(text);
  if (name) return { handle: null, brand: name, how: "name" };
  return null;
}

// ---- a US place from a caption ---------------------------------------------------------------
const EXTRA_CITIES = {
  "San Antonio": "TX", "Fort Worth": "TX", Plano: "TX", Irvine: "CA", "Santa Monica": "CA", Pasadena: "CA", "Long Beach": "CA", "Santa Ana": "CA", Anaheim: "CA",
  "Jersey City": "NJ", Hoboken: "NJ", Newark: "NJ", Scottsdale: "AZ", Tempe: "AZ", Tucson: "AZ", Queens: "NY", Manhattan: "NY", Boulder: "CO", Cambridge: "MA",
  Somerville: "MA", Arlington: "VA", Alexandria: "VA", Charleston: "SC", Savannah: "GA", Richmond: "VA", Louisville: "KY", Memphis: "TN", Milwaukee: "WI",
  Madison: "WI", Albuquerque: "NM", Gallup: "NM", "Fort Lauderdale": "FL", "St. Petersburg": "FL", Berkeley: "CA", "Palo Alto": "CA", "Santa Barbara": "CA", Cincinnati: "OH",
};
const ALIASES = { NYC: ["New York", "NY"], "New York City": ["New York", "NY"], "Bay Area": ["San Francisco", "CA"], DC: ["Washington DC", "DC"], ATL: ["Atlanta", "GA"], Philly: ["Philadelphia", "PA"], Vegas: ["Las Vegas", "NV"] };
const CITIES = new Map([...Object.entries(CITY_STATE), ...Object.entries(EXTRA_CITIES)].map(([c, s]) => [c, [c, s]]).concat(Object.entries(ALIASES)));
const CITY_RE = new RegExp(`(?<![\\w#@])(${[...CITIES.keys()].sort((a, b) => b.length - a.length).map((c) => c.replace(/[.]/g, "\\.")).join("|")})(?![\\w])`);
const STATE_SET = new Set(STATES);
const CITY_ST = new RegExp(`\\b([A-Z][A-Za-z.'-]+(?:\\s[A-Z][A-Za-z.'-]+){0,2}),\\s*(${STATES.join("|")})\\b`);

// A city tag (matchapopup<place>) stands in for the place when the caption names none.
const TAG_PLACE = { nyc: ["New York", "NY"], la: ["Los Angeles", "CA"], chicago: ["Chicago", "IL"], houston: ["Houston", "TX"], dallas: ["Dallas", "TX"], atl: ["Atlanta", "GA"], miami: ["Miami", "FL"], sf: ["San Francisco", "CA"], bayarea: ["San Francisco", "CA"], seattle: ["Seattle", "WA"], dc: ["Washington DC", "DC"], philly: ["Philadelphia", "PA"], boston: ["Boston", "MA"], austin: ["Austin", "TX"], sandiego: ["San Diego", "CA"], oc: ["Santa Ana", "CA"], nj: ["Newark", "NJ"], denver: ["Denver", "CO"], lasvegas: ["Las Vegas", "NV"], phoenix: ["Phoenix", "AZ"], raleigh: ["Raleigh", "NC"], charlotte: ["Charlotte", "NC"], portland: ["Portland", "OR"], detroit: ["Detroit", "MI"], minneapolis: ["Minneapolis", "MN"], nashville: ["Nashville", "TN"], orlando: ["Orlando", "FL"], tampa: ["Tampa", "FL"], sacramento: ["Sacramento", "CA"], sanantonio: ["San Antonio", "TX"], honolulu: ["Honolulu", "HI"] };

// usPlace(caption, tag) -> {city, state, address, from} | null. from: "address" | "city-state" | "city" | "tag".
// Positive US evidence only: a street address, "City, ST", a city we know, or a city tag. Winnipeg, Manila and Paris match nothing.
export function usPlace(caption, tag = "") {
  const text = String(caption || "").replace(/\s+/g, " ");
  const a = parseAddress(text);
  if (a?.state && STATE_SET.has(a.state)) return { city: a.city, state: a.state, address: a.address, from: "address" };
  const cs = CITY_ST.exec(text);
  if (cs) return { city: cs[1], state: cs[2], address: a?.address || "", from: "city-state" };
  const c = CITY_RE.exec(text);
  if (c) { const [city, state] = CITIES.get(c[1]); return { city, state, address: a?.address || "", from: "city" }; }
  const t = /^matchapopup(.+)$/.exec(String(tag).toLowerCase());
  const place = t && TAG_PLACE[t[1]];
  if (place) return { city: place[0], state: place[1], address: a?.address || "", from: "tag" };
  return null;
}

// ---- posts -> events -------------------------------------------------------------------------
const CONF = ["unsure", "likely", "confirmed"];

// One hashtag post -> {source, raw, how, placeFrom} or null (no brand, not matcha, no US place).
export function postToItem(post, tag, { known, queried, names } = {}) {
  const caption = post.caption || "";
  if (!caption || !post.permalink || !hasMatcha(caption)) return null;
  const who = attribute(caption, { known, queried, names });
  if (!who) return null;
  const place = usPlace(caption, tag);
  if (!place) return null;
  const source = {
    id: `hashtag:${slug(who.handle || who.brand) || "post"}`, brand: who.brand, home_city: place.city || "", home_state: place.state, website: null, instagram: who.handle, tiktok: null,
    schedule_url: null, schedule_kind: "manual", adapter: "manual", active: true, kind: "popup", category: "matcha",
  };
  const raw = {
    source_url: post.permalink, text: caption, published_at: post.timestamp, handle: who.handle, media_type: post.media_type || null,
    image_url: post.image_url || null, posts: { instagram: post.permalink }, shortcode: shortcodeOf(post.permalink), hashtag: tag,
    hints: { city: place.city || undefined, state: place.state },
  };
  return { source, raw, how: who.how, placeFrom: place.from };
}

// Rules on what the extractor made of a post: dated today or later, confidence by what is known (never above likely), the matcha word in the title.
export function settle(cands, { now, placeFrom }) {
  const out = [];
  for (const c of cands) {
    const t = refDate(now, c.tz), day = `${t.y}-${String(t.mo).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    if (String(c.start).slice(0, 10) < day) continue;
    let conf = c.venue || c.address ? "likely" : "unsure";
    if (placeFrom === "tag") conf = "unsure";
    if (CONF.indexOf(c.confidence) < CONF.indexOf(conf)) conf = c.confidence;
    out.push({ ...c, confidence: conf, title: hasMatcha(c.title) ? c.title : c.title.replace(/ pop-up/, " matcha pop-up") });
  }
  return out;
}

// The picture of a hashtag post: a video's thumbnail, a photo's url, or the first photo of a carousel.
const pictureOf = (p) => p.thumbnail_url || (p.media_type !== "VIDEO" ? p.media_url : null) || (p.children?.data || []).find((x) => x.media_type === "IMAGE" && x.media_url)?.media_url || null;

// ---- the harvest -----------------------------------------------------------------------------
// harvest({now, env, http, rate, room, file, wl, sources, events, dry}) -> {candidates, accounts, stats}
//  room(): false once this run's call budget is spent. events: the events we hold (a post already attached to a brand-read event is skipped).
export async function harvest({ now = new Date(), env = process.env, http = fetch, rate, room = () => true, file = FILE, wl = { accounts: [] }, sources = [], events = [], dry = false } = {}) {
  const stats = { tags: 0, skipped: 0, posts: 0, kept: 0, stopped: false };
  const c = creds(env);
  if (!c) return { candidates: [], accounts: [], stats };
  const cfg = loadConfig(file);
  const plan = planTags(cfg, rate, now);
  const queried = weekTags(cfg, now);
  const known = new Set([...wl.accounts.map((a) => a.handle.toLowerCase()), ...sources.map((s) => (s.instagram || "").toLowerCase()).filter(Boolean)]);
  const names = new Map(wl.accounts.filter((a) => a.name).map((a) => [a.handle.toLowerCase(), a.name]));
  // Posts already attached to an event of a real source: that brand's own read owns them.
  const owned = new Set(events.filter((e) => !String(e.source_id).startsWith("hashtag:")).map((e) => shortcodeOf(e.posts?.instagram)).filter(Boolean));
  const seen = new Set(), candidates = [], accounts = [];

  for (const tag of plan) {
    if (!room()) break;
    const st = cfg.stats[tag] ||= { runs: 0, posts: 0, kept: 0, last_run: null, last_top: null };
    if (st.last_run && new Date(now) - Date.parse(st.last_run) < HARVEST_GAP_HOURS * HOUR) { stats.skipped++; continue; }
    let posts = [];
    try {
      if (!cfg.ids[tag]) {
        const hid = await hashtagId(tag, c, rate, http);
        rate.hashtagUsed(tag);
        if (!hid) { st.last_run = new Date(now).toISOString(); continue; }
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
    let kept = 0;
    for (const p of posts) {
      const sc = shortcodeOf(p.permalink);
      if (!sc || seen.has(sc) || owned.has(sc)) continue;
      seen.add(sc);
      const item = postToItem({ ...p, image_url: pictureOf(p) }, tag, { known, queried, names });
      if (!item) continue;
      const { candidates: cs } = await processItems([item.raw], item.source, { now, handle: item.source.instagram });
      const good = settle(cs, { now, placeFrom: item.placeFrom });
      if (!good.length) continue;
      kept++;
      candidates.push(...good);
      if (item.raw.handle) accounts.push({ handle: item.raw.handle, found_via: "hashtag", found_from: `#${tag}`, evidence: item.raw.text.slice(0, 160) });
    }
    st.runs++; st.posts += posts.length; st.kept += kept; st.last_run = new Date(now).toISOString();
    stats.kept += kept;
  }
  if (!dry) saveConfig(cfg, file);
  info(`hashtags: ${stats.tags} read, ${stats.skipped} read within ${HARVEST_GAP_HOURS}h, ${stats.posts} posts, ${stats.kept} dated US posts${stats.stopped ? " (rate limit: stopped)" : ""}`);
  return { candidates, accounts, stats };
}
