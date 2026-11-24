// npm run daily: the once-a-day run (docs/DAILY-RUN.md). The Windows task "Matcha Map daily" starts it at 13:00 local time.
// Steps, in order, each its own child process (one crash never stops the run; a failed step is recorded and the next still runs):
//   pull (tools/sync-checkout.js: a fast-forward to origin/main that first unions or discards what the watch task left dirty), discover, watch, ingest, yelp-leads (once a UTC day), overture (if the adapter exists), deepen (new shops only),
//   pages (only when yelp-leads, overture or deepen changed the data), smoke, report (docs/DAILY.md + one LADDER.md line),
//   commit, push, deploy (live smoke after it), notify (a GitHub issue when something failed or nothing new arrived).
// Commit, push and deploy need the smoke to have passed. No step may call a model: every child gets MATCHA_NO_MODEL=1 and no
// CLAUDE_API_KEY or ANTHROPIC_API_KEY (childEnv below; ingest/lib/env.js and ingest/lib/llm.js honour the flag even with a .env file).
// Flags: --dry (everything except commit, push, deploy and the issue; prints what it would do) | --steps a,b,c (only those steps).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { yelpDue, stampYelp, todayUTC } from "./lib/day-gate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GH = "C:\\Program Files\\GitHub CLI\\gh.exe";
const CHROME_DEFAULT = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const IDENTITY = ["-c", "user.name=Steven Macchia", "-c", "user.email=64022630+StevenMacchia@users.noreply.github.com"];
const MODEL_KEYS = ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"];

export const STEP_NAMES = ["pull", "discover", "watch", "ingest", "yelp-leads", "overture", "deepen", "pages", "smoke", "report", "commit", "push", "deploy", "notify"];
// Same arguments as YELP_LEADS in ingest/loop.js (test/daily.test.js checks they match).
export const YELP_ARGS = ["ingest/shops-keyed.js", "--provider", "yelp", "--limit", "250"];
const SCRIPTS = {
  discover: ["ingest/lib/discover.js"],
  watch: ["ingest/watch.js"],
  ingest: ["ingest/run.js"],
  "yelp-leads": YELP_ARGS,
  deepen: ["ingest/shops-deepen.js", "--new"],
  smoke: ["tools/smoke.js"],
};
// Explicit paths only, each only if it exists. Never `git add -A`.
export const COMMIT_PATHS = ["data/events.json", "data/review", "data/geocache.json", "data/watchlist.json", "data/hashtags.json", "data/tavily-budget.json", "data/shops.json", "data/shops-extra.json", "data/sources.json", "data/pages.json", "site/data", "site/art", "site/img", "site/feeds", "site/e", "site/city", "site/state", "site/brand", "site/weekend", "site/og", "site/sitemap.xml", "site/robots.txt", "docs/DAILY.md", "LADDER.md"];
// The generators ingest/run.js runs after the data is written, in its order (plus the slim first-paint file `npm run pages` writes).
const PAGES_SCRIPT = `
const u = (p) => import(${JSON.stringify(pathToFileURL(ROOT + path.sep).href)} + p);
for (const [f, fn] of [["tools/gen-pages.js", "run"], ["tools/slim-events.js", "writeSlim"], ["tools/gen-feeds.js", "run"], ["tools/gen-event-pages.js", "run"], ["tools/gen-weekend.js", "generate"], ["tools/gen-brand-extras.js", "run"], ["tools/gen-sitemap-extras.js", "run"]]) {
  const m = await u(f); await m[fn](); console.log("ok " + f);
}`;

// The environment every child gets: no model keys, the no-model flag, a default Chrome.
export function childEnv(env = process.env) {
  const out = { ...env };
  for (const k of MODEL_KEYS) delete out[k];
  out.MATCHA_NO_MODEL = "1";
  if (!out.CHROME_PATH) out.CHROME_PATH = CHROME_DEFAULT;
  return out;
}

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
    `- New today (${d.newTotal}) by source: ${list(d.newBySource)}`,
    `- Keyed calls today: ${list(d.calls)}`,
    `- Failures: ${fails.length ? fails.map((s) => `${s.name}${s.note ? ` (${s.note})` : ""}`).join("; ") : "none"}`, "",
    "Steps:",
    ...(d.steps.length ? d.steps : [{ name: "none run yet", status: "" }]).map((s) => `- ${s.name}${s.status ? ": " + s.status : ""}${s.secs != null ? ` ${s.secs}s` : ""}${s.note ? ` (${s.note})` : ""}`),
  ];
  return lines.join("\n") + "\n";
}

// One line for LADDER.md.
export function ladderLine(d) {
  const f = failedSteps(d);
  return `- ${d.etLabel} daily run: ${d.events.total} events, ${d.events.upcoming} upcoming, ${d.shopsShown} shops, ${d.citiesUpcoming} cities with a pop-up, ${d.newTotal} new (${list(d.newBySource)}), pages city ${d.pages.city} brand ${d.pages.brand} event ${d.pages.event} weekend ${d.pages.weekend}, keyed calls ${list(d.calls)}, failures ${f.length ? f.join(", ") : "none"}, ${fmtDur(d.totalSecs)} (docs/DAILY.md).`;
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
  const s = summarize({ events: rd("data/events.json", { events: [] }).events || [], shops: rd("site/data/shops.json", { shops: [] }).shops || [], keyed: rd(".cache/keyed-places.json", {}), today });
  return { ...s, pages: { city: countIndex(path.join(root, "site/city")), brand: countIndex(path.join(root, "site/brand")), event: countIndex(path.join(root, "site/e")), weekend: countIndex(path.join(root, "site/weekend")) } };
}

