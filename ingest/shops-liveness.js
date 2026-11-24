// npm run shops:liveness [-- --dry] [-- --limit n] [-- --conc n]   (weekly; Mondays in the daily run)
// Has a storefront on the map closed? Three signals, each read from a public page we already read or may read:
//   site      the shop's own website returns 404 or 410 (a deep link is judged by its origin), its domain no longer resolves, the page is a parked
//             or for-sale page, or the page itself says it has permanently closed;
//   instagram the bio we already read through the Graph (data/watchlist.json `bio`, business and creator accounts only; nothing new is fetched)
//             says closed for good;
//   roundup   a press or newsletter roundup reported the place closed (data/roundup-closures.json, written by the roundup reader) and names the shop.
// One signal sets `status: "check"` on the shop's entry in data/shops-overrides.json with the signals, the reason and the date; the pin stays on
// the map. A second, different signal sets `status: "closed"`: the row stays in data/shops.json (so this step keeps watching it) but is not
// written to the site layer. A hand check ends it either way: change `status` to "open" (and it is not flagged again for 60 days) or "closed".
// A shop whose signals all clear for two runs in a row goes back to unflagged. Held Matcha Cafe Maiko rows are rechecked with the same page test
// as `npm run shops:recheck` and reported.
import "./lib/env.js";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.js";
import { htmlToLines } from "./lib/html.js";
import { nameKey } from "./lib/shops/providers.js";
import { shown } from "../tools/card-completeness.mjs";
import { judge } from "./shops-recheck.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const today = new Date().toISOString().slice(0, 10);
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

