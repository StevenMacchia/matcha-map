// Rung 34: the manifest, the icons, the service worker's precache list and the script syntax.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const SITE = path.resolve("site");
const read = (p) => fs.readFileSync(path.join(SITE, p), "utf8");
const exists = (u) => fs.existsSync(path.join(SITE, u.replace(/^\//, "").split(/[?#]/)[0]));

test("manifest is valid JSON with the required fields and every icon exists", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const k of ["name", "short_name", "description", "start_url", "display", "background_color", "theme_color", "icons"]) assert.ok(m[k], k);
  assert.equal(m.display, "standalone");
  assert.match(m.start_url, /^\/\?source=pwa$/);
  assert.ok(m.categories.includes("food") && m.categories.includes("travel"));
  const sizes = new Set(m.icons.map((i) => i.sizes));
  assert.ok(sizes.has("192x192") && sizes.has("512x512"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable"), "a maskable icon");
  for (const i of m.icons) assert.ok(exists(i.src), i.src);
  assert.ok(exists("/icons/apple-touch-icon.png") && exists("/icons/favicon-32.png"));
});

test("sw.js precache list only names files that exist, and index.html links the manifest and icons", () => {
  const src = read("sw.js");
  const ctx = {};
  vm.runInNewContext(src.slice(0, src.indexOf('self.addEventListener("install"')), ctx);
  assert.ok(ctx.SHELL.length > 10);
  for (const u of ctx.SHELL) assert.ok(u === "/" || exists(u), "missing from site/: " + u);
  assert.ok(ctx.SHELL.includes("/index.html") && ctx.SHELL.includes("/pwa.js"));
  assert.match(ctx.VERSION, /^mm-[0-9a-f]+$/); // a hash of the shell files, stamped by tools/sw-version.js
  const html = read("index.html");
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /manifest-src 'self'/);
  assert.match(html, /worker-src 'self'/);
  assert.match(html, /src="pwa\.js(?:\?v=mm-[0-9a-f]+)?"/); // tools/sw-version.js stamps ?v= on the shell links
  // linked outside the generated seo block, so tools/gen-pages.js keeps them
  const seo = html.slice(html.indexOf("seo:start"), html.indexOf("seo:end"));
  assert.ok(!seo.includes("manifest"));
});

test("sw.js and pwa.js parse; the service worker never touches tiles or Instagram images", () => {
  for (const f of ["sw.js", "pwa.js"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(SITE, f)], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const sw = read("sw.js");
  assert.ok(sw.includes("url.origin !== self.location.origin"), "cross-origin requests are left to the network");
  assert.ok(!/tiles\.openfreemap|cdninstagram|fbcdn/.test(sw));
});
