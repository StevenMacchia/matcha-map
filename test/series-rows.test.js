// Series rows (design rung 5): the list shows one row per series with no date filter, the header counts a series once with
// "(N dates)" after it, and the rule reads in plain words. site/series.js runs in a vm like citypins.js; the words are in cards.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { seriesWords, seriesUntil, rowHtml, cardHtml } from "../site/cards.js";

const SITE = path.resolve("site");
const w = {};
vm.runInNewContext(fs.readFileSync(path.join(SITE, "series.js"), "utf8"), { window: w });
const MS = w.MatchaSeries;

const S = (weekdays, until = null, o = {}) => ({ id: "s-" + weekdays.join(""), rule: "weekly", weekdays, until, source_url: null, projected: true, ...o });
const it = (id, start, series = null, venue = "Hall") => ({ key: "e:" + id, data: { id, start, series, venue, brand: "Moonbee" } });

test("seriesWords: one weekday, a run, a run over the weekend, a split set, two days, every day", () => {
  assert.equal(seriesWords(S([2])), "Every Tuesday");
  assert.equal(seriesWords(S([3, 4, 5, 6, 0])), "Wed to Sun");
  assert.equal(seriesWords(S([1, 2, 3, 4, 5, 6])), "Mon to Sat");
  assert.equal(seriesWords(S([0, 1, 5, 6])), "Fri to Mon");
  assert.equal(seriesWords(S([5, 1, 3])), "Mon, Wed, Fri");
  assert.equal(seriesWords(S([6, 0])), "Sat and Sun");
  assert.equal(seriesWords(S([2, 4])), "Tue and Thu");
  assert.equal(seriesWords(S([0, 1, 2, 3, 4, 5, 6])), "Every day");
  assert.equal(seriesWords(null), "");
  assert.equal(seriesWords(S([])), "");
  assert.equal(seriesWords(S([9, "x"])), "");
});

test("seriesUntil: Mon D, nothing without a date", () => {
  assert.equal(seriesUntil(S([2], "2027-01-04")), "until Jan 4");
  assert.equal(seriesUntil(S([2], "2026-12-26")), "until Dec 26");
  assert.equal(seriesUntil(S([2], null)), "");
  assert.equal(seriesUntil(S([2], "soon")), "");
});

test("group: one entry per series at its first date's place, the next date leads, one-offs stay", () => {
  const a = S([2], "2026-12-29"), b = S([6]);
  const list = [it("x1", "2026-11-25T10:00:00-08:00", a), it("o1", "2026-11-25T12:00:00-08:00"), it("x0", "2026-11-24T10:00:00-08:00", a),
    it("y1", "2026-11-28T09:00:00-08:00", b, "Market"), it("y2", "2026-12-05T09:00:00-08:00", b, "Other market"), it("o2", "2026-11-29T09:00:00-08:00")];
  const g = JSON.parse(JSON.stringify(MS.group(list))); // out of the vm realm
  assert.deepEqual(g.map((x) => x.it.data.id), ["x0", "o1", "y1", "o2"]);
  assert.deepEqual(g.map((x) => x.n), [2, 1, 2, 1]);
  assert.equal(g[2].it.data.venue, "Market", "a series that moves venue stays one row, named by its next date");
  assert.equal(MS.group([]).length, 0);
});

test("the header count: a series once, then (N dates) when the rows hold more dates", () => {
  const a = S([2]);
  const g = MS.group([it("x1", "2026-11-24", a), it("x2", "2026-12-01", a), it("x3", "2026-12-08", a), it("o1", "2026-11-25")]);
  const c = MS.counts(g);
  assert.deepEqual(JSON.parse(JSON.stringify(c)), { rows: 2, dates: 4 });
  assert.equal(MS.datesNote(c), "(4 dates)");
  assert.equal(MS.datesNote(MS.counts(MS.group([it("o1", "2026-11-25")]))), "");
});

const NOW = new Date("2026-11-24T16:00:00Z"); // Tue 8am in Seattle
const ev = (o = {}) => ({ id: "aaaaaa000009", brand: "Howdy Y'all", kind: "popup", start: "2026-11-24T10:00:00-08:00", end: "2026-11-24T16:00:00-08:00",
  tz: "America/Los_Angeles", venue: "Central Library", address: "1000 4th Ave", city: "Seattle", state: "WA", lat: 47.6, lng: -122.3,
  confidence: "likely", status: "upcoming", menu: [], series: S([1, 2, 3, 4, 5, 6], "2027-01-04"), ...o });
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("the series row: rule at venue until date, a series word in the day line, the next date's id", () => {
  const h = rowHtml(ev(), { now: NOW, series: 34 });
  assert.match(text(h), /series/);
  assert.ok(h.includes("<span class=\"mm-rname\">Howdy Y&#39;all</span>"));
  assert.match(h, /<span class="mm-rp">Mon to Sat at Central Library · until Jan 4<\/span>/);
  assert.match(h, /data-key="e:aaaaaa000009" data-event="aaaaaa000009"/);
  assert.doesNotMatch(text(rowHtml(ev(), { now: NOW })), /series|until/, "expanded rows are the dates as before");
  assert.match(rowHtml(ev(), { now: NOW }), /mm-dot mm-conf-likely/, "a projected date keeps its likely dot");
  assert.doesNotMatch(rowHtml(ev({ series: null }), { now: NOW }), /mm-conf-likely/);
  assert.match(rowHtml(ev({ series: S([2]) }), { now: NOW, series: 6 }), /Every Tuesday at Central Library<\/span>/, "no until, no until");
  const bad = rowHtml(ev({ venue: "<b>x</b>", series: { id: "q", weekdays: [2], until: "<i>" } }), { now: NOW, series: 2 });
  assert.doesNotMatch(bad, /<b>|<i>/);
});

test("the card: a quiet pill with the rule beside the day, only when the event has a series", () => {
  const h = cardHtml(ev(), { now: NOW, phone: true });
  assert.match(h, /<p class="mm-dayline"><span class="mm-daypill">Today<\/span><span class="mm-serpill">Mon to Sat<\/span>/);
  assert.doesNotMatch(cardHtml(ev({ series: null }), { now: NOW, phone: true }), /mm-serpill/);
  assert.match(cardHtml(ev(), { now: NOW, phone: false }), /mm-serpill/, "the desktop pop-up too");
});

test("the page loads series.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const a = html.indexOf('src="series.js'), b = html.indexOf('src="app.js');
  assert.ok(a > 0 && b > a, "series.js before app.js");
  assert.match(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"), /"\/series\.js"/);
});

test("today's data: every series reads in plain words", () => {
  const evs = JSON.parse(fs.readFileSync(path.join(SITE, "data", "events.json"), "utf8")).events;
  for (const e of evs) if (e.series && e.status === "upcoming") assert.ok(seriesWords(e.series), "no words for " + e.series.id);
});
