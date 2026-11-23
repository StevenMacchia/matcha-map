import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The verification meta tag is added by hand with the real token Google shows (docs/SEARCH-CONSOLE.md). A placeholder
// must never be committed: it would verify nothing and look like a real tag.
test("site/index.html carries no Search Console tag with a placeholder value", () => {
  const html = fs.readFileSync("site/index.html", "utf8");
  const tags = [...html.matchAll(/<meta\s+[^>]*name=["']google-site-verification["'][^>]*>/gi)].map((m) => m[0]);
  for (const t of tags) {
    const v = (/content=["']([^"']*)["']/i.exec(t) || [])[1] || "";
    assert.match(v, /^[A-Za-z0-9_-]{20,}$/, `verification tag has a placeholder or empty value: ${t}`);
    assert.doesNotMatch(v, /^(x+|your|token|placeholder|todo|changeme|abc|test|replace)/i, `verification tag looks like a placeholder: ${t}`);
  }
  assert.doesNotMatch(html, /google-site-verification[^>]*content=["']\s*["']/i);
});

test("the Search Console doc names the property, the sitemap and where the tag goes", () => {
  const md = fs.readFileSync("docs/SEARCH-CONSOLE.md", "utf8");
  for (const s of ["https://matchamap.app/", "sitemap.xml", "site/index.html", "google-site-verification"]) assert.ok(md.includes(s), s);
});
