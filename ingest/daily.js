// npm run daily: the once-a-day run (docs/DAILY-RUN.md). The Windows task "Matcha Map daily" starts it at 13:00 local time.
// Steps, in order, each its own child process (one crash never stops the run; a failed step is recorded and the next still runs):
//   pull (tools/sync-checkout.js: a fast-forward to origin/main that first unions or discards what the watch task or a stranded run left dirty), discover, watch, ingest, yelp-leads (once a UTC day), overture (if the adapter exists), deepen (new shops only),
//   pages (only when yelp-leads, overture or deepen changed the data), seo-gate (the nine SEO rules, tools/seo-gate.js), smoke,
//   report (docs/DAILY.md + one LADDER.md line), commit (after a resync when origin/main moved during the run: pages, gate, smoke and report again),
//   push, deploy (live smoke after it), notify (a GitHub issue when something failed or nothing new arrived; gh's own login, else the token git holds).
// Commit, push and deploy need the smoke and the SEO gate to have passed. No step may call a model: every child gets MATCHA_NO_MODEL=1 and no
// CLAUDE_API_KEY or ANTHROPIC_API_KEY (childEnv below; ingest/lib/env.js and ingest/lib/llm.js honour the flag even with a .env file).
// The run holds .cache/daily.lock (ingest/lib/runlock.js) so the hourly watch task skips while it runs, and waits for a running watch first.
// Flags: --dry (everything except commit, push, deploy and the issue; prints what it would do) | --steps a,b,c (only those steps).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { yelpDue, stampYelp, todayUTC } from "./lib/day-gate.js";
import { acquire, waitFor } from "./lib/runlock.js";
import { readSiteShops } from "./lib/site-shops.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GH = "C:\\Program Files\\GitHub CLI\\gh.exe";
const CHROME_DEFAULT = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const IDENTITY = ["-c", "user.name=Steven Macchia", "-c", "user.email=64022630+StevenMacchia@users.noreply.github.com"];
const MODEL_KEYS = ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"];

export const STEP_NAMES = ["pull", "discover", "watch", "ingest", "yelp-leads", "overture", "deepen", "pages", "seo-gate", "social", "smoke", "perf-gate", "report", "commit", "push", "deploy", "notify"];
// Same arguments as YELP_LEADS in ingest/loop.js (test/daily.test.js checks they match).
export const YELP_ARGS = ["ingest/shops-keyed.js", "--provider", "yelp", "--limit", "250"];
const SCRIPTS = {
  discover: ["ingest/lib/discover.js"],
  watch: ["ingest/watch.js"],
  ingest: ["ingest/run.js"],
  "yelp-leads": YELP_ARGS,
  deepen: ["ingest/shops-deepen.js", "--new"],
  smoke: ["tools/smoke.js"],
  "perf-gate": ["tools/perf-gate.js"], // Lighthouse mobile on four page types against the budgets in docs/PERFORMANCE.md; soft
  "seo-gate": ["tools/seo-gate.js"],
  social: ["tools/social/outbox.js"], // npm run social; writes tools/brand/outbox/<date>/ and site/social/<date>/
};
// Explicit paths only, each only if it exists. Never `git add -A`.
export const COMMIT_PATHS = ["data/events.json", "data/review", "data/geocache.json", "data/watchlist.json", "data/hashtags.json", "data/tavily-budget.json", "data/shops.json", "data/shops-extra.json", "data/sources.json", "data/pages.json", "site/data", "site/art", "site/img", "site/feeds", "site/e", "site/city", "site/state", "site/brand", "site/weekend", "site/og", "site/sitemap.xml", "site/robots.txt", "site/_redirects", "site/social", "tools/brand/outbox", "data/pages-lastmod.json", "data/seo-state.json", "docs/DAILY.md", "LADDER.md"];
// site/sitemap-1.xml, sitemap-2.xml... exist only once the sitemap passes 45,000 URLs; they are staged by name when present.
export const sitemapParts = (root = ROOT) => (fs.existsSync(path.join(root, "site")) ? fs.readdirSync(path.join(root, "site")).filter((n) => /^sitemap-\d+\.xml$/.test(n)).map((n) => `site/${n}`) : []);
// The generators ingest/run.js runs after the data is written, in its order (plus the slim first-paint file `npm run pages` writes).
const PAGES_SCRIPT = `
const u = (p) => import(${JSON.stringify(pathToFileURL(ROOT + path.sep).href)} + p);
for (const [f, fn] of [["tools/gen-pages.js", "run"], ["tools/slim-events.js", "writeSlim"], ["tools/gen-feeds.js", "run"], ["tools/gen-event-pages.js", "run"], ["tools/gen-weekend.js", "generate"], ["tools/gen-brand-extras.js", "run"], ["tools/gen-sitemap-extras.js", "run"]]) {
  const m = await u(f); await m[fn](); console.log("ok " + f);
}`;

