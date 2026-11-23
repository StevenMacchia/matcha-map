import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrences, limitOf, ruleText, seriesCandidates, endedOccurrences, detectSeries } from "../ingest/lib/series.js";
import { clean } from "../ingest/lib/write.js";

const base = {
  id: "t-sat", brand: "Test Matcha", source_id: "test-matcha", title: "Test Matcha at the Market", weekdays: [6], start_time: "09:00", end_time: "13:00",
  tz: "America/Chicago", from: null, until: null, skip: [], extend: true, horizon_days: 42, confirmed: "2026-11-20", confidence: "likely",
  venue: "Town Market", address: "1 Main St", city: "Austin", state: "TX", lat: 30.27, lng: -97.74, source_url: "https://example.com/find-us",
  evidence: ["https://example.com/find-us"], rule_source: "page says every Saturday",
};
const NOW = new Date("2026-11-23T18:00:00Z"); // Monday 2026-11-23 in Austin

test("an open series runs six weeks from today by weekday, minus skipped days", () => {
  const o = occurrences({ ...base, skip: ["2026-12-05"] }, "2026-11-23");
  assert.deepEqual(o, ["2026-11-28", "2026-12-12", "2026-12-19", "2026-12-26", "2027-01-02"]);
  assert.equal(ruleText({ weekdays: [6, 0] }), "weekly on Sundays, Saturdays");
});

test("a declared until ends it; extend:false never adds dates past the listed window", () => {
  assert.equal(limitOf({ ...base, until: "2026-12-12" }, "2026-11-23"), "2026-12-12");
  assert.deepEqual(occurrences({ ...base, until: "2026-12-12" }, "2026-11-23"), ["2026-11-28", "2026-12-05", "2026-12-12"]);
  assert.equal(limitOf({ ...base, extend: true, until: "2027-06-01" }, "2026-11-23"), "2027-01-04");
});

test("an open-ended series that no source confirmed in 28 days stops adding dates", () => {
  assert.equal(limitOf({ ...base, confirmed: "2026-10-01" }, "2026-11-23"), null);
  assert.deepEqual(occurrences({ ...base, confirmed: "2026-10-01" }, "2026-11-23"), []);
  assert.equal(limitOf({ ...base, extend: false, until: null }, "2026-11-23"), null);
});

test("an ended series stops at its end and from/until bound the dates", () => {
  assert.equal(limitOf({ ...base, ended: "2026-12-01" }, "2026-11-23"), "2026-12-01");
  assert.deepEqual(occurrences({ ...base, from: "2026-12-12", until: "2026-12-19" }, "2026-11-23"), ["2026-12-12", "2026-12-19"]);
});

test("candidates are flagged, merge into a held date and keep its id, and project the rest", () => {
  const held = [{ id: "held-1", brand: "Test Matcha", source_id: "test-matcha", title: "Test Matcha at the Market", start: "2026-11-28T09:00:00-06:00", end: "2026-11-28T13:00:00-06:00", tz: "America/Chicago",
    venue: "Town Market", address: "1 Main St", city: "Austin", state: "TX", lat: 30.27, lng: -97.74, approx: false, confidence: "unsure", status: "upcoming", evidence: [], menu: [], posts: {}, links: {} }];
  const { candidates, stats } = seriesCandidates([{ ...base, until: "2026-12-12", extend: false }], held, { sources: [], now: NOW });
  assert.equal(candidates.length, 3);
  const merged = candidates.find((c) => c.start.startsWith("2026-11-28"));
  assert.equal(merged.id, "held-1");
  assert.equal(merged.series.projected, false);
  assert.equal(merged.confidence, "likely");
  const added = candidates.filter((c) => c.series.projected);
  assert.equal(added.length, 2);
  assert.ok(added.every((c) => c.start.endsWith("-06:00") && c.end && c.series.id === "t-sat" && c.series.until === "2026-12-12"));
  assert.deepEqual(stats, { series: 1, flagged: 1, added: 2, dropped: {} });
});

test("time zone: a Honolulu series is dated in Honolulu, and an all-day series has no times", () => {
  const { candidates } = seriesCandidates([{ ...base, id: "t-hi", tz: "Pacific/Honolulu", state: "HI", city: "Honolulu", start_time: null, end_time: null, weekdays: [0], until: "2026-12-06", extend: false }], [], { sources: [], now: NOW });
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.all_day === true && c.start.endsWith("-10:00")));
});

test("occurrences of a removed or ended series go; past ones and listed ones stay", () => {
  const ev = (id, start, projected) => ({ id, start, tz: "America/Chicago", series: { id: "t-sat", projected } });
  const held = [ev("a", "2026-12-12T09:00:00-06:00", true), ev("b", "2026-11-14T09:00:00-06:00", true), ev("c", "2026-12-12T09:00:00-06:00", false), { id: "d", start: "2026-12-12T09:00:00-06:00" }];
  assert.deepEqual([...endedOccurrences(held, [], NOW)].sort(), ["a"]);
  assert.deepEqual([...endedOccurrences(held, [{ ...base, ended: "2026-12-01" }], NOW)].sort(), ["a", "c"]);
  assert.deepEqual([...endedOccurrences(held, [{ ...base, weekdays: [0] }], NOW)].sort(), ["a", "c"]);
  assert.equal(endedOccurrences(held, [base], NOW).size, 0);
});

test("the writer keeps the series field, and only a real one", () => {
  const e = { id: "x", brand: "B", source_id: "b", title: "t", start: "2026-12-05T09:00:00-06:00", state: "TX", series: { id: "t-sat", rule: "weekly on Saturdays", weekdays: [6], until: null, source_url: "https://e.com", projected: true } };
  assert.equal(clean(e).series.id, "t-sat");
  assert.equal(clean({ ...e, series: {} }).series, null);
  assert.equal(clean({ ...e, series: undefined }).series, null);
});

test("detectSeries lists a repeated weekday at one place that is not recorded yet", () => {
  const ev = (d) => ({ id: d, source_id: "s1", brand: "S", venue: "Pier", city: "Miami", state: "FL", title: "S pop-up", start: `${d}T10:00:00-05:00`, status: "upcoming", source_url: "https://e.com" });
  const found = detectSeries([ev("2026-12-05"), ev("2026-12-12"), ev("2026-12-19"), { ...ev("2026-12-08"), venue: "Dock", source_id: "s2" }], [], "2026-11-23");
  assert.equal(found.length, 1);
  assert.equal(found[0].weekdays, "sat");
  assert.equal(detectSeries([ev("2026-12-05"), ev("2026-12-12"), ev("2026-12-19")], [{ source_id: "s1", venue: "Pier" }], "2026-11-23").length, 0);
});
