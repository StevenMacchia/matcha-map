// The perf lane's guards that need no browser (docs/PERFORMANCE.md; the Lighthouse budgets are tools/perf-gate.js):
// the shell loads nothing from a third-party script or font host, MapLibre and the font are served from this site,
// every script is deferred, other sites' photos go out as data-pic, and the gate's own helpers hold.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BUDGETS, check, split, targets } from "../tools/perf-gate.js";

const html = fs.readFileSync("site/index.html", "utf8");

test("the home page loads MapLibre and the font from this site; the CSP names no script, style or font host but ours", () => {
  assert.doesNotMatch(html, /unpkg\.com|fonts\.googleapis|fonts\.gstatic/);
  assert.match(html, /<script defer src="vendor\/maplibre-gl-4\.7\.1\/maplibre-gl\.js/);
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  assert.match(csp, /script-src 'self' https:\/\/static\.cloudflareinsights\.com;/);
  assert.match(csp, /style-src 'self';/);
  assert.match(csp, /font-src 'self' https:\/\/tiles\.openfreemap\.org;/);
  for (const f of ["vendor/maplibre-gl-4.7.1/maplibre-gl.js", "vendor/maplibre-gl-4.7.1/maplibre-gl.css", "vendor/maplibre-gl-4.7.1/LICENSE.txt", "fonts/mplus-rounded-1c-latin-500.woff2", "fonts/mplus-rounded-1c-latin-700.woff2", "fonts/mplus-rounded-1c-latin-800.woff2"]) assert.ok(fs.existsSync("site/" + f), f);
  assert.match(fs.readFileSync("site/style.css", "utf8"), /@font-face[^}]*mplus-rounded-1c-latin-700\.woff2/);
});

test("every script on the home page is deferred, a module, or the one small head script", () => {
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  assert.ok(tags.length >= 15);
  for (const m of tags) if (!/\bdefer\b|type="module"/.test(m[0])) assert.match(m[1], /^theme\.js/, "only theme.js (the theme before first paint) is allowed to block: " + m[1]);
});

test("the service worker keeps MapLibre in its shell and answers the pinned folders from the cache", () => {
  const sw = fs.readFileSync("site/sw.js", "utf8");
  assert.match(sw, /"\/vendor\/maplibre-gl-4\.7\.1\/maplibre-gl\.js"/);
  assert.match(sw, /"\/pics\.js"/);
  assert.match(sw, /indexOf\("\/vendor\/"\) === 0/);
  assert.match(fs.readFileSync("site/_headers", "utf8"), /\/vendor\/\*\s+! Cache-Control\s+Cache-Control: public, max-age=31536000, immutable/);
});

test("one fetch per data file: app.js, cards-app.js and pwa.js share theme.js's mmJSON", () => {
  assert.match(fs.readFileSync("site/theme.js", "utf8"), /window\.mmJSON = function/);
  for (const f of ["app.js", "cards-app.js", "pwa.js"]) assert.match(fs.readFileSync("site/" + f, "utf8"), /window\.mmJSON/, f);
});

test("the gate: budgets, the targets exist, and a missed budget is named", () => {
  const T = targets();
  for (const k of ["home", "city", "state", "brand"]) assert.ok(BUDGETS[k]);
  for (const k of ["city", "state", "brand"]) assert.ok(fs.existsSync("site" + T[k] + "index.html"), T[k]);
  assert.ok(BUDGETS.city.perf >= 90 && BUDGETS.city.lcpMs <= 2500, "static pages are held to the requested target");
  const bad = check("home", { performance: 40, lcp: 12000, bytes: 9 * 1048576 }, { own: 3 * 1048576, photos: 2 * 1048576 }, 800 * 1024);
  assert.equal(bad.length, 6);
  assert.deepEqual(check("state", { performance: 99, lcp: 1700, bytes: 100000 }, { own: 0, photos: 0 }, 0), []);
  const lh = { audits: { "network-requests": { details: { items: [
    { url: "http://x/a.js", transferSize: 10, mimeType: "text/javascript" }, { url: "https://tiles.openfreemap.org/2/1/1.pbf", transferSize: 600 },
    { url: "https://scontent.cdninstagram.com/a.jpg", transferSize: 900, mimeType: "image/jpeg", resourceType: "Image" }] } } } };
  assert.deepEqual(split(lh, "http://x"), { own: 10, photos: 900, tiles: 600 });
});
