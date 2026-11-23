// N7: the home page links only files that exist, and the shell keeps the hooks other modules plug into.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
const app = fs.readFileSync(path.join(SITE, "app.js"), "utf8");

function local(ref) {
  if (/^(https?:|data:|mailto:|#|webcal:|blob:)/i.test(ref) || ref.startsWith("//")) return null;
  const clean = ref.split(/[?#]/)[0];
  if (!clean || clean === "/") return null;
  let p = path.join(SITE, clean.replace(/^\//, ""));
  if (clean.endsWith("/")) p = path.join(p, "index.html");
  return p;
}

test("index.html references only files that exist", () => {
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  const missing = refs.map((r) => [r, local(r)]).filter(([, p]) => p && !fs.existsSync(p)).map(([r]) => r);
  assert.deepEqual(missing, []);
});

test("app.js imports and fetches only files that exist", () => {
  const refs = [...app.matchAll(/\b(?:import|fetch)\("([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^data\/(events|sources|shops|zips|brands|places)\.json$/.test(r));
  const missing = refs.map((r) => [r, local(r.replace(/^\.\//, ""))]).filter(([, p]) => p && !fs.existsSync(p)).map(([r]) => r);
  assert.deepEqual(missing, []);
});

test("the shell keeps its hooks: #search-slot, renderCard, the list grip", () => {
  assert.match(html, /id="search-slot"/);
  assert.match(html, /id="list-grip"/);
  assert.match(app, /function renderCard\(/);
  assert.match(app, /prefers-reduced-motion/);
});
