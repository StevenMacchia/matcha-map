// Timezones: state default, a small metro table, and offset math with Intl (no deps).
const STATE_TZ = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};
// Metros where the state default is wrong or split (key: "city|ST", lowercase city).
const CITY_TZ = {
  "el paso|TX": "America/Denver",
  "boise|ID": "America/Boise",
  "pensacola|FL": "America/Chicago",
  "panama city|FL": "America/Chicago",
  "nashville|TN": "America/Chicago",
  "knoxville|TN": "America/New_York",
  "chattanooga|TN": "America/New_York",
  "louisville|KY": "America/New_York",
  "bowling green|KY": "America/Chicago",
  "south bend|IN": "America/Indiana/Indianapolis",
  "gary|IN": "America/Chicago",
  "evansville|IN": "America/Chicago",
  "las vegas|NV": "America/Los_Angeles",
  "west wendover|NV": "America/Denver",
  "bismarck|ND": "America/Chicago",
  "sioux falls|SD": "America/Chicago",
  "rapid city|SD": "America/Denver",
  "omaha|NE": "America/Chicago",
  "scottsbluff|NE": "America/Denver",
  "wichita|KS": "America/Chicago",
  "marquette|MI": "America/Detroit",
  "tucson|AZ": "America/Phoenix",
  "phoenix|AZ": "America/Phoenix",
  "tempe|AZ": "America/Phoenix",
  "honolulu|HI": "Pacific/Honolulu",
};
export const STATES = Object.keys(STATE_TZ);

// tzFor({city,state}) -> IANA zone or null.
export function tzFor({ city, state } = {}) {
  const st = (state || "").toUpperCase();
  const c = (city || "").toLowerCase().trim();
  if (c && st && CITY_TZ[`${c}|${st}`]) return CITY_TZ[`${c}|${st}`];
  return STATE_TZ[st] || null;
}

// Offset (minutes east of UTC) of a zone at an instant (ms).
export function offsetMinutes(tz, ms) {
  const p = parts(tz, ms);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

// Wall-clock parts of an instant in a zone.
export function parts(tz, ms) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", weekday: "short",
  });
  const o = {};
  for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow };
}

const pad = (n) => String(n).padStart(2, "0");
export function fmtOffset(min) {
  const s = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// Local wall time in a zone -> ISO string with the right offset (handles DST).
export function zonedIso(tz, y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetMinutes(tz, guess);
  off = offsetMinutes(tz, guess - off * 60000); // second pass near a DST change
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${fmtOffset(off)}`;
}

// An instant (ms or Date or ISO) -> local ISO string in a zone.
export function isoLocal(when, tz) {
  const ms = new Date(when).getTime();
  const p = parts(tz, ms);
  return zonedIso(tz, p.y, p.mo, p.d, p.h, p.mi);
}
