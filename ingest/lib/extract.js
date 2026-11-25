// Rule extractor: RawItem -> event candidates. No network. Pure functions.
import { STATES, tzFor, zonedIso, parts } from "./tz.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const monthNum = (s) => MONTHS[s.slice(0, 4).toLowerCase() === "sept" ? "sept" : s.slice(0, 3).toLowerCase()];
const NOT_TIME = "(?!\\s*(?::|am\\b|pm\\b|a\\.m|p\\.m))";
const SEP = "(-|\\u2013|\\u2014|to|through|thru|&|and|\\+)";

const RE_MD = new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b${NOT_TIME}(?:\\s*${SEP}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b${NOT_TIME})?(?:,?\\s*(20\\d\\d)\\b)?`, "gi");
const RE_DM = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(-|\\u2013|\\u2014|to|&|and)\\s*(\\d{1,2})(?:st|nd|rd|th)?)?\\s+(?:of\\s+)?${MON}\\b\\.?(?:,?\\s*(20\\d\\d)\\b)?`, "gi");
const RE_NUM = /(?<![\d/$.:])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?:\s*[-–]\s*(\d{1,2}))?(?![\d/])/g;
const RE_REL = /\b(today|tonight|tomorrow|this weekend|next weekend|(?:this|next|on)?\s*(?:sun|mon|tues|wednes|thurs|fri|satur)day(?!s))\b/gi;
// A date with no year that lands more than this many days ahead of the post is last season's (a July date read in November rolled to next July).
export const DEFAULT_MAX_AHEAD_DAYS = 150;

// Recurring talk: "weekly", "every Saturday", "each week", "every other weekend"; "every single time" is not.
const RECURRING = /\bweekly\b|\b(?:every|each)\s+(?:other\s+|single\s+)?(?:sun|mon|tue|wed|thu|fri|sat|week|day|weekend|month|first|second|third|fourth|last|1st|2nd|3rd|4th)/i;

const pad = (n) => String(n).padStart(2, "0");
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const validMD = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

// Add days to a {y,mo,d} date.
function addDays({ y, mo, d }, n) {
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const dowOf = ({ y, mo, d }) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
const cmpDays = (a, b) => Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 86400000);
const cmp = (a, b) => a.y - b.y || a.mo - b.mo || a.d - b.d;

// Next occurrence of month/day on or after ref (never in the past).
function inferYear(m, d, ref) {
  let y = ref.y;
  if (cmp({ y, mo: m, d }, ref) < 0) y += 1;
  return y;
}

