// /claim/ explainer: the words from docs/GET-ON-THE-MAP-COPY.md, own CSP, no inline script or style, a button to the form.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../site/claim/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../site/claim/claim.css", import.meta.url), "utf8");
const promote = fs.readFileSync(new URL("../site/promote/promote.js", import.meta.url), "utf8");
const text = html.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/\s+/g, " ");

test("the explainer carries the copy as written", () => {
  for (const s of ["Get your matcha pop-up on the map", "Matcha Map is a free map of matcha pop-ups across the US. People use it to find one near them on a given day. If you run pop-ups, cafes or a market, your dates belong on it.",
    "Claim your page", "Tell us your brand and your Instagram or TikTok, and your email so we can write back. We check it is really you before anything changes.",
    "We read public posts and pages only, never anything behind a login.", "A page for your brand", "The right name, place and time, because you can fix them", "A link back to your account",
    "Nothing. (A paid Featured spot exists for brands that want one; it is never needed to be listed.)", "We do not sell your data, send you spam, or post for you.", "We never copy your photos without credit and a link back.",
    "Pop-up brands, cafes that run matcha events, and market and festival organizers with matcha vendors.", "We write back by email once we have checked it. Questions: reply to the message that brought you here."]) assert.ok(text.includes(s), s);
  assert.match(html, /<a class="fm-btn" href="#claim-title">Claim your page<\/a>/);
  assert.match(html, /id="claim-title"/);
  assert.match(html, /href="\/data-deletion\/"/);
});

test("page: own CSP, no inline script, handler or style, scripts and styles are local, no banned words", () => {
  const m = /Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(m);
  assert.match(m[1], /^default-src 'none'; script-src 'self' https:\/\/static\.cloudflareinsights\.com; style-src 'self';/);
  assert.doesNotMatch(m[1], /unsafe-inline|unsafe-eval/);
  assert.ok([...html.matchAll(/<script\b([^>]*)>/g)].every((x) => /\bsrc="\//.test(x[1])));
  assert.doesNotMatch(html, /\son[a-z]+=|\sstyle=|javascript:/i);
  assert.match(html, /href="\/claim\/claim\.css"/);
  assert.doesNotMatch(html + css, /kawaii|uwu|cute|cutesy|girly/i);
});

test("promote: the host card links to /claim/ with the same button text, carrying brand and handle", () => {
  assert.match(promote, /href="\/claim\/' \+ hd \+ '">Claim your page<\/a>/);
  assert.match(promote, /"&handle=" \+ encodeURIComponent\("@"/);
});
