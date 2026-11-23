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