// Find every date mention. Returns [{start,end,dates:[{y,mo,d}],kind}] in text order.
export function findDates(text, ref) {
  const found = [];
  const taken = [];
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  const push = (m, dates, kind) => {
    taken.push([m.index, m.index + m[0].length]);
    found.push({ start: m.index, end: m.index + m[0].length, dates, kind });
  };
  // Range separators (- to through) fill every day; list separators (& and +) keep just the two.
  const isList = (sep) => /^(&|and|\+)$/i.test(sep || "");
  const make = (mo, d1, sep, d2, yr) => {
    if (!validMD(mo, d1)) return null;
    const y = yr ? +yr : inferYear(mo, d1, ref);
    const dates = [{ y, mo, d: d1, inferred: !yr }];
    if (d2 && validMD(mo, d2) && d2 > d1) {
      if (isList(sep) || d2 - d1 > 6) dates.push({ y, mo, d: d2, inferred: !yr });
      else for (let d = d1 + 1; d <= d2; d++) dates.push({ y, mo, d, inferred: !yr });
    }
    return { dates };
  };

  for (const m of text.matchAll(RE_MD)) {
    const r = make(monthNum(m[1]), +m[2], m[3], m[4] ? +m[4] : null, m[5]);
    if (r && free(m.index, m.index + m[0].length)) push(m, r.dates, "md");
  }
  for (const m of text.matchAll(RE_DM)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const r = make(monthNum(m[4]), +m[1], m[2], m[3] ? +m[3] : null, m[5]);
    if (r) push(m, r.dates, "dm");
  }
  for (const m of text.matchAll(RE_NUM)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const mo = +m[1], d = +m[2];
    if (!validMD(mo, d)) continue;
    let yr = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    const r = make(mo, d, "-", m[4] ? +m[4] : null, yr);
    if (r) push(m, r.dates, "num");
  }
  // Relative words only count when there is no explicit date elsewhere in the text.
  // Recurring talk ("every Saturday", "weekly") is not one dated event.
  if (!found.length && !RECURRING.test(text)) {
    for (const m of text.matchAll(RE_REL)) {
      if (/every\s*$/i.test(text.slice(Math.max(0, m.index - 8), m.index))) continue;
      const w = m[1].trim().toLowerCase();
      const dow = dowOf(ref);
      let date, kind = "rel";
      if (w === "today" || w === "tonight") date = ref;
      else if (w === "tomorrow") date = addDays(ref, 1);
      else if (w.endsWith("weekend")) {
        const toSat = dow === 0 ? 0 : (6 - dow + 7) % 7; // Sunday: the weekend is today
        date = addDays(ref, toSat + (w.startsWith("next") ? 7 : 0));
        kind = "weekend";
      } else {
        const target = WEEKDAYS.findIndex((x) => w.endsWith(x));
        const ahead = (target - dow + 7) % 7;
        date = addDays(ref, ahead + (w.startsWith("next") ? 7 : 0));
        kind = "weekday";
      }
      push(m, [date], kind);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// Hour/minute -> 24h with a meridiem ("am"/"pm"/null).
function to24(h, mi, mer) {
  let hh = h % 12;
  if (mer === "pm") hh += 12;
  return { h: hh, mi: mi || 0 };
}
const MER = "(am|pm|a\\.m\\.|p\\.m\\.)";
const mer = (s) => (s ? (s[0].toLowerCase() === "a" ? "am" : "pm") : null);

// Find a time (range or single) in a short segment. Returns {start,end,untilSoldOut} or null.
export function findTime(raw) {
  // "630am" is 6:30am, "1030pm" is 10:30pm (a compact time, 3 or 4 digits); without this "630am-Midnight" read only "12am" and the event started at local midnight.
  const text = raw.replace(/\bnoon\b/gi, "12pm").replace(/\bmidnight\b/gi, "12am")
    .replace(/(?<![\d/:.])(\d{1,2})(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/gi, (m, h, mi, ap) => (+h >= 1 && +h <= 12 && +mi < 60 ? `${h}:${mi}${ap}` : m));
  const soldOut = /(until|till|til)\s+(we\s+)?(sold\s*out|sell\s*out)|while\s+supplies\s+last|sold\s*out/i.test(text);
  const range = new RegExp(`(?<![\\d/:])(\\d{1,2})(?::(\\d{2}))?\\s*${MER}?\\s*(?:-|\\u2013|\\u2014|to|until|till|til)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MER}`, "i").exec(text);
  if (range) {
    const [, h1, m1, mer1, h2, m2, mer2] = range;
    if (+h1 >= 1 && +h1 <= 12 && +h2 >= 1 && +h2 <= 12) {
      const endMer = mer(mer2);
      const e = to24(+h2, +m2, endMer);
      let s = to24(+h1, +m1, mer(mer1) || endMer);
      if (!mer1 && s.h * 60 + s.mi >= e.h * 60 + e.mi) s = to24(+h1, +m1, endMer === "pm" ? "am" : "pm"); // "11-3pm" -> 11am
      return { start: s, end: e, untilSoldOut: false };
    }
  }
  const from = new RegExp(`\\b(?:from|starts?(?:\\s+at)?|starting(?:\\s+at)?|at|doors(?:\\s+at)?|@)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*${MER}?\\b(?!\\s+[A-Z][a-z])`, "i").exec(text);
  const single = new RegExp(`(?<![\\d/:])(\\d{1,2})(?::(\\d{2}))?\\s*${MER}`, "i").exec(text);
  const pick = single || from;
  if (pick && +pick[1] >= 1 && +pick[1] <= 12) {
    let m = mer(pick[3]);
    if (!m) m = +pick[1] === 12 ? "pm" : +pick[1] >= 7 ? "am" : "pm"; // "from 10" -> am, "at 3" -> pm
    return { start: to24(+pick[1], +pick[2], m), end: null, untilSoldOut: soldOut };
  }
  return null;
}

const SUFFIX = "(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway|Ct|Court|Pl|Place|Sq|Square|Ter|Terrace|Expy|Expressway|Cir|Circle|Trl|Trail)";
const RE_ADDR = new RegExp(`\\b(\\d{1,5})\\s+((?:[NSEW]\\.?\\s+)?(?:[A-Z0-9][A-Za-z0-9.'-]*\\s+){0,3}?${SUFFIX}\\b\\.?)(?:,?\\s*((?:Suite|Ste|Unit|Apt|Bldg|Building|Floor|Fl)\\.?\\s*#?\\s*[A-Za-z0-9-]+|#\\s*[A-Za-z0-9-]+))?`);
const RE_TAIL = /^\s*,?\s*([A-Z][A-Za-z.'-]*(?:\s[A-Z][A-Za-z.'-]*){0,3}),?\s+([A-Z]{2})\b(?:\s+(\d{5}(?:-\d{4})?))?/;

// Parse a street address plus optional city, state, zip out of free text.
export function parseAddress(text) {
  const m = RE_ADDR.exec(text || "");
  if (!m) return null;
  const out = { address: `${m[1]} ${m[2].replace(/\.$/, "")}${m[3] ? " " + m[3] : ""}`.replace(/\s+/g, " "), city: null, state: null, zip: null };
  const t = RE_TAIL.exec(text.slice(m.index + m[0].length));
  if (t && STATES.includes(t[2])) { out.city = t[1]; out.state = t[2]; out.zip = t[3] || null; }
  return out;
}

// "Venue, City, ST" -> {venue, city, state}. Plain venue text stays venue.
export function splitPlace(s) {
  const parts_ = String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (parts_.length >= 3 && /^[A-Z]{2}$/.test(parts_.at(-1)) && STATES.includes(parts_.at(-1))) {
    return { venue: parts_.slice(0, -2).join(", "), city: parts_.at(-2), state: parts_.at(-1) };
  }
  if (parts_.length === 2 && /^[A-Z]{2}$/.test(parts_[1]) && STATES.includes(parts_[1])) return { venue: null, city: parts_[0], state: parts_[1] };
  return { venue: parts_[0] || null, city: null, state: null };
}

const NOT_VENUE = new RegExp(`^(?:${MON}|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|The Matcha|Matcha)\\b`);
// Venue: the first "@mention" that is not the source's own handle, else "at Capitalized Words".
function findVenue(text, own) {
  const ownSet = new Set((own || []).filter(Boolean).map((h) => h.toLowerCase()));
  for (const m of text.matchAll(/(?<![\w.])@([A-Za-z0-9._]{2,30})/g)) {
    const h = m[1].replace(/\.+$/, "");
    if (!ownSet.has(h.toLowerCase())) return { venue: "@" + h, kind: "mention" };
  }
  const at = /\bat\s+((?:[A-Z][\w'&.-]*)(?:\s+(?:&\s+)?[A-Z][\w'&.-]*){0,3})/.exec(text);
  if (at && !NOT_VENUE.test(at[1]) && !/^\d/.test(at[1])) return { venue: at[1].replace(/[.,]$/, ""), kind: "at" };
  return null;
}

const CONF = ["unsure", "likely", "confirmed"];
const capConf = (c, max) => (CONF.indexOf(c) > CONF.indexOf(max) ? max : c);

// The ref "today" in a zone as {y,mo,d}.
export function refDate(when, tz) {
  const p = parts(tz, new Date(when).getTime());
  return { y: p.y, mo: p.mo, d: p.d };
}

// extract(raw, {source, now}) -> candidate[]. A candidate has the event fields minus ids/geo.
export function extract(raw, ctx = {}) {
  const source = ctx.source || {};
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const homeTz = tzFor({ state: source.home_state, city: source.home_city }) || "America/New_York";
  const text = String(raw.text || "").replace(/\s+/g, " ").trim();
  const hints = raw.hints || {};
  const ref = refDate(raw.published_at || now, homeTz);
  const today = refDate(now, homeTz);
  const own = [source.instagram, source.tiktok];

  // Where: hints win, then text.
  let place = hints.venue ? splitPlace(hints.venue) : { venue: null, city: null, state: null };
  const addr = parseAddress(hints.address || "") || parseAddress(text);
  let venue = place.venue;
  let venueKind = venue ? "hint" : null;
  if (!venue) { const v = findVenue(text, own); if (v) { venue = v.venue; venueKind = v.kind; } }
  let city = hints.city || addr?.city || place.city || null;
  let state = hints.state || addr?.state || place.state || null;
  let cityInferred = false;
  if (!city || !state) { city = source.home_city || null; state = source.home_state || null; cityInferred = true; }
  const tz = hints.tz || tzFor({ city, state }) || homeTz;

  // When: hints give an exact start; otherwise read dates and times from text.
  const slots = [];
  if (hints.start) {
    slots.push({ start: hints.start, end: hints.end || null, all_day: !!hints.all_day, explicit: true, timed: !hints.all_day, rel: false });
  } else {
    const dates = findDates(text, ref);
    const globalTime = dates.length === 1 ? findTime(text) : null;
    dates.forEach((g, i) => {
      const after = text.slice(g.end, dates[i + 1] ? dates[i + 1].start : g.end + 140);
      const before = text.slice(Math.max(i ? dates[i - 1].end : 0, g.start - 50), g.start);
      const t = findTime(after) || findTime(before) || globalTime;
      for (const d of g.dates) {
        // Stale-page guard: a year-less date far ahead is more likely last season's.
        if (d.inferred && cmpDays(d, ref) > (raw.maxAheadDays || DEFAULT_MAX_AHEAD_DAYS)) continue;
        const rel = ["rel", "weekday", "weekend"].includes(g.kind);
        // A relative word ("tomorrow", "this Saturday") resolves against the post date (raw.published_at). Without a trusted post date
        // (raw.noRelative) it is not used; and a relative day that resolves before today is a past post, never an event.
        if (rel && (raw.noRelative || cmpDays(d, today) < 0)) continue;
        const base = { explicit: !rel, timed: !!t, rel, weak: g.kind === "weekday" || g.kind === "weekend" };
        if (t) {
          slots.push({ ...base, start: zonedIso(tz, d.y, d.mo, d.d, t.start.h, t.start.mi), end: t.end ? zonedIso(tz, d.y, d.mo, d.d, t.end.h, t.end.mi) : null, all_day: false });
        } else {
          slots.push({ ...base, start: zonedIso(tz, d.y, d.mo, d.d, 0, 0), end: null, all_day: true });
        }
      }
    });
  }

  // De-dupe slots by start.
  const seen = new Set();
  const out = [];
  for (const s of slots) {
    if (seen.has(s.start)) continue;
    seen.add(s.start);
    const hasAddr = !!(addr && addr.address);
    let conf;
    if (s.explicit && s.timed && hasAddr && !cityInferred) conf = "confirmed";
    else if (s.explicit && (s.timed || hasAddr || (venue && !cityInferred))) conf = "likely";
    else conf = "unsure";
    if (s.rel) conf = capConf(conf, s.weak ? "unsure" : "likely");
    if (!hasAddr && cityInferred && !(hints.start && venue)) conf = "unsure";
    const title = hints.title || (venue ? `${source.brand || "Matcha"} pop-up at ${venue.replace(/^@/, "")}` : `${source.brand || "Matcha"} pop-up`);
    out.push({
      title: title.slice(0, 120),
      start: s.start, end: s.end, tz, all_day: s.all_day,
      venue: venue || "", address: addr?.address || "",
      city: city || "", state: state || "", zip: addr?.zip || null,
      source_url: raw.source_url, confidence: conf, extracted_by: "rule",
      cityInferred, hasAddress: hasAddr, timed: s.timed,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rich fields: menu, price, description. Pure functions; each fills only what the text really says.
import { FLAVORS, ITEMS, SUFFIXES, NOT_ITEMS, NEEDS_SUFFIX } from "./menu-terms.js";

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const stripEmoji = (s) => String(s).replace(EMOJI, " ");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (list) => list.flatMap((x) => x.split("|")).sort((a, b) => b.length - a.length).map((x) => esc(x).replace(/ /g, "\\s+")).join("|");
const canonOf = new Map();
for (const e of [...FLAVORS, ...ITEMS]) { const v = e.split("|"); for (const x of v) canonOf.set(x, v[0]); }
const SUFFIX_RE = alt(SUFFIXES);
const FLAVOR_RE = alt(FLAVORS), ITEM_RE = alt(ITEMS);
const RE_COMPOUND = new RegExp(`(?<![\\w-])(?:(${FLAVOR_RE})\\s+)?(${FLAVOR_RE})(?:\\s+(?:iced|hot))?\\s+(${SUFFIX_RE})(?![\\w-])`, "gi");
const RE_FLAVOR = new RegExp(`(?<![\\w-])(${FLAVOR_RE})(?![\\w-])`, "gi");
const RE_ITEM = new RegExp(`(?<![\\w-])(${ITEM_RE})(?![\\w-])`, "gi");
const RE_COMBO = new RegExp(`(?<![\\w-])(?:(${FLAVOR_RE})\\s*[x×+]\\s*matcha|matcha\\s*[x×+]\\s*(${FLAVOR_RE}))(?![\\w-])`, "gi");
const RE_VOCAB = new RegExp(`(?<![\\w-])(?:${FLAVOR_RE}|${ITEM_RE}|matcha)(?![\\w-])`, "i");
const HEADER = /(?:^|[\s(])(?:(?:on the )?menu(?:\s+(?:features|includes|offers|has|will include)(?:\s+[\w-]+){0,4}?)?|flavou?rs|we'?re (?:serving|pouring|offering)|serving|pouring|offering|featuring)(?:\s+(?:today|this week|include|includes))?\s*[:\-–—]\s*|\b(?:drinks|flavou?rs|treats|items)(?:\s+[\w'’-]+){0,4}?\s+(?:include|includes|featuring|feature)\s+/gi;
const BULLET = /^\s*(?:[-*•·▪◦‣–—]|\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
const NOT_MENU_LINE = /(?:^|\s)(?:when|where|date|time|address|location|rsvp)\b|https?:|@|#|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:mon|tues?|wednes|thurs?|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i;

const canon = (s) => { const k = s.toLowerCase().replace(/\s+/g, " "); return canonOf.get(k) || k; };

// Clean one candidate list item: no emoji, prices, brackets, hashtags. Returns "" if it is not a menu item.
function cleanItem(s) {
  let t = stripEmoji(s).replace(/\([^)]*\)/g, " ").replace(/\$\s?\d[\d.,]*/g, " ").replace(/[*_~"“”]/g, " ")
    .replace(/^[\s\-–—•·.:;!?]+|[\s\-–—•·.:;!?]+$/g, "").replace(/\s+/g, " ").toLowerCase();
  t = t.replace(/^(?:and|or|plus|our|the|a|an)\s+/, "");
  if (!t || t.length > 40 || t.split(" ").length > 5 || /[@#]|https?:|\d/.test(t) || NOT_ITEMS.test(t)) return "";
  if (!/[a-z]{3}/.test(t)) return "";
  return t;
}
const splitItems = (s) => s.split(/[,;·•|\n]|\s&\s|\s\+\s|\sand\s|\s\/\s/).map(cleanItem).filter(Boolean);

// menuFromText(text) -> string[] (lowercase, source order, deduped, at most 8). [] when the text names nothing.
export function menuFromText(text) {
  const src = String(text || "").replace(/\r/g, "");
  if (!src.trim()) return [];
  const hits = []; // {i, e, t}
  const add = (i, e, t) => hits.push({ i, e, t });

  // 1. Header lists: "Menu: a, b, c" or a header line followed by short lines.
  const claimed = [];
  for (const m of src.matchAll(HEADER)) {
    const from = m.index + m[0].length;
    let end = src.length;
    const nl = src.indexOf("\n", from);
    const sentence = /[.!?](?:\s|$)/g; sentence.lastIndex = from;
    const se = sentence.exec(src);
    let body;
    if (nl === from || (nl > from && !src.slice(from, nl).trim())) {
      // header alone on its line: take the following short lines until a blank line
      const lines = []; let pos = nl + 1;
      for (let n = 0; n < 8 && pos <= src.length; n++) {
        const e2 = src.indexOf("\n", pos); const line = src.slice(pos, e2 < 0 ? src.length : e2);
        if (!line.trim() || line.length > 60) break;
        lines.push(line); pos = e2 < 0 ? src.length + 1 : e2 + 1;
      }
      body = lines.join("\n"); end = Math.max(from, pos - 1);
    } else {
      end = Math.min(nl < 0 ? src.length : nl, se ? se.index : src.length);
      body = src.slice(from, end);
    }
    claimed.push([m.index, end]);
    let off = from;
    for (const part of body.split(/(?<=[,;·•|\n])|\s&\s|\s\+\s|\sand\s|\s\/\s/)) {
      const it = splitItems(part)[0];
      if (it) add(off, off + part.length, it);
      off += part.length;
    }
  }
  const taken = (i, e) => claimed.some(([a, b]) => i < b && e > a);

  // 2. Bullet or emoji-led runs of two or more short lines, kept when the line names a known item.
  const lines = []; let pos = 0;
  for (const l of src.split("\n")) { lines.push({ l, i: pos }); pos += l.length + 1; }
  for (let k = 0; k < lines.length; k++) {
    const run = [];
    while (k < lines.length && BULLET.test(lines[k].l) && lines[k].l.length <= 70 && !NOT_MENU_LINE.test(lines[k].l)) run.push(lines[k++]);
    if (run.length >= 2) for (const { l, i } of run) {
      const it = splitItems(l)[0];
      if (it && RE_VOCAB.test(it) && !taken(i, i + l.length)) { add(i, i + l.length, it); claimed.push([i, i + l.length]); }
    }
  }

  // 3. Vocabulary, longest reading first, never overlapping a list item.
  const vocab = [];
  const push = (m, text, flavorOnly) => {
    if (flavorOnly && NEEDS_SUFFIX.has(canon(m[1]))) return;
    vocab.push({ i: m.index, e: m.index + m[0].length, t: text });
  };
  for (const m of src.matchAll(RE_COMBO)) push(m, `${canon(m[1] || m[2])} matcha`);
  for (const m of src.matchAll(RE_COMPOUND)) push(m, [m[1] && canon(m[1]), canon(m[2]), m[3].toLowerCase().replace(/\s+/g, " ")].filter(Boolean).join(" "));
  for (const m of src.matchAll(RE_FLAVOR)) push(m, canon(m[1]), true);
  for (const m of src.matchAll(RE_ITEM)) push(m, canon(m[1]));
  vocab.sort((a, b) => a.i - b.i || (b.e - b.i) - (a.e - a.i));
  const kept = [];
  for (const v of vocab) {
    if (taken(v.i, v.e)) continue;
    if (kept.some((k) => v.i < k.e && v.e > k.i)) continue;
    kept.push(v);
  }
  for (const v of kept) add(v.i, v.e, v.t);

  // 4. Source order, dedupe, drop an item that sits whole inside a longer one, cap at 8.
  hits.sort((a, b) => a.i - b.i);
  const seen = [];
  for (const h of hits) if (!seen.includes(h.t)) seen.push(h.t);
  const out = seen.filter((t) => !seen.some((o) => o !== t && o.length > t.length && new RegExp(`(?<![\\w-])${esc(t)}(?![\\w-])`).test(o)));
  return out.slice(0, 8);
}

// priceFromText(text) -> "$7", "$6–9", "from $5", "free" or null.
export function priceFromText(text) {
  const t = String(text || "");
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const found = [];
  let from = false;
  const rangeRe = /(?<![\w$])(from\s+|starting\s+at\s+|starts?\s+at\s+)?\$\s?(\d{1,3}(?:\.\d{2})?)(?:\s*(?:-|–|—|to)\s*\$?\s*(\d{1,3}(?:\.\d{2})?))?(?![\d,])/gi;
  for (const m of t.matchAll(rangeRe)) {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 12), before = t.slice(Math.max(0, m.index - 24), m.index);
    if (/^\s*(?:off|gift|credit|donat)/i.test(after) || /^\s*(?:from|of|per)\s+(?:every|each|all|the)\b/i.test(after) || /(?:worth|win|giveaway|prize|gift\s*card|raffle|donat\w*)\s*(?:of|:)?\s*$/i.test(before)) continue;
    const a = parseFloat(m[2]), b = m[3] ? parseFloat(m[3]) : null;
    if (b !== null && b < a) continue;
    if (m[1]) from = true;
    found.push(a); if (b !== null) found.push(b);
  }
  if (found.length) {
    const lo = Math.min(...found), hi = Math.max(...found);
    if (from) return `from $${fmt(lo)}`;
    return lo === hi ? `$${fmt(lo)}` : `$${fmt(lo)}–${fmt(hi)}`;
  }
  if (/\bit'?s\s+free\b|\bfree\s+(?:entry|admission|event|rsvp|to\s+(?:attend|join|enter)|samples?|drinks?|matcha|pop-?ups?)\b|\bfree!/i.test(t)) return "free";
  return null;
}

// descriptionFromText(text) -> first line of a caption or description, cleaned, at most 200 chars, or null.
export function descriptionFromText(text, max = 200) {
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    let l = stripEmoji(raw)
      .replace(/https?:\/\/\S+|www\.\S+/gi, " ").replace(/(?<![\w])#[\w]+/g, " ").replace(/(?<![\w.])@[\w.]+/g, " ")
      .replace(/\s+/g, " ").replace(/^[\s\-–—•·|:;,.]+|[\s\-–—•·|:;,]+$/g, "").trim();
    if ((l.match(/[A-Za-z]/g) || []).length < 8) continue;
    if (l.length > max) {
      const sentences = l.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [];
      let acc = "";
      for (const s of sentences) { if ((acc + s).trim().length > max) break; acc += s; }
      l = acc.trim() || l.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[\s,;:-]+$/, "") + "…";
    }
    return l;
  }
  return null;
}

export const SOCIAL_POST = /^https?:\/\/(?:www\.)?(instagram|tiktok)\.com\/(?:(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+|@[\w.]+\/video\/\d+|t\/[A-Za-z0-9]+)/i;

// postsFrom(urls[], otherUrl) -> {instagram, tiktok, other}
export function postsFrom(urls, otherUrl = null) {
  const posts = { instagram: null, tiktok: null, other: null };
  for (const u of urls.filter(Boolean)) {
    const m = SOCIAL_POST.exec(u);
    if (m) { const k = m[1].toLowerCase(); if (!posts[k]) posts[k] = u.split(/[?#]/)[0]; }
  }
  if (otherUrl && !/^https?:\/\/(?:www\.)?(?:instagram|tiktok)\.com\//i.test(otherUrl)) posts.other = otherUrl;
  return posts;
}

export const socialProfile = (kind, h) => (h ? (kind === "instagram" ? `https://www.instagram.com/${h}/` : `https://www.tiktok.com/@${h}`) : null);

// richFields(raw, source) -> { image, posts, menu, price, description, links } for a candidate.
export function richFields(raw, source = {}) {
  const text = [raw.text, raw.description].filter(Boolean).join("\n");
  const host = (() => { try { return new URL(raw.source_url).host.replace(/^www\./, ""); } catch { return null; } })();
  const handle = raw.handle || source.instagram || source.tiktok || null;
  const image = raw.image_url ? { url: raw.image_url, local: null, credit: handle ? `@${handle}` : host, width: null, height: null } : null;
  // A caption (manual paste, Graph, TikTok) or an event description is the brand's own words; a scraped date line is not.
  const descSrc = raw.description || (raw.manual || raw.media_type ? raw.text : null);
  const price = raw.price_hint === "free" ? "free" : priceFromText(raw.price_hint) || priceFromText(text);
  const inText = text.match(/https?:\/\/(?:www\.)?(?:instagram|tiktok)\.com\/\S+/i)?.[0];
  const posts = postsFrom([raw.source_url, inText, ...Object.values(raw.posts || {})], raw.source_url);
  for (const k of ["instagram", "tiktok", "other"]) if (raw.posts?.[k]) posts[k] = raw.posts[k];
  return {
    image, posts, menu: menuFromText(text), price,
    description: descSrc ? descriptionFromText(descSrc) : null,
    links: { website: source.website || null, instagram: socialProfile("instagram", source.instagram), tiktok: socialProfile("tiktok", source.tiktok) },
    pay: raw.pay_hint || payFromText(text), hours: raw.hours_hint || hoursFromText(text),
    evidence: [...new Set([raw.source_url, ...(raw.evidence || [])].filter((u) => String(u || "").startsWith("http")))],
  };
}

// How to pay, as the text says it: "cash, Venmo", "card only". -> string|null
const PAY = [["cash only", /\bcash[\s-]only\b/i], ["card only", /\b(?:card|cashless)[\s-]only\b/i], ["cash", /\bcash\b(?! ?app)/i], ["card", /\b(?:credit|debit) cards?\b|\bcards? (?:accepted|welcome)\b|\bwe take cards?\b/i], ["Venmo", /\bvenmo\b/i], ["Zelle", /\bzelle\b/i], ["Cash App", /\bcash ?app\b/i], ["Apple Pay", /\bapple ?pay\b/i], ["PayPal", /\bpaypal\b/i], ["tap to pay", /\btap to pay\b/i]];
export function payFromText(text) {
  const t = String(text || "");
  const found = PAY.filter(([, re]) => re.test(t)).map(([w]) => w);
  if (found.includes("cash only")) return "cash only";
  if (found.includes("card only")) return "card only";
  return found.length ? found.join(", ") : null;
}
// Opening hours, only when the text labels them ("Hours: 11am-3pm", "open 10 to 2", "until sold out"). -> string|null
export function hoursFromText(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  const m = /\b(?:hours|open)\s*[:\-–]?\s*((?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|until|till)\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|sold out|close))/i.exec(t);
  if (m) return m[1].trim().slice(0, 40);
  return /\buntil (?:we )?sell out\b|\buntil sold out\b|\bwhile supplies last\b/i.test(t) ? "until sold out" : null;
}
