// npm run gate:seo: the nine SEO rules (docs/SEO-RULES.md) as a pure check over the generated site/ tree, data/pages-lastmod.json
// and data/seo-state.json (the previous passing run: its indexable set and its per-page {hash, lastmod, section hashes}).
// One line per rule (ok, or FAIL with up to five examples), then `seo gate: N rules, M failed; indexable X, noindex Y, lastmod moved Z`.
// Exit 1 on any failure. The daily run calls it after `pages` and before `smoke`; commit, push and deploy need it to have passed.
//   --baseline  record today's set and snapshot as the state without failing rule 9 (the first run, by hand)
//   --dry       print only, write no state
//   --root <d>  another checkout (tests)
// Env: SEO_PACE_LIMIT (default 150 newly indexable pages per run), SEO_EVENT_PACE_LIMIT (default 300 new event pages per run).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { cityIndexable, stateIndexable } from "./gen-pages.js";
import { checkSite } from "./check-jsonld.js";
import { readState, writeState, readSitemapRows, isSitemapIndex, parseRedirects, hash12, hashInput, dayText, SITEMAP_SPLIT } from "./seo-lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_WORDS = 150; // rule 5: words outside the boilerplate on an indexable city or state page
export const FAQ_SHARE = 0.05; // rule 5: no FAQ answer on more than 5% of indexable pages
export const PACE_LIMIT = 150; // rule 9
export const EVENT_PACE_LIMIT = 300;
export const FILE_LIMIT = 50000; // rule 6: URLs per sitemap file
// rule 8: the top of each tree and a page inside it
const PROTECTED = ["/", "/city/", "/state/", "/weekend/", "/e/", "/brand/", "/city/nc/raleigh/", "/state/nc/", "/weekend/raleigh-nc/", "/e/abc123def456/", "/brand/moonbee/"];
const TREES = ["city", "state", "brand", "e", "weekend"];
const SECTION_LABEL = ["intro", "events", "shops", "brands", "nearby", "faq"];

const attr = (html, re) => { const m = re.exec(html); return m ? m[1] : null; };
export const isNoindex = (html) => /<meta name="robots" content="[^"]*noindex/i.test(html);

// ---- boilerplate and words (rule 5) ----
// Template text is excluded: head, script and style, header, footer, nav, every h2 and summary, and any element marked data-boiler.
const BOILER_TAGS = new Set(["head", "script", "style", "header", "footer", "nav", "h2", "summary"]);
const VOID = new Set(["img", "br", "hr", "input", "meta", "link"]);
export function stripBoilerplate(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let out = "", last = 0, skip = null, depth = 0, m;
  while ((m = re.exec(html))) {
    const [all, close, name0, rest] = m, name = name0.toLowerCase();
    if (skip === null) {
      if (!close && (BOILER_TAGS.has(name) || /\sdata-boiler(\s|=|\/|$)/.test(" " + rest))) {
        out += html.slice(last, m.index);
        last = re.lastIndex;
        if (!VOID.has(name) && !/\/$/.test(rest)) { skip = name; depth = 1; }
      }
    } else if (name === skip) {
      if (!close) depth++; else if (--depth === 0) { skip = null; last = re.lastIndex; }
    }
  }
  if (skip === null) out += html.slice(last);
  return out;
}
export function wordsOutside(html) {
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) || [0, html])[1];
  const text = stripBoilerplate(body).replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
export const faqAnswers = (html) => [...html.matchAll(/<details><summary>[\s\S]*?<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => m[1]);

// ---- the tree ----
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walk(p, out); else if (n.name === "index.html") out.push(p);
  }
  return out;
}
const rel = (site, f) => path.relative(site, f).split(path.sep).join("/");
// key: "city/nc/raleigh", "state", "e/<id>"; path: "/city/nc/raleigh/"
const keyOf = (r) => r.replace(/\/?index\.html$/, "");
const pathOfKey = (k) => (k ? `/${k}/` : "/");

