// Public embed captions for links a PERSON pasted into data/inbox/ - nothing else.
//
// What it does: for one Instagram post or TikTok video URL that a human put in an inbox file, fetch the host's public embed page
// (the page any blog loads to show an embedded post), read the caption and the picture out of the returned HTML, and hand them
// to the extractor like a pasted caption. It is never used for search results, hashtags, profiles or crawling.
//
// robots.txt, read 2026-11-22 (this file's header records it, and fetchEmbed() re-reads it on every run before any request):
//   instagram.com/robots.txt  "User-agent: *  Disallow: /" after a long list of named crawlers; the only Allow lines under * are
//                             a few numeric prefixes (/289-). /p/<code>/embed/captioned/ is therefore DISALLOWED for us.
//   tiktok.com/robots.txt     "User-agent: *" allows /foryou /discover /about /legal /tag /share /music ... and Disallow: /embed/@,
//                             /embed/v2, /embed/curated. /embed/v2/<id> is therefore DISALLOWED for us.
// Both disallow the embed path, so today this module fetches nothing: every URL ends as "skipped: robots.txt disallows ..." in the
// log, and the paste stays a plain caption paste (the manual path works as before). The code below is the finished reader, kept so
// that if either host ever allows the path the owner's pasted links start to work without another change. We do not work around
// a Disallow: no cookies, no headless browser, no retries, no other user agent.
//
// Hard rules, all enforced in code:
//   - the caller must be the inbox path: opts.caller === "inbox" AND the URL must be the first line of an existing file in
//     data/inbox/ (checked by reading that file), otherwise the call throws;
//   - at most 30 URLs per run (a counter in opts.state), 1 request per second per host (the shared fetcher's throttle);
//   - robots.txt of the host first; a response that is a login, challenge or consent page gives up on that URL (logged, no retry);
//   - only these two paths are built: instagram.com/p/<code>/embed/captioned/ and tiktok.com/embed/v2/<numeric id>.
//
// One-line call for the manual path (rung 22's owner), after parsePaste() has built `raw` from an inbox file:
//     raw = await enrichFromEmbed(raw, { fetcher, file, state: embedState })   // embedState = newEmbedState(), one per run
// It returns raw with `text` (and `image_url` when the paste had none) filled from the embed, or raw unchanged.
import fs from "node:fs";
import path from "node:path";
import { parseRobots, robotsAllows } from "./fetch.js";
import { decode } from "./html.js";
import { info, warn } from "./log.js";

export const MAX_PER_RUN = 30;
export const newEmbedState = () => ({ used: 0, skipped: [], fetched: 0 });

const IG = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|tv)\/([A-Za-z0-9_-]{5,})/i;
const TT = /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.]+\/video\/(\d{8,})/i;

