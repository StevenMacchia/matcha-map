// npm run smoke [-- --url <base>]: load the site in headless Chrome with a fresh profile and fail when it does not come up.
// Checks the home page at 1440 and 390: no uncaught error in the console, the "Brewing" loader gone, at least one
// rendered pin and at least one list row. Without --url it serves site/ itself on a free port. Exit 1 on any failure.
// Needs Chrome: CHROME env, or the usual Windows, macOS and Linux paths below.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const urlArg = argv.includes("--url") ? argv[argv.indexOf("--url") + 1] : null;
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!CHROME) { console.error("smoke: Chrome not found (set CHROME)"); process.exit(2); }

const SITE = path.resolve("site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(SITE, p);
      if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}

function run(base, w, h) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mm-smoke-"));
  // SMOKE_BUDGET (ms of virtual time) is raised for a remote site, where the map library and tiles arrive slower than from localhost.
  const budget = +(process.env.SMOKE_BUDGET || (urlArg && /^https?:\/\/(?!(localhost|127\.0\.0\.1))/.test(urlArg) ? 25000 : 12000));
  const args = (dump) => ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`, `--window-size=${w},${h}`, `--virtual-time-budget=${budget}`,
    "--enable-logging=stderr", "--v=0", dump ? "--dump-dom" : "--screenshot=" + path.join(profile, "warm.png"), `${base}/?smoke=1&motion=reduce`];
  // Two loads on one fresh profile: the first warms the HTTP cache with the map library from unpkg (virtual time does not wait
  // for a slow real download, so a cold load can dump the page before the map exists); the second is the one measured.
  spawnSync(CHROME, args(false), { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 90000 });
  const r = spawnSync(CHROME, args(true), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 90000 });
  fs.rmSync(profile, { recursive: true, force: true });
  const dom = r.stdout || "", log = r.stderr || "";
  const uncaught = log.split(/\r?\n/).filter((l) => /CONSOLE.*(Uncaught|TypeError|ReferenceError|SyntaxError)/.test(l)).map((l) => l.replace(/^.*CONSOLE/, "CONSOLE").slice(0, 200));
  const pins = (dom.match(/class="[^"]*\bmaplibregl-marker\b/g) || []).length; // MapLibre adds its class after the pin's own
  const rows = (dom.match(/class="row\b/g) || []).length;
  return { w, h, pins, rows, uncaught, brewing: null, exit: r.status };
}

const own = urlArg ? null : await serve();
const base = urlArg || own.base;
let failed = false;
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const o = run(base, w, h);
  const bad = o.uncaught.length || o.pins === 0 || o.rows === 0;
  console.log(`${w}x${h}: ${o.pins} pins, ${o.rows} rows, ${o.uncaught.length} uncaught${o.brewing ? ", " + o.brewing : ""} -> ${bad ? "FAIL" : "ok"}`);
  for (const u of o.uncaught) console.log("  " + u);
  if (bad) failed = true;
}
if (own) own.server.close();
process.exit(failed ? 1 : 0);
