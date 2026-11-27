// npm run daily (ingest/daily.js, docs/DAILY-RUN.md): the step list, no model calls, the report, the issue title, shops:deepen --new, the day gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { STEP_NAMES, YELP_ARGS, COMMIT_PATHS, childEnv, summarize, renderReport, headline, issueTitle, needsIssue, ladderLine, appendLadder, parseArgs, fmtDur, socialSummary, parseCredential } from "../ingest/daily.js";
import { newRows } from "../ingest/shops-deepen.js";
import { yelpDue, stampYelp } from "../ingest/lib/day-gate.js";
import { loadEnv, parseEnv } from "../ingest/lib/env.js";
import { llmEnabled, askLlm } from "../ingest/lib/llm.js";

test("the step list and its order", () => {
  assert.deepEqual(STEP_NAMES, ["pull", "discover", "watch", "ingest", "yelp-leads", "overture", "deepen", "pages", "seo-gate", "social", "smoke", "perf-gate", "report", "daily-status", "commit", "push", "deploy", "notify"]);
  assert.deepEqual(parseArgs(["--dry", "--steps", "report,smoke"]), { dry: true, steps: ["report", "smoke"] });
  assert.deepEqual(parseArgs([]), { dry: false, steps: null });
});

test("children get no model key and the no-model flag, even when the parent has both keys", () => {
  const e = childEnv({ CLAUDE_API_KEY: "a", ANTHROPIC_API_KEY: "b", YELP_API_KEY: "y", PATH: "p" });
  assert.equal(e.CLAUDE_API_KEY, undefined);
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.MATCHA_NO_MODEL, "1");
  assert.equal(e.YELP_API_KEY, "y");
  assert.equal(e.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe");
  assert.equal(childEnv({ CHROME_PATH: "x" }).CHROME_PATH, "x");
});

test("a real child of the daily run cannot call a model: no key inherited, .env cannot put it back, the llm module stays off", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "CLAUDE_API_KEY=from-file\nANTHROPIC_API_KEY=from-file\nYELP_API_KEY=y\n");
  const env = childEnv({ CLAUDE_API_KEY: "k", ANTHROPIC_API_KEY: "k", PATH: process.env.PATH });
  loadEnv(file, env);
  assert.equal(env.CLAUDE_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.YELP_API_KEY, "y", "other keys still load");
  // Without the flag the file would have supplied the key.
  const plain = {};
  loadEnv(file, plain);
  assert.equal(plain.CLAUDE_API_KEY, "from-file");
  assert.equal(llmEnabled({ CLAUDE_API_KEY: "k", MATCHA_NO_MODEL: "1" }), false);
  assert.equal(llmEnabled({ CLAUDE_API_KEY: "k" }), true);
  // Even a key that slipped through makes no request while the flag is on.
  let called = false;
  return askLlm("post", { env: { CLAUDE_API_KEY: "k", MATCHA_NO_MODEL: "1" }, fetchFn: () => { called = true; throw new Error("no"); } }).then((r) => {
    assert.equal(r, null);
    assert.equal(called, false);
    // And a spawned node child, started the way the daily run starts them, sees neither key.
    const out = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify([process.env.CLAUDE_API_KEY, process.env.ANTHROPIC_API_KEY, process.env.MATCHA_NO_MODEL]))"], { env: childEnv({ CLAUDE_API_KEY: "k", ANTHROPIC_API_KEY: "k" }), encoding: "utf8" });
    assert.deepEqual(JSON.parse(out.stdout), [null, null, "1"]);
    assert.ok(parseEnv("A=1").A === "1");
  });
});

const EVENTS = [
  { id: "1", status: "upcoming", city: "Raleigh", state: "NC", first_seen: "2026-11-23T12:00:00.000Z", source_id: "a" },
  { id: "2", status: "upcoming", city: "raleigh", state: "nc", first_seen: "2026-11-23T13:00:00.000Z", source_id: "a" },
  { id: "3", status: "upcoming", city: "Austin", state: "TX", first_seen: "2026-11-22T13:00:00.000Z", source_id: "b" },
  { id: "4", status: "past", city: "Denver", state: "CO", first_seen: "2026-11-23T01:00:00.000Z", source_id: "b" },
  { id: "5", status: "upcoming", city: "", state: "", first_seen: "2026-11-23T02:00:00.000Z" },
];
const SHOPS = [{ verified: true }, { verified: true }, { verified: false }, {}];
const D = (over = {}) => ({
  date: "2026-11-23", etLabel: "2026-11-23 13:00 ET", utcLabel: "2026-11-23 18:00 UTC", totalSecs: 125,
  ...summarize({ events: EVENTS, shops: SHOPS, keyed: { days: { "2026-11-23": { yelp: 250, foursquare: 0 }, "2026-11-22": { yelp: 9 } } }, today: "2026-11-23" }),
  pages: { city: 10, brand: 20, event: 30, weekend: 4 },
  steps: [{ name: "pull", status: "ok", secs: 2, note: "" }, { name: "discover", status: "ok", secs: 60, note: "" }, { name: "overture", status: "off", secs: null, note: "no adapter yet" }],
  ...over,
});