export function loadPages(site) {
  const pages = [];
  for (const t of TREES) for (const f of walk(path.join(site, t))) {
    const html = fs.readFileSync(f, "utf8"), key = keyOf(rel(site, f));
    pages.push({
      key, path: pathOfKey(key), tree: t, html,
      title: attr(html, /<title>([\s\S]*?)<\/title>/), desc: attr(html, /<meta name="description" content="([^"]*)"/),
      canonicals: [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]),
      noindex: isNoindex(html), seo: attr(html, /<html[^>]*\sdata-seo="([^"]*)"/),
    });
  }
  return pages;
}
const parseSeo = (s) => { const m = /^u(\d+) s(\d+) b(\d+) n(\d+)$/.exec(s || ""); return m ? { ups: +m[1], shops: +m[2], brandsWithPicture: +m[3], nearbyCities: +m[4] } : null; };
const pathOfLoc = (loc) => { try { return decodeURIComponent(new URL(loc).pathname); } catch { return ""; } };
const sample = (a, n = 5) => a.slice(0, n);
const num = (n) => n.toLocaleString("en-US");

// ---- the rules ----
// Each returns { ok, msg, examples }. ctx: { site, root, pages, rows, sitemapFiles, state, stored, baseline, env }.
function rule1(ctx) {
  const bad = [], inMap = new Set(ctx.rows.map((r) => pathOfLoc(r.loc)));
  const cities = ctx.pages.filter((p) => p.tree === "city");
  let ix = 0;
  for (const p of cities) {
    const c = parseSeo(p.seo);
    if (!c) { bad.push(`${p.key}: no data-seo summary`); continue; }
    const want = cityIndexable(c).indexable;
    if (want) ix++;
    if (p.noindex === want) bad.push(`${p.key}: counts ${p.seo} say ${want ? "indexable" : "noindex"}, the page is ${p.noindex ? "noindex" : "indexable"}`);
    if (inMap.has(p.path) !== want) bad.push(`${p.key}: counts ${p.seo} say ${want ? "in" : "out of"} the sitemap, it is ${inMap.has(p.path) ? "in" : "out"}`);
  }
  return { ok: !bad.length, examples: bad, msg: `${num(cities.length)} city pages, ${num(ix)} earned an index, ${num(cities.length - ix)} noindex` };
}

