// npm run loop:    discover -> watch -> ingest every 6 hours while this process is open (first run now).
// npm run refresh: the same three steps once, then exit.
// Each step is its own child process, so one crash never stops the cycle. Needs no keys.
// Flags: --once (same as refresh) | --every <hours> (default 6) | --verbose (pass step output through)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const once = argv.includes("--once");
const verbose = argv.includes("--verbose");
const hours = argv.includes("--every") ? Number(argv[argv.indexOf("--every") + 1]) : 6;
if (!(hours > 0)) { console.error("--every needs a number of hours above 0"); process.exit(2); }

const STEPS = [
  ["discover", ["ingest/lib/discover.js"]],
  ["watch", ["ingest/watch.js"]],
  ["ingest", ["ingest/run.js"]],
];

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

async function cycle() {
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
  const ok = await cycle();
  process.exit(ok ? 0 : 1);
} else {
  say(`loop started: discover, watch, ingest every ${hours} hours. Ctrl+C to stop.`);
  await cycle();
  if (!stopping) {
    timer = setInterval(() => { cycle(); }, hours * 3600 * 1000);
    say(`next run at ${new Date(Date.now() + hours * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16)}`);
  }
}