test("summarize counts events, upcoming, verified shops, cities with a pop-up, new today per source and keyed calls today", () => {
  const d = D();
  assert.deepEqual(d.events, { total: 5, upcoming: 4 });
  assert.equal(d.shopsShown, 2);
  assert.equal(d.citiesUpcoming, 2, "Raleigh twice (case-insensitive) and Austin; the blank city is not a city");
  assert.equal(d.newTotal, 4);
  assert.deepEqual(d.newBySource, { a: 2, b: 1, unknown: 1 });
  assert.deepEqual(d.calls, { yelp: 250, foursquare: 0 });
});

test("the report: headline first, then the counts, per-source new, calls, failures, steps", () => {
  const md = renderReport(D());
  const lines = md.split("\n");
  assert.equal(lines[0], "Daily run 2026-11-23: ok, 4 new events");
  assert.match(md, /Run: 2026-11-23 13:00 ET \/ 2026-11-23 18:00 UTC\. Total 2m 05s\./);
  assert.match(md, /- Events: 5 total, 4 upcoming/);
  assert.match(md, /- Shops shown: 2/);
  assert.match(md, /- Cities with an upcoming pop-up: 2/);
  assert.match(md, /- Pages: city 10, brand 20, event 30, weekend 4/);
  assert.match(md, /- SEO pace queue: not recorded/);
  const paced = renderReport(D({ pace: { updated: "2026-11-23", cap: 100, admitted: 100, queued: 109, next: ["city/tx/plano"] } }));
  assert.match(paced, /- SEO pace queue: 100 newly indexable admitted, 109 earned and waiting \(100 per run\)/);
  assert.match(ladderLine(D({ pace: { cap: 100, admitted: 100, queued: 109 } })), /SEO pace queue 100 newly indexable admitted, 109 earned and waiting \(100 per run\), keyed calls/);
  assert.match(md, /- New today \(4\) by source: a 2, b 1, unknown 1/);
  assert.match(md, /- Keyed calls today: yelp 250/);
  assert.match(md, /- Failures: none/);
  assert.match(md, /- overture: off \(no adapter yet\)/);
  assert.ok(lines.length < 40, "one screen");
  assert.equal(needsIssue(D()), false);
});

test("the headline: zero new events, and failed steps (which win)", () => {
  const zero = D({ newTotal: 0, newBySource: {} });
  assert.equal(headline(zero), "Daily run 2026-11-23: zero new events");
  assert.match(renderReport(zero), /- New today \(0\) by source: none/);
  assert.equal(needsIssue(zero), true);
  const failed = D({ steps: [{ name: "discover", status: "FAILED", secs: 3, note: "exit 1: boom" }, { name: "ingest", status: "FAILED", secs: 1, note: "exit 2" }, { name: "pull", status: "ok", secs: 1, note: "" }] });
  assert.equal(headline(failed), "Daily run 2026-11-23: FAILED discover, ingest");
  assert.match(renderReport(failed), /- Failures: discover \(exit 1: boom\); ingest \(exit 2\)/);
  assert.equal(needsIssue(failed), true);
  const live = D({ steps: [{ name: "deploy", status: "ok", secs: 1, note: "" }, { name: "live-smoke", status: "FAILED", secs: 9, note: "exit 1" }] });
  assert.equal(needsIssue(live), true);
  assert.equal(issueTitle(live), "Daily run 2026-11-23: live-smoke");
});

test("the issue title: failed step names, else zero new events", () => {
  assert.equal(issueTitle(D({ steps: [{ name: "ingest", status: "FAILED" }, { name: "smoke", status: "FAILED" }] })), "Daily run 2026-11-23: ingest, smoke");
  assert.equal(issueTitle(D({ newTotal: 0, newBySource: {} })), "Daily run 2026-11-23: zero new events");
});

