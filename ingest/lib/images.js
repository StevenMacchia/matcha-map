// Event images: download each one once to site/img/events/<event id>.<ext> so the card does not depend
// on a CDN link that expires. jpg, png or webp only; at most 2 redirects; the same
// User-Agent, robots.txt check and 1 request per second per host as every other fetch. Width and height
// come from the file's own header bytes (no image library). If a download fails the remote url stays
// and local stays null. These are brands' public promo shots, shown with credit and a link back.
// Size (N7): a download over MAX_BYTES (2 MB) is redrawn at 1200 px wide by tools/shrink-images.js (headless Chrome,
// no image library) and kept when that brings it under the line; past HARD_MAX (16 MB) it is never downloaded.
// Without Chrome the big picture is skipped as before (the remote url stays), logged once as a debug line.
import fs from "node:fs";
import path from "node:path";
import { UA } from "./fetch.js";
import { debug, info, warn } from "./log.js";

export const MAX_BYTES = 2 * 1024 * 1024;
export const SHRINK_OVER = 250 * 1024;
export const HARD_MAX = 16 * 1024 * 1024;
export const MAX_REDIRECTS = 2;
export const ROBOTS = "blocked by robots.txt";
export const IMG_DIR = "site/img/events";

// Sniff type and size from the first bytes. -> {ext, width, height} or null (not jpg, png or webp).
export function readHeader(b) {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ext: "jpg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { ext: "jpg", width: null, height: null };
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { ext: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8L") { const v = b.readUInt32LE(21); return { ext: "webp", width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
    if (kind === "VP8 ") return { ext: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return { ext: "webp", width: null, height: null };
  }
  return null;
}

// One image: robots, throttle, size cap, redirects. -> {buf, ext, width, height} or throws.
export async function fetchImage(url, { fetcher, fetchFn = fetch } = {}) {
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(cur);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("not http");
    if (fetcher?.allowed && !(await fetcher.allowed(cur))) throw new Error(ROBOTS);
    if (fetcher?.throttle) await fetcher.throttle(u.host);
    const res = await fetchFn(cur, { headers: { "User-Agent": UA, Accept: "image/webp,image/png,image/jpeg" }, redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { cur = new URL(res.headers.get("location"), cur).href; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") || 0) > HARD_MAX) throw new Error("over 16 MB");
    const chunks = []; let n = 0;
    for await (const ch of res.body) { n += ch.length; if (n > HARD_MAX) throw new Error("over 16 MB"); chunks.push(ch); }
    const buf = Buffer.concat(chunks);
    const head = readHeader(buf);
    if (!head) throw new Error("not a jpg, png or webp");
    return { buf, ...head };
  }
  throw new Error("too many redirects");
}

// Fill image.local, width and height on events (mutates). Files already on disk are reused.
// Bring a big download under MAX_BYTES: shrink(buf, ext) -> Buffer|null (default: tools/shrink-images.js).
async function fitSize(r, shrink) {
  if (r.buf.length <= SHRINK_OVER && (r.width || 0) <= 1600) return r;
  let out = null;
  try {
    const fn = shrink || (await import("../../tools/shrink-images.js")).shrinkBuffer;
    out = await fn(r.buf, r.ext);
  } catch (err) { debug("image shrink unavailable", err.message); }
  if (!out) {
    if (r.buf.length > MAX_BYTES) throw new Error("over 2 MB");
    return r;   // small enough to keep as is; a failed resize never fails the ingest
  }
  if (out.length > MAX_BYTES) throw new Error("over 2 MB");
  const head = readHeader(out) || {};
  return { ...r, buf: out, width: head.width || r.width, height: head.height || r.height };
}

// 400 px thumbnail beside the picture (thumbs/<name>); best effort and silent. Skipped when a test injects a shrinker.
async function writeThumb(dir, name, r, shrink) {
  if (shrink) return;
  try {
    const { shrinkBuffer } = await import("../../tools/shrink-images.js");
    const out = await shrinkBuffer(r.buf, r.ext, 400, true);
    if (out) { fs.mkdirSync(path.join(dir, "thumbs"), { recursive: true }); fs.writeFileSync(path.join(dir, "thumbs", name), out); }
  } catch (err) { debug("thumb skipped", err.message); }
}

export async function downloadImages(events, { fetcher, dir = IMG_DIR, fetchFn, shrink } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stats = { downloaded: 0, reused: 0, failed: 0, robots: 0 };
  for (const e of events) {
    const img = e.image;
    if (!img?.url) continue;
    if (img.local && fs.existsSync(path.join(dir, path.basename(img.local))) && img.width) { stats.reused++; continue; }
    if (fetcher?.noFetch) continue;
    try {
      const r = await fitSize(await fetchImage(img.url, { fetcher, fetchFn }), shrink);
      const name = `${e.id}.${r.ext}`;
      fs.writeFileSync(path.join(dir, name), r.buf);
      await writeThumb(dir, name, r, shrink);
      Object.assign(img, { local: `img/events/${name}`, width: r.width, height: r.height });
      stats.downloaded++;
    } catch (err) {
      img.local = null;
      // A CDN that robots.txt closes to us (Instagram's) is not a failure: the site shows the API url itself, so keep it and stay quiet.
      if (err.message === ROBOTS) { stats.robots++; e.image_url = e.image_url || img.url; continue; }
      stats.failed++;
      debug("image failed", img.url, err.message);
      if (err.message === "over 2 MB") info(`  image ${e.id}: over 2 MB, left remote (no Chrome to redraw it; run npm run images)`);
      else warn(`image ${e.id}: ${err.message}`);
    }
  }
  return stats;
}

// Delete downloaded images no event points at any more (past events dropped, image changed).
export function pruneImages(events, dir = IMG_DIR) {
  if (!fs.existsSync(dir)) return 0;
  const keep = new Set(events.map((e) => e.image?.local && path.basename(e.image.local)).filter(Boolean));
  let n = 0;
  for (const f of fs.readdirSync(dir)) if (/\.(jpe?g|png|webp)$/i.test(f) && !keep.has(f)) {
    fs.unlinkSync(path.join(dir, f)); n++;
    try { fs.unlinkSync(path.join(dir, "thumbs", f)); } catch { /* none */ }
  }
  return n;
}
