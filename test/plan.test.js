// The dry planner behind `npm run watch -- --dry`: pure, on a fixture watch list. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { planWatch, formatPlan, RUNS_PER_DAY } from "../ingest/lib/plan.js";

const NOW = new Date("2026-11-25T12:00:00Z");
const acc = (handle, o = {}) => ({ handle, platform: "instagram", status: "candidate", hits: 0, last_checked: null, graph_checked_at: null, ...o });
const real = Array.from({ length: 150 }, (_, i) => acc(`real${i}`));
const guessed = Array.from({ length: 40 }, (_, i) => acc(`guess${i}`, { guess: true }));
const accounts = [
  acc("hit", { status: "watching", hits: 3, last_checked: "2026-11-01T00:00:00Z", graph_checked_at: "2026-11-01T00:00:00Z" }),
  acc("fresh", { status: "watching", last_checked: "2026-11-25T11:00:00Z", graph_checked_at: "2026-11-25T11:00:00Z" }), // checked an hour ago: not due
  acc("gone", { status: "dropped" }),
  acc("tt", { platform: "tiktok" }),
  acc("refused", { graph_error_at: "2026-11-24T00:00:00Z" }), // Graph said no yesterday: skipped for 7 days
  ...guessed, ...real,
];
const run = (o = {}) => planWatch({ accounts, now: NOW, tags: ["matchapopup", "matchacart"], hashtagCalls: 90, ...o });

test("a fresh slot: 180 calls, 90 to hashtags, 90 to accounts", () => {
  const p = run();
  assert.equal(p.allowance, 180);
  assert.equal(p.accountCalls, 90);
  assert.equal(p.hashtagCalls + p.accountCalls, 180);
});

test("order: accounts with hits first, real brands before guessed, guessed capped per run", () => {
  assert.equal(run().reads.filter((a) => a.guess).length, 0); // 90 slots all go to real brands first
  const p = run({ tags: [], hashtagCalls: 0 }); // 180 slots: 1 hit + 150 real + 15 guessed
  const names = p.reads.map((a) => a.handle);
  assert.equal(names[0], "hit");
  assert.equal(names.filter((h) => h.startsWith("guess")).length, 15);
  assert.ok(names.indexOf("real149") < names.indexOf("guess0"));
  assert.equal(p.waiting.guessed, 25);
});

test("never planned: dropped, TikTok, not due, or refused by Graph this week", () => {
  const names = run().reads.map((a) => a.handle);
  for (const h of ["gone", "tt", "fresh", "refused"]) assert.ok(!names.includes(h), h);
});

test("calls already used this hour come off the run, hashtags first", () => {
  const p = run({ used: 138 });
  assert.equal(p.allowance, 42);
  assert.equal(p.accountCalls, 0);
  assert.equal(run({ used: 100 }).accountCalls, 0);
  assert.equal(run({ used: 60, hashtagCalls: 20 }).accountCalls, 100);
});

test("days to first coverage follow the per-run room and the guessed cap", () => {
  const p = run();
  assert.equal(p.firstRead.real, 150); // "hit" and "fresh" were read, "refused" is skipped for the week
  assert.equal(p.firstRead.guessed, 40);
  assert.equal(p.firstRead.runs, Math.max(Math.ceil(p.firstRead.real / 75), Math.ceil(40 / 15)));
  assert.equal(p.firstRead.days, p.firstRead.runs / RUNS_PER_DAY);
});

test("no hashtags in the slot leaves the whole allowance to accounts", () => {
  assert.equal(run({ tags: [], hashtagCalls: 0 }).accountCalls, 166); // everything due that fits: capped by the list, not the budget
  assert.equal(run({ tags: [], hashtagCalls: 0, guessCap: 100 }).accountCalls, 180); // then by the budget
});

test("graph off: nothing to read", () => {
  assert.equal(run({ graphOn: false }).accountCalls, 0);
});

test("formatPlan prints the numbers a person checks", () => {
  const t = formatPlan(run());
  assert.match(t, /180 calls/);
  assert.match(t, /1\. @hit/);
  assert.match(t, /never read by Graph/);
});
