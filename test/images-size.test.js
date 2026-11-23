// N7: a download over 2 MB is redrawn smaller instead of dropped; when it cannot be, the remote url stays.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadImages, MAX_BYTES } from "../ingest/lib/images.js";

function png(w, h, size) {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const fetchOf = (buf) => async () => new Response(buf, { status: 200 });

test("a picture over 2 MB is kept when the shrinker brings it under", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-img-"));
  const ev = [{ id: "aaaaaaaaaaaa", image: { url: "https://example.com/a.png" } }];
  const st = await downloadImages(ev, { dir, fetchFn: fetchOf(png(4000, 3000, MAX_BYTES + 10)), shrink: async () => png(1200, 900, 1000) });
  assert.equal(st.downloaded, 1);
  assert.equal(ev[0].image.local, "img/events/aaaaaaaaaaaa.png");
  assert.equal(ev[0].image.width, 1200);
  assert.equal(fs.statSync(path.join(dir, "aaaaaaaaaaaa.png")).size, 1000);
});

test("a picture over 2 MB that cannot be shrunk keeps the remote url", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-img-"));
  const ev = [{ id: "bbbbbbbbbbbb", image: { url: "https://example.com/b.png" } }];
  const st = await downloadImages(ev, { dir, fetchFn: fetchOf(png(4000, 3000, MAX_BYTES + 10)), shrink: async () => null });
  assert.equal(st.failed, 1);
  assert.equal(ev[0].image.local, null);
});
