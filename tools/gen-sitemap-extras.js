// npm run sitemap-extras: append the weekend pages, event pages and calendar feeds to site/sitemap.xml, which gen-pages.js
// writes. Parses the file, drops any earlier copy of those sections, adds them again from what is on disk, and re-writes it:
// running it twice gives the same file. Runs last in `npm run ingest`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./site-url.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXTRA_PREFIXES = ["/weekend/", "/e/", "/feeds/"];
export const MAX_URLS = 50000;
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

export function mergeSitemap(xml, paths, lastmod) {
  const keep = parseSitemap(xml).filter((u) => !EXTRA_PREFIXES.some((p) => pathOf(u.loc).startsWith(p)));
  const rows = keep.concat(paths.map((p) => ({ loc: SITE_URL + p, lastmod })));
  if (rows.length > MAX_URLS) rows.length = MAX_URLS;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}

export function run({ root = ROOT, now = new Date() } = {}) {
  const site = path.join(root, "site");
  const file = path.join(site, "sitemap.xml");
  const xml = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const paths = extraPaths(site);
  // lastmod: the existing sitemap's date for its home entry (so a rerun on the same data is identical), else today
  const home = parseSitemap(xml)[0];
  const next = mergeSitemap(xml, paths, (home && home.lastmod) || now.toISOString().slice(0, 10));
  if (next !== xml) fs.writeFileSync(file, next);
  return { added: paths.length, total: parseSitemap(next).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = run();
  console.log(`sitemap extras: ${o.added} added, ${o.total} urls`);
}
