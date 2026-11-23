import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { needsShrink, needsThumb, run } from "../tools/shrink-images.js";
import { thumbFor } from "../site/img-helper.js";

test("skip logic: small files skip, big or wide files go, indexed files are not retried", () => {
  assert.equal(needsShrink({ size: 100000, width: 800 }), false);
  assert.equal(needsShrink({ size: 300000, width: 800 }), true);
  assert.equal(needsShrink({ size: 100000, width: 2000 }), true);
  assert.equal(needsShrink({ size: 300000, width: 2000 }, { orig: 900000 }), false);
  assert.equal(needsThumb(false), true);
  assert.equal(needsThumb(true), false);
});

test("dry run on a fixture folder counts work without Chrome", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-idx-"));
  const png = Buffer.alloc(400000);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(3000, 16); png.writeUInt32BE(2000, 20);
  fs.writeFileSync(path.join(dir, "a.png"), png);
  const r = await run({ dir, dry: true });
  assert.equal(r.files, 1);
  assert.equal(r.todo, 1);
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ "a.png": { orig: 400000 } }));
  assert.equal((await run({ dir, dry: true })).todo, 0);
});

test("thumbFor maps event pictures and leaves other urls alone", () => {
  assert.equal(thumbFor("img/events/ab.jpg"), "img/events/thumbs/ab.jpg");
  assert.equal(thumbFor("/img/events/ab.webp"), "/img/events/thumbs/ab.webp");
  assert.equal(thumbFor("https://x.com/a.jpg"), "https://x.com/a.jpg");
  assert.equal(thumbFor(null), null);
});
