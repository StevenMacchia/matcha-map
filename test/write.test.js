import test from "node:test";
import assert from "node:assert/strict";
import { eventId, mergeEvents, computeStatus } from "../ingest/lib/write.js";
import { parseRobots, robotsAllows } from "../ingest/lib/fetch.js";
import { parseIcs, icsToRaw } from "../ingest/adapters/ics.js";
import { slugDate } from "../ingest/adapters/mato.js";

const now = new Date("2026-11-22T20:00:00Z");
const cand = (o = {}) => ({
  brand: "X", source_id: "x", handle: null, source_url: "https://e.com", title: "T",
  start: "2026-12-06T11:00:00-08:00", end: "2026-12-06T15:00:00-08:00", tz: "America/Los_Angeles", all_day: false,
  venue: "Sunny Books", address: "", city: "Los Angeles", state: "CA", zip: null,
  lat: 34, lng: -118, geocode_source: "nominatim", confidence: "confirmed", extracted_by: "rule", ...o,
});

test("id is stable, 12 hex, venue case-insensitive", () => {
  const a = eventId(cand());
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, eventId(cand({ venue: "SUNNY BOOKS" })));
  assert.notEqual(a, eventId(cand({ start: "2026-12-07T11:00:00-08:00" })));
});
test("merge adds then dedupes and keeps first_seen", () => {
  const first = mergeEvents([], [cand()], { now: new Date("2026-11-01T00:00:00Z") });
  assert.equal(first.events.length, 1);
  const second = mergeEvents(first.events, [cand({ title: "New" })], { now });
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].title, "New");
  assert.equal(second.events[0].first_seen, "2026-11-01T00:00:00.000Z");
  assert.equal(second.events[0].last_seen, now.toISOString());
});
test("same event twice in one run keeps the more confident one", () => {
  const r = mergeEvents([], [cand({ confidence: "unsure", title: "a" }), cand({ confidence: "likely", title: "b" })], { now });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].confidence, "likely");
});
test("confidence drops one step after 14 unseen days, once per 14 days", () => {
  const seen = mergeEvents([], [cand()], { now: new Date("2026-11-01T00:00:00Z") }).events;
  const live = ["x"];
  const d13 = mergeEvents(seen, [], { now: new Date("2026-11-14T00:00:00Z"), liveSourceIds: live });
  assert.equal(d13.events[0].confidence, "confirmed");
  const d15 = mergeEvents(seen, [], { now: new Date("2026-11-16T00:00:00Z"), liveSourceIds: live });
  assert.equal(d15.events[0].confidence, "likely");
  const d16 = mergeEvents(d15.events, [], { now: new Date("2026-11-17T00:00:00Z"), liveSourceIds: live, decay: d15.decay });
  assert.equal(d16.events[0].confidence, "likely"); // not repeated
  const d29 = mergeEvents(d16.events, [], { now: new Date("2026-11-30T00:00:00Z"), liveSourceIds: live, decay: d16.decay });
  assert.equal(d29.events[0].confidence, "unsure");
});
test("no decay when the source was not live this run", () => {
  const seen = mergeEvents([], [cand()], { now: new Date("2026-11-01T00:00:00Z") }).events;
  const r = mergeEvents(seen, [], { now: new Date("2026-11-30T00:00:00Z"), liveSourceIds: [] });
  assert.equal(r.events[0].confidence, "confirmed");
});
test("seeing it again resets decay", () => {
  const seen = mergeEvents([], [cand()], { now: new Date("2026-11-01T00:00:00Z") });
  const dec = mergeEvents(seen.events, [], { now: new Date("2026-11-16T00:00:00Z"), liveSourceIds: ["x"] });
  const back = mergeEvents(dec.events, [cand()], { now: new Date("2026-11-17T00:00:00Z"), liveSourceIds: ["x"], decay: dec.decay });
  assert.equal(back.events[0].confidence, "confirmed");
  assert.deepEqual(back.decay, {});
});
test("status and 30-day expiry", () => {
  const e = cand();
  assert.equal(computeStatus(e, now), "upcoming");
  assert.equal(computeStatus(e, new Date("2026-12-07T00:00:00Z")), "past");
  assert.equal(computeStatus({ ...e, status: "cancelled" }, now), "cancelled");
  const kept = mergeEvents([], [cand()], { now: new Date("2027-01-05T00:00:00Z") });
  assert.equal(kept.events[0].status, "past");
  const gone = mergeEvents(kept.events, [], { now: new Date("2027-01-10T00:00:00Z") });
  assert.equal(gone.events.length, 0);
  assert.equal(gone.stats.dropped, 1);
});
test("output is sorted by start and has only schema keys", () => {
  const r = mergeEvents([], [cand({ start: "2026-12-20T10:00:00-08:00", end: null, venue: "B" }), cand({ venue: "A" })], { now });
  assert.deepEqual(r.events.map((e) => e.venue), ["A", "B"]);
  assert.equal(Object.keys(r.events[0]).length, 23);
});

test("robots rules: longest match wins, wildcards", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /api/\nDisallow: /*?\nAllow: /api/public");
  assert.equal(robotsAllows(rules, "/venue/x"), true);
  assert.equal(robotsAllows(rules, "/api/x"), false);
  assert.equal(robotsAllows(rules, "/api/public"), true);
  assert.equal(robotsAllows(rules, "/a?b=1"), false);
});
test("ics parse", () => {
  const ics = "BEGIN:VEVENT\nDTSTART:20261129T170000Z\nDTEND:20261129T190000Z\nSUMMARY:Pop-up\nLOCATION:1 A St\\, Austin\nEND:VEVENT";
  assert.equal(parseIcs(ics).length, 1);
  const [r] = icsToRaw(ics, { home_city: "Austin", home_state: "TX" }, 0);
  assert.equal(r.hints.start, "2026-11-29T11:00:00-06:00");
});
test("mato slug dates", () => {
  assert.equal(slugDate("holiday-cookie-buffet-14-dec-2026"), Date.UTC(2026, 11, 14));
  assert.equal(slugDate("matcha-pilates-social-2026-10-24"), Date.UTC(2026, 9, 24));
  assert.equal(slugDate("no-date"), null);
});