// ---- processes ---------------------------------------------------------------------------------------------------------------------------
function runProc({ cmd = process.execPath, args = [], shell = false, cwd = ROOT }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "";
    let child;
    try { child = spawn(cmd, args, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], shell }); }
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
  const steps = [];
  const rec = (name, status, secs, note = "") => { steps.push({ name, status, secs, note }); say(`${name} ${status}${secs != null ? ` ${secs}s` : ""}${note ? ` (${note})` : ""}`); };
  const fromRun = (name, r) => rec(name, r.ok ? "ok" : "FAILED", r.secs, r.note);
  const state = { smokeOk: false, pushOk: false, before: null };
  const snapshot = () => { if (!state.before) state.before = dataHash(); };
  const build = () => ({ date: today, etLabel: fmtET(new Date()), utcLabel: fmtUTC(new Date()), totalSecs: Math.round((Date.now() - started.getTime()) / 1000), steps: [...steps], ...collect(ROOT, today) });
  const writeDaily = (d) => { fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true }); fs.writeFileSync(path.join(ROOT, "docs/DAILY.md"), renderReport(d)); };
  say(`daily run${args.dry ? " (dry)" : ""}: ${args.steps ? args.steps.join(",") : "all steps"}`);

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
      case "pages": {
        const changed = !state.before || state.before !== dataHash();
        if (!changed) { rec(name, "skipped", null, "steps 5 to 7 changed no data"); break; }
        fromRun(name, await node(["--input-type=module", "-e", PAGES_SCRIPT]));
        break;
      }
      case "smoke": { const r = await node(SCRIPTS.smoke); state.smokeOk = r.ok; fromRun(name, r); break; }
      case "report": {
        const d = build();
        writeDaily(d);
        const line = ladderLine(d);
        if (args.dry) say(`dry: would append to LADDER.md under "## Daily runs": ${line}`);
        else { const f = path.join(ROOT, "LADDER.md"); fs.writeFileSync(f, appendLadder(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "", line)); }
        rec(name, "ok", null, "docs/DAILY.md");
        break;
      }
      case "commit": {
        if (!state.smokeOk) { rec(name, "skipped", null, "smoke did not pass"); break; }
        const d = collect(ROOT, today);
        const msg = `daily: ${today} ${d.events.total} events, ${d.events.upcoming} upcoming, ${d.newTotal} new`;
        if (args.dry) { rec(name, "skipped", null, `dry: would commit "${msg}"`); break; }
        const paths = COMMIT_PATHS.filter((p) => fs.existsSync(path.join(ROOT, p)));
        const add = await git(["add", "--", ...paths]);
        if (!add.ok) { fromRun(name, add); break; }
        const staged = await git(["diff", "--cached", "--quiet", "--", ...paths]);
        if (staged.ok) { rec(name, "skipped", null, "nothing staged"); break; }
        fromRun(name, await git([...IDENTITY, "commit", "-m", `${msg}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, "--", ...paths]));
        break;
      }
      case "push": {
        if (!state.smokeOk) { rec(name, "skipped", null, "smoke did not pass"); break; }
        if (args.dry) { rec(name, "skipped", null, "dry: would fetch, merge if needed and push HEAD:main"); break; }
        const f = await git(["fetch", "origin"]);
        if (!f.ok) { fromRun(name, f); break; }
        const anc = await git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
        if (!anc.ok) {
          const m = await git([...IDENTITY, "merge", "--no-edit", "origin/main"]);
          if (!m.ok) { await git(["merge", "--abort"]); rec(name, "FAILED", m.secs, `merge with origin/main failed, aborted: ${m.note}`); break; }
        }
        const p = await git(["push", "origin", "HEAD:main"]);
        state.pushOk = p.ok;
        fromRun(name, p);
        break;
      }
      case "deploy": {
        if (!state.smokeOk || !state.pushOk) { rec(name, "skipped", null, !state.smokeOk ? "smoke did not pass" : "push did not succeed"); break; }
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
        const ghRun = (a) => runProc({ cmd: fs.existsSync(GH) ? GH : "gh", args: a });
        const body = path.join(ROOT, "docs/DAILY.md");
        try {
          await ghRun(["label", "create", "daily-run", "--color", "0E8A16", "--description", "Matcha Map daily run needs a look", "--force"]);
          const l = await ghRun(["issue", "list", "--label", "daily-run", "--state", "open", "--search", today, "--json", "number,title"]);
          let existing = null;
          try { existing = JSON.parse(l.out).find((i) => i.title.includes(`Daily run ${today}`)); } catch { /* none */ }
          const r = existing ? await ghRun(["issue", "comment", String(existing.number), "--body-file", body]) : await ghRun(["issue", "create", "--title", title, "--label", "daily-run", "--body-file", body]);
          rec(name, r.ok ? "ok" : "skipped", null, r.ok ? (existing ? `commented on #${existing.number}` : "issue opened") : `gh failed: ${r.note}`);
        } catch (e) { rec(name, "skipped", null, `gh unavailable: ${e.message}`); }
        break;
      }
    }
  }
  const failed = steps.filter((s) => s.status === "FAILED").map((s) => s.name);
  say(`done in ${fmtDur(Math.round((Date.now() - started.getTime()) / 1000))}${failed.length ? `; FAILED: ${failed.join(", ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
