// node tools/sync-checkout.js [--dry]: bring the plain checkout to origin/main when the hourly watch task or yesterday's run left tracked files dirty
// (the `pull` step of npm run daily calls this instead of a bare `git pull --ff-only`). docs/DAILY-RUN.md.
//   1. fetch; if HEAD already holds origin/main, done.
//   2. dirty generated outputs (site/ pages, feeds, images, site/data, sitemap, docs/DAILY.md, LADDER.md) are discarded: the run regenerates them.
//      dirty state files are unioned against origin/main's copy with tools/merge-state.cjs (events, watchlist, review, geocache, budget, shops,
//      sources); any other dirty data/*.json gets a plain object union, ours over theirs.
//   3. every local copy is kept first in .cache/sync/<timestamp>/; the dirty files are checked out, `git merge --ff-only origin/main` runs, the unions
//      are written back. Untracked files that block the fast-forward are moved aside and restored where no tracked file took the path.
//   4. any other dirty tracked file (code, docs) stops the sync before anything is touched, naming it; so does a local commit not on main,
//      unless every local commit is the run's own ("daily: ..."): those are dissolved back into the working tree first (git reset --mixed to
//      the merge base), so a run whose push failed is unioned like any other run output instead of stranding the checkout (2026-11-24).
//   5. if the fast-forward still fails, the paths git names as in the way are moved aside once and it is retried; if it fails again the local
//      copies are put back as they were, so the run that follows works on its own data, not on HEAD's.
// One line per action. Exit 0 on success, 1 when it stopped.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MERGE_STATE = path.join(HERE, "merge-state.cjs");

const GENERATED = /^(site\/(city|state|brand|e|weekend|feeds|og|art|img|data|social)\/|site\/(sitemap\.xml|sitemap-\d+\.xml|robots\.txt|index\.html|_redirects)$|docs\/DAILY\.md$|LADDER\.md$|data\/(seo-state|pages-lastmod)\.json$|tools\/brand\/outbox\/\d{4}-\d{2}-\d{2}\/)/;
// Which merge-state.cjs kind a state file takes, or "plain" for any other data/*.json, or null when it is not a state file.
export function stateKind(f) {
  const fixed = { "data/events.json": "events", "data/watchlist.json": "watchlist", "data/geocache.json": "geocache", "data/tavily-budget.json": "budget", "data/shops.json": "shops", "data/sources.json": "sources", "tools/brand/outbox/history.json": "plain" };
  if (fixed[f]) return fixed[f];
  if (/^data\/review\/[^/]+\.json$/.test(f)) return "review";
  if (/^data\/[^/]+\.json$/.test(f)) return "plain";
  return null;
}
export const classify = (f) => (GENERATED.test(f) ? "generated" : stateKind(f) ? "state" : "blocked");

// Plain union, ours over theirs; nested plain objects merge, anything else (arrays, scalars) takes ours.
export function plainUnion(ours, theirs) {
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(ours) || !isObj(theirs)) return ours;
  const out = { ...theirs };
  for (const [k, v] of Object.entries(ours)) out[k] = isObj(v) && isObj(theirs[k]) ? plainUnion(v, theirs[k]) : v;
  return out;
}