// The environment every child gets: no model keys, the no-model flag, the daily-child mark (ingest/lib/runlock.js), a default Chrome.
export function childEnv(env = process.env) {
  const out = { ...env };
  for (const k of MODEL_KEYS) delete out[k];
  out.MATCHA_NO_MODEL = "1";
  out.MATCHA_DAILY_CHILD = "1";
  if (!out.CHROME_PATH) out.CHROME_PATH = CHROME_DEFAULT;
  return out;
}

// The social outbox of the day: where it is and how many items it holds. INDEX.md entries (bullet or numbered lines) when there is one,
// else the files in the folder; "none" when the folder is missing.
export function socialSummary(root, today) {
  const rel = `tools/brand/outbox/${today}`, dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return { path: rel, items: null };
  const idx = path.join(dir, "INDEX.md");
  if (fs.existsSync(idx)) return { path: rel, items: fs.readFileSync(idx, "utf8").split(/\r?\n/).filter((l) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(l)).length };
  return { path: rel, items: fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).length };
}
export const socialText = (s) => (!s || s.items == null ? "none" : `${s.path} (${s.items} item${s.items === 1 ? "" : "s"})`);
// The SEO pace queue (docs/SEO-RULES.md, rule 9) as tools/gen-pages.js left it in data/seo-state.json: how many newly earned city pages this
// run admitted to the index and how many earned pages wait noindex for a later run.
export const paceText = (q) => (!q || q.queued == null ? "not recorded" : `${q.admitted} newly indexable admitted, ${q.queued} earned and waiting (${q.cap} per run)`);

