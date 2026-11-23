import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { slimData } from "../tools/slim-events.js";

const full = JSON.parse(fs.readFileSync("site/data/events.json", "utf8"));

test("the slim list keeps every event and leaves out the heavy fields", () => {
  const s = slimData(full);
  assert.equal(s.slim, true);
  assert.equal(s.events.length, full.events.length);
  for (const [i, e] of s.events.entries()) {
    assert.equal(e.id, full.events[i].id);
    for (const k of ["description", "posts", "evidence", "links", "source_url", "image_url", "price", "extracted_by", "first_seen", "last_seen"]) assert.equal(e[k], undefined, `${e.id} keeps ${k}`);
    if (e.image) assert.deepEqual(Object.keys(e.image), ["local"]);
    if (e.menu) assert.ok(e.menu.every((m) => typeof m === "string"));
  }
});

test("the committed events-slim.json is current and under 40 percent of events.json", () => {
  const onDisk = JSON.parse(fs.readFileSync("site/data/events-slim.json", "utf8"));
  assert.deepEqual(onDisk.events.map((e) => e.id), full.events.map((e) => e.id));
  assert.ok(fs.statSync("site/data/events-slim.json").size < fs.statSync("site/data/events.json").size * 0.4);
});

test("app.js loads the slim list first and swaps the full records in by id", () => {
  const js = fs.readFileSync("site/app.js", "utf8");
  assert.match(js, /getJSON\("data\/events-slim\.json"\)/);
  assert.match(js, /function landFull/);
  assert.match(js, /it\.data = e;/);
});
