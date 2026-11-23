// npm run loop:    watch every hour; discover and ingest every 6 hours (with a watch pass each time), while this process is open.
// npm run refresh: discover -> watch -> ingest once, then exit.
// Each step is its own child process, so one crash never stops the cycle. Needs no keys.
// Flags: --once (same as refresh) | --every <hours> for discover + ingest (default 6) | --watch-every <hours> (default 1) | --verbose (pass step output through)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const once = argv.includes("--once");
const verbose = argv.includes("--verbose");
const hours = argv.includes("--every") ? Number(argv[argv.indexOf("--every") + 1]) : 6;
const watchHours = argv.includes("--watch-every") ? Number(argv[argv.indexOf("--watch-every") + 1]) : 1;
if (!(hours > 0) || !(watchHours > 0)) { console.error("--every and --watch-every need a number of hours above 0"); process.exit(2); }

const WATCH = ["watch", ["ingest/watch.js"]];
// The full cycle (discover, watch, ingest) and the hourly one (watch alone).
const FULL = [["discover", ["ingest/lib/discover.js"]], WATCH, ["ingest", ["ingest/run.js"]]];

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const say = (m) => console.log(`[${stamp()}] ${m}`);

function runStep(args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let tail = "";
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    current = child;
    const take = (d) => { tail = (tail + d).slice(-4000); if (verbose) process.stdout.write(d); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (e) => { current = null; resolve({ ok: false, secs: 0, note: e.message }); });
    child.on("close", (code) => {
      current = null;
      const last = tail.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      resolve({ ok: code === 0, secs: Math.round((Date.now() - t0) / 1000), note: code === 0 ? "" : `exit ${code}: ${last.slice(0, 120)}` });
    });
  });
}

function counts() {
  try {
    const e = JSON.parse(fs.readFileSync(path.join(ROOT, "data/events.json"), "utf8")).events;
    const w = JSON.parse(fs.readFileSync(path.join(ROOT, "data/watchlist.json"), "utf8")).accounts;
    return `${e.length} events, ${e.filter((x) => x.status === "upcoming").length} upcoming, ${w.length} watched`;
  } catch { return "counts unavailable"; }
}

let current = null, stopping = false, running = false, timer = null;

async function cycle(STEPS = FULL) {
  if (running) return;
  running = true;
  const parts = [];
  for (const [name, args] of STEPS) {
    if (stopping) break;
    const r = await runStep(args);
    parts.push(`${name} ${r.ok ? "ok" : "FAILED"} ${r.secs}s${r.note ? ` (${r.note})` : ""}`);
  }
  running = false;
  if (parts.length) say(`${parts.join(" | ")} | ${counts()}`);
  return parts.length === STEPS.length && !parts.some((p) => p.includes("FAILED"));
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (current) try { current.kill(); } catch { /* already gone */ }
  say("stopped");
  setTimeout(() => process.exit(0), 200);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (once) {
  const ok = await cycle(FULL);
  process.exit(ok ? 0 : 1);
} else {
  say(`loop started: watch every ${watchHours} h, discover and ingest every ${hours} h. Ctrl+C to stop.`);
  await cycle(FULL);
  if (!stopping) {
    // One hourly tick; every `hours` hours it is the full cycle, otherwise the watch pass alone.
    const every = Math.max(1, Math.round(hours / watchHours));
    let tick = 0;
    timer = setInterval(() => { tick++; cycle(tick % every === 0 ? FULL : [WATCH]); }, watchHours * 3600 * 1000);
    say(`next run at ${new Date(Date.now() + watchHours * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16)}`);
  }
}