// ---- report ------------------------------------------------------------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
export function fmtET(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`;
}
export const fmtUTC = (d) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
export const fmtDur = (secs) => (secs >= 3600 ? `${Math.floor(secs / 3600)}h ${pad2(Math.floor((secs % 3600) / 60))}m` : secs >= 60 ? `${Math.floor(secs / 60)}m ${pad2(secs % 60)}s` : `${secs}s`);

export const failedSteps = (d) => d.steps.filter((s) => s.status === "FAILED").map((s) => s.name);
export const zeroNew = (d) => d.newTotal === 0;
export const needsIssue = (d) => failedSteps(d).length > 0 || zeroNew(d);
export const headline = (d) => {
  const f = failedSteps(d);
  if (f.length) return `Daily run ${d.date}: FAILED ${f.join(", ")}`;
  if (zeroNew(d)) return `Daily run ${d.date}: zero new events`;
  return `Daily run ${d.date}: ok, ${d.newTotal} new events`;
};
// "Daily run <date>: <failed steps | zero new events>"
export const issueTitle = (d) => `Daily run ${d.date}: ${failedSteps(d).join(", ") || "zero new events"}`;

const list = (o, none = "none") => { const e = Object.entries(o || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); return e.length ? e.map(([k, n]) => `${k} ${n}`).join(", ") : none; };

export function renderReport(d) {
  const fails = d.steps.filter((s) => s.status === "FAILED");
  const lines = [
    headline(d), "",
    `Run: ${d.etLabel} / ${d.utcLabel}. Total ${fmtDur(d.totalSecs)}.`, "",
    `- Events: ${d.events.total} total, ${d.events.upcoming} upcoming`,
    `- Shops shown: ${d.shopsShown}`,
    `- Cities with an upcoming pop-up: ${d.citiesUpcoming}`,
    `- Pages: city ${d.pages.city}, brand ${d.pages.brand}, event ${d.pages.event}, weekend ${d.pages.weekend}`,
    `- SEO pace queue: ${paceText(d.pace)}`,
    `- New today (${d.newTotal}) by source: ${list(d.newBySource)}`,
    `- Keyed calls today: ${list(d.calls)}`,
    `- Social outbox: ${socialText(d.social)}`,
    `- Failures: ${fails.length ? fails.map((s) => `${s.name}${s.note ? ` (${s.note})` : ""}`).join("; ") : "none"}`, "",
    "Steps:",
    ...(d.steps.length ? d.steps : [{ name: "none run yet", status: "" }]).map((s) => `- ${s.name}${s.status ? ": " + s.status : ""}${s.secs != null ? ` ${s.secs}s` : ""}${s.note ? ` (${s.note})` : ""}`),
  ];
  return lines.join("\n") + "\n";
}

// One line for LADDER.md.
export function ladderLine(d) {
  const f = failedSteps(d);
  return `- ${d.etLabel} daily run: ${d.events.total} events, ${d.events.upcoming} upcoming, ${d.shopsShown} shops, ${d.citiesUpcoming} cities with a pop-up, ${d.newTotal} new (${list(d.newBySource)}), pages city ${d.pages.city} brand ${d.pages.brand} event ${d.pages.event} weekend ${d.pages.weekend}, SEO pace queue ${paceText(d.pace)}, keyed calls ${list(d.calls)}, social outbox ${socialText(d.social)}, failures ${f.length ? f.join(", ") : "none"}, ${fmtDur(d.totalSecs)} (docs/DAILY.md).`;
}

// Append to LADDER.md under a trailing "## Daily runs" heading (created at the end if missing), in the file's own line ending.
export function appendLadder(text, line) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let t = text.endsWith("\n") ? text : text + eol;
  if (!/^## Daily runs\s*$/m.test(t)) t += `${eol}## Daily runs${eol}${eol}`;
  return t + line + eol;
}

// Count index.html files under a folder.
export function countIndex(dir) {
  let n = 0;
  const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (e.isDirectory()) walk(path.join(d, e.name)); else if (e.name === "index.html") n++; } };
  walk(dir);
  return n;
}

// Pure: the numbers from already-read data.
export function summarize({ events, shops, keyed, today }) {
  const up = events.filter((e) => e.status === "upcoming");
  const newToday = events.filter((e) => String(e.first_seen || "").slice(0, 10) === today);
  const newBySource = {};
  for (const e of newToday) { const k = e.source_id || e.source || "unknown"; newBySource[k] = (newBySource[k] || 0) + 1; }
  const cities = new Set(up.filter((e) => e.city).map((e) => `${String(e.city).toLowerCase()}|${String(e.state || "").toUpperCase()}`));
  return {
    events: { total: events.length, upcoming: up.length },
    shopsShown: shops.filter((s) => s.verified).length,
    citiesUpcoming: cities.size,
    newTotal: newToday.length, newBySource,
    calls: (keyed && keyed.days && keyed.days[today]) || {},
  };
}

export function collect(root, today) {
  const rd = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(root, f), "utf8")); } catch { return fb; } };
  const s = summarize({ events: rd("data/events.json", { events: [] }).events || [], shops: (() => { try { return readSiteShops(root).shops || []; } catch { return []; } })(), keyed: rd(".cache/keyed-places.json", {}), today });
  return { ...s, social: socialSummary(root, today), pace: rd("data/seo-state.json", {}).queue || null, pages: { city: countIndex(path.join(root, "site/city")), brand: countIndex(path.join(root, "site/brand")), event: countIndex(path.join(root, "site/e")), weekend: countIndex(path.join(root, "site/weekend")) } };
}