function rule2(ctx) {
  const bad = [], reasons = new Map(), { stored, state } = ctx, prior = (state && state.pages) || null;
  const inMap = new Map(ctx.rows.map((r) => [pathOfLoc(r.loc), r.lastmod]));
  let moved = 0, checked = 0;
  for (const p of ctx.pages) {
    const cur = stored[p.key];
    if (!cur || !inMap.has(p.path)) continue;
    checked++;
    // the stored hash must be the page's own: with the date it prints turned back into the token
    const printed = attr(p.html, /\b[Uu]pdated ([A-Z][a-z]{2} \d{1,2}, \d{4})/);
    if (printed && printed !== dayText(cur[1])) bad.push(`${p.key}: Updated line prints ${printed}, its lastmod is ${cur[1]}`);
    else if (hash12(hashInput(p.html)) !== cur[0]) bad.push(`${p.key}: the page changed after data/pages-lastmod.json was written (run npm run pages)`);
    if (inMap.get(p.path) !== cur[1]) bad.push(`${p.key}: sitemap lastmod ${inMap.get(p.path)} is not the stored ${cur[1]}`);
    const was = prior && prior[p.key];
    if (!was) continue;
    if (was[0] === cur[0] && was[1] !== cur[1]) bad.push(`${p.key}: lastmod moved ${was[1]} to ${cur[1]} with no change in content`);
    if (was[1] !== cur[1]) {
      moved++;
      let why = "page changed";
      if (was[2] && cur[2]) {
        const m = new Set(SECTION_LABEL.filter((s, i) => was[2][i] !== cur[2][i]));
        why = !m.size ? "head or template" : m.size >= 4 ? "template or copy change" : m.has("events") ? (m.has("intro") ? "new or removed event" : "event changed") : m.has("shops") ? "shops changed" : m.has("brands") ? "brands changed" : m.has("nearby") ? "nearby changed" : m.has("faq") ? "faq changed" : "intro changed";
      }
      reasons.set(why, (reasons.get(why) || 0) + 1);
    }
  }
  const top = [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(", ");
  ctx.moved = moved;
  return { ok: !bad.length, examples: bad, msg: `${num(checked)} stamped pages in the sitemap; lastmod moved on ${num(moved)}${top ? ` (${top})` : ""}${prior ? "" : "; no previous state to compare"}` };
}

function rule3(ctx) {
  const bad = [], prior = ctx.state && ctx.state.pages;
  const have = new Set(ctx.pages.map((p) => p.key));
  let redirects = new Map();
  try { redirects = parseRedirects(fs.readFileSync(path.join(ctx.site, "_redirects"), "utf8")); } catch { /* none */ }
  for (const [from] of redirects) if (have.has(from.replace(/^\/|\/$/g, ""))) bad.push(`${from}: a 301 line on a path that is a live page hides it`);
  let n = 0;
  if (prior) for (const k of Object.keys(prior)) {
    n++;
    if (have.has(k)) continue;
    const p = pathOfKey(k);
    if (/^(e|brand)\//.test(k)) { if (!redirects.has(p)) bad.push(`${p}: published before, missing now, and no 301 in site/_redirects`); }
    else if (/^(city|state)(\/|$)/.test(k)) bad.push(`${p}: a published ${k.split("/")[0]} page is missing (it must keep its page, noindex if empty)`);
  }
  return { ok: !bad.length, examples: bad, msg: prior ? `${num(n)} published paths all present or redirected; ${num(redirects.size)} 301 lines` : `no previous state; ${num(redirects.size)} 301 lines` };
}

function rule4(ctx) {
  const bad = [], titles = new Map(), descs = new Map();
  for (const p of ctx.pages) {
    const add = (m, k) => { if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(p.key); };
    add(titles, p.title); add(descs, p.desc);
    const want = SITE_URL + p.path;
    if (p.canonicals.length !== 1) bad.push(`${p.key}: ${p.canonicals.length} canonical links`);
    else if (p.canonicals[0] !== want) bad.push(`${p.key}: canonical ${p.canonicals[0]}, expected ${want}`);
    if (p.title == null) bad.push(`${p.key}: no title`);
    if (p.desc == null) bad.push(`${p.key}: no meta description`);
  }
  for (const [what, m] of [["title", titles], ["description", descs]]) for (const [k, keys] of m) if (keys.length > 1) bad.push(`${what} "${k.slice(0, 60)}" on ${keys.length} pages: ${sample(keys, 3).join(", ")}`);
  return { ok: !bad.length, examples: bad, msg: `${num(ctx.pages.length)} pages: titles, descriptions and canonicals clean` };
}

function rule5(ctx) {
  const bad = [], inMap = new Set(ctx.rows.map((r) => pathOfLoc(r.loc)));
  const idx = ctx.pages.filter((p) => (p.tree === "city" || p.tree === "state") && inMap.has(p.path));
  const faq = new Map();
  let min = Infinity;
  for (const p of idx) {
    const w = wordsOutside(p.html);
    min = Math.min(min, w);
    if (w < MIN_WORDS) bad.push(`${p.key}: ${w} words outside the boilerplate, need ${MIN_WORDS}`);
    if (p.tree === "city") for (const a of new Set(faqAnswers(p.html))) faq.set(a, (faq.get(a) || 0) + 1);
  }
  const cityIdx = idx.filter((p) => p.tree === "city").length, allowed = Math.max(1, Math.floor(cityIdx * FAQ_SHARE));
  for (const [a, n] of faq) if (n > allowed) bad.push(`FAQ answer on ${n} of ${cityIdx} indexable city pages (limit ${allowed}): "${a.slice(0, 70)}"`);
  const thin = (t) => ctx.pages.filter((p) => p.tree === t && inMap.has(p.path) && wordsOutside(p.html) < MIN_WORDS).length;
  return { ok: !bad.length, examples: bad, msg: `${num(idx.length)} indexable city and state pages, fewest words ${min === Infinity ? 0 : min}; no FAQ answer on more than ${allowed} pages (info: ${thin("brand")} brand and ${thin("e")} event pages are under ${MIN_WORDS} words by nature and are not gated)` };
}

function rule6(ctx) {
  const bad = [], seen = new Set();
  const { site } = ctx;
  if (ctx.rows.length > ctx.limits.split && ctx.sitemapFiles.length < 2) bad.push(`${num(ctx.rows.length)} URLs in one file: past ${num(ctx.limits.split)} it must be an index over sitemap-N.xml files`);
  for (const f of ctx.sitemapFiles) {
    if (f === "sitemap.xml") continue;
    const n = readSitemapRowsOf(site, f).length;
    if (n > ctx.limits.file) bad.push(`${f}: ${num(n)} URLs, the limit is ${num(ctx.limits.file)}`);
  }
  if (ctx.sitemapFiles.length === 1 && ctx.rows.length > ctx.limits.file) bad.push(`sitemap.xml: ${num(ctx.rows.length)} URLs, the limit is ${num(ctx.limits.file)}`);
  for (const r of ctx.rows) {
    const p = pathOfLoc(r.loc);
    if (!r.loc.startsWith(SITE_URL + "/")) { bad.push(`${r.loc}: not under ${SITE_URL}`); continue; }
    if (seen.has(p)) bad.push(`${p}: listed twice`);
    seen.add(p);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.lastmod) || isNaN(Date.parse(r.lastmod))) bad.push(`${p}: lastmod "${r.lastmod}" is not YYYY-MM-DD`);
    const f = p.endsWith("/") ? path.join(site, p, "index.html") : path.join(site, p);
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { bad.push(`${p}: in the sitemap, no file`); continue; }
    if (p.endsWith("/") && isNoindex(fs.readFileSync(f, "utf8"))) bad.push(`${p}: in the sitemap and noindex`);
  }
  let robots = "";
  try { robots = fs.readFileSync(path.join(site, "robots.txt"), "utf8"); } catch { /* none */ }
  if (!new RegExp(`^Sitemap:\\s*${SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sitemap\\.xml\\s*$`, "mi").test(robots)) bad.push(`robots.txt does not name ${SITE_URL}/sitemap.xml`);
  return { ok: !bad.length, examples: bad, msg: `${num(ctx.rows.length)} URLs in ${ctx.sitemapFiles.length} file${ctx.sitemapFiles.length === 1 ? "" : "s"}, all resolve, none noindex, robots.txt names the sitemap` };
}
function readSitemapRowsOf(site, f) {
  try { return (fs.readFileSync(path.join(site, f), "utf8").match(/<url>/g) || []); } catch { return []; }
}

