import test from "node:test";
import assert from "node:assert/strict";
import { tidyCity } from "../ingest/lib/names.js";
import { clean } from "../ingest/lib/write.js";

test("tidyCity title-cases an all-lower-case city and leaves mixed case alone", () => {
  assert.equal(tidyCity("philadelphia"), "Philadelphia");
  assert.equal(tidyCity("st. louis"), "St. Louis");
  assert.equal(tidyCity("winston-salem"), "Winston-Salem");
  assert.equal(tidyCity("coeur d'alene"), "Coeur D'Alene");
  assert.equal(tidyCity("McLean"), "McLean");
  assert.equal(tidyCity("DeKalb"), "DeKalb");
  assert.equal(tidyCity("  New  York "), "New York");
  assert.equal(tidyCity(""), null);
  assert.equal(tidyCity(null), null);
});

test("clean() tidies the city so a lower-case listing groups with its city", () => {
  const e = clean({ id: "x", brand: "B", title: "Matcha pop-up", start: "2026-12-01", city: "philadelphia", state: "PA" });
  assert.equal(e.city, "Philadelphia");
});

test("snapApprox moves a city-centre pin when the city file moves the centre, and leaves real pins alone", async () => {
  const { snapApprox } = await import("../ingest/lib/write.js");
  const lookup = (city, state) => (city === "San Francisco" && state === "CA" ? { lat: 37.7793, lng: -122.4193 } : null);
  const sea = { id: "a", city: "San Francisco", state: "CA", lat: 37.7272, lng: -123.0322, approx: true, geocode_source: "none" };
  const real = { id: "b", city: "San Francisco", state: "CA", lat: 37.76, lng: -122.44, approx: false, geocode_source: "nominatim" };
  const r = snapApprox([sea, real], lookup);
  assert.equal(r.moved, 1);
  assert.deepEqual([r.events[0].lat, r.events[0].lng], [37.7793, -122.4193]);
  assert.deepEqual([r.events[1].lat, r.events[1].lng], [37.76, -122.44]);
});
