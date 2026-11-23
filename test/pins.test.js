// The pin look (site/pins.js, the 2026-11-23 mock): shop, pop-up, brand, stack and neighbourhood markup, escaped, with
// image sources only over https or on this site, a day pill, and a going badge only for a real count of one or more.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SITE = path.resolve("site");
const w = {};
vm.runInNewContext(fs.readFileSync(path.join(SITE, "pins.js"), "utf8"), { window: w });
const P = w.MatchaPins;
const tags = (html) => [...html.matchAll(/<[^>]*>/g)].map((m) => m[0]);

test("shop pin: the photo in the ring, the cup mark, the open dot only when open", () => {
  const open = P.shopPin({ photo: "https://cdn.example/s.jpg", open: true });
  assert.match(open, /class="pn pn-sh"/);
  assert.match(open, /<img src="https:\/\/cdn\.example\/s\.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">/);
  assert.match(open, /class="pn-cup bx"/);
  assert.match(open, /class="pn-open"/);
  const shut = P.shopPin({ photo: "", drawn: "<span class=\"pn-draw\" data-char=\"s-shop\"></span>", serves: true });
  assert.doesNotMatch(shut, /pn-open|<img/);
  assert.match(shut, /pn-sh sv/);
  assert.match(shut, /data-char="s-shop"/, "the drawn shop when there is no photo");
});

test("pop-up pin: day pill, today pulse, going badge only from one up", () => {
  const html = P.popPin({ photo: "img/events/a.jpg", pill: "Today", today: true, going: 0 });
  assert.match(html, /pn pn-pu today/);
  assert.equal((html.match(/pn-pulse/g) || []).length, 2);
  assert.match(html, /<span class="pn-pill bx">Today<\/span>/);
  assert.doesNotMatch(html, /going/, "no badge for zero");
  assert.match(P.popPin({ pill: "Sat", going: 3 }), /<span class="pn-going bx">3 going<\/span>/);
  assert.equal(P.goingHTML(0), ""); assert.equal(P.goingHTML(-2), ""); assert.equal(P.goingHTML("x"), "");
});

test("day pill: Today, the weekday this week, else the date", () => {
  const now = new Date(2026, 10, 26, 18, 30); // Thu Nov 26
  assert.equal(P.dayPill("2026-11-26T13:00:00-06:00", now), "Today");
  assert.equal(P.dayPill("2026-11-28T10:00:00-05:00", now), "Sat");
  assert.equal(P.dayPill("2026-12-02T10:00:00-05:00", now), "Wed");
  assert.equal(P.dayPill("2026-12-03T10:00:00-05:00", now), "Dec 3");
  assert.equal(P.dayPill("2026-11-21T10:00:00-05:00", now), "Nov 21");
  assert.equal(P.dayPill("", now), "");
});

test("brand pin, stack and neighbourhood", () => {
  assert.match(P.brandPin({ photo: "/brand/leaf/avatar.jpg" }), /pn pn-br[\s\S]*<img src="\/brand\/leaf\/avatar\.jpg"/);
  assert.match(P.brandPin({ photo: "", drawn: "<svg></svg>" }), /<span class="pn-ph"><svg><\/svg><\/span>/);
  const st = P.stackPin([{ kind: "s", photo: "https://a.example/1.jpg" }, { kind: "e", photo: "" }, { kind: "b" }], 3);
  assert.equal((st.match(/pn-st pn-st/g) || []).length, 2, "two faces");
  assert.match(st, /<span class="pn-fan bx">3<\/span>/);
  const hd = P.hoodPin([{ kind: "s" }, { kind: "s" }, { kind: "e" }, { kind: "b" }], 13, 2);
  assert.equal((hd.match(/class="pn-av /g) || []).length, 3, "three faces at most");
  assert.match(hd, /<span class="hd-n">13<\/span><span class="hd-p bx">2<\/span>/);
  assert.doesNotMatch(P.hoodPin([{ kind: "s" }], 4, 0), /hd-p/, "no pink count without pop-ups");
});

test("every value is escaped and only https or local images reach a src", () => {
  const X = `"><img src=x onerror=alert(1)>`;
  for (const html of [P.shopPin({ photo: X }), P.shopPin({ photo: "http://plain.example/a.jpg" }), P.shopPin({ photo: "javascript:alert(1)" }), P.popPin({ photo: "//evil.example/a.jpg", pill: X, going: X }),
    P.brandPin({ photo: "data:image/png;base64,AAAA" }), P.stackPin([{ kind: X, photo: X }], X), P.hoodPin([{ kind: X }], X, X)]) {
    assert.doesNotMatch(html, /<img src=x|javascript:|data:image|http:\/\/|src="\/\//);
    for (const t of tags(html)) assert.doesNotMatch(t.replace(/="[^"]*"/g, ""), /\son[a-z]+/i, t);
  }
  assert.equal(P.src("../secret"), ""); assert.equal(P.src("img/a.jpg"), "img/a.jpg"); assert.equal(P.src("https://x.example/a b"), "");
});

test("the bob phase is a steady negative delay under 3.6 s", () => {
  const a = P.phase("s:1"), b = P.phase("s:1"), c = P.phase("e:2");
  assert.equal(a, b);
  assert.ok(a <= 0 && a > -3.6 && c <= 0 && c > -3.6);
});

test("the page loads pins.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  assert.ok(html.indexOf('src="pins.js') > 0 && html.indexOf('src="pins.js') < html.indexOf('src="app.js'));
  assert.match(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"), /"\/pins\.js"/);
});
