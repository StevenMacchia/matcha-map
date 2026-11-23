// Mastodon: public hashtag timelines of five big instances, no key and no login.
//
// Endpoints (checked 2026-11-22): GET https://<instance>/api/v1/timelines/tag/<tag>?limit=40 for the tags matcha, matchapopup,
// matchalatte and matchabar; and GET /api/v2/search?q=matcha+pop+up&type=statuses, which answers unauthenticated but returns no
// statuses on mastodon.social (full-text search needs a login there), so it counts only when it returns something.
// robots.txt of every instance allows /api/ for "*" (they disallow only /media_proxy/ and /interact/, and block named AI crawlers).
// An instance that answers 401, 403 or 422 (timelines limited to signed-in users) is skipped for the run; the others go on.
// The same status reaches several instances through federation: it is kept once (by its uri). Content is HTML: stripped to text.
// A status is kept when it names matcha and a pop-up word, is under 45 days old, and the extractor finds a future date and a US
// place. Pseudo-source `mastodon:<acct>`, brand = the display name; confidence capped at likely.
import { siteBudget, gate, finish, slugify, CAP } from "./common.js";
import { matchaPopup, usable, tagKinds } from "./textfind.js";
import { cityFromText } from "./bluesky.js";
import { decode } from "../html.js";

export const name = "mastodon";
export const host = "mastodon.social";
export const INSTANCES = ["mastodon.social", "mstdn.social", "mas.to", "hachyderm.io", "mastodon.online"];
export const TAGS = ["matcha", "matchapopup", "matchalatte", "matchabar"];
const MAX_AGE_DAYS = 45;

export const tagUrl = (inst, tag) => `https://${inst}/api/v1/timelines/tag/${tag}?limit=40`;
export const searchUrl = (inst) => `https://${inst}/api/v2/search?q=${encodeURIComponent("matcha pop up")}&type=statuses&limit=40`;

// Status HTML -> plain text (paragraphs and line breaks become spaces).
export const stripHtml = (html) => decode(String(html || "").replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// Statuses -> [RawItem] (not yet checked for a date). Pure.
export function statusesToRaw(list, now = new Date()) {
  const out = [];
  for (const s0 of Array.isArray(list) ? list : []) {
    const s = s0?.reblog || s0;
    const text = stripHtml(s?.content);
    const acct = s?.account?.acct, url = s?.url || s?.uri;
    if (!text || !acct || !url || !matchaPopup(text)) continue;
    const t = Date.parse(s.created_at || "");
    if (!Number.isFinite(t) || now.getTime() - t > MAX_AGE_DAYS * 86400000) continue;
    const img = (s.media_attachments || []).find((m) => m.type === "image")?.url || s.card?.image || null;
    const link = s.card?.url || null;
    out.push({
      source_url: url, text: link ? `${text} ${link}` : text, description: null, image_url: /^https?:\/\//.test(img || "") ? img : null,
      published_at: new Date(t).toISOString(), maxAheadDays: 120, organizer: { name: String(s.account.display_name || "").trim() || acct, url: s.account.url || null },
      hints: {}, evidence: [url, link].filter(Boolean), masto: { acct, uri: s.uri || url },
    });
  }
  return out;
}

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, instances = INSTANCES, tags = TAGS } = ctx;
  const stats = { instances: 0, needAuth: [], skippedHosts: [], timelines: 0, statuses: 0, popupPosts: 0, kept: 0, searchHits: 0, fetches: 0, pages: 0 };
  const seen = new Set(), raws = [];
  for (const inst of instances) {
    const b = siteBudget(fetcher, `${name} ${inst}`, Math.ceil(cap / instances.length));
    const g = await gate(b, inst);
    if (!g.ok) { stats.skippedHosts.push(`${inst}: ${g.reason}`); stats.fetches += b.st.used; continue; }
    stats.instances++;
    const lists = [];
    for (const tag of tags) {
      if (b.st.stopped || b.left() <= 0) break;
      const r = await b.get(tagUrl(inst, tag));
      if ([401, 403, 422].includes(r.status)) { stats.needAuth.push(inst); break; }
      if (!r.ok) continue;
      try { lists.push(JSON.parse(r.text)); stats.timelines++; } catch { /* not JSON */ }
    }
    if (!stats.needAuth.includes(inst) && !b.st.stopped && b.left() > 0) {
      const r = await b.get(searchUrl(inst));
      if (r.ok) { try { const st = JSON.parse(r.text)?.statuses || []; stats.searchHits += st.length; lists.push(st); } catch { /* not JSON */ } }
    }
    stats.fetches += b.st.used; stats.pages += b.st.pages;
    for (const list of lists) {
      stats.statuses += Array.isArray(list) ? list.length : 0;
      for (const raw of statusesToRaw(list, now)) {
        if (seen.has(raw.masto.uri)) continue;
        seen.add(raw.masto.uri);
        stats.popupPosts++;
        const place = cityFromText(raw.text);
        if (place) raw.hints = { city: place.city, state: place.state };
        const src = { id: `${name}:${slugify(raw.masto.acct)}`, brand: raw.organizer.name, home_city: place?.city || "", home_state: place?.state || "" };
        if (!usable(raw, src, now)) continue;
        raws.push(raw);
        stats.kept++;
      }
    }
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  for (const r of out.items) { r.source_hint.id = `${name}:${slugify(r.masto.acct)}`; r.source_hint.brand = r.organizer.name; }
  // Mastodon accounts are not Instagram handles: no watch-list candidates from here.
  return { items: out.items, candidates: [], stats };
}

export default { name, host, discover };
