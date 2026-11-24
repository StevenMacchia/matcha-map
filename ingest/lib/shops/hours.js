// Opening hours from the plain text of a shop's own page, when it has no schema.org markup: "Mon - Fri: 7am - 3pm", "Saturday 8:30 AM - 4 PM",
// "Daily 9-5pm", "Sat & Sun 8am-2pm", "Closed Mondays". Result in OpenStreetMap syntax ("Mo-Fr 07:00-15:00; Sa,Su 08:00-16:00") or null.
// Conservative on purpose: a line must start with day names and a time range follow them directly (so "Sat Nov 28 10am-4pm" event lines do not
// match), a time with no am/pm is read only when the other end carries one, a range that ends before it starts is dropped, and the first
// line that names a day wins (a footer repeating the hours cannot override the contact block). Nothing is guessed.
const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAYS = { mon: 0, tue: 1, tues: 1, wed: 2, thu: 3, thur: 3, thurs: 3, fri: 4, sat: 5, sun: 6 };
const DAY = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?";
const SEP = "\\s*(?:-|\\u2013|\\u2014|to|until|till)\\s*";
const SPEC = `((?:daily|every ?day|${DAY})(?:\\s*(?:-|\\u2013|\\u2014|to|through|thru|,|&|and|\\+)\\s*${DAY})*)`;
const ENTRY = new RegExp(`${SPEC}\\.?\\s*[:,|]?\\s*(?:from\\s+)?${TIME}${SEP}${TIME}(?![\\d:])`, "gi");

export function expandDays(spec) {
  const s = spec.toLowerCase();
  if (/^(daily|every ?day)/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  const words = s.match(new RegExp(DAY, "g")) || [];
  const idx = words.map((w) => DAYS[w.slice(0, 3)]);
  if (!idx.length) return [];
  if (/(-|–|—|\bto\b|through|thru)/.test(s) && idx.length === 2) {
    const [a, b] = idx, out = [];
    for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b || out.length > 7) break; }
    return out;
  }
  return [...new Set(idx)];
}

const to24 = (h, m, ap, fallbackAp) => {
  let hr = +h; const mi = m ? +m : 0;
  if (hr > 24 || mi > 59) return null;
  const mer = (ap || fallbackAp || "").toLowerCase().replace(/[^ap]/g, "");
  if (mer) { if (hr < 1 || hr > 12) return null; hr = (hr % 12) + (mer === "p" ? 12 : 0); }
  else if (!(m || hr >= 13)) return null; // "9-5" with no am/pm and no minutes: ambiguous
  return hr * 60 + mi;
};
const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

// Per-day spans -> "Mo-Fr 07:00-15:00; Sa,Su 08:00-16:00" (the shape shops-deepen's hoursFromLd writes).
export function osmFromDays(byDay) {
  const groups = new Map();
  for (let d = 0; d < 7; d++) if (byDay[d]) groups.set(byDay[d], [...(groups.get(byDay[d]) || []), d]);
  return [...groups].map(([span, ds]) => {
    const runs = []; for (const i of ds) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); }
    return `${runs.map(([a, b]) => (a === b ? ORDER[a] : b === a + 1 ? `${ORDER[a]},${ORDER[b]}` : `${ORDER[a]}-${ORDER[b]}`)).join(",")} ${span}`;
  }).join("; ");
}

export function hoursFromText(lines) {
  const byDay = {};
  const L = (Array.isArray(lines) ? lines : String(lines).split("\n")).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean);
  for (let i = 0; i < L.length; i++) {
    // a day on one line and its time on the next ("Monday" / "7am - 3pm") reads as one entry
    let line = L[i];
    if (line.length <= 24 && new RegExp(`^${SPEC}\\.?:?$`, "i").test(line) && L[i + 1] && L[i + 1].length <= 40) line = `${line} ${L[i + 1]}`;
    if (line.length > 140) continue;
    ENTRY.lastIndex = 0;
    let m;
    while ((m = ENTRY.exec(line))) {
      const days = expandDays(m[1]);
      if (!days.length) continue;
      const apS = m[4], apE = m[7];
      const end = to24(m[5], m[6], apE, apS);
      let start = to24(m[2], m[3], apS, apE);
      // "8-4pm", "11-3pm": the start has no am/pm of its own and reading it as pm would put it after the close, so it is am
      if (!apS && apE && start != null && end != null && start >= end && start >= 720) start -= 720;
      if (start == null || end == null || end <= start) continue;
      const span = `${hhmm(start)}-${hhmm(end)}`;
      for (const d of days) if (!byDay[d]) byDay[d] = span;
    }
  }
  // fewer than three days named is more likely a market day or an event than the shop's hours
  return Object.keys(byDay).length >= 3 ? osmFromDays(byDay) : null;
}

// Any hours string a page gave us -> clean OSM hours ("Mo-Fr 07:00-15:00; Sa 08:00-12:00") or null. A JSON-LD openingHours list read as one string
// ("Mo 08:00-16:00, , We 08:00-16:00") has its separators repaired; anything that still does not parse part by part is dropped, never guessed.
const D2 = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const PART = new RegExp(`^${D2}(?:-${D2})?(?:,${D2}(?:-${D2})?)* \\d\\d:\\d\\d-\\d\\d:\\d\\d(?:,\\d\\d:\\d\\d-\\d\\d:\\d\\d)*$`);
export function normalizeHours(h) {
  if (!h) return null;
  const fixed = String(h).replace(/\s*,(?:\s*,)+\s*/g, ", ").replace(/(?<=\d\d),\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, "; ").replace(/\s+/g, " ").trim().replace(/;\s*$/, "");
  const parts = fixed.split(/\s*;\s*/).filter(Boolean);
  const span = /(\d\d):(\d\d)-(\d\d):(\d\d)/g;
  if (!parts.length || !parts.every((p) => PART.test(p) && [...p.matchAll(span)].every((m) => +m[3] * 60 + +m[4] > +m[1] * 60 + +m[2]))) return null;
  return parts.join("; ");
}
