// /promote/: caption builders, the page's CSP and its pinned QR script.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../site/promote/promote.js", import.meta.url), "utf8"), ctx);
const P = ctx.window.MatchaPromote;
const html = fs.readFileSync(new URL("../site/promote/index.html", import.meta.url), "utf8");
const src = fs.readFileSync(new URL("../site/promote/promote.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../site/promote/promote.css", import.meta.url), "utf8");
const BANNED = /kawaii|uwu|cute|cutesy|girly/i;
const NOW = new Date("2026-11-25T15:00:00Z");
const E = { id: "abc123def456", brand: "Moonbee Matcha", handle: "moonbeematcha", start: "2026-11-28T11:00:00-05:00", end: "2026-11-28T15:00:00-05:00", venue: "Books & Co", city: "Raleigh", state: "NC" };

test("captions name the brand, link the map with the id, mention the city, and use no banned word", () => {
  const c = P.captions(E, NOW);
  for (const t of [c.instagram, c.tiktok]) {
    assert.match(t, /Moonbee Matcha/);
    assert.ok(t.includes("https://matchamap.app/?event=abc123def456"));
    assert.match(t, /Raleigh/);
    assert.ok(!BANNED.test(t));
  }
  assert.match(c.instagram, /Saturday Nov 28, 11am to 3pm/);
  assert.match(c.instagram, /\n/);
  const tags = c.instagram.match(/#\w+/g) || [];
  assert.ok(tags.length >= 2 && tags.length <= 3);
  assert.doesNotMatch(c.tiktok, /already happened/);
});

test("a past event says it already happened", () => {
  const c = P.captions(E, new Date("2026-12-10T00:00:00Z"));
  assert.match(c.instagram, /already happened/);
  assert.match(c.tiktok, /already happened/);
});

test("share card is plain SVG with no outside references and escapes the brand", () => {
  const s = P.shareCardSVG(E, NOW);
  assert.match(s, /viewBox="0 0 1080 1350"/);
  assert.match(s, /Moonbee Matcha/);
  assert.doesNotMatch(s, /<image|href=|<script/);
  assert.equal(P.shareCardSVG({ ...E, brand: "<b>x</b>" }, NOW).includes("<b>x"), false);
});

test("page: own CSP with unpkg in script-src, no inline script, handler or style, pinned QR script, no banned words", () => {
  const m = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, "CSP meta");
  assert.match(m[1], /^default-src 'none'; script-src 'self' https:\/\/unpkg\.com https:\/\/static\.cloudflareinsights\.com;/);
  assert.match(m[1], /form-action 'none'/);
  assert.match(m[1], /img-src 'self' data: blob:/);
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((x) => x[1]);
  assert.ok(scripts.length >= 3 && scripts.every((a) => /\bsrc="/.test(a)), "every script has a src");
  assert.doesNotMatch(html, /\son[a-z]+=|\sstyle=/i);
  assert.ok(html.includes('<script src="https://unpkg.com/qrcode-generator@1.4.4/qrcode.js"></script>'));
  assert.ok(!BANNED.test(html + src + css));
});
