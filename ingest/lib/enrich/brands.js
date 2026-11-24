// Brand facts for the card: site/data/brands.json, one entry per Instagram handle the Graph API has read.
// Built from data/watchlist.json (what recordGraph stored) and data/sources.json (kind, home city). Nothing is fetched here.
import fs from "node:fs";
import path from "node:path";

export const OUT = "site/data/brands.json";
export const MAX_BYTES = 400 * 1024;
const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

// First 160 characters of a bio with emails and phone numbers taken out.
export function cleanBio(s) {
  const t = String(s || "").replace(EMAIL, " ").replace(PHONE, " ").replace(/\s+/g, " ").trim();
  return t.slice(0, 160).trim();
}
const cut = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// Profile pictures stay on Meta's servers (copying them off is against the platform terms we work under), and Meta's urls are signed
// to expire in about five days. So the card shows the url from the newest Graph read only while that read is under PICTURE_DAYS old
// and the url's own expiry (the `oe` query parameter, seconds since the epoch in hex) has not passed; otherwise picture is null and
// the site draws the brand's initial instead of a broken image. Every watched account is re-read within 72 hours (cadenceFor).
export const PICTURE_DAYS = 7;
export const META_PICTURE = /\b(cdninstagram\.com|fbcdn\.net)\b/;
export function pictureExpiry(url) {
  const m = /[?&]oe=([0-9A-Fa-f]{6,12})(?:&|$)/.exec(String(url || ""));
  return m ? new Date(parseInt(m[1], 16) * 1000) : null;
}
// The picture url a card may show from a watch-list account, or null. `at` is when the url was read (profile_picture_at, or the read
// date for accounts recorded before that field existed).
export function freshPicture(acc, now = new Date()) {
  const url = acc.profile_picture_url || null;
  if (!url) return { picture: null, at: null };
  const at = acc.profile_picture_at || acc.graph_checked_at || null;
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t) || new Date(now) - t > PICTURE_DAYS * 86400e3) return { picture: null, at: null };
  const exp = pictureExpiry(url);
  if (exp && exp <= new Date(now)) return { picture: null, at: null };
  return { picture: url, at: new Date(t).toISOString() };
}

export function brandEntry(acc, source, now = new Date()) {
  const recent = (acc.recent || []).filter((r) => r && r.permalink && r.image_url).slice(0, 3)
    .map((r) => ({ permalink: r.permalink, image_url: r.image_url, timestamp: r.timestamp || null, caption: cut(r.caption, 80) }));
  const { picture, at } = freshPicture(acc, now);
  return {
    handle: acc.handle, name: acc.name || source?.auto_name || source?.brand || acc.handle,
    website: acc.website || null, followers: Number.isFinite(acc.followers_count) ? acc.followers_count : null,
    bio: cleanBio(acc.bio), picture,
    home_city: source?.home_city || null, home_state: source?.home_state || null, kind: source?.kind || null,
    recent, ...(at ? { picture_at: at } : {}),
  };
}

// A brand that is only a record in sources.json (no Instagram read, often no Instagram at all) still gets a card record, so the map can
// show its name, kind, city and bio. `handle` is its Instagram handle when it has one, else its source id with - made _ (a card key,
// not a real handle); source_id and source_only say so. Nothing is guessed: picture and followers stay empty until a read gives them.
export function sourceEntry(s) {
  return {
    handle: s.instagram ? String(s.instagram) : String(s.id).replace(/[^A-Za-z0-9._]+/g, "_"), name: s.auto_name || s.brand || s.id,
    website: s.website || null, followers: null, bio: cleanBio(s.about), picture: null,
    home_city: s.home_city || null, home_state: s.home_state || null, kind: s.kind || null, recent: [], source_id: s.id, source_only: true,
  };
}

// accounts: watch list accounts; only Instagram ones Graph has read and that are not dropped.
// Gaps of a card filled from the brand's own site and from the events we hold (data/brands-extra.json by handle, ingest/brands-deepen.js):
// only empty fields are filled; last_dated_post_seen is always the latest date held.
export function attachBrandExtras(brands, extra = {}) {
  return brands.map((b) => {
    const e = extra[b.handle];
    if (!e) return b;
    const o = { ...b };
    for (const k of ["bio", "picture", "website"]) if (!o[k] && e[k]) o[k] = e[k];
    if (o.bio && o.bio === e.bio) o.bio = cleanBio(e.bio);
    if (e.bio && cleanBio(e.bio) === o.bio) o.bio_source = e.bio_source;
    if (!(o.recent || []).length && (e.recent || []).length) o.recent = e.recent.slice(0, 2); // two posts keep the file under MAX_BYTES
    if (e.last_dated_post_seen) o.last_dated_post_seen = e.last_dated_post_seen;
    return o;
  });
}
function readExtras(file = "data/brands-extra.json") {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).brands || {}; } catch { return {}; }
}

export function buildBrands(wl, sources, now = new Date()) {
  const bySource = new Map((sources || []).map((s) => [s.id, s]));
  const byHandle = new Map((sources || []).filter((s) => s.instagram).map((s) => [s.instagram.toLowerCase(), s]));
  const brands = [];
  for (const a of wl?.accounts || []) {
    if (a.platform !== "instagram" || a.status === "dropped" || !a.graph_checked_at) continue;
    if (!a.name && a.followers_count == null && !a.profile_picture_url) continue; // Graph returned nothing about it
    brands.push(brandEntry(a, bySource.get(a.source_id) || byHandle.get(a.handle.toLowerCase()) || null, now));
  }
  const have = new Set(brands.map((x) => x.handle.toLowerCase()));
  for (const s of sources || []) {
    if (s.active === false) continue;
    const e = sourceEntry(s);
    if (!have.has(e.handle.toLowerCase())) { brands.push(e); have.add(e.handle.toLowerCase()); }
  }
  brands.sort((x, y) => x.handle.toLowerCase().localeCompare(y.handle.toLowerCase()));
  brands.splice(0, brands.length, ...attachBrandExtras(brands, readExtras()));
  // Stay under the size cap: shrink the recent lists first, then drop the lowest-followed entries' posts.
  let body = JSON.stringify({ generated: new Date(now).toISOString(), brands });
  for (let n = 2; n >= 1 && Buffer.byteLength(body) > MAX_BYTES; n--) {
    for (const b of brands) b.recent = b.recent.slice(0, n);
    body = JSON.stringify({ generated: new Date(now).toISOString(), brands });
  }
  // Still over: not all-or-nothing. Every card keeps no posts, then the most-followed ones get their latest post back while the file fits
  // (the old loop shrank to 0 for everyone, so no card showed a post at all).
  if (Buffer.byteLength(body) > MAX_BYTES) {
    const keep = new Map(brands.map((b) => [b, b.recent.slice(0, 1)]));
    for (const b of brands) b.recent = [];
    let size = Buffer.byteLength(JSON.stringify({ generated: new Date(now).toISOString(), brands }));
    for (const b of [...brands].sort((x, y) => (y.followers || 0) - (x.followers || 0))) {
      const add = keep.get(b);
      if (!add.length) continue;
      const extra = Buffer.byteLength(JSON.stringify(add));
      if (size + extra > MAX_BYTES) break;
      b.recent = add; size += extra;
    }
  }
  return { generated: new Date(now).toISOString(), brands };
}

export function writeBrands(data, file = OUT) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + "\n");
  return file;
}
