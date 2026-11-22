// Parsers for the text a search result carries about an Instagram or TikTok post. Pure functions; nothing here opens a page.
// Shapes seen in Tavily results (2026-11-22):
//   1  og:description   `1,234 likes, 56 comments - handle on November 18, 2026: "caption"`
//   2  snippet tail     `caption text - @handle on November 6, 2026.`
//   3  title            `Video by Name on May 14, 2025.` (a display name, not a handle; the date still counts)
//   4  raw content      `- Author: @handle (Name) - Posted: 2026-11-07T18:35:45+00:00`
//   5  title            `Name on Instagram: "caption"` or `Name (@handle) • Instagram photos and videos` (no date)
//   6  TikTok           `TikTok video from name (@handle): "caption"`
// Dates are only read in English month names (and ISO). A day written with a Spanish, French, German or Italian month is not read
// at all (nonEnglishMonth: true), so a relative word in such a post is never resolved against a guessed date.
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const EN = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const FOREIGN = /\b\d{1,2}\.?\s+(?:de\s+|d['’])?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre|januar|februar|m[äa]rz|juni|juli|oktober|dezember|gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|dicembre|janeiro|fevereiro|mar[çc]o|maio|junho|julho|setembro|outubro|novembro|dezembro)\b/i;
const HANDLE = "[A-Za-z0-9._]{2,30}";
const RE_COUNTS = new RegExp(String.raw`(?<![\d.,A-Za-z])([\d.,]+[KkMm]?)\s+likes?(?:,\s*([\d.,]+[KkMm]?)\s+comments?)?\s*[-–—]\s*(${HANDLE})(?:\s+on\s+(?:((?:${EN})\.?\s+\d{1,2},?\s+\d{4})|[^:]{0,40}))?\s*:\s*["“]?(.*)$`, "is");
const RE_TAIL = new RegExp(String.raw`[-–—]\s*@(${HANDLE})\s+on\s+((?:${EN})\.?\s+\d{1,2},?\s+\d{4})\s*\.?\s*$`, "i");
const RE_BY = new RegExp(String.raw`\b(?:Photo|Video|Reel|Post)s?\s+by\s+(.{2,60}?)\s+on\s+((?:${EN})\.?\s+\d{1,2},?\s+\d{4})`, "i");
const RE_AUTHOR = new RegExp(String.raw`Author:\s*@(${HANDLE})`, "i");
const RE_POSTED = /Posted:\s*(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/i;
const RE_TT = new RegExp(String.raw`TikTok video from\s+.{0,60}?\(@(${HANDLE})\)\s*:\s*["“]?(.*)$`, "is");
const RE_ONIG = new RegExp(String.raw`^(?:(.{1,60}?)\s+on\s+Instagram\s*:\s*["“]?(.*)|(.{1,60}?)\s*\(@(${HANDLE})\)\s*[•·-]\s*Instagram)`, "is");

const num = (s) => { if (!s) return null; const m = /^([\d.,]+)([KkMm]?)$/.exec(s.trim()); if (!m) return null; const n = parseFloat(m[1].replace(/,/g, "")); return Math.round(n * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1)); };

// "November 18, 2026" -> ISO at 12:00 UTC (so the day is the same in every US time zone), or null.
export function parseEnDate(s) {
  const m = new RegExp(String.raw`(${EN})\.?\s+(\d{1,2}),?\s+(\d{4})`, "i").exec(String(s || ""));
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()], d = +m[2], y = +m[3];
  const t = Date.UTC(y, mo - 1, d, 12);
  const dt = new Date(t);
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2010 ? dt.toISOString() : null;
}

// Text of a result (title, snippet, raw content joined with newlines) -> {handle, published, caption, likes, comments, shape, nonEnglishMonth}.
// Fields are null when the text does not say. `now` guards against a date in the future.
// The words of the post without the page's own metadata ("Video by X on <date>", "Posted: <iso>", "Author: @x"), so the post date
// is never read as an event date.
export function cleanText(t) {
  return String(t || "").replace(new RegExp(RE_BY.source, "gi"), " ").replace(/Posted:\s*\S+/gi, " ").replace(/Author:\s*@\S+/gi, " ").replace(/\s+/g, " ").trim();
}
export function parsePostText(text, { now = new Date() } = {}) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const out = { handle: null, published: null, caption: null, likes: null, comments: null, shape: null, nonEnglishMonth: false };
  if (!t) return out;
  let m;
  if ((m = RE_COUNTS.exec(t))) {
    Object.assign(out, { shape: "counts", likes: num(m[1]), comments: num(m[2]), handle: m[3], published: parseEnDate(m[4]), caption: m[5].replace(/["”]\s*\.?\s*$/, "").trim() });
  } else if ((m = RE_TAIL.exec(t))) {
    Object.assign(out, { shape: "tail", handle: m[1], published: parseEnDate(m[2]), caption: t.slice(0, m.index).replace(/\s*(?:\.\.\.|…)\s*$/, "").trim() });
  } else if ((m = RE_TT.exec(t))) {
    Object.assign(out, { shape: "tiktok", handle: m[1], caption: m[2].replace(/["”]\s*\.?\s*$/, "").trim() });
  } else if ((m = RE_ONIG.exec(t))) {
    Object.assign(out, { shape: "ig-title", handle: m[4] || null, caption: (m[2] || "").replace(/["”]\s*\.?\s*$/, "").trim() || null });
  }
  if (!out.published) {
    const by = RE_BY.exec(t);
    if (by) { out.published = parseEnDate(by[2]); out.shape = out.shape || "by"; }
  }
  const au = RE_AUTHOR.exec(t);
  if (au && !out.handle) out.handle = au[1];
  const po = RE_POSTED.exec(t);
  if (po && !out.published) {
    const iso = po[2] ? `${po[1]}T${po[2]}${po[3] ? (po[3] === "Z" ? "Z" : po[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "Z"}` : `${po[1]}T12:00:00Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) { out.published = d.toISOString(); out.shape = out.shape || "posted"; }
  }
  if (!out.published && FOREIGN.test(t)) out.nonEnglishMonth = true;
  if (out.published && Date.parse(out.published) - new Date(now).getTime() > 86400000) out.published = null; // a post cannot be from the future
  if (out.handle) out.handle = out.handle.replace(/\.+$/, "");
  out.text = cleanText(out.caption || t);
  return out;
}
