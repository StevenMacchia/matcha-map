// ingest/lib/runlock.js: the daily run and the hourly watch take turns in a checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquire, readLock, waitFor, lockPath, STALE_MS } from "../ingest/lib/runlock.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "runlock-"));

test("runlock: acquire writes the lock, a stale one counts as gone, release removes only its own", () => {
  const root = tmp();
  assert.equal(readLock(root, "daily"), null);
  const t0 = Date.parse("2026-11-24T18:00:00Z");
  const release = acquire(root, "daily", t0);
  assert.equal(readLock(root, "daily", t0 + 60e3).pid, process.pid);
  assert.equal(readLock(root, "daily", t0 + 60e3).age, 60e3);
  assert.equal(readLock(root, "daily", t0 + STALE_MS.daily + 1), null, "a lock older than STALE_MS is gone (a killed run)");
  // another process took the lock since: release leaves it
  fs.writeFileSync(lockPath(root, "daily"), JSON.stringify({ pid: process.pid + 1, started: new Date(t0).toISOString() }));
  release();
  assert.equal(readLock(root, "daily", t0 + 1000).pid, process.pid + 1);
  fs.unlinkSync(lockPath(root, "daily"));
  const rel2 = acquire(root, "daily", t0);
  rel2();
  assert.equal(fs.existsSync(lockPath(root, "daily")), false);
  fs.writeFileSync(lockPath(root, "watch"), "not json");
  assert.equal(readLock(root, "watch"), null, "a broken lock file is no lock");
});

test("runlock: waitFor returns null once the lock goes, or the lock when it outlasts maxMs", async () => {
  const root = tmp();
  let t = 0;
  const now = () => t;
  acquire(root, "watch", 0);
  const logs = [];
  const sleep = async (ms) => { t += ms; if (t >= 30e3) fs.rmSync(lockPath(root, "watch"), { force: true }); };
  assert.equal(await waitFor(root, "watch", { maxMs: 60e3, stepMs: 10e3, now, log: (m) => logs.push(m), sleep }), null);
  assert.ok(logs.length >= 1 && /waiting for the watch run \(pid \d+, 0s old\)/.test(logs[0]), logs.join("\n"));
  acquire(root, "watch", t);
  const held = await waitFor(root, "watch", { maxMs: 20e3, stepMs: 10e3, now, log: () => {}, sleep: async (ms) => { t += ms; } });
  assert.equal(held.pid, process.pid, "still held after maxMs: the caller goes on");
  assert.equal(await waitFor(root, "none", { now }), null, "no lock, no wait");
});
