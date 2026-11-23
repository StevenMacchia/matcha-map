import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyAdditions } from "../tools/apply-watchlist-additions.js";
import * as wl from "../ingest/lib/watchlist.js";

const additions = [
  { handle: "NewBrand", platform: "instagram", status: "candidate", source_id: "new-brand", city: "Dallas", state: "TX", reason: "r", evidence: "https://example.com/p", added: "2026-11-22" },
  { handle: "existing", platform: "instagram", status: "candidate", reason: "dup" },
  { handle: "newbrand", platform: "instagram", reason: "same handle twice" },
  { handle: "newbrand", platform: "tiktok", reason: "other platform", evidence: "https://example.com/t" },
];
const list = () => ({ updated: "x", accounts: [wl.newAccount({ handle: "Existing" })] });

test("applyAdditions adds new handles, skips existing ones, case-insensitively", () => {
  const w = list();
  const r = applyAdditions(w, additions, { sourceIds: new Set() });
  assert.deepEqual(r, { added: 2, skipped: 2 });
  assert.equal(w.accounts.length, 3);
  const a = w.accounts[1];
  assert.equal(a.handle, "NewBrand"); assert.equal(a.status, "candidate"); assert.equal(a.source_id, null);
  assert.equal(a.found_via, "manual"); assert.equal(a.cadence_hours, 72);
  assert.match(a.notes, /Dallas, TX \| r \| evidence: https:\/\/example.com\/p/);
  assert.equal(w.accounts[2].platform, "tiktok");
});

test("source_id is kept only when it exists in sources.json; second run changes nothing", () => {
  const w = list();
  applyAdditions(w, additions, { sourceIds: new Set(["new-brand"]) });
  assert.equal(w.accounts[1].source_id, "new-brand");
  const snap = JSON.stringify(w);
  assert.deepEqual(applyAdditions(w, additions), { added: 0, skipped: 4 });
  assert.equal(JSON.stringify(w), snap);
});

test("CLI merges into a copy, keeps formatting, and is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wla-"));
  const f = path.join(dir, "watchlist.json"), a = path.join(dir, "add.json");
  fs.writeFileSync(f, JSON.stringify(list(), null, 2) + "\n");
  fs.writeFileSync(a, JSON.stringify({ generated: "2026-11-22", additions }));
  const run = () => execFileSync("node", [path.resolve("tools/apply-watchlist-additions.js"), a, f], { encoding: "utf8" });
  assert.match(run(), /added 2, already present 2/);
  const once = fs.readFileSync(f, "utf8");
  assert.ok(once.endsWith("}\n") && once.includes('\n  "accounts": ['));
  assert.match(run(), /added 0, already present 4/);
  assert.equal(fs.readFileSync(f, "utf8"), once);
});
