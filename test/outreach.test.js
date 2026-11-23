import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, claimLink, toCsv, COLS, SITE } from "../tools/outreach.js";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const sources = [
  { id: "a", brand: "Alpha Matcha", instagram: "alpha", kind: "popup", category: "matcha", home_city: "Denver", home_state: "CO", active: true },
  { id: "b", brand: "Beta Cafe", instagram: "beta", kind: "cafe", category: "matcha", home_city: "Austin", home_state: "TX", active: true },
  { id: "c", brand: "Gone", instagram: "gone", active: false },
];
const events = [
  { id: "e1", source_id: "a", start: "2026-12-05T10:00:00-07:00", city: "Denver", state: "CO" },
  { id: "e2", source_id: "b", start: "2026-10-01T10:00:00-05:00", city: "Austin", state: "TX" },
  ...Array.from({ length: 9 }, (_, i) => ({ id: "x" + i, source_id: "z", start: "2026-12-01T10:00:00-06:00", city: "Austin", state: "TX" })),
];
const watchlist = { accounts: [{ handle: "alpha", platform: "instagram", name: "Alpha", status: "watching", last_post_with_popup: "2026-11-20T10:00:00Z", followers_count: 1200 }, { handle: "dropped1", platform: "instagram", name: "D", status: "dropped" }] };

test("claim link carries the brand and the handle, url-encoded", () => {
  assert.equal(claimLink("Matcha LUV", "matchaluv.dsm"), `${SITE}/claim/?brand=Matcha%20LUV&handle=%40matchaluv.dsm`);
  assert.equal(claimLink("No Handle", ""), `${SITE}/claim/?brand=No%20Handle`);
});

test("rows: active sources only, thin city and a coming pop-up rank first, claims are yes, no or unknown", () => {
  const rows = buildRows({ sources, events, watchlist, claims: [{ brand: "Beta Cafe", handle: "" }], now: NOW });
  assert.deepEqual(rows.map((r) => r.handle), ["alpha", "beta"]);
  assert.equal(rows[0].upcoming_events, 1);
  assert.equal(rows[0].last_dated_post_seen, "2026-12-05");
  assert.equal(rows[0].active, "yes");
  assert.equal(rows[1].has_claim, "yes");
  assert.equal(rows[0].has_claim, "no");
  assert.equal(buildRows({ sources, events, watchlist, claims: null, now: NOW })[0].has_claim, "unknown");
});

test("csv quotes commas, quotes and keeps the column order", () => {
  const out = toCsv([{ brand: 'A, "B"', handle: "x" }], ["brand", "handle"]);
  assert.equal(out, 'brand,handle\r\n"A, ""B""",x\r\n');
  assert.ok(COLS.includes("claim_link"));
});