function rule7(ctx) {
  const { stats, errors } = checkSite(ctx.site);
  const bad = stats.files ? errors : ["no pages found to check"];
  return { ok: !bad.length, examples: bad, msg: `${num(stats.files)} pages, ${num(stats.blocks)} blocks, no problems` };
}

function rule8(ctx) {
  const bad = [], site = ctx.site;
  let robots = "";
  try { robots = fs.readFileSync(path.join(site, "robots.txt"), "utf8"); } catch { bad.push("robots.txt is missing"); }
  // the paths a Disallow in a group for every agent would hide
  let all = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) { if (!line) all = all && false; continue; }
    const k = m[1].toLowerCase();
    if (k === "user-agent") { all = m[2].trim() === "*" ? true : (all === "seen" ? "seen" : false); continue; }
    if (k !== "disallow" || !all || !m[2].trim()) continue;
    const re = new RegExp("^" + m[2].trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    for (const p of PROTECTED) if (re.test(p)) bad.push(`robots.txt: Disallow: ${m[2].trim()} blocks ${p}`);
  }
  let home = "";
  try { home = fs.readFileSync(path.join(site, "index.html"), "utf8"); } catch { bad.push("site/index.html is missing"); }
  if (isNoindex(home)) bad.push("the home page carries noindex");
  try { if (/x-robots-tag:[^\n]*noindex/i.test(fs.readFileSync(path.join(site, "_headers"), "utf8"))) bad.push("site/_headers sets X-Robots-Tag noindex"); } catch { /* no headers file */ }
  // a state hub with a pop-up or a shop is never noindex and is in the sitemap
  const inMap = new Set(ctx.rows.map((r) => pathOfLoc(r.loc)));
  for (const p of ctx.pages.filter((x) => x.tree === "state" && x.key !== "state")) {
    const m = /^u(\d+) s(\d+) c(\d+)$/.exec(p.seo || "");
    if (!m) { bad.push(`${p.key}: no data-seo summary`); continue; }
    const want = stateIndexable({ ups: +m[1], shops: +m[2], cities: +m[3] });
    if (p.noindex === want) bad.push(`${p.key}: ${p.seo} says ${want ? "indexable" : "noindex"}, the page is ${p.noindex ? "noindex" : "indexable"}`);
    if (inMap.has(p.path) !== want) bad.push(`${p.key}: ${p.seo} says ${want ? "in" : "out of"} the sitemap, it is ${inMap.has(p.path) ? "in" : "out"}`);
  }
  return { ok: !bad.length, examples: bad, msg: "robots.txt, the home page, _headers and the state hubs leave every indexable page open" };
}

