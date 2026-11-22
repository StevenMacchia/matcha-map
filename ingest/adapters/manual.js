// Manual intake: data/inbox/*.txt (one pasted post per file) and --paste input.
// Format: first line = the source URL (optional), the rest = the caption.
// The shared extractor does the rest. Sources with schedule_kind "manual" have nothing to
// crawl; their events arrive through here.
import fs from "node:fs";
import path from "node:path";

// Text of a paste -> RawItem. A leading URL line becomes source_url.
export function parsePaste(text, fallbackUrl = null) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  let url = fallbackUrl;
  if (/^https?:\/\/\S+$/.test((lines[0] || "").trim())) url = lines.shift().trim();
  // A line starting with "image:" gives the photo url; it is not part of the caption.
  let image_url = null;
  const rest = lines.filter((l) => {
    const m = /^\s*image:\s*(https?:\/\/\S+)\s*$/i.exec(l);
    if (m) { image_url = m[1]; return false; }
    return true;
  });
  const caption = rest.join("\n").trim();
  return { source_url: url, text: caption, manual: true, image_url };
}

export function readInbox(dir = "data/inbox") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()
    .map((f) => ({ file: f, raw: parsePaste(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter((x) => x.raw.text || x.raw.source_url);
}

const alnum = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const slugOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Which source does a paste belong to? By URL handle, then by "@handle" in the caption, then (no handle matched) by
// brand name: the brand (letters and digits only, 5+ of them) in the first 300 characters of the text, or its slug
// as a whole part of the file name (data/inbox/<city>-<brand-slug>-<date>.txt). Longest brand wins.
export function matchSource(raw, sources, { file = null } = {}) {
  const hay = `${raw.source_url || ""} ${raw.text || ""} ${raw.handle || ""}`.toLowerCase();
  for (const s of sources) {
    for (const h of [s.instagram, s.tiktok]) {
      if (!h) continue;
      const hl = h.toLowerCase();
      if (hay.includes(`instagram.com/${hl}`) || hay.includes(`tiktok.com/@${hl}`) || hay.includes(`@${hl}`)) return { source: s, handle: h };
    }
  }
  const head = alnum(String(raw.text || "").slice(0, 300));
  const base = file ? `-${slugOf(String(file).replace(/\.[a-z0-9]+$/i, ""))}-` : null;
  let best = null;
  for (const s of sources) {
    const b = alnum(s.brand);
    if (b.length < 5) continue;
    const inFile = base && slugOf(s.brand) && base.includes(`-${slugOf(s.brand)}-`);
    const inText = head.includes(b);
    if ((inFile || inText) && (!best || b.length > best.len)) best = { source: s, handle: s.instagram || s.tiktok || null, len: b.length };
  }
  return best ? { source: best.source, handle: best.handle } : null;
}

export default {
  name: "manual",
  matches: (source) => source.schedule_kind === "manual" || source.schedule_kind === "none",
  async fetch() { return []; }, // nothing to crawl; see readInbox / --paste in run.js
};
