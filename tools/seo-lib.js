// Shared by the SEO rules (docs/SEO-RULES.md): the state file data/seo-state.json, the registry of published event and brand pages with
// the 301 lines in site/_redirects, and the sitemap writer that splits into sitemap-1.xml, sitemap-2.xml... plus an index.
// State file keys, one owner each: registry and gone (gen-pages.js, gen-event-pages.js), indexable, pages and updated (tools/seo-gate.js).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SITE_URL } from "./site-url.js";

export const STATE_FILE = "data/seo-state.json";
export const SITEMAP_SPLIT = 45000; // above this many URLs the sitemap becomes an index over several files
export const SITEMAP_CHUNK = 45000; // URLs per file once split (the protocol allows 50,000)
export const REDIRECT_CAP = 1900; // Cloudflare Pages allows 2,000 static redirects in _redirects

export function readState(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), "utf8")); } catch { return null; }
}
export function writeState(root, state) {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, STATE_FILE), JSON.stringify(state) + "\n");
}
// Read-modify-write one owner's keys, leaving the others as they are.
export function patchState(root, fn) {
  const s = readState(root) || {};
  fn(s);
  writeState(root, s);
  return s;
}

// ---- the registry and _redirects ----
const PREFIX = { events: "/e/", brands: "/brand/" };
// current: { "<id or slug>": "<st>/<city slug>" or "" } for the pages generated now. A page published before and not generated now gets
// a 301 line (to its city page when known, else the home page); a page generated now loses any 301 line it had.
export function updateRegistry(state, kind, current, existing = []) {
  const reg = (state.registry = state.registry || {}), gone = (state.gone = state.gone || {});
  const prev = { ...Object.fromEntries(existing.map((k) => [k, ""])), ...(reg[kind] || {}) };
  for (const [k, city] of Object.entries(prev)) if (!(k in current)) { delete gone[PREFIX[kind] + k + "/"]; gone[PREFIX[kind] + k + "/"] = city ? `/city/${city}/` : "/"; }
  for (const k of Object.keys(current)) delete gone[PREFIX[kind] + k + "/"];
  reg[kind] = current;
  // over the cap: the oldest event lines go first, then the oldest brand lines
  let over = Object.keys(gone).length - REDIRECT_CAP;
  for (const p of ["/e/", "/brand/"]) for (const k of Object.keys(gone)) { if (over <= 0) break; if (k.startsWith(p)) { delete gone[k]; over--; } }
  return state;
}
export const REDIRECTS_HEAD = "# Written by tools/gen-pages.js and tools/gen-event-pages.js from data/seo-state.json (docs/SEO-RULES.md, rule 3). Do not edit by hand.\n# A page that was published and is no longer generated keeps its address: it points at its city page, or the home page.\n";
export function redirectsText(gone) {
  return REDIRECTS_HEAD + Object.entries(gone || {}).map(([from, to]) => `${from} ${to} 301`).join("\n") + (Object.keys(gone || {}).length ? "\n" : "");
}
export function writeRedirects(root, state) {
  const f = path.join(root, "site", "_redirects"), text = redirectsText(state.gone);
  if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text) fs.writeFileSync(f, text);
}
export const parseRedirects = (text) => new Map(String(text || "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2).map((p) => [p[0], p[1]]));
// Directory names under site/<dir>/ that hold an index.html: the pages already on disk.
export const dirsWithIndex = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory() && fs.existsSync(path.join(dir, x.name, "index.html"))).map((x) => x.name) : []);

