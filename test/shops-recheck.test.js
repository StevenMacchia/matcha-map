import { test } from "node:test";
import assert from "node:assert/strict";
import { datesIn, judge } from "../ingest/shops-recheck.js";

test("datesIn reads ISO and written dates; a date without a year is 2026", () => {
  assert.deepEqual(datesIn("Open since 2026-11-21. Closed Nov 8, 2026 and November 27th. Sept 3, 2025"), ["2025-09-03", "2026-11-08", "2026-11-21", "2026-11-27"]);
});

test("judge flags a Matcha Toko page and dates after the cutoff, and ignores earlier ones", () => {
  const live = judge("<html><body><p>Welcome to Matcha Toko</p><p>Hours updated Nov 21, 2026: 10am to 6pm</p></body></html>", "2026-11-08");
  assert.equal(live.toko, true);
  assert.deepEqual(live.after, ["2026-11-21"]);
  const old = judge("<html><body><p>Matcha Cafe Maiko</p><p>Copyright 2024. Menu as of Aug 2, 2025.</p></body></html>", "2026-11-08");
  assert.equal(old.toko, false);
  assert.deepEqual(old.after, []);
  assert.equal(judge("<p>This location is temporarily closed</p>", "2026-11-08").closed, true);
});
