// One run at a time in a checkout. The daily run (ingest/daily.js) holds .cache/daily.lock for its whole run and the hourly watch task
// (ingest/watch.js) skips while it is there: the daily run has its own watch step, and both write data/watchlist.json and site/data/brands.json
// (on 2026-11-24 the hourly task fired at 13:16 inside the 13:00 run). The watch task holds .cache/watch.lock while it runs; the daily run
// waits for it, up to five minutes, before its pull step. A lock older than STALE_MS counts as gone (a killed process). The daily run's
// own children carry MATCHA_DAILY_CHILD=1 and ignore the daily lock.
import fs from "node:fs";
import path from "node:path";

export const STALE_MS = { daily: 3 * 3600e3, watch: 15 * 60e3 };
export const lockPath = (root, name) => path.join(root, ".cache", `${name}.lock`);

// { pid, started, age } while a fresh lock is held, else null.
export function readLock(root, name, now = Date.now()) {
  try {
    const j = JSON.parse(fs.readFileSync(lockPath(root, name), "utf8"));
    const age = now - Date.parse(j.started);
    return Number.isFinite(age) && age < (STALE_MS[name] || STALE_MS.watch) ? { ...j, age } : null;
  } catch { return null; }
}

// Writes the lock; returns the release function (removes the lock only if this process still owns it).
export function acquire(root, name, now = Date.now()) {
  const p = lockPath(root, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, started: new Date(now).toISOString() }) + "\n");
  return () => { try { if (JSON.parse(fs.readFileSync(p, "utf8")).pid === process.pid) fs.unlinkSync(p); } catch { /* gone */ } };
}

// Waits while a fresh lock is held; resolves null once it is gone, or the lock still held after maxMs.
export async function waitFor(root, name, { maxMs = 5 * 60e3, stepMs = 10e3, log = () => {}, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = now();
  for (;;) {
    const l = readLock(root, name, now());
    if (!l) return null;
    if (now() - t0 >= maxMs) return l;
    log(`waiting for the ${name} run (pid ${l.pid}, ${Math.round(l.age / 1000)}s old)`);
    await sleep(stepMs);
  }
}