// ---- processes ---------------------------------------------------------------------------------------------------------------------------
function runProc({ cmd = process.execPath, args = [], shell = false, cwd = ROOT, env = childEnv() }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "";
    let child;
    try { child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell }); }
    catch (e) { return resolve({ ok: false, code: -1, secs: 0, note: e.message, out: "" }); }
    const take = (d) => { out = (out + d).slice(-200000); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (e) => resolve({ ok: false, code: -1, secs: 0, note: e.message, out }));
    child.on("close", (code) => {
      const last = out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      resolve({ ok: code === 0, code, secs: Math.round((Date.now() - t0) / 1000), note: code === 0 ? "" : `exit ${code}: ${last.slice(0, 120)}`, out });
    });
  });
}
const node = (args) => runProc({ args });
const git = (args) => runProc({ cmd: "git", args });
const firstLines = (s, n) => String(s || "").trim().split(/\r?\n/).filter(Boolean).slice(0, n).join(" | ").slice(0, 200);

// The token git's credential helper holds for github.com (git credential fill, never prompting), or null. Handed to gh as GH_TOKEN in memory
// when gh cannot read its own login (the notify step); never logged, never written anywhere.
export const parseCredential = (text) => { const m = /^password=(.+)$/m.exec(String(text || "")); return m ? m[1].trim() || null : null; };
function gitToken() {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try { child = spawn("git", ["credential", "fill"], { cwd: ROOT, env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }, stdio: ["pipe", "pipe", "ignore"] }); }
    catch { return resolve(null); }
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(parseCredential(out)));
    child.stdin.on("error", () => {});
    child.stdin.end("protocol=https\nhost=github.com\n\n");
  });
}

function dataHash() {
  const h = crypto.createHash("sha1");
  const dataDir = path.join(ROOT, "data");
  const keyed = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((f) => /^shops-keyed-.+\.json$/.test(f)).map((f) => `data/${f}`) : [];
  for (const f of ["data/events.json", "data/shops.json", "data/shops-extra.json", "site/data/shops.json", ...keyed]) { try { h.update(f).update(fs.readFileSync(path.join(ROOT, f))); } catch { /* absent */ } }
  return h.digest("hex");
}

