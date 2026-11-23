// functions/_middleware.js: the old host and www answer 301 to the same path on https://matchamap.app; the canonical host and previews pass through.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequest, redirectFor } from "../functions/_middleware.js";

const req = (u, m = "GET") => new Request(u, { method: m });

test("the old pages.dev host and www redirect permanently to the same path and query on the canonical host", async () => {
  for (const [from, to] of [
    ["https://matchamap-cu7.pages.dev/", "https://matchamap.app/"],
    ["https://matchamap-cu7.pages.dev/city/nc/raleigh/?x=1", "https://matchamap.app/city/nc/raleigh/?x=1"],
    ["https://www.matchamap.app/promote/?event=abc123def456", "https://matchamap.app/promote/?event=abc123def456"],
    ["http://www.matchamap.app/feeds/all.ics", "https://matchamap.app/feeds/all.ics"],
  ]) {
    const r = redirectFor(req(from));
    assert.ok(r, from);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), to);
  }
});

test("the canonical host and preview deployments pass through to next()", async () => {
  let passed = 0;
  const next = async () => { passed++; return new Response("ok"); };
  for (const u of ["https://matchamap.app/", "https://matchamap.app/api/rsvp?events=", "https://debb1a84.matchamap-cu7.pages.dev/city/tx/austin/", "http://localhost:8788/"]) {
    const r = await onRequest({ request: req(u), next });
    assert.equal(r.status, 200, u);
  }
  assert.equal(passed, 4);
  const r = await onRequest({ request: req("https://matchamap-cu7.pages.dev/e/abc123def456/"), next });
  assert.equal(r.status, 301);
  assert.equal(passed, 4, "a redirect never calls next()");
});
