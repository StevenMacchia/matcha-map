import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { usableBio } from "../ingest/brands-deepen.js";
import { attachBrandExtras, MAX_BYTES } from "../ingest/lib/enrich/brands.js";

test("a usable bio has words and is not a template or cookie line", () => {
  assert.equal(usableBio("Small-batch ceremonial matcha, whisked to order at farmers markets across Austin."), "Small-batch ceremonial matcha, whisked to order at farmers markets across Austin.");
  assert.equal(usableBio("Home"), null);
  assert.equal(usableBio("We use cookies to improve your experience on this website, accept all."), null);
  assert.equal(usableBio("x".repeat(500)), null);
});

test("extras fill only empty fields; the latest dated post is always taken; recent only when empty", () => {
  const brands = [{ handle: "a", bio: "own bio", picture: null, website: null, recent: [] }, { handle: "b", bio: null, picture: "p", website: "w", recent: [{ permalink: "x" }] }, { handle: "c" }];
  const extra = {
    a: { bio: "site bio", bio_source: "https://a.example", picture: "https://a.example/og.jpg", website: "https://a.example", last_dated_post_seen: "2026-12-01", recent: [{ permalink: "https://instagram.com/p/1", image_url: "u", timestamp: "2026-12-01", caption: "c" }] },
    b: { bio: "site bio b", bio_source: "https://b.example", picture: "other", website: "other", recent: [{ permalink: "y" }], last_dated_post_seen: "2026-11-30" },
  };
  const [a, b, c] = attachBrandExtras(brands, extra);
  assert.equal(a.bio, "own bio");
  assert.equal(a.bio_source, undefined);
  assert.equal(a.picture, "https://a.example/og.jpg");
  assert.equal(a.website, "https://a.example");
  assert.equal(a.recent.length, 1);
  assert.equal(a.last_dated_post_seen, "2026-12-01");
  assert.equal(b.bio, "site bio b");
  assert.equal(b.bio_source, "https://b.example");
  assert.equal(b.picture, "p");
  assert.deepEqual(b.recent, [{ permalink: "x" }]);
  assert.deepEqual(c, { handle: "c" });
});

test("the shipped brands.json stays under the size cap", () => {
  assert.ok(fs.statSync("site/data/brands.json").size <= MAX_BYTES * 1.25);
});
