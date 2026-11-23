// Duplicates across sources: the same pop-up read from two places (an Instagram post and an Eventbrite page, a city-only listing and
// the later one with the venue). One record is kept (the richer, with its id) and the other folds into it.
//
// Same pop-up = same brand (or handle), same start day, same city, and
//   both placed: the same normalised venue, or pins within 200 m;
//   both city-only (no street, no venue): always (they say the same thing);
//   one city-only, one placed: when the city-only one names no venue or address (it is the place-less version of the same post).
// Two timed records more than 3 hours apart are two sessions, not a duplicate. Two placed records at different venues stay two events.

export const SAME_METERS = 200;
const arr = (x) => (Array.isArray(x) ? x : x == null || x === "" ? [] : [x]);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
// The richer of two values: a longer string, arrays unioned, objects merged key by key, else the non-empty one; `a` wins ties.
export function richer(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return [...new Set([...arr(a), ...arr(b)])];
  if (a && typeof a === "object" && b && typeof b === "object") return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, a[k] ?? b[k] ?? null]));
  if (typeof a === "string" && typeof b === "string") return b.trim().length > a.trim().length ? b : a;
  return isEmpty(a) ? b ?? null : a;
}
const CONF = ["unsure", "likely", "confirmed"];
const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const normVenue = (v) => String(v || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const placed = (e) => !e.approx && typeof e.lat === "number" && typeof e.lng === "number";
const hasPlaceText = (e) => !!String(e.venue || e.address || "").trim();

export function meters(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function sameBrand(a, b) {
  return (norm(a.brand) && norm(a.brand) === norm(b.brand)) || (a.handle && b.handle && String(a.handle).toLowerCase() === String(b.handle).toLowerCase());
}

// Two venue texts name the same place when either is blank, they match, or one contains the other (handles and "(market name)" suffixes count).
const placeKey = (v) => String(v || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
function sameNamedPlace(a, b) {
  const xs = [a.venue, a.address].map(placeKey).filter(Boolean), ys = [b.venue, b.address].map(placeKey).filter(Boolean);
  if (!xs.length || !ys.length) return true;
  return xs.some((x) => ys.some((y) => x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)))));
}
// A start at local midnight with no end is a date with no time given, however the flag says.
const untimed = (e) => e.all_day || /T00:00(:00)?([+-]|Z)/.test(String(e.start));

export function isDuplicate(a, b) {
  if (a.id === b.id || !sameBrand(a, b)) return false;
  if (String(a.start).slice(0, 10) !== String(b.start).slice(0, 10)) return false;
  if (a.series && b.series && a.series.id !== b.series.id) return false;
  if (norm(a.city) !== norm(b.city) || a.state !== b.state) return false;
  if (!untimed(a) && !untimed(b) && Math.abs(Date.parse(a.start) - Date.parse(b.start)) > 3 * 3600000) return false;
  const pa = placed(a), pb = placed(b);
  if (pa && pb) {
    const va = normVenue(a.venue || a.address), vb = normVenue(b.venue || b.address);
    return (!!va && va === vb) || meters(a, b) <= SAME_METERS;
  }
  if (!pa && !pb) return sameNamedPlace(a, b); // two city-only records: the same unless they name different places
  const cityOnly = pa ? b : a;
  return !hasPlaceText(cityOnly) || sameNamedPlace(a, b);
}

// How much an event tells: a real pin and place first, then confidence, then card fields.
export function richness(e) {
  return (placed(e) ? 8 : 0) + (String(e.venue || "").trim() ? 4 : 0) + (String(e.address || "").trim() ? 2 : 0) + CONF.indexOf(e.confidence) * 3
    + (e.series ? 1 : 0) + (e.image ? 1 : 0) + (e.menu || []).length * 0.1 + (e.price ? 1 : 0) + (e.hours ? 1 : 0) + (e.description ? 1 : 0)
    + (["manual", "sweep"].includes(e.extracted_by) ? 2 : 0) + (e.all_day ? 0 : 1);
}

// Fold `b` into `a` (a is kept): longer text, unioned lists, objects merged, the higher confidence, the earliest first_seen.
function fold(a, b) {
  const o = { ...a };
  for (const k of ["title", "end", "zip", "handle", "menu", "price", "description", "image_url", "evidence", "hours", "pay"]) o[k] = richer(a[k], b[k]);
  o.posts = richer(a.posts, b.posts);
  o.links = richer(a.links, b.links);
  if (!a.image && b.image) o.image = b.image;
  if (a.all_day && b.all_day === false && String(b.start).slice(0, 10) === String(a.start).slice(0, 10)) { o.start = b.start; o.all_day = false; }
  if (!placed(a) && placed(b)) Object.assign(o, { lat: b.lat, lng: b.lng, approx: false, geocode_source: b.geocode_source, venue: a.venue || b.venue, address: a.address || b.address, zip: a.zip || b.zip });
  if (!a.series && b.series) o.series = b.series;
  o.menu = (o.menu || []).slice(0, 8);
  o.evidence = [...new Set(o.evidence || [])].slice(0, 8);
  o.confidence = CONF[Math.max(CONF.indexOf(a.confidence), CONF.indexOf(b.confidence))];
  o.first_seen = [a.first_seen, b.first_seen].filter(Boolean).sort()[0] || a.first_seen;
  o.last_seen = [a.last_seen, b.last_seen].filter(Boolean).sort().pop() || a.last_seen;
  return o;
}

// events -> { events (duplicates folded, order kept), merged: [{kept, dropped, why}] }
export function mergeDuplicateEvents(events) {
  const order = events.map((e, i) => [e, i]).sort((x, y) => richness(y[0]) - richness(x[0]) || x[1] - y[1]);
  const gone = new Set(), out = new Map(), merged = [];
  for (const [e] of order) {
    if (gone.has(e.id)) continue;
    let keep = e;
    for (const [o] of order) {
      if (o === e || gone.has(o.id) || o.id === keep.id) continue;
      if (isDuplicate(keep, o)) { keep = fold(keep, o); gone.add(o.id); merged.push({ kept: e.id, dropped: o.id, brand: e.brand, day: String(e.start).slice(0, 10), city: e.city }); }
    }
    out.set(e.id, keep);
  }
  return { events: events.filter((e) => !gone.has(e.id)).map((e) => out.get(e.id) || e), merged };
}