// ---- sitemaps ----
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");
export function parseSitemap(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(m[1]);
    if (!loc) continue;
    const lm = /<lastmod>([\s\S]*?)<\/lastmod>/.exec(m[1]);
    urls.push({ loc: unesc(loc[1].trim()), lastmod: lm ? lm[1].trim() : "" });
  }
  return urls;
}
export const isSitemapIndex = (xml) => /<sitemapindex[\s>]/.test(String(xml));
export const sitemapChildren = (xml) => [...String(xml).matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)].map((m) => { const l = /<loc>([\s\S]*?)<\/loc>/.exec(m[1]); return l ? unesc(l[1].trim()) : ""; }).filter(Boolean);
const urlset = (rows) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
// rows: [{ loc, lastmod }] -> Map(file name -> xml): one sitemap.xml, or past `split` URLs sitemap-1.xml... and an index at sitemap.xml.
export function sitemapFiles(rows, { split = SITEMAP_SPLIT, chunk = SITEMAP_CHUNK, site = SITE_URL } = {}) {
  const out = new Map();
  if (rows.length <= split) { out.set("sitemap.xml", urlset(rows)); return out; }
  const parts = [];
  for (let i = 0; i < rows.length; i += chunk) parts.push(rows.slice(i, i + chunk));
  parts.forEach((p, i) => out.set(`sitemap-${i + 1}.xml`, urlset(p)));
  const day = (p) => p.map((r) => r.lastmod).filter(Boolean).sort().pop();
  out.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts.map((p, i) => `<sitemap><loc>${site}/sitemap-${i + 1}.xml</loc>${day(p) ? `<lastmod>${day(p)}</lastmod>` : ""}</sitemap>`).join("\n")}\n</sitemapindex>\n`);
  return out;
}
// Every URL row of the sitemap in site/, following an index into its files.
export function readSitemapRows(siteDir) {
  const f = path.join(siteDir, "sitemap.xml");
  if (!fs.existsSync(f)) return { rows: [], files: [] };
  const xml = fs.readFileSync(f, "utf8");
  if (!isSitemapIndex(xml)) return { rows: parseSitemap(xml), files: ["sitemap.xml"] };
  const rows = [], files = ["sitemap.xml"];
  for (const loc of sitemapChildren(xml)) {
    let name; try { name = path.posix.basename(new URL(loc).pathname); } catch { continue; }
    const g = path.join(siteDir, name);
    if (fs.existsSync(g)) { rows.push(...parseSitemap(fs.readFileSync(g, "utf8"))); files.push(name); }
  }
  return { rows, files };
}
// Write the files of a sitemapFiles() result into site/, removing sitemap-N.xml files that are no longer part of it.
export function writeSitemaps(siteDir, files) {
  for (const n of fs.existsSync(siteDir) ? fs.readdirSync(siteDir) : []) if (/^sitemap-\d+\.xml$/.test(n) && !files.has(n)) fs.rmSync(path.join(siteDir, n));
  for (const [n, xml] of files) { const f = path.join(siteDir, n); if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== xml) fs.writeFileSync(f, xml); }
}

// ---- page hashes (rule 2) ----
// The date a page prints in its "Updated" line and the rolling weekend window are not content: they stand in as tokens while a page is
// hashed, in the generator (which writes the tokens) and in the gate (which reads the printed dates and turns them back).
export const UPDATED = "~UPDATED~";
export const WIN = "~WEEKEND~";
const UPDATED_RE = /\b([Uu]pdated) [A-Z][a-z]{2} \d{1,2}, \d{4}/g;
const WIN_RE = /[A-Z][a-z]{2} \d{1,2} to [A-Z][a-z]{2} \d{1,2}/g;
// Head-only template changes are not content, so a page is hashed as it read before each one (hashes stored earlier stay valid and no lastmod moves):
//  2026-11-25 (perf lane): the Google Fonts stylesheet became two preloads of the self-hosted font, and the CSP no longer names fonts.googleapis.com / fonts.gstatic.com.
const FONT_PRELOADS_RE = /<link rel="preload" href="\/fonts\/mplus-rounded-1c-latin-500\.woff2"[^>]*>\r?\n<link rel="preload" href="\/fonts\/mplus-rounded-1c-latin-700\.woff2"[^>]*>/;
const FONT_LINK_OLD = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap">';
const asBefore = (html) => html.replace(FONT_PRELOADS_RE, FONT_LINK_OLD).replace("style-src 'self';", "style-src 'self' https://fonts.googleapis.com;").replace("font-src 'self';", "font-src https://fonts.gstatic.com;");
export const hashInput = (html) => asBefore(html).replace(UPDATED_RE, `$1 ${UPDATED}`).replace(WIN_RE, WIN);
export const hash12 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
export const dayText = (k) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(k + "T12:00:00Z"));
export const SECTIONS = ["lead", "events", "shops", "brands", "nearby", "faq"]; // the order of a city page's sub-hashes
export const subHash = (s) => hash12(s).slice(0, 6);