function rule9(ctx) {
  const prior = ctx.state && ctx.state.indexable;
  const today = ctx.indexable, events = ctx.pages.filter((p) => p.tree === "e").map((p) => p.key);
  const limit = Number(ctx.env.SEO_PACE_LIMIT) || PACE_LIMIT, evLimit = Number(ctx.env.SEO_EVENT_PACE_LIMIT) || EVENT_PACE_LIMIT;
  if (!prior) return { ok: !!ctx.baseline, examples: ["no previous state: run `node tools/seo-gate.js --baseline` once, by hand, to record today's set"], msg: `baseline recorded: ${num(today.length)} indexable pages` };
  const was = new Set(prior), fresh = today.filter((k) => !was.has(k));
  const wasPages = new Set(Object.keys(ctx.state.pages || {})), freshEv = events.filter((k) => !wasPages.has(k));
  const bad = [];
  if (!ctx.baseline && fresh.length > limit) bad.push(`${num(fresh.length)} pages newly indexable in one run (limit ${limit}; SEO_PACE_LIMIT raises it): ${sample(fresh, 3).join(", ")}`);
  if (!ctx.baseline && freshEv.length > evLimit) bad.push(`${num(freshEv.length)} new event pages in one run (limit ${evLimit}; SEO_EVENT_PACE_LIMIT raises it)`);
  const dropped = prior.filter((k) => !today.includes(k)).length;
  return { ok: !bad.length, examples: bad, msg: `${num(fresh.length)} newly indexable (limit ${limit}), ${num(freshEv.length)} new event pages (limit ${evLimit}), ${num(dropped)} no longer indexable${ctx.baseline ? "; baseline" : ""}` };
}

const RULES = [
  [1, "earned index", rule1], [2, "real freshness", rule2], [3, "stable urls", rule3], [4, "no duplicates", rule4], [5, "thin content", rule5],
  [6, "sitemap hygiene", rule6], [7, "structured data", rule7], [8, "robots and meta", rule8], [9, "publishing pace", rule9],
];

// limits: { split, file } override the sitemap limits (tests force small ones).
export function runGate({ root = ROOT, baseline = false, dry = false, env = process.env, today = new Date(), limits = {} } = {}) {
  const site = path.join(root, "site");
  const pages = loadPages(site);
  const { rows, files } = readSitemapRows(site);
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(path.join(root, "data", "pages-lastmod.json"), "utf8")); } catch { /* none */ }
  const state = readState(root);
  // the evergreen indexable set: sitemap pages other than events and feeds
  const indexable = [...new Set(rows.map((r) => keyOf(pathOfLoc(r.loc).replace(/^\/|\/$/g, ""))).filter((k) => k && !/^(e|feeds)(\/|$)/.test(k)))].sort();
  const ctx = { site, root, pages, rows, sitemapFiles: files, state, stored, baseline, env, indexable, moved: 0, limits: { split: SITEMAP_SPLIT, file: FILE_LIMIT, ...limits } };
  const results = RULES.map(([n, name, fn]) => ({ n, name, ...fn(ctx) }));
  const failed = results.filter((r) => !r.ok).length;
  const noindex = pages.filter((p) => p.noindex).length;
  const lines = results.map((r) => `rule ${r.n} ${r.name}: ${r.ok ? "ok" : "FAIL"} (${r.ok ? r.msg : `${r.examples.length}: ${sample(r.examples).join(" | ")}${r.examples.length > 5 ? ` | ... ${r.examples.length - 5} more` : ""}`})`);
  const summary = `seo gate: ${RULES.length} rules, ${failed} failed; indexable ${pages.length - noindex}, noindex ${noindex}, lastmod moved ${ctx.moved}`;
  // the state moves forward only on a passing run (or --baseline with every other rule passing), so a failure repeats until it is fixed
  const recordable = !failed;
  let wrote = false;
  if (recordable && !dry) {
    // "updated" moves only with the rest, so an unchanged day leaves the file as it was
    const next = { ...(state || {}), version: 1, indexable, pages: stored };
    const same = state && JSON.stringify({ ...state, updated: undefined }) === JSON.stringify({ ...next, updated: undefined });
    if (!same) writeState(root, { ...next, updated: today.toISOString().slice(0, 10) });
    wrote = true;
  }
  return { results, failed, lines, summary, wrote, indexable: pages.length - noindex, noindex, moved: ctx.moved };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), ri = a.indexOf("--root");
  const o = runGate({ root: ri >= 0 ? path.resolve(a[ri + 1]) : ROOT, baseline: a.includes("--baseline"), dry: a.includes("--dry") });
  o.lines.forEach((l) => console.log(l));
  console.log(o.summary);
  if (!o.wrote) console.log(o.failed ? "state not updated (a rule failed)" : "state not updated (--dry)");
  process.exit(o.failed ? 1 : 0);
}
