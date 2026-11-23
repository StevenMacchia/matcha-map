// The dry planner behind `npm run watch -- --dry`: pure, on a fixture watch list. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { planWatch, formatPlan, hashtagBudget, RUNS_PER_DAY, BACKLOG_LIMIT, HASHTAG_SHARE } from "../ingest/lib/plan.js";

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

test("a fresh slot with a big backlog: 180 calls, hashtags capped at 30, 150 to accounts", () => {
  const p = run(); // 190 never-read accounts, far over BACKLOG_LIMIT
  assert.equal(p.allowance, 180);
  assert.equal(p.hashtagCalls, HASHTAG_SHARE);
  assert.equal(p.accountCalls, 150);
  assert.equal(p.hashtagCalls + p.accountCalls, 180);
});

test("order: never-read accounts first, real brands before guessed, guessed capped per run, then re-reads", () => {
  assert.equal(run().reads.filter((a) => a.guess).length, 0); // 150 slots: the hit and 149 of the 150 real brands, no room left for guessed
  const p = run({ tags: [], hashtagCalls: 0 }); // 180 slots: 1 hit + 150 real + 15 guessed
  const names = p.reads.map((a) => a.handle);
  assert.equal(names[0], "real0"); // "hit" was read before, so it waits behind the never-read backlog
  assert.equal(names.at(-1), "hit");
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
  assert.equal(p.accountCalls, 12); // 30 hashtag calls come first
  assert.equal(run({ used: 100 }).accountCalls, 50);
  assert.equal(run({ used: 160 }).accountCalls, 0);
  assert.equal(run({ used: 60, hashtagCalls: 20 }).accountCalls, 100);
});

test("days to first coverage follow the per-run room and the guessed cap", () => {
  const p = run();
  assert.equal(p.firstRead.real, 150); // "hit" and "fresh" were read, "refused" is skipped for the week
  assert.equal(p.firstRead.guessed, 40);
  assert.equal(p.firstRead.runs, Math.max(Math.ceil(p.firstRead.real / (150 - 15)), Math.ceil(40 / 15)));
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
  assert.match(t, /1\. @real0 \(candidate, first read\)/);
  assert.match(t, /never read by Graph/);
});

// ---- never-read accounts first, hashtag share, unreadable ----------------------------------------
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const readAcc = (handle, ago, o = {}) => acc(handle, { status: "watching", hits: 2, last_checked: day(ago), graph_checked_at: day(ago), cadence_hours: 24, ...o });

test("never-read accounts come before accounts with hits, then the longest since their last read", () => {
  const list = [readAcc("hit-3d", 3), readAcc("hit-9d", 9), acc("never-a"), acc("never-b", { status: "watching" }), readAcc("hit-5d", 5)];
  const names = planWatch({ accounts: list, now: NOW }).reads.map((a) => a.handle);
  assert.deepEqual(names, ["never-b", "never-a", "hit-9d", "hit-5d", "hit-3d"]); // watching before candidate inside the backlog
});

test("a never-read account whose last_checked is old still goes before one that Graph read", () => {
  const list = [readAcc("read", 30), acc("tavily-only", { last_checked: day(40) })];
  assert.equal(planWatch({ accounts: list, now: NOW }).reads[0].handle, "tavily-only");
});

test("hashtag reads are capped at 30 calls while 50 or more accounts are never read, and get 90 back under 50", () => {
  const mk = (n) => [...Array.from({ length: n }, (_, i) => acc(`n${i}`)), readAcc("old", 3)];
  assert.equal(planWatch({ accounts: mk(BACKLOG_LIMIT), now: NOW, tags: ["a"], hashtagCalls: 90 }).hashtagCalls, 30);
  const under = planWatch({ accounts: mk(BACKLOG_LIMIT - 1), now: NOW, tags: ["a"], hashtagCalls: 90 });
  assert.equal(under.hashtagCalls, 90);
  assert.equal(under.accountCalls, 50); // the 49 never-read and the one old read all fit in 180 - 90
  assert.equal(hashtagBudget(49, 90), 90);
  assert.equal(hashtagBudget(50, 90), 30);
  assert.equal(hashtagBudget(500, 20), 20); // never raises a smaller budget
});

test("unreadable accounts are never planned, counted, and not part of the backlog", () => {
  const list = [acc("ok"), acc("personal", { status: "unreadable", graph_error: "Graph API HTTP 400: Invalid user id", graph_error_at: "2026-01-01T00:00:00Z" })];
  const p = planWatch({ accounts: list, now: NOW, all: true });
  assert.deepEqual(p.reads.map((a) => a.handle), ["ok"]);
  assert.equal(p.unreadable, 1);
  assert.equal(p.backlog.count, 1); // the 7-day skip would be long over; unreadable stays out
});

test("the plan says how many runs the backlog needs at this run's allowance", () => {
  const list = Array.from({ length: 300 }, (_, i) => acc(`r${i}`));
  const p = planWatch({ accounts: list, now: NOW, tags: ["a"], hashtagCalls: 90, guessCap: 15 });
  assert.equal(p.backlog.count, 300);
  assert.equal(p.backlog.runsFresh, Math.ceil(300 / (150 - 15)));
  assert.equal(planWatch({ accounts: list, now: NOW, tags: ["a"], hashtagCalls: 90, used: 100 }).backlog.runsNow, Math.ceil(300 / (50 - 15))); // 80 left, 30 for hashtags
  const t = formatPlan(p);
  assert.match(t, /backlog: 300 never-read accounts; 3 runs/);
  assert.match(t, /hashtag reads capped at 30 calls until the backlog is under 50/);
});
