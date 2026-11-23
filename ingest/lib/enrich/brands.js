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

export function brandEntry(acc, source) {
  const recent = (acc.recent || []).filter((r) => r && r.permalink && r.image_url).slice(0, 3)
    .map((r) => ({ permalink: r.permalink, image_url: r.image_url, timestamp: r.timestamp || null, caption: cut(r.caption, 80) }));
  return {
    handle: acc.handle, name: acc.name || source?.auto_name || source?.brand || acc.handle,
    website: acc.website || null, followers: Number.isFinite(acc.followers_count) ? acc.followers_count : null,
    bio: cleanBio(acc.bio), picture: acc.profile_picture_url || null,
    home_city: source?.home_city || null, home_state: source?.home_state || null, kind: source?.kind || null,
    recent,
  };
}

// accounts: watch list accounts; only Instagram ones Graph has read and that are not dropped.
export function buildBrands(wl, sources, now = new Date()) {
  const bySource = new Map((sources || []).map((s) => [s.id, s]));
  const byHandle = new Map((sources || []).filter((s) => s.instagram).map((s) => [s.instagram.toLowerCase(), s]));
  const brands = [];
  for (const a of wl?.accounts || []) {
    if (a.platform !== "instagram" || a.status === "dropped" || !a.graph_checked_at) continue;
    if (!a.name && a.followers_count == null && !a.profile_picture_url) continue; // Graph returned nothing about it
    brands.push(brandEntry(a, bySource.get(a.source_id) || byHandle.get(a.handle.toLowerCase()) || null));
  }
  brands.sort((x, y) => x.handle.toLowerCase().localeCompare(y.handle.toLowerCase()));
  // Stay under the size cap: shrink the recent lists first, then drop the lowest-followed entries' posts.
  let body = JSON.stringify({ generated: new Date(now).toISOString(), brands });
  for (let n = 2; n >= 0 && Buffer.byteLength(body) > MAX_BYTES; n--) {
    for (const b of brands) b.recent = b.recent.slice(0, n);
    body = JSON.stringify({ generated: new Date(now).toISOString(), brands });
  }
  return { generated: new Date(now).toISOString(), brands };
}

export function writeBrands(data, file = OUT) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + "\n");
  return file;
}
