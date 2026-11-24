// Every page under site/ (the app, the city, state, brand, event, weekend and social pages, the 404 page) references only
// assets that exist, resolved the way a browser resolves them from that page's own address: a relative "app.js" on a
// page under /city/nc/raleigh/ points at /city/nc/raleigh/app.js and fails here. Found live on 2026-11-23: with no 404
// page, Pages served the app shell for every unknown path and its relative assets came back as HTML.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
function* htmlFiles(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* htmlFiles(p);
    else if (d.name.endsWith(".html")) yield p;
  }
}
const SKIP_REL = /^(canonical|alternate|dns-prefetch|preconnect|prefetch|prerender|me|author|license|next|prev|search|help)$/i;
const external = (u) => /^(https?:)?\/\//i.test(u) || /^(data|mailto|tel|javascript|blob):/i.test(u) || u.startsWith("#");
export function assetRefs(html) {
  const out = [];
  for (const m of html.matchAll(/<(script|link|img|use|source|video|audio|iframe)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(), attrs = m[2];
    if (tag === "link") { const rel = /\brel="([^"]*)"/i.exec(attrs); if (rel && SKIP_REL.test(rel[1].trim())) continue; }
    const a = /\b(?:src|href)="([^"]+)"/i.exec(attrs);
    if (!a) continue;
    const u = a[1].trim();
    if (!u || external(u) || u.includes("${")) continue; // a template string inside a page's own script is not a reference
    out.push(u);
  }
  return out;
}
export function resolveRef(pageRel, ref) {
  const clean = ref.replace(/[?#].*$/, "");
  if (!clean) return null; // "?x" or "#x": the page itself
  const dir = path.posix.dirname(pageRel);
  let p = clean.startsWith("/") ? clean : path.posix.normalize(path.posix.join(dir, clean));
  if (p.endsWith("/")) p += "index.html";
  return p.replace(/^\/+/, "");
}

test("every page under site/ references only assets that exist, resolved from the page's own address", () => {
  const misses = [];
  let pages = 0, refs = 0;
  for (const file of htmlFiles(SITE)) {
    pages++;
    const rel = "/" + path.relative(SITE, file).split(path.sep).join("/");
    for (const ref of assetRefs(fs.readFileSync(file, "utf8"))) {
      refs++;
      const p = resolveRef(rel, ref);
      if (!p) continue;
      const target = path.join(SITE, ...p.split("/"));
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) misses.push(`${rel} -> ${ref}`);
    }
  }
  assert.ok(pages > 10 && refs > pages, `read ${pages} pages, ${refs} references`);
  assert.deepEqual(misses.slice(0, 20), [], `${misses.length} missing assets (first 20 shown)`);
});

test("the 404 page and the app shell point at root assets, so they work at any address", () => {
  const nf = fs.readFileSync(path.join(SITE, "404.html"), "utf8");
  assert.match(nf, /<meta name="robots" content="noindex,follow">/);
  for (const ref of assetRefs(nf)) assert.ok(ref.startsWith("/"), "404.html: " + ref);
  assert.deepEqual(assetRefs('<link rel="canonical" href="x"><script src="/a.js?v=1"></script><img src="https://x/y.png"><use href="/c.svg#m"/>'), ["/a.js?v=1", "/c.svg#m"]);
  assert.equal(resolveRef("/city/nc/raleigh/index.html", "app.js?v=1"), "city/nc/raleigh/app.js");
  assert.equal(resolveRef("/city/nc/raleigh/index.html", "/app.js?v=1"), "app.js");
  assert.equal(resolveRef("/index.html", "../x/"), "x/index.html");
});