export function sync({ cwd = process.cwd(), dry = false, log = console.log } = {}) {
  const git = (args, o = {}) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, ...o });
  const out = (args) => git(args).stdout;
  const stop = (m) => { log(`sync: STOPPED: ${m}`); return { ok: false }; };

  const f = git(["fetch", "origin"]);
  if (f.status !== 0) return stop(`git fetch origin failed: ${(f.stderr || "").trim().split("\n").pop()}`);
  log("sync: fetched origin");
  const dirtyNow = () => out(["status", "--porcelain", "-z", "--untracked-files=no"]).split("\0").filter(Boolean).map((l) => l.slice(3));
  const holds = git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status === 0;
  if (holds) { const n = dirtyNow().length; log(`sync: HEAD already holds origin/main${n ? `; ${n} dirty file(s) left as they are` : ""}`); return { ok: true, changed: false }; }
  if (git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).status !== 0) {
    // Local commits origin/main lacks. The run's own commits ("daily: ...", ingest/daily.js) that never reached main are dissolved back into
    // the working tree: their files are then dirty like any other run output and the union and discard below apply. Anything else stops the sync.
    const local = out(["log", "--format=%s", "origin/main..HEAD"]).split("\n").filter(Boolean);
    const foreign = local.filter((s) => !/^daily: /.test(s));
    if (!local.length || foreign.length) return stop(`HEAD has ${local.length} commit(s) origin/main does not, not all the run's own ("daily: ..."): ${foreign[0] || local[0] || "?"}; nothing touched`);
    const base = out(["merge-base", "HEAD", "origin/main"]).trim();
    if (dry) log(`sync: (dry) would dissolve ${local.length} unpushed daily commit(s) into the working tree (git reset --mixed ${base.slice(0, 9)}) and union their data`);
    else {
      const r = git(["reset", "-q", "--mixed", base]);
      if (r.status !== 0) return stop(`git reset --mixed ${base.slice(0, 9)} failed: ${(r.stderr || "").trim().split("\n").pop()}`);
      log(`sync: ${local.length} unpushed daily commit(s) dissolved into the working tree, their data unioned below: ${local.join("; ")}`);
    }
  }
  const dirty = dirtyNow();
  const blocked = dirty.filter((p) => classify(p) === "blocked");
  if (blocked.length) return stop(`tracked file(s) changed that the run does not regenerate: ${blocked.join(", ")}; commit or revert them; nothing touched`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const keep = path.join(cwd, ".cache", "sync", stamp);
  const unions = []; // { file, text }
  const act = (m) => log(`sync:${dry ? " (dry)" : ""} ${m}`);

  // Plan (and, unless dry, back up) each dirty file.
  for (const p of dirty) {
    const kind = classify(p);
    const abs = path.join(cwd, p);
    if (kind === "generated") { act(`discard ${p} (regenerated by the run)`); }
    else {
      const k = stateKind(p);
      act(`union ${p} with origin/main (${k})`);
    }
    if (dry) continue;
    if (fs.existsSync(abs)) { fs.mkdirSync(path.dirname(path.join(keep, p)), { recursive: true }); fs.copyFileSync(abs, path.join(keep, p)); }
  }
  // Untracked files main now tracks would block the fast-forward.
  // --no-renames: a renamed file's new path counts as added here, or an untracked copy of it blocks the fast-forward (2026-11-24: renamed feed and art files)
  const added = out(["diff", "--name-only", "--no-renames", "--diff-filter=A", "HEAD", "origin/main"]).split("\n").filter(Boolean);
  const blockers = added.filter((p) => fs.existsSync(path.join(cwd, p)) && git(["ls-files", "--error-unmatch", "--", p]).status !== 0);
  for (const p of blockers) act(`move untracked ${p} aside (origin/main tracks it now)`);
  if (dry) { act(`git merge --ff-only origin/main`); return { ok: true, changed: true, dry: true }; }

  for (const p of dirty) {
    const k = classify(p) === "state" ? stateKind(p) : null;
    if (!k || !fs.existsSync(path.join(keep, p))) continue;
    const theirsText = git(["show", `origin/main:${p}`]).stdout;
    const oursFile = path.join(keep, p);
    if (git(["cat-file", "-e", `origin/main:${p}`]).status !== 0 || !theirsText) { unions.push({ file: p, text: fs.readFileSync(oursFile, "utf8") }); continue; }
    try {
      const theirsFile = path.join(keep, ".theirs", p), outFile = path.join(keep, ".merged", p);
      fs.mkdirSync(path.dirname(theirsFile), { recursive: true }); fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(theirsFile, theirsText);
      if (k === "plain") {
        fs.writeFileSync(outFile, JSON.stringify(plainUnion(JSON.parse(fs.readFileSync(oursFile, "utf8")), JSON.parse(theirsText)), null, 1) + "\n");
      } else {
        const r = spawnSync(process.execPath, [MERGE_STATE, k, oursFile, theirsFile, outFile], { encoding: "utf8" });
        if (r.status !== 0) throw new Error((r.stderr || "").trim().split("\n").pop());
        log(`sync: ${r.stdout.trim()}`);
      }
      unions.push({ file: p, text: fs.readFileSync(outFile, "utf8") });
    } catch (e) {
      // Keep the local copy whole rather than lose it; it is also in the backup folder.
      log(`sync: union of ${p} failed (${e.message}); keeping the local copy`);
      unions.push({ file: p, text: fs.readFileSync(oursFile, "utf8") });
    }
  }
  const moved = [];
  const aside = (p) => { const to = path.join(keep, "untracked", p); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(path.join(cwd, p), to); moved.push([p, to]); };
  for (const p of blockers) aside(p);
  if (dirty.length) { const c = git(["checkout", "--", ...dirty]); if (c.status !== 0) return stop(`git checkout failed: ${(c.stderr || "").trim()}; local copies are in ${keep}`); act(`checked out ${dirty.length} file(s)`); }
  let m = git(["merge", "--ff-only", "origin/main"]);
  if (m.status !== 0) {
    // Paths git itself names as in the way (indented lines of its message) are moved aside once and the fast-forward is retried.
    const named = (m.stderr || "").split("\n").filter((l) => /^\s+\S/.test(l)).map((l) => l.trim()).filter((p) => fs.existsSync(path.join(cwd, p)) && git(["ls-files", "--error-unmatch", "--", p]).status !== 0);
    if (named.length) { for (const p of named) aside(p); act(`moved ${named.length} more untracked file(s) git named aside and retried`); m = git(["merge", "--ff-only", "origin/main"]); }
  }
  if (m.status !== 0) {
    // Put everything back as it was: the moved files and the local copies of the dirty files, so the run that follows works on its own data.
    for (const [p, to] of moved) { fs.mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true }); fs.renameSync(to, path.join(cwd, p)); }
    let back = 0;
    for (const p of dirty) { const from = path.join(keep, p); if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(cwd, p)); back++; } }
    const why = (m.stderr || m.stdout || "").trim().split("\n").map((l) => l.trim()).filter((l) => /^(error|fatal):/.test(l))[0] || (m.stderr || m.stdout || "").trim().split("\n").pop();
    return stop(`git merge --ff-only origin/main failed: ${why}; ${back} local cop${back === 1 ? "y" : "ies"} put back, also in ${keep}`);
  }
  act(`fast-forwarded to origin/main ${out(["rev-parse", "--short", "HEAD"]).trim()}`);
  for (const { file, text } of unions) { fs.writeFileSync(path.join(cwd, file), text); act(`wrote the union back to ${file}`); }
  for (const [p, to] of moved) {
    if (fs.existsSync(path.join(cwd, p))) act(`kept ${p} in ${keep} (a tracked file took the path)`);
    else { fs.mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true }); fs.renameSync(to, path.join(cwd, p)); act(`restored untracked ${p}`); }
  }
  if (dirty.length || moved.length) act(`local copies kept in ${keep}`);
  return { ok: true, changed: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = sync({ dry: process.argv.includes("--dry") });
  process.exit(r.ok ? 0 : 1);
}
