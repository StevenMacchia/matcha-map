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
  const caption = lines.join("\n").trim();
  return { source_url: url, text: caption, manual: true };
}

export function readInbox(dir = "data/inbox") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()
    .map((f) => ({ file: f, raw: parsePaste(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter((x) => x.raw.text || x.raw.source_url);
}

// Which source does a paste belong to? By URL handle, then by "@handle" in the caption.
export function matchSource(raw, sources) {
  const hay = `${raw.source_url || ""} ${raw.text || ""} ${raw.handle || ""}`.toLowerCase();
  for (const s of sources) {
    for (const h of [s.instagram, s.tiktok]) {
      if (!h) continue;
      const hl = h.toLowerCase();
      if (hay.includes(`instagram.com/${hl}`) || hay.includes(`tiktok.com/@${hl}`) || hay.includes(`@${hl}`)) return { source: s, handle: h };
    }
  }
  return null;
}

export default {
  name: "manual",
  matches: (source) => source.schedule_kind === "manual" || source.schedule_kind === "none",
  async fetch() { return []; }, // nothing to crawl; see readInbox / --paste in run.js
};