// ---- the run -----------------------------------------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const a = { dry: argv.includes("--dry"), steps: null };
  const i = argv.indexOf("--steps");
  if (i >= 0) a.steps = String(argv[i + 1] || "").split(",").map((x) => x.trim()).filter(Boolean);
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of MODEL_KEYS) delete process.env[k];
  process.env.MATCHA_NO_MODEL = "1";
  if (args.steps) { const bad = args.steps.filter((s) => !STEP_NAMES.includes(s)); if (bad.length) { console.error(`unknown step(s): ${bad.join(", ")}. Steps: ${STEP_NAMES.join(", ")}`); process.exit(2); } }
  const want = (n) => !args.steps || args.steps.includes(n);
  const started = new Date();
  const today = todayUTC(started.getTime());
  const say = (m) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${m}`);
  // One run at a time in this checkout (ingest/lib/runlock.js): wait for a running hourly watch, then hold the daily lock so the watch task skips.
  const busy = await waitFor(ROOT, "watch", { log: (m) => say(`lock: ${m}`) });
  if (busy) say(`lock: the watch run is still going after 5 minutes (pid ${busy.pid}); going on`);
  const release = args.dry ? () => {} : acquire(ROOT, "daily");

  const steps = [];
  const rec = (name, status, secs, note = "") => { steps.push({ name, status, secs, note }); say(`${name} ${status}${secs != null ? ` ${secs}s` : ""}${note ? ` (${note})` : ""}`); };
  const fromRun = (name, r) => rec(name, r.ok ? "ok" : "FAILED", r.secs, r.note);
  const state = { smokeOk: false, gateOk: false, pushOk: false, before: null };
  const snapshot = () => { if (!state.before) state.before = dataHash(); };
  const build = () => ({ date: today, etLabel: fmtET(new Date()), utcLabel: fmtUTC(new Date()), totalSecs: Math.round((Date.now() - started.getTime()) / 1000), steps: [...steps], ...collect(ROOT, today) });
  const writeDaily = (d) => { fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true }); fs.writeFileSync(path.join(ROOT, "docs/DAILY.md"), renderReport(d)); };
  // The LADDER line of this run; written again (replacing the first) when the report step runs a second time after a resync.
  let ladderWritten = null;
  const writeLadder = (line) => {
    const f = path.join(ROOT, "LADDER.md");
    let t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    if (ladderWritten && t.trimEnd().endsWith(ladderWritten)) t = t.trimEnd().slice(0, -ladderWritten.length).trimEnd() + (t.includes("\r\n") ? "\r\n" : "\n");
    fs.writeFileSync(f, appendLadder(t, line));
    ladderWritten = line;
  };

  // The steps a resync runs again (see commit): pages, seo-gate, smoke, report.
  const pagesStep = async (force = false) => {
    if (!force && state.before && state.before === dataHash()) { rec("pages", "skipped", null, "steps 5 to 7 changed no data"); return; }
    fromRun("pages", await node(["--input-type=module", "-e", PAGES_SCRIPT]));
  };
  const gateStep = async () => {
    // --dry prints and writes no state; the daily run never passes --baseline (a person records the first set)
    const r = await node(args.dry ? [...SCRIPTS["seo-gate"], "--dry"] : SCRIPTS["seo-gate"]);
    state.gateOk = r.ok;
    const lines = r.out.split(/\r?\n/).filter(Boolean);
    for (const l of lines) say(`  ${l}`);
    const fail = lines.filter((l) => /^rule \d+ .*: FAIL/.test(l)).map((l) => l.slice(0, 160));
    rec("seo-gate", r.ok ? "ok" : "FAILED", r.secs, r.ok ? lines.find((l) => l.startsWith("seo gate:")) || "" : fail.join("; ") || r.note);
  };
  const smokeStep = async () => { const r = await node(SCRIPTS.smoke); state.smokeOk = r.ok; fromRun("smoke", r); };
  const reportStep = () => {
    const d = build();
    writeDaily(d);
    const line = ladderLine(d);
    if (args.dry) say(`dry: would append to LADDER.md under "## Daily runs": ${line}`);
    else writeLadder(line);
    rec("report", "ok", null, "docs/DAILY.md");
  };
  say(`daily run${args.dry ? " (dry)" : ""}: ${args.steps ? args.steps.join(",") : "all steps"}`);

  try {
  for (const name of STEP_NAMES) {
    if (!want(name)) continue;
    if (["yelp-leads", "overture", "deepen"].includes(name)) snapshot();
    switch (name) {
      case "pull": fromRun("pull", await node(["tools/sync-checkout.js"])); break;
      case "discover": case "watch": case "ingest": case "deepen": fromRun(name, await node(SCRIPTS[name])); break;
      case "yelp-leads": {
        if (!yelpDue()) { rec(name, "skipped", null, "ran today"); break; }
        const r = await node(SCRIPTS[name]);
        if (r.ok) stampYelp();
        fromRun(name, r);
        break;
      }
      case "overture":
        if (fs.existsSync(path.join(ROOT, "ingest/overture.js"))) fromRun(name, await node(["ingest/overture.js", "--incremental"]));
        else rec(name, "off", null, "no adapter yet");
        break;
      case "pages": await pagesStep(); break;
      case "seo-gate": await gateStep(); break;
      case "social": {
        // soft: a failure is recorded as "social FAILED (soft)" and never stops the run, the commit, the push or the deploy
        const r = await node(SCRIPTS.social);
        rec(name, r.ok ? "ok" : "FAILED (soft)", r.secs, r.ok ? "" : `social FAILED (soft): ${r.note}`);
        break;
      }
      case "smoke": await smokeStep(); break;
      case "perf-gate": {
        // soft like social: a missed budget is recorded ("perf-gate FAILED (soft)") and shows in the report, and never stops the commit, the push or the deploy
        if (args.dry) { rec(name, "skipped", null, "dry"); break; }
        const r = await node(SCRIPTS["perf-gate"]);
        const miss = r.out.split(/\r?\n/).filter((l) => /FAIL |perf gate:/.test(l)).map((l) => l.trim().slice(0, 140));
        rec(name, r.ok ? "ok" : "FAILED (soft)", r.secs, r.ok ? miss.pop() || "" : `perf-gate FAILED (soft): ${miss.join("; ").slice(0, 400) || r.note}`);
        break;
      }
      case "report": reportStep(); break;
      case "commit": {
        if (!state.smokeOk || !state.gateOk) { rec(name, "skipped", null, !state.smokeOk ? "smoke did not pass" : "seo gate did not pass"); break; }
        const msgOf = () => { const d = collect(ROOT, today); return `daily: ${today} ${d.events.total} events, ${d.events.upcoming} upcoming, ${d.newTotal} new`; };
        if (args.dry) { rec(name, "skipped", null, `dry: would fetch, resync if origin/main moved, then commit "${msgOf()}"`); break; }
        // origin/main may have moved during the run (another lane landing while the steps ran, 2026-11-24). Bring it in before committing,
        // the way the pull step does (tools/sync-checkout.js: the run's dirty state files unioned, its generated pages discarded), then
        // rebuild the pages and run the gate, the smoke and the report again on the result; the push then fast-forwards instead of merging.
        const f = await git(["fetch", "origin"]);
        if (f.ok && !(await git(["merge-base", "--is-ancestor", "origin/main", "HEAD"])).ok) {
          const s = await node(["tools/sync-checkout.js"]);
          const last = firstLines(s.out.trim().split(/\r?\n/).filter(Boolean).pop(), 1);
          if (!s.ok) { rec(name, "FAILED", s.secs, `origin/main moved during the run and the resync stopped: ${last}`); break; }
          say(`origin/main moved during the run (${last}); pages, gate, smoke and report run again on the result`);
          state.gateOk = state.smokeOk = false;
          await pagesStep(true);
          await gateStep();
          if (state.gateOk) await smokeStep();
          reportStep();
          if (!state.smokeOk || !state.gateOk) { rec(name, "skipped", null, !state.gateOk ? "seo gate did not pass after the resync" : "smoke did not pass after the resync"); break; }
        }
        const msg = msgOf();
        const paths = [...COMMIT_PATHS, ...sitemapParts()].filter((p) => fs.existsSync(path.join(ROOT, p)));
        const add = await git(["add", "--", ...paths]);
        if (!add.ok) { fromRun(name, add); break; }
        const staged = await git(["diff", "--cached", "--quiet", "--", ...paths]);
        if (staged.ok) { rec(name, "skipped", null, "nothing staged"); break; }
        fromRun(name, await git([...IDENTITY, "commit", "-m", `${msg}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, "--", ...paths]));
        break;
      }
      case "push": {
        if (!state.smokeOk || !state.gateOk) { rec(name, "skipped", null, !state.smokeOk ? "smoke did not pass" : "seo gate did not pass"); break; }
        if (args.dry) { rec(name, "skipped", null, "dry: would fetch, merge if needed and push HEAD:main"); break; }
        const f = await git(["fetch", "origin"]);
        if (!f.ok) { fromRun(name, f); break; }
        const anc = await git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
        if (!anc.ok) {
          // the small window after the commit's resync; a conflict is aborted here and tomorrow's pull dissolves this run's commit and unions it
          const m = await git([...IDENTITY, "merge", "--no-edit", "origin/main"]);
          if (!m.ok) { await git(["merge", "--abort"]); rec(name, "FAILED", m.secs, `merge with origin/main failed, aborted (the next pull unions this run's commit): ${m.note}`); break; }
        }
        const p = await git(["push", "origin", "HEAD:main"]);
        state.pushOk = p.ok;
        fromRun(name, p);
        break;
      }
      case "deploy": {
        if (!state.smokeOk || !state.gateOk || !state.pushOk) { rec(name, "skipped", null, !state.smokeOk ? "smoke did not pass" : !state.gateOk ? "seo gate did not pass" : "push did not succeed"); break; }
        if (args.dry) { rec(name, "skipped", null, "dry: would npm run deploy, then smoke https://matchamap.app"); break; }
        const r = await runProc({ cmd: "npm run deploy", shell: true });
        fromRun(name, r);
        if (r.ok) { const l = await node(["tools/smoke.js", "--url", "https://matchamap.app"]); rec("live-smoke", l.ok ? "ok" : "FAILED", l.secs, l.note); }
        break;
      }
      case "notify": {
        const d = build();
        if (!args.dry) writeDaily(d);
        if (!needsIssue(d)) { rec(name, "skipped", null, "nothing to report"); break; }
        const title = issueTitle(d);
        if (args.dry) { rec(name, "skipped", null, `dry: would open or comment on issue "${title}"`); break; }
        const ghRun = (a, env) => runProc({ cmd: fs.existsSync(GH) ? GH : "gh", args: a, env });
        const body = path.join(ROOT, "docs/DAILY.md");
        try {
          // gh keeps its login in the Windows credential store. When this process cannot read it (exit 4, "please run gh auth login": the
          // scheduled task on 2026-11-24, though gh is logged in at the prompt), the token git's own credential helper holds for github.com is
          // handed to gh as GH_TOKEN for this process only; nothing is written anywhere. The probe's first lines go to the log for the record.
          let env;
          const probe = await ghRun(["auth", "status"]);
          if (!probe.ok) {
            say(`  gh auth status: exit ${probe.code}: ${firstLines(probe.out, 2)}`);
            const tok = await gitToken();
            if (tok) { env = { ...childEnv(), GH_TOKEN: tok }; say("  gh: using the token git's credential helper holds for github.com, as GH_TOKEN for this process only"); }
            else say(`  gh: git credential fill holds no token for github.com either (user ${process.env.USERNAME || "?"}, APPDATA ${process.env.APPDATA ? "set" : "unset"}, session ${process.env.SESSIONNAME || "?"})`);
          }
          await ghRun(["label", "create", "daily-run", "--color", "0E8A16", "--description", "Matcha Map daily run needs a look", "--force"], env);
          const l = await ghRun(["issue", "list", "--label", "daily-run", "--state", "open", "--search", today, "--json", "number,title"], env);
          let existing = null;
          try { existing = JSON.parse(l.out).find((i) => i.title.includes(`Daily run ${today}`)); } catch { /* none */ }
          const r = existing ? await ghRun(["issue", "comment", String(existing.number), "--body-file", body], env) : await ghRun(["issue", "create", "--title", title, "--label", "daily-run", "--body-file", body], env);
          rec(name, r.ok ? "ok" : "skipped", null, r.ok ? (existing ? `commented on #${existing.number}` : "issue opened") : `gh failed: ${r.note}`);
        } catch (e) { rec(name, "skipped", null, `gh unavailable: ${e.message}`); }
        break;
      }
    }
  }
  } finally { release(); }
  const failed = steps.filter((s) => s.status === "FAILED").map((s) => s.name);
  say(`done in ${fmtDur(Math.round((Date.now() - started.getTime()) / 1000))}${failed.length ? `; FAILED: ${failed.join(", ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
