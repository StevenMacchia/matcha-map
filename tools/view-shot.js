// node tools/view-shot.js --at 31.3,-99.3,5 --out shots/tx-z5.png [--size 1440x900] [--url http://127.0.0.1:8791] [--wait 15000]
// A screenshot of one map view for review: headless Chrome over the DevTools protocol, waiting until the pins and the list
// are on the page (Chrome's own --screenshot with a virtual-time budget often fires before the markers exist). Without
// --url it serves site/ itself on a free port. The view comes from the app's ?at=lat,lng,zoom parameter; motion is off.
// Needs Chrome (CHROME_PATH, or the usual install paths). Prints the pin and row counts; exit 1 when no pin appeared.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const AT = arg("--at"), OUT = arg("--out"), SIZE = arg("--size", "1440x900"), URL_ARG = arg("--url"), WAIT = +arg("--wait", 15000), DARK = process.argv.includes("--dark"), CLICK = arg("--click"), LIST = process.argv.includes("--list"), OPEN = arg("--open");
if (!AT || !OUT) { console.error("usage: node tools/view-shot.js --at lat,lng,zoom --out file.png [--size WxH] [--url base] [--wait ms] [--dark] [--click \"label text\"] [--list] [--open b:<id>]"); process.exit(2); }
const [W, H] = SIZE.split("x").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  return process.env.CHROME_PATH || process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
function serve() {
  const SITE = path.resolve("site");
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(SITE, p);
      if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${s.address().port}`, stop() { s.close(); } }));
  });
}
async function startChrome(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-shot-"));
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "about:blank"];
  if (process.env.CI || (process.getuid && process.getuid() === 0)) args.push("--no-sandbox", "--disable-dev-shm-usage");
  const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const ws = await new Promise((res, rej) => {
    let buf = "";
    p.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
    p.on("exit", (c) => rej(new Error("Chrome exited " + c)));
    setTimeout(() => rej(new Error("Chrome did not start")), 20000);
  });
  return { ws, stop() { p.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked on Windows */ } } };
}
class CDP {
  constructor(url) { this.id = 0; this.cb = new Map(); this.ws = new WebSocket(url); }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error("CDP socket error")); this.ws.onmessage = (m) => this.#msg(JSON.parse(m.data)); }); }
  #msg(m) { if (m.id && this.cb.has(m.id)) { const { res, rej } = this.cb.get(m.id); this.cb.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.cb.set(id, { res, rej })); }
  close() { this.ws.close(); }
}

const PROBE = `(() => { const q = (s) => document.querySelectorAll(s).length; const l = document.getElementById("loading");
  return { rows: q("#list .row, #list .mm-row"), pins: q(".maplibregl-marker"), loading: !!l && !l.hidden && getComputedStyle(l).display !== "none" }; })()`;

const bin = findChrome();
if (!bin) { console.error("view-shot: no Chrome found. Set CHROME_PATH."); process.exit(2); }
const own = URL_ARG ? null : await serve(), base = URL_ARG || own.base;
const chrome = await startChrome(bin), cdp = new CDP(chrome.ws);
let code = 0;
try {
  await cdp.open();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sid);
  await Promise.all([s("Page.enable"), s("Runtime.enable")]);
  await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  if (DARK) await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await s("Page.navigate", { url: `${base}/?at=${AT}&motion=reduce` });
  const probe = async () => (await s("Runtime.evaluate", { expression: PROBE, returnByValue: true })).result.value;
  const end = Date.now() + WAIT;
  let st = { pins: 0, rows: 0, loading: true };
  while (Date.now() < end) { try { st = await probe(); } catch { /* navigating */ } if (st.pins > 0 && st.rows > 0 && !st.loading) break; await sleep(250); }
  // --click "<text>": press the first map marker whose label contains the text (a city pin, a cluster), then wait for the
  // move and the markers that follow it, so the screenshot shows what a visitor gets after that tap.
  if (CLICK) {
    const hit = (await s("Runtime.evaluate", { returnByValue: true, expression: `(() => { const b = [...document.querySelectorAll(".maplibregl-marker button, .maplibregl-marker")]
      .find((e) => (e.getAttribute("aria-label") || "").includes(${JSON.stringify(CLICK)})); if (!b) return null; b.click(); return b.getAttribute("aria-label"); })()` })).result.value;
    if (!hit) { console.error(`view-shot: no marker labelled "${CLICK}"`); code = 1; }
    else { await sleep(2500); st = await probe(); const z = (await s("Runtime.evaluate", { returnByValue: true, expression: "window.__matcha && window.__matcha.map.getZoom()" })).result.value; console.log(`clicked "${hit}" -> zoom ${z && z.toFixed(2)}`); }
  }
  // --list: the phone list view (the sheet pulled up), through the list grip the visitor taps
  if (LIST) { await s("Runtime.evaluate", { expression: `(() => { const g = document.getElementById("list-grip"); if (g && !document.body.classList.contains("show-list")) g.click(); })()` }); await sleep(900); }
  // --open <key>: open one card ("b:<source id>", "s:<id>", "e:<id>") the way a list row does
  if (OPEN) { const ok = (await s("Runtime.evaluate", { returnByValue: true, expression: `(() => { const o = window.MatchaCards && window.MatchaCards.open; if (!o) return false; o(${JSON.stringify(OPEN)}); return true; })()` })).result.value; if (!ok) { console.error("view-shot: cannot open " + OPEN); code = 1; } await sleep(2500); }
  await sleep(1500); // tiles and the last marker animations
  const shot = await s("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log(`${OUT}: ${W}x${H} at ${AT}, ${st.pins} pins, ${st.rows} rows${st.loading ? ", still loading" : ""}`);
  if (st.pins === 0) code = 1;
  await cdp.send("Target.closeTarget", { targetId });
} finally {
  cdp.close(); chrome.stop(); if (own) own.stop();
}
process.exit(code);
