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
  if (!found.length && !/\b(every|weekly|each)\b/i.test(text)) {
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
  const text = raw.replace(/\bnoon\b/gi, "12pm").replace(/\bmidnight\b/gi, "12am");
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
        if (raw.maxAheadDays && d.inferred && cmpDays(d, ref) > raw.maxAheadDays) continue;
        const rel = ["rel", "weekday", "weekend"].includes(g.kind);
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
