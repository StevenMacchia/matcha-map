import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { unsureTable, isSettled, settledKey, readReview, readSettled, effectiveConfidence, PROMOTE } from "../ingest/lib/review.js";

const item = (o = {}) => ({ brand: "B", title: "B pop-up", start: "2026-12-05T11:00:00-06:00", source_url: "https://ma.to/event/b-1", evidence: ["https://ma.to/event/b-1"], confidence: "unsure", notes: "found by mato", _file: "2026-11-23.json", ...o });
const NOW = new Date("2026-11-23T12:00:00Z");

test("a settled item is keyed by page URL and day; social posts never key", () => {
  assert.equal(settledKey(item()), "https://ma.to/event/b-1|2026-12-05");
  assert.equal(settledKey(item({ source_url: "https://www.instagram.com/p/x/", evidence: ["https://www.instagram.com/p/x/", "https://site.example/e"] })), "https://site.example/e|2026-12-05");
});

test("settled.json, a dropped note, or a recent checked note settles an item; an old checked note does not", () => {
  const settled = new Map([["https://ma.to/event/b-1|2026-12-05", { verdict: "dropped", why: "class" }]]);
  assert.equal(isSettled(item(), settled, NOW), true);
  assert.equal(isSettled(item({ source_url: "https://ma.to/event/other", evidence: [] }), settled, NOW), false);
  assert.equal(isSettled(item({ notes: "dropped: a class; found by mato" }), new Map(), NOW), true);
  assert.equal(isSettled(item({ notes: "checked 2026-11-20: page shows no venue" }), new Map(), NOW), true);
  assert.equal(isSettled(item({ notes: "checked 2026-10-01: page shows no venue" }), new Map(), NOW), false);
  assert.equal(isSettled(item(), new Map(), NOW), false);
});

test("the table lists only open items, and a promotable item is never in it", () => {
  const items = [item(), item({ source_url: "https://ma.to/event/c", evidence: [], title: "C" }), item({ confidence: "likely", source_url: "https://ma.to/event/d", evidence: [] })];
  const settled = new Map([["https://ma.to/event/b-1|2026-12-05", { verdict: "dropped" }]]);
  const { rows } = unsureTable(items, settled);
  assert.deepEqual(rows.map((r) => r.title), ["C"]);
});

test("data/review: the open queue is under 20 and every settled entry has a reason", () => {
  const items = readReview();
  const { rows } = unsureTable(items, readSettled());
  assert.ok(rows.length < 20, `${rows.length} open review items`);
  const file = JSON.parse(fs.readFileSync("data/review/settled.json", "utf8"));
  assert.ok(file.settled.length > 0);
  for (const s of file.settled) {
    assert.ok(s.url && s.day && ["dropped", "promoted", "past"].includes(s.verdict) && String(s.why || "").length > 8, JSON.stringify(s));
  }
  assert.ok(items.some((i) => PROMOTE.has(effectiveConfidence(i))), "promotable items exist");
});