const PARKED = /(?:this domain (?:is|may be) for sale|domain (?:is )?for sale|buy this domain|is for sale on|parked (?:free|domain|by)|this web ?page is parked|domain parking|sedoparking|hugedomains|afternic|dan\.com\/buy|account suspended|site (?:can.t|cannot) be reached|default web ?site page|apache2 (?:ubuntu )?default page|welcome to nginx|index of \/|domain expired|renew(?:al)? this domain)/i;
const SITE_CLOSED = /(?:permanently closed|we (?:have|'ve|’ve) (?:permanently )?closed|has (?:permanently )?closed (?:its|their) doors|closed (?:our|its|their) doors|we are (?:now )?closed for good|closed for good|no longer (?:in business|open|operating)|thank you for \d+ (?:amazing |wonderful |great )?years)/i;
const BIO_CLOSED = /(?:permanently closed|closed permanently|we (?:have|'ve|’ve) closed|\bnow closed\b|closed for good|closed down|out of business|thank you for \d+ (?:amazing |wonderful |great )?years|\bclosed\s*(?:[-–—:|.]|\bsince\b)\s*(?:20\d\d|thank))/i;

// A page's HTML + status -> the site signal, or null.
export function siteSignal(html, status, finalUrl = "") {
  if (status === 404 || status === 410) return { kind: "site", why: `own site returns ${status}` };
  const text = htmlToLines(html || "");
  const joined = text.join(" ");
  if (status >= 200 && status < 300 && text.length < 60 && PARKED.test(joined)) return { kind: "site", why: "own site is a parked or for-sale page" };
  if (status >= 200 && status < 300 && text.length < 120 && SITE_CLOSED.test(joined)) {
    const line = text.find((l) => SITE_CLOSED.test(l)) || "";
    return { kind: "site", why: `own site says closed: "${line.slice(0, 90)}"` };
  }
  return null;
}
export const bioSignal = (bio) => (bio && BIO_CLOSED.test(String(bio)) ? { kind: "instagram", why: `Instagram bio says closed: "${String(bio).replace(/\s+/g, " ").slice(0, 90)}"` } : null);

// A closure line that names the shop (its full name, or its name without a trailing "Cafe"/"Coffee"), optionally with its city.
export function roundupSignal(shop, closures) {
  const full = nameKey(shop.name);
  if (full.split(" ").length < 2 && full.length < 8) return null;
  const short = full.replace(/ (cafe|coffee|tea|matcha|house|bar)$/, "");
  for (const c of closures) {
    const line = nameKey(c.line);
    if (line.includes(full) || (short.length >= 8 && line.includes(short))) return { kind: "roundup", why: `${c.source || "a roundup"} reported it closed: "${c.line.slice(0, 90)}"`, url: c.source_url || null };
  }
  return null;
}

// Existing override entry + this run's signals -> the new entry (or null to leave the entry alone), plus a verdict.
export function judgeRow(prev, signals, when = today) {
  const kinds = [...new Set(signals.map((s) => s.kind))];
  const hand = prev && /^(open|closed)$/.test(prev.status || "") && prev.checked_by === "hand";
  if (hand) {
    if (prev.status === "open" && prev.checked && Date.parse(when) - Date.parse(prev.checked) < 60 * 864e5) return { verdict: "kept (hand check)", entry: null };
    if (prev.status === "closed") return { verdict: "kept (hand check)", entry: null };
  }
  if (!kinds.length) {
    if (prev && /^(check|closed)$/.test(prev.status || "") && prev.checked_by !== "hand") {
      const clear = (prev.clear_runs || 0) + 1;
      return clear >= 2 ? { verdict: "cleared", entry: "remove" } : { verdict: "clearing", entry: { ...prev, clear_runs: clear, checked: when } };
    }
    return { verdict: "open", entry: null };
  }
  const status = kinds.length >= 2 || (prev?.status === "closed") ? "closed" : "check";
  const reason = signals.map((s) => s.why).join("; ");
  return {
    verdict: status,
    entry: { ...(prev || {}), status, signals: kinds, check_reason: reason, checked: when, checked_by: "liveness", clear_runs: 0, why: `${status === "closed" ? "Closed" : "Check"} ${when}: ${reason}` },
  };
}

async function main() {
  const shops = read("data/shops.json", { shops: [] }).shops;
  const overrides = read("data/shops-overrides.json", {});
  const closures = read("data/roundup-closures.json", { closures: [] }).closures;
  const watch = new Map(read("data/watchlist.json", { accounts: [] }).accounts.filter((a) => a.bio).map((a) => [String(a.handle).toLowerCase(), a.bio]));
  const rows = shops.filter((s) => (shown(s) || overrides[s.id]?.status === "closed") && s.tier !== "event").slice(0, +opt("--limit", 100000));
  const f = createFetcher({});
  const results = [], tally = { rows: rows.length, withSite: 0, siteRead: 0, siteUnreadable: 0, bios: 0, check: 0, closed: 0, cleared: 0 };
  const origin = new Map();
  let next = 0;
  const siteOf = async (url) => {
    let u; try { u = new URL(url); } catch { return { status: 0 }; }
    const one = async (target) => {
      try { const r = await f.get(target); return r.blocked ? { status: 0, blocked: true } : { status: r.status, text: r.text }; }
      catch (e) { return { status: 0, dns: /ENOTFOUND/.test(`${e.cause?.code || ""} ${e.message}`), err: e.message }; }
    };
    let r = await one(u.href);
    // A deep link that 404s is a moved page, not a closed shop: judge the origin.
    if ((r.status === 404 || r.status === 410) && (u.pathname.length > 1 || u.search)) { const o = origin.get(u.origin) || await one(u.origin + "/"); origin.set(u.origin, o); r = o; }
    return r;
  };
  const work = async () => {
    while (next < rows.length) {
      const s = rows[next++];
      const signals = [];
      if (s.website && !/instagram\.com|facebook\.com|linktr\.ee/i.test(s.website)) {
        tally.withSite++;
        const r = await siteOf(s.website);
        if (r.status) tally.siteRead++; else tally.siteUnreadable++;
        const sig = r.dns ? { kind: "site", why: "own site's domain does not resolve" } : siteSignal(r.text, r.status);
        if (sig) signals.push(sig);
      }
      const bio = s.instagram ? watch.get(String(s.instagram).toLowerCase()) : null;
      if (bio) { tally.bios++; const sig = bioSignal(bio); if (sig) signals.push(sig); }
      const rs = roundupSignal(s, closures);
      if (rs) signals.push(rs);
      results.push({ s, signals });
    }
  };
  await Promise.all(Array.from({ length: +opt("--conc", 12) }, work));
  const next_o = { ...overrides };
  const flagged = [];
  for (const { s, signals } of results) {
    const j = judgeRow(overrides[s.id], signals);
    if (j.entry === "remove") {
      const { status, signals: _s, check_reason, checked, checked_by, clear_runs, ...rest } = next_o[s.id] || {};
      const why = String(rest.why || "").replace(/^(Check|Closed) \d{4}-\d\d-\d\d: [^]*$/, "");
      if (Object.keys(rest).filter((k) => k !== "why").length || why) next_o[s.id] = { ...rest, ...(why ? { why } : {}) }; else delete next_o[s.id];
      tally.cleared++;
    } else if (j.entry) {
      next_o[s.id] = j.entry;
      if (j.entry.status === "check") tally.check++; else if (j.entry.status === "closed") tally.closed++;
      if (j.verdict === "check" || j.verdict === "closed") flagged.push({ name: s.name, city: s.city, state: s.state, tier: s.tier || "shop", verdict: j.verdict, why: j.entry.check_reason });
    }
  }
  // Held Matcha Cafe Maiko rows: the same page test as shops:recheck, reported (never flipped by this step).
  const maiko = [];
  { const seen = new Map();
    for (const [id, v] of Object.entries(overrides)) {
      if (v.verified !== false || !/Held 20\d\d/.test(String(v.why || ""))) continue;
      const s = shops.find((x) => x.id === id); if (!s?.website) continue;
      const url = s.website.replace("//matchacafe-maiko.com", "//www.matchacafe-maiko.com");
      if (!seen.has(url)) { try { const r = await f.get(url, { cache: false }); seen.set(url, r.ok ? judge(r.text, "2026-11-08") : { err: r.blocked ? "robots" : `http ${r.status}` }); } catch (e) { seen.set(url, { err: e.message }); } }
      maiko.push({ id, city: s.city, state: s.state, url, ...seen.get(url) });
    }
  }
  const out = { date: today, ...tally, flagged, maiko: { rows: maiko.length, siteSaysToko: maiko.filter((m) => m.toko).length, datesAfterCutoff: maiko.filter((m) => m.after?.length).length, closedWording: maiko.filter((m) => m.closed).length, unreadable: maiko.filter((m) => m.err).length } };
  console.log(JSON.stringify(out, null, 1));
  if (!flag("--dry")) {
    fs.writeFileSync("data/shops-overrides.json", JSON.stringify(next_o, null, 1) + "\n");
    fs.writeFileSync("data/shops-liveness.json", JSON.stringify({ about: "Last weekly liveness run (npm run shops:liveness); flagged rows are also in data/shops-overrides.json with status check or closed.", ...out }, null, 1) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