test("the LADDER.md line is one line and lands under a trailing Daily runs heading in the file's own line ending", () => {
  const line = ladderLine(D());
  assert.ok(!line.includes("\n"));
  assert.match(line, /^- 2026-11-23 13:00 ET daily run: 5 events, 4 upcoming, 2 shops, 2 cities with a pop-up, 4 new \(a 2, b 1, unknown 1\)/);
  const once = appendLadder("# Ladder\r\n\r\ntext\r\n", line);
  assert.equal(once, `# Ladder\r\n\r\ntext\r\n\r\n## Daily runs\r\n\r\n${line}\r\n`);
  const twice = appendLadder(once, line);
  assert.equal(twice.match(/## Daily runs/g).length, 1);
  assert.ok(twice.endsWith(`${line}\r\n${line}\r\n`));
  assert.equal(appendLadder("x", "y"), "x\n\n## Daily runs\n\ny\n");
  assert.equal(fmtDur(3725), "1h 02m");
});

test("commit paths are explicit: no root, no wildcard, the ones named", () => {
  for (const p of COMMIT_PATHS) assert.ok(!/^\.?\/?$|\*/.test(p), p);
  for (const p of ["data/events.json", "site/city", "site/e", "docs/DAILY.md", "LADDER.md", "site/sitemap.xml", "site/_redirects", "data/seo-state.json", "data/pages-lastmod.json"]) assert.ok(COMMIT_PATHS.includes(p), p);
  const src = fs.readFileSync("ingest/daily.js", "utf8");
  assert.ok(!/["']add["'],\s*["']-A["']|git add -A/.test(src.replace(/\/\/.*$/gm, "")), "never git add -A");
});

test("shops:deepen --new reads only rows with a website, verified, and no entry in the extras store", () => {
  const shops = [
    { id: "a", website: "https://a.test", verified: true },
    { id: "b", website: "https://b.test", verified: true },
    { id: "c", website: "", verified: true },
    { id: "d", website: "https://d.test", verified: false },
  ];
  assert.deepEqual(newRows(shops, { b: { read: "2026-11-01" } }).map((s) => s.id), ["a"]);
  assert.deepEqual(newRows(shops, null).map((s) => s.id), ["a", "b"]);
  assert.match(fs.readFileSync("ingest/daily.js", "utf8"), /"ingest\/shops-deepen\.js", "--new"/);
});

test("the day gate is shared: loop.js and daily.js import it, and the stamp holds the UTC day", () => {
  for (const f of ["ingest/loop.js", "ingest/daily.js"]) assert.match(fs.readFileSync(f, "utf8"), /from "\.\/lib\/day-gate\.js"/, f);
  assert.ok(!/DAY_STAMP|function yelpDue|function stampYelp/.test(fs.readFileSync("ingest/loop.js", "utf8")), "loop.js no longer owns the gate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-gate-"));
  const file = path.join(dir, ".cache", "yelp-leads-day.txt");
  assert.equal(yelpDue((f) => fs.readFileSync(f, "utf8"), "2026-11-23", file), true, "no stamp: due");
  stampYelp(file, "2026-11-23");
  assert.equal(yelpDue((f) => fs.readFileSync(f, "utf8"), "2026-11-23", file), false, "stamped today: not due");
  assert.equal(yelpDue((f) => fs.readFileSync(f, "utf8"), "2026-11-24", file), true, "next UTC day: due");
  // Both runners search the same way.
  const loop = fs.readFileSync("ingest/loop.js", "utf8");
  assert.ok(loop.includes(JSON.stringify(YELP_ARGS).replace(/","/g, '", "').replace(/^\[/, "[").replace(/\]$/, "]")), "daily and loop use the same yelp-leads arguments");
});

test("the seo-gate step sits right after pages and before smoke; commit, push and deploy need it as well as the smoke", () => {
  assert.equal(STEP_NAMES.indexOf("seo-gate"), STEP_NAMES.indexOf("pages") + 1);
  assert.ok(STEP_NAMES.indexOf("seo-gate") < STEP_NAMES.indexOf("smoke"));
  const src = fs.readFileSync(new URL("../ingest/daily.js", import.meta.url), "utf8");
  for (const name of ["commit", "push", "deploy"]) {
    const block = new RegExp(`case "${name}": \\{[\\s\\S]*?\\n      \\}`).exec(src)[0];
    assert.match(block, /state\.smokeOk/, name);
    assert.match(block, /state\.gateOk/, name + " needs the gate");
  }
  assert.ok(!/seo-gate\.js[^\n]*--baseline/.test(src), "the daily run never records a baseline");
  assert.ok(COMMIT_PATHS.includes("site/_redirects") && COMMIT_PATHS.includes("data/seo-state.json"));
});

test("social: a soft step after the gate; its failure never blocks commit, push or deploy; the report names the outbox path and item count", () => {
  assert.equal(STEP_NAMES.indexOf("social"), STEP_NAMES.indexOf("seo-gate") + 1);
  assert.ok(STEP_NAMES.indexOf("social") < STEP_NAMES.indexOf("smoke"));
  assert.ok(COMMIT_PATHS.includes("site/social"));
  const src = fs.readFileSync(new URL("../ingest/daily.js", import.meta.url), "utf8");
  assert.match(src, /tools\/social\/outbox\.js/);
  assert.match(src, /"FAILED \(soft\)"/);
  for (const name of ["commit", "push", "deploy"]) assert.ok(!/socialOk/.test(new RegExp(`case "${name}": \\{[\\s\\S]*?\\n      \\}`).exec(src)[0]), name);
  // a soft failure is not a FAILED step: no issue, no failed exit
  const soft = D({ steps: [{ name: "social", status: "FAILED (soft)", secs: 1, note: "social FAILED (soft): exit 1" }] });
  assert.equal(needsIssue({ ...soft, newTotal: 3 }), false);
  assert.match(renderReport(soft), /- social: FAILED \(soft\) 1s \(social FAILED \(soft\): exit 1\)/);
  // the outbox line: INDEX.md entries, else files, else none
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mm-soc-"));
  try {
    assert.equal(socialSummary(root, "2026-11-23").items, null);
    assert.match(renderReport(D({ social: socialSummary(root, "2026-11-23") })), /- Social outbox: none/);
    const dir = path.join(root, "tools/brand/outbox/2026-11-23");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.md"), "x");
    fs.writeFileSync(path.join(dir, "b.md"), "x");
    assert.equal(socialSummary(root, "2026-11-23").items, 2, "files when there is no INDEX.md");
    fs.writeFileSync(path.join(dir, "INDEX.md"), "# Outbox\n\n- one\n- two\n3. three\n");
    const s = socialSummary(root, "2026-11-23");
    assert.deepEqual(s, { path: "tools/brand/outbox/2026-11-23", items: 3 });
    assert.match(renderReport(D({ social: s })), /- Social outbox: tools\/brand\/outbox\/2026-11-23 \(3 items\)/);
    assert.match(ladderLine(D({ social: s })), /social outbox tools\/brand\/outbox\/2026-11-23 \(3 items\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("daily: the social outbox is committed, children carry the daily-child mark, parseCredential reads git's answer", () => {
  assert.ok(COMMIT_PATHS.includes("tools/brand/outbox"), "the social step's outbox and history.json are committed by the run");
  assert.equal(childEnv({}).MATCHA_DAILY_CHILD, "1");
  assert.equal(parseCredential("protocol=https\nhost=github.com\nusername=x\npassword=tok_123\n"), "tok_123");
  assert.equal(parseCredential("protocol=https\nhost=github.com\n"), null);
  assert.equal(parseCredential(""), null);
});

test("daily-status: a soft step right after report; its failure never blocks commit, push or deploy; the Run health tile reads its file", () => {
  assert.equal(STEP_NAMES.indexOf("daily-status"), STEP_NAMES.indexOf("report") + 1);
  assert.ok(STEP_NAMES.indexOf("daily-status") < STEP_NAMES.indexOf("commit"));
  assert.ok(COMMIT_PATHS.includes("site/data"), "site/data/daily-status.json rides in the daily commit");
  const src = fs.readFileSync(new URL("../ingest/daily.js", import.meta.url), "utf8");
  assert.match(src, /tools\/daily-status\.js/);
  assert.match(src, /daily-status FAILED \(soft\)/);
  const soft = D({ steps: [{ name: "daily-status", status: "FAILED (soft)", secs: 1, note: "daily-status FAILED (soft): exit 1" }] });
  assert.equal(needsIssue({ ...soft, newTotal: 3 }), false);
});