// URL -> {kind, embedUrl, host, path} or null (not a post URL we know). The embed path is built from the id only.
export function embedTarget(url) {
  let m = IG.exec(url || "");
  if (m) return { kind: "instagram", host: "www.instagram.com", path: `/p/${m[1]}/embed/captioned/`, embedUrl: `https://www.instagram.com/p/${m[1]}/embed/captioned/` };
  m = TT.exec(url || "");
  if (m) return { kind: "tiktok", host: "www.tiktok.com", path: `/embed/v2/${m[1]}`, embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}` };
  return null;
}

// The caller check: the URL is the first line of a file inside data/inbox (a person pasted it there).
export function isInboxPaste(file, url, dir = "data/inbox") {
  if (!file) return false;
  const p = path.resolve(dir, path.basename(String(file)));
  if (!p.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(p)) return false;
  const first = fs.readFileSync(p, "utf8").replace(/\r/g, "").split("\n")[0].trim();
  return first === String(url || "").trim();
}

const GATE = /(accounts\/login|\/login\b|log in to instagram|log in or sign up|challenge_required|\/challenge\/|checkpoint|captcha|verify you are human|enable javascript|consent\.|cookie[-_ ]?consent|sorry, this page isn)/i;

// Embed page html -> {caption, image, author} or null when it is a login / challenge page or holds no caption.
export function parseEmbed(html, kind) {
  const s = String(html || "");
  if (GATE.test(s.slice(0, 20000)) && !/class="Caption"|class="Embed"|__FRAMEWORK/i.test(s)) return null;
  let caption = null, image = null, author = null;
  if (kind === "instagram") {
    const c = /<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i.exec(s);
    if (c) caption = decode(c[1].replace(/<a class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    const u = /class="CaptionUsername"[^>]*>([^<]+)</i.exec(s) || /class="UsernameText"[^>]*>([^<]+)</i.exec(s);
    if (u) author = decode(u[1]).trim();
    const im = /<img[^>]*class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i.exec(s) || /<img[^>]*src="([^"]+)"[^>]*class="EmbeddedMediaImage"/i.exec(s);
    if (im) image = decode(im[1]);
  } else {
    const j = /<script[^>]*id="__FRAMEWORK_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(s);
    if (j) {
      try {
        const d = JSON.parse(j[1]);
        const find = (n, k, depth = 0) => { if (!n || typeof n !== "object" || depth > 8) return null; if (typeof n[k] === "string" && n[k]) return n[k]; for (const v of Object.values(n)) { const f = find(v, k, depth + 1); if (f) return f; } return null; };
        caption = find(d, "desc") || find(d, "text");
        image = find(d, "cover") || find(d, "originCover");
        author = find(d, "uniqueId");
      } catch { /* not JSON */ }
    }
    if (!caption) { const t = /<p[^>]*class="[^"]*caption[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(s); if (t) caption = decode(t[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
  }
  if (!caption) return null;
  return { caption, image: /^https?:\/\//.test(image || "") ? image : null, author };
}

// fetchEmbed(url, opts) -> {ok, caption?, image?, author?, reason?}. opts: {fetcher, caller, file, state, dir}.
export async function fetchEmbed(url, { fetcher, caller, file = null, state = newEmbedState(), dir = "data/inbox" } = {}) {
  if (caller !== "inbox" || !isInboxPaste(file, url, dir)) throw new Error("embed captions are only for a link a person pasted into data/inbox");
  const t = embedTarget(url);
  if (!t) return { ok: false, reason: "not an Instagram post or TikTok video url" };
  if (state.used >= MAX_PER_RUN) { state.skipped.push(url); return { ok: false, reason: `cap of ${MAX_PER_RUN} per run reached` }; }
  // robots.txt of the host first: the embed path must be allowed for our agent.
  const rb = await fetcher.get(`https://${t.host}/robots.txt`, { robots: false });
  if (!rb.ok) { info(`embed: ${t.host} robots.txt unreadable (HTTP ${rb.status || "error"}), skipped ${url}`); return { ok: false, reason: "robots.txt unreadable" }; }
  if (!robotsAllows(parseRobots(rb.text), t.path)) { info(`embed: skipped ${url} (${t.host} robots.txt disallows ${t.path.replace(/[A-Za-z0-9_-]{8,}/, "<id>")})`); return { ok: false, reason: "robots.txt disallows the embed path" }; }
  state.used++;
  let r;
  try { r = await fetcher.get(t.embedUrl, { robots: true }); } catch (e) { warn(`embed: ${url}: ${e.message}`); return { ok: false, reason: e.message }; }
  if (r.blocked) return { ok: false, reason: "robots.txt disallows the embed path" };
  if (!r.ok) { warn(`embed: ${url}: HTTP ${r.status || "error"}, giving up (no retry)`); return { ok: false, reason: `HTTP ${r.status}` }; }
  const p = parseEmbed(r.text, t.kind);
  if (!p) { warn(`embed: ${url}: login, challenge or empty page, giving up (no retry)`); return { ok: false, reason: "login or challenge page" }; }
  state.fetched++;
  return { ok: true, ...p };
}

// The one-line hook: a RawItem built from an inbox paste -> the same RawItem with the caption (and image) from the embed.
// Only when the paste has a post url and no caption text of its own (a caption the person pasted always wins).
export async function enrichFromEmbed(raw, opts = {}) {
  if (!raw?.source_url || (raw.text && raw.text.trim().length > 20)) return raw;
  if (!embedTarget(raw.source_url)) return raw;
  const r = await fetchEmbed(raw.source_url, { ...opts, caller: "inbox" });
  if (!r.ok) return raw;
  return { ...raw, text: r.caption, image_url: raw.image_url || r.image || null, embed: { kind: embedTarget(raw.source_url).kind, author: r.author || null } };
}
