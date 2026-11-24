// npm run sitemap-extras: append the weekend pages, event pages and calendar feeds to site/sitemap.xml, which gen-pages.js
// writes. Parses the file, drops any earlier copy of those sections, adds them again from what is on disk, and re-writes it:
// running it twice gives the same file. Runs last in `npm run ingest`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";
import { parseSitemap, sitemapFiles, readSitemapRows, writeSitemaps } from "./seo-lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXTRA_PREFIXES = ["/weekend/", "/e/", "/feeds/"];
export { parseSitemap };
export const pathOf = (loc) => { try { return new URL(loc).pathname; } catch { return loc; } };

// Site-relative paths of the extra pages found under site/.
export function extraPaths(siteDir) {
  const out = [];
  const dirs = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []);
  if (fs.existsSync(path.join(siteDir, "weekend", "index.html"))) out.push("/weekend/");
  for (const d of dirs(path.join(siteDir, "weekend"))) {
    const f = path.join(siteDir, "weekend", d.name, "index.html");
    // empty-weekend pages are noindex: keep them out of the sitemap
    if (d.isDirectory() && fs.existsSync(f) && !/<meta name="robots" content="noindex/.test(fs.readFileSync(f, "utf8"))) out.push(`/weekend/${d.name}/`);
  }
  for (const d of dirs(path.join(siteDir, "e"))) if (d.isDirectory() && fs.existsSync(path.join(siteDir, "e", d.name, "index.html"))) out.push(`/e/${d.name}/`);
  for (const f of dirs(path.join(siteDir, "feeds"))) if (f.isFile() && f.name.endsWith(".ics")) out.push(`/feeds/${f.name}`);
  return out.sort();
}

// The rows without any earlier copy of the extra sections, then the extra pages from disk.
export function mergeRows(rows, paths, lastmod, lastmodOf = () => "") {
  return rows.filter((u) => !EXTRA_PREFIXES.some((p) => pathOf(u.loc).startsWith(p))).concat(paths.map((p) => ({ loc: SITE_URL + p, lastmod: lastmodOf(p) || lastmod })));
}
// One urlset string (never split): kept for callers that hold a single file.
export function mergeSitemap(xml, paths, lastmod, lastmodOf = () => "") {
  return sitemapFiles(mergeRows(parseSitemap(xml), paths, lastmod, lastmodOf), { split: Infinity }).get("sitemap.xml");
}

// split and chunk: forced small limits for tests; the defaults are 45,000 URLs (docs/SEO-RULES.md, rule 6).
export function run({ root = ROOT, now = new Date(), split, chunk } = {}) {
  const site = path.join(root, "site");
  const { rows: existing } = readSitemapRows(site);
  const paths = extraPaths(site);
  // lastmod: the existing sitemap's date for its home entry (so a rerun on the same data is identical), else today
  const home = existing[0];
  const base = (home && home.lastmod) || now.toISOString().slice(0, 10);
  // an event page: the day its event was last seen (never after the sitemap's own date); weekend and feed pages: the sitemap's date
  const seen = new Map();
  try { for (const e of JSON.parse(fs.readFileSync(path.join(site, "data", "events.json"), "utf8")).events) { const d = String(e.last_seen || e.first_seen || "").slice(0, 10); if (e.id && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d) && d <= base) seen.set(e.id, d); } } catch { /* no data: every page gets the base date */ }
  // an event page: the lastmod gen-event-pages.js stored with its content hash (data/pages-lastmod.json); it moves only when the page does
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(path.join(root, "data", "pages-lastmod.json"), "utf8")); } catch { /* none yet */ }
  const rows = mergeRows(existing, paths, base, (p) => { const m = /^[/]e[/]([^/]+)[/]$/.exec(p); return m ? (stored["e/" + m[1]] && stored["e/" + m[1]][1]) || seen.get(m[1]) || "" : ""; });
  const opts = {};
  if (split) opts.split = split;
  if (chunk) opts.chunk = chunk;
  writeSitemaps(site, sitemapFiles(rows, opts));
  return { added: paths.length, total: rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`sitemap extras: ${o.added} added, ${o.total} urls`);
}
