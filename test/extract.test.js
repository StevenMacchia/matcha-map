import test from "node:test";
import assert from "node:assert/strict";
import { extract, parseAddress, findTime, splitPlace } from "../ingest/lib/extract.js";
import { tzFor, zonedIso, isoLocal } from "../ingest/lib/tz.js";

const source = { brand: "X Matcha", home_city: "Los Angeles", home_state: "CA", instagram: "xmatcha", tiktok: null };
const now = "2026-11-22T20:00:00Z"; // Sunday
const ex = (text, extra = {}) => extract({ source_url: "https://e.com/p", text, ...extra }, { source, now });

test("explicit date, time range, @venue and address", () => {
  const [e] = ex("Sat Nov 28, 11am-3pm at @sunnybooks 123 Main St, Los Angeles, CA 90012");
  assert.equal(e.start, "2026-11-28T11:00:00-08:00");
  assert.equal(e.end, "2026-11-28T15:00:00-08:00");
  assert.equal(e.venue, "@sunnybooks");
  assert.equal(e.address, "123 Main St");
  assert.equal(e.zip, "90012");
  assert.equal(e.confidence, "confirmed");
  assert.equal(e.extracted_by, "rule");
});
test("numeric date and bare time", () => {
  const [e] = ex("11/29 at 4");
  assert.equal(e.start, "2026-11-29T16:00:00-08:00");
});
test("day-month form", () => {
  const [e] = ex("29 Nov 2pm");
  assert.equal(e.start, "2026-11-29T14:00:00-08:00");
});
test("long weekday form is date-only", () => {
  const [e] = ex("Saturday, November 28th");
  assert.equal(e.start, "2026-11-28T00:00:00-08:00");
  assert.equal(e.all_day, true);
});
test("date range makes one event per day", () => {
  const r = ex("Nov 29-30 11:00 AM to 3 PM");
  assert.deepEqual(r.map((x) => x.start.slice(0, 10)), ["2026-11-29", "2026-11-30"]);
  assert.equal(r[1].end, "2026-11-30T15:00:00-08:00");
});
test("list with ampersand keeps just two days", () => {
  const r = ex("Dec 5 & 7 from 10 until sold out");
  assert.deepEqual(r.map((x) => x.start.slice(0, 10)), ["2026-12-05", "2026-12-07"]);
  assert.equal(r[0].start.slice(11, 16), "10:00");
  assert.equal(r[0].end, null);
});
test("multiple dates in one caption", () => {
  const r = ex("Pop-ups: Dec 6 11am-2pm and Dec 13 noon-3pm");
  assert.equal(r.length, 2);
  assert.equal(r[1].start, "2026-12-13T12:00:00-08:00");
});
test("relative words resolve against now", () => {
  assert.equal(ex("tomorrow 10am")[0].start, "2026-11-23T10:00:00-08:00");
  assert.equal(ex("this Saturday 11-3pm")[0].start, "2026-11-28T11:00:00-08:00");
  assert.equal(ex("next Saturday")[0].start.slice(0, 10), "2026-12-05");
  assert.equal(ex("this weekend")[0].start.slice(0, 10), "2026-11-22");
});
test("relative words resolve against published_at when given", () => {
  const [e] = ex("tomorrow 10am", { published_at: "2026-12-01T18:00:00Z" });
  assert.equal(e.start.slice(0, 10), "2026-12-02");
});
test("recurring talk is not an event", () => {
  assert.equal(ex("we are here every Saturday").length, 0);
});
test("year inference: next occurrence, never past", () => {
  assert.equal(ex("Jan 10 11am")[0].start.slice(0, 4), "2027");
  assert.equal(ex("Dec 6 11am")[0].start.slice(0, 4), "2026");
  assert.equal(ex("Nov 22 11am")[0].start.slice(0, 4), "2026"); // today stays this year
});
test("explicit year may be past", () => {
  assert.equal(ex("Nov 29, 2025 11am")[0].start.slice(0, 10), "2025-11-29");
});
test("times", () => {
  assert.deepEqual(findTime("11am-3pm").start, { h: 11, mi: 0 });
  assert.deepEqual(findTime("11-3pm").start, { h: 11, mi: 0 });
  assert.deepEqual(findTime("11-3pm").end, { h: 15, mi: 0 });
  assert.deepEqual(findTime("from 10").start, { h: 10, mi: 0 });
  assert.equal(findTime("noon").start.h, 12);
  assert.equal(findTime("until sold out 10am").untilSoldOut, true);
  assert.equal(findTime("no time here"), null);
});
test("address with suite, city, state, zip", () => {
  const a = parseAddress("Matcha & Creme, 10455 N Central Expy Ste 106, Dallas, TX 75230, USA");
  assert.equal(a.address, "10455 N Central Expy Ste 106");
  assert.equal(a.city, "Dallas");
  assert.equal(a.state, "TX");
  assert.equal(a.zip, "75230");
  assert.equal(parseAddress("no address here"), null);
});
test("place split", () => {
  assert.deepEqual(splitPlace("@citycovestudios, Fredericksburg, VA"), { venue: "@citycovestudios", city: "Fredericksburg", state: "VA" });
});
test("city and timezone come from the address, not the brand home", () => {
  const [e] = ex("Dec 6 11am-2pm 500 Elm St, Dallas, TX 75201");
  assert.equal(e.city, "Dallas");
  assert.equal(e.tz, "America/Chicago");
  assert.equal(e.start, "2026-12-06T11:00:00-06:00");
});
test("no address falls back to home city and unsure", () => {
  const [e] = ex("Dec 6 11am");
  assert.equal(e.city, "Los Angeles");
  assert.equal(e.confidence, "unsure");
});
test("structured date and time with a named venue is likely", () => {
  const [e] = extract({ source_url: "u", text: "Cookie night", hints: { start: "2026-12-14T17:00:00-05:00", venue: "@citycove, Fredericksburg, VA" } }, { source, now });
  assert.equal(e.confidence, "likely");
  assert.equal(e.state, "VA");
  assert.equal(e.tz, "America/New_York");
});
test("website stale guard drops far-ahead year-less dates", () => {
  assert.equal(ex("Feb 1 10am", { maxAheadDays: 60 }).length, 0);
  assert.equal(ex("Dec 12 10am", { maxAheadDays: 60 }).length, 1);
});

test("tz lookup", () => {
  assert.equal(tzFor({ state: "HI" }), "Pacific/Honolulu");
  assert.equal(tzFor({ city: "El Paso", state: "TX" }), "America/Denver");
  assert.equal(tzFor({ city: "Dallas", state: "TX" }), "America/Chicago");
  assert.equal(tzFor({ state: "ZZ" }), null);
  assert.equal(zonedIso("America/New_York", 2026, 7, 4, 12, 0), "2026-07-04T12:00:00-04:00");
  assert.equal(zonedIso("America/New_York", 2026, 12, 4, 12, 0), "2026-12-04T12:00:00-05:00");
  assert.equal(isoLocal("2026-11-22T19:00:00Z", "America/Chicago"), "2026-11-22T13:00:00-06:00");
});
