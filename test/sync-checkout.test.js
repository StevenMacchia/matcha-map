// tools/sync-checkout.js against a temp repo with a bare origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sync, classify, plainUnion } from "../tools/sync-checkout.js";

const ID = ["-c", "user.name=t", "-c", "user.email=t@t.test"];
const git = (cwd, ...a) => { const r = spawnSync("git", [...ID, ...a], { cwd, encoding: "utf8" }); assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}`); return r.stdout; };
const put = (cwd, f, t) => { fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true }); fs.writeFileSync(path.join(cwd, f), t); };
const ev = (id, last_seen) => ({ id, last_seen, status: "upcoming" });
const evFile = (events) => JSON.stringify({ generated: "2026-01-01", events }, null, 1) + "\n";

// origin (bare) + a "main" working clone to push from + the plain checkout under test.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
  const origin = path.join(root, "origin.git"), dev = path.join(root, "dev"), plain = path.join(root, "plain");
  git(root, "init", "--bare", "-b", "main", origin);
  git(root, "clone", origin, dev);
  git(dev, "checkout", "-b", "main");
  put(dev, "data/events.json", evFile([ev("a", "2026-11-01"), ev("b", "2026-11-01")]));
  put(dev, "site/city/x/index.html", "v1");
  put(dev, "ingest/code.js", "v1");
  git(dev, "add", "-A"); git(dev, "commit", "-m", "one"); git(dev, "push", "origin", "main");
  git(root, "clone", origin, plain);
  const push = (msg) => { git(dev, "add", "-A"); git(dev, "commit", "-m", msg); git(dev, "push", "origin", "main"); };
  return { root, dev, plain, push, run: (o = {}) => { const lines = []; const r = sync({ cwd: plain, log: (l) => lines.push(l), ...o }); return { ...r, lines }; } };
}

test("a clean checkout behind main fast-forwards; one that already holds main is left alone", () => {
  const t = setup();
  assert.equal(t.run().lines.some((l) => /already holds/.test(l)), true);
  put(t.dev, "ingest/code.js", "v2"); t.push("two");
  const r = t.run();
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(t.plain, "ingest/code.js"), "utf8"), "v2");
  assert.ok(r.lines.some((l) => /fast-forwarded/.test(l)));
});

test("a dirty generated file is discarded and kept in .cache/sync", () => {
  const t = setup();
  put(t.plain, "site/city/x/index.html", "local edit");
  put(t.dev, "site/city/x/index.html", "v2"); t.push("two");
  const r = t.run();
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.equal(fs.readFileSync(path.join(t.plain, "site/city/x/index.html"), "utf8"), "v2");
  const kept = fs.readdirSync(path.join(t.plain, ".cache/sync"));
  assert.equal(fs.readFileSync(path.join(t.plain, ".cache/sync", kept[0], "site/city/x/index.html"), "utf8"), "local edit");
});

test("a dirty events.json is unioned: an event only local survives, main's newer last_seen wins", () => {
  const t = setup();
  put(t.plain, "data/events.json", evFile([ev("a", "2026-11-02"), ev("b", "2026-11-02"), ev("local-only", "2026-11-02")]));
  put(t.dev, "data/events.json", evFile([ev("a", "2026-11-01"), ev("b", "2026-11-09"), ev("main-only", "2026-11-09")])); t.push("two");
  const r = t.run();
  assert.equal(r.ok, true, r.lines.join("\n"));
  const e = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(t.plain, "data/events.json"), "utf8")).events.map((x) => [x.id, x.last_seen]));
  assert.deepEqual(e, { a: "2026-11-02", b: "2026-11-09", "local-only": "2026-11-02", "main-only": "2026-11-09" });
  assert.equal(git(t.plain, "rev-parse", "HEAD"), git(t.dev, "rev-parse", "HEAD"));
});

test("a dirty code file stops the sync, names the file and touches nothing", () => {
  const t = setup();
  put(t.plain, "ingest/code.js", "local code");
  put(t.plain, "site/city/x/index.html", "local page");
  put(t.dev, "ingest/other.js", "x"); t.push("two");
  const before = git(t.plain, "rev-parse", "HEAD");
  const r = t.run();
  assert.equal(r.ok, false);
  assert.ok(r.lines.some((l) => /STOPPED/.test(l) && l.includes("ingest/code.js")), r.lines.join("\n"));
  assert.equal(git(t.plain, "rev-parse", "HEAD"), before);
  assert.equal(fs.readFileSync(path.join(t.plain, "site/city/x/index.html"), "utf8"), "local page");
});

test("an untracked file in the way of a new tracked path is moved aside; dry changes nothing", () => {
  const t = setup();
  put(t.plain, "data/new-state.json", JSON.stringify({ mine: 1 }));
  put(t.dev, "data/new-state.json", JSON.stringify({ theirs: 1 })); t.push("two");
  const d = t.run({ dry: true });
  assert.equal(d.ok, true);
  assert.equal(fs.readFileSync(path.join(t.plain, "data/new-state.json"), "utf8"), '{"mine":1}');
  const r = t.run();
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.equal(fs.readFileSync(path.join(t.plain, "data/new-state.json"), "utf8"), '{"theirs":1}', "the tracked file took the path");
  assert.ok(r.lines.some((l) => /a tracked file took the path/.test(l)));
});

test("classification and the plain union", () => {
  assert.equal(classify("site/data/pages.json"), "generated");
  assert.equal(classify("docs/DAILY.md"), "generated");
  assert.equal(classify("data/review/x.json"), "state");
  assert.equal(classify("data/hashtags.json"), "state");
  assert.equal(classify("ingest/run.js"), "blocked");
  assert.equal(classify("docs/DAILY-RUN.md"), "blocked");
  assert.deepEqual(plainUnion({ a: 1, n: { x: 1 } }, { a: 2, b: 3, n: { y: 2 } }), { a: 1, b: 3, n: { x: 1, y: 2 } });
});


test("a renamed file's new path with an untracked copy in the way is listed as a blocker (no rename detection) and moved aside", () => {
  const t = setup();
  // main renames the page; the hourly task already wrote the new path locally, untracked (2026-11-24: renamed feed and art files)
  fs.rmSync(path.join(t.dev, "site/city/x/index.html"));
  put(t.dev, "site/city/y/index.html", "v1");
  t.push("rename");
  put(t.plain, "site/city/y/index.html", "local copy");
  const r = t.run();
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /move untracked site\/city\/y\/index\.html aside/.test(l)), r.lines.join("\n"));
  assert.equal(fs.readFileSync(path.join(t.plain, "site/city/y/index.html"), "utf8"), "v1");
  const kept = fs.readdirSync(path.join(t.plain, ".cache/sync"));
  assert.equal(fs.readFileSync(path.join(t.plain, ".cache/sync", kept[0], "untracked/site/city/y/index.html"), "utf8"), "local copy");
});

test("a stranded daily commit is dissolved into the working tree and its data unioned; a person's commit stops the sync", () => {
  const t = setup();
  // the run committed locally but its push failed; main moved on (2026-11-24)
  put(t.plain, "data/events.json", evFile([ev("a", "2026-11-01"), ev("b", "2026-11-01"), ev("run-only", "2026-11-03")]));
  put(t.plain, "site/city/x/index.html", "run build");
  git(t.plain, "add", "-A"); git(t.plain, "commit", "-m", "daily: 2026-11-24 3 events, 3 upcoming, 1 new");
  put(t.dev, "data/events.json", evFile([ev("a", "2026-11-01"), ev("b", "2026-11-01"), ev("main-only", "2026-11-04")]));
  put(t.dev, "site/city/x/index.html", "v2");
  t.push("two");
  const dry = t.run({ dry: true });
  assert.equal(dry.ok, true);
  assert.ok(dry.lines.some((l) => /would dissolve 1 unpushed daily commit/.test(l)), dry.lines.join("\n"));
  assert.equal(git(t.plain, "log", "--oneline").trim().split("\n").length, 2, "dry touched nothing");
  const r = t.run();
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /1 unpushed daily commit\(s\) dissolved/.test(l)), r.lines.join("\n"));
  assert.equal(git(t.plain, "rev-parse", "HEAD").trim(), git(t.dev, "rev-parse", "origin/main").trim());
  const ids = JSON.parse(fs.readFileSync(path.join(t.plain, "data/events.json"), "utf8")).events.map((e) => e.id).sort();
  assert.deepEqual(ids, ["a", "b", "main-only", "run-only"]);
  assert.equal(fs.readFileSync(path.join(t.plain, "site/city/x/index.html"), "utf8"), "v2");
  // a person's commit is never dissolved
  put(t.plain, "ingest/code.js", "local work"); git(t.plain, "add", "-A"); git(t.plain, "commit", "-m", "fix: something by hand");
  put(t.dev, "ingest/code.js", "v3"); t.push("three");
  const r2 = t.run();
  assert.equal(r2.ok, false);
  assert.ok(r2.lines.some((l) => /not all the run's own/.test(l)), r2.lines.join("\n"));
  assert.equal(fs.readFileSync(path.join(t.plain, "ingest/code.js"), "utf8"), "local work");
});

test("what the run regenerates counts as generated: gate state, redirects, social pages, dated outbox folders; the outbox history is unioned", () => {
  for (const f of ["data/seo-state.json", "data/pages-lastmod.json", "site/_redirects", "site/sitemap-2.xml", "site/social/2026-11-25/06-feed.png", "tools/brand/outbox/2026-11-25/INDEX.md"]) assert.equal(classify(f), "generated", f);
  assert.equal(classify("tools/brand/outbox/history.json"), "state");
  assert.equal(classify("tools/social/outbox.js"), "blocked");
});
