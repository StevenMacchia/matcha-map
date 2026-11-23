import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicate, mergeDuplicateEvents, meters } from "../ingest/lib/dedupe.js";
import { mergeEvents } from "../ingest/lib/write.js";

const ev = (o) => ({
  id: "e" + Math.random().toString(36).slice(2, 8), brand: "Whisk Co", handle: null, source_id: "whisk", title: "Whisk Co pop-up", start: "2026-12-05T11:00:00-06:00", end: null, tz: "America/Chicago", all_day: false,
  venue: "Town Hall", address: "", city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431, approx: false, geocode_source: "nominatim", confidence: "likely", status: "upcoming",
  first_seen: "2026-11-20T00:00:00Z", last_seen: "2026-11-22T00:00:00Z", extracted_by: "rule", evidence: [], menu: [], posts: {}, links: {}, ...o,
});
const cityOnly = (o = {}) => ev({ venue: "", approx: true, geocode_source: "none", confidence: "unsure", all_day: true, start: "2026-12-05T00:00:00-06:00", ...o });

test("same brand, day, city and venue text or 200 m: duplicate; 300 m apart at another venue is not", () => {
  const a = ev({});
  assert.ok(isDuplicate(a, ev({ venue: "town hall" })));
  assert.ok(isDuplicate(a, ev({ venue: "Hall Annex", lat: 30.2681, lng: -97.7431 }))); // about 100 m
  assert.ok(meters(a, ev({ lat: 30.2699 })) > 250);
  assert.ok(!isDuplicate(a, ev({ venue: "Other Place", lat: 30.2699 })));
  assert.ok(!isDuplicate(a, ev({ brand: "Another Brand" })));
  assert.ok(!isDuplicate(a, ev({ start: "2026-12-06T11:00:00-06:00" })));
  assert.ok(!isDuplicate(a, ev({ city: "Dallas" })));
});

test("two sessions the same day more than 3 hours apart are two events", () => {
  assert.ok(!isDuplicate(ev({}), ev({ start: "2026-12-05T16:00:00-06:00" })));
  assert.ok(isDuplicate(ev({}), ev({ start: "2026-12-05T13:00:00-06:00" })));
});

test("a city-only record folds into the placed one; two city-only records fold unless they name different places", () => {
  assert.ok(isDuplicate(ev({}), cityOnly()));
  assert.ok(!isDuplicate(ev({}), cityOnly({ venue: "Somewhere Else" })), "a city-only record that names a venue is not the place-less twin");
  assert.ok(isDuplicate(cityOnly(), cityOnly({ id: "other" })));
  assert.ok(!isDuplicate(cityOnly({ venue: "Brick 828" }), cityOnly({ venue: "Pier 9" })));
  assert.ok(isDuplicate(cityOnly({ venue: "Brick 828 (Golden Makers Market)" }), cityOnly({ venue: "@goldenmakersmarket" })));
});

test("the richer record is kept with its id; the twin's lists, image and series fold in", () => {
  const keep = ev({ id: "keep", evidence: ["https://a.example/1"], menu: ["latte"] });
  const twin = cityOnly({ id: "twin", evidence: ["https://b.example/2"], menu: ["ube"], description: "A longer description of the pop-up", series: { id: "s1", rule: "weekly on Saturdays", weekdays: [6], until: null, source_url: "https://e", projected: false }, image: { url: "https://i" } });
  const r = mergeDuplicateEvents([twin, keep]);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].id, "keep");
  assert.deepEqual(r.events[0].evidence, ["https://a.example/1", "https://b.example/2"]);
  assert.deepEqual(r.events[0].menu, ["latte", "ube"]);
  assert.equal(r.events[0].description, "A longer description of the pop-up");
  assert.equal(r.events[0].series.id, "s1");
  assert.equal(r.events[0].image.url, "https://i");
  assert.deepEqual(r.merged.map((m) => [m.kept, m.dropped]), [["keep", "twin"]]);
});

test("a placeless record that merges into a better one adopts its place; confidence takes the higher", () => {
  const a = cityOnly({ id: "a" });
  const b = ev({ id: "b", confidence: "confirmed" });
  const [one] = mergeDuplicateEvents([a, b]).events;
  assert.equal(one.id, "b");
  assert.equal(one.confidence, "confirmed");
  assert.equal(one.approx, false);
});

test("the writer folds duplicates and expires unconfirmed city-only finds a live source stopped showing", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const stale = cityOnly({ id: "stale", source_id: "live-src", brand: "Old Find", start: "2026-12-10T00:00:00-06:00", last_seen: "2026-11-10T00:00:00Z", first_seen: "2026-11-01T00:00:00Z" });
  const manual = cityOnly({ id: "manual", source_id: "live-src", brand: "Hand Entered", start: "2026-12-10T00:00:00-06:00", last_seen: "2026-11-10T00:00:00Z", extracted_by: "manual" });
  const notLive = cityOnly({ id: "nolive", source_id: "other-src", brand: "Quiet Source", start: "2026-12-10T00:00:00-06:00", last_seen: "2026-11-10T00:00:00Z" });
  const twinA = ev({ id: "ta", brand: "Twin Brand", source_id: "t", last_seen: "2026-11-30T00:00:00Z" });
  const twinB = cityOnly({ id: "tb", brand: "Twin Brand", source_id: "t2", last_seen: "2026-11-30T00:00:00Z" });
  const r = mergeEvents([stale, manual, notLive, twinA, twinB], [], { now, liveSourceIds: ["live-src"] });
  const ids = r.events.map((e) => e.id).sort();
  assert.deepEqual(ids, ["manual", "nolive", "ta"]);
  assert.equal(r.stats.expired, 1);
  assert.equal(r.stats.merged, 1);
});
