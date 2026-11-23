// npm run smoke: serve site/, drive headless Chrome over the key pages at desktop and phone width,
// and fail on any uncaught exception, any 4xx/5xx for a same-origin asset, or an empty home page. The home page also
// loads in a 1 by 1 window and in a background tab (document.hidden, no size): a visitor's tab restored at launch or
// opened behind another one. On 2026-11-23 the stand-in map's fit threw on NaN there and the page stayed on "Brewing".
// Flags: --url <base>. Env: CHROME_PATH (Chrome binary), SMOKE_URL (reuse a running server instead of starting tools/serve.js).
// Talks to Chrome over the DevTools protocol with Node's built-in WebSocket (Node 22+), no dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const SIZES = [[1440, 900], [390, 844]];
const HOME_WAIT_MS = 10000, SETTLE_MS = 1500, PAGE_TIMEOUT_MS = 30000;

const first = (dir) => {
  try { return fs.readdirSync(path.join(SITE, dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()[0]; } catch { return null; }
};
function pages() {
  const list = ["/", "/?city=new-york-ny"];
  const st = first("city"), city = st && first("city/" + st);
  const brand = first("brand"), ev = first("e");
  if (city) list.push(`/city/${st}/${city}/`);
  if (brand) list.push(`/brand/${brand}/`);
  list.push("/add/");
  if (ev) list.push(`/promote/?event=${ev}`);
  list.push("/promote/");
  if (ev) list.push(`/e/${ev}/`, `/?event=${ev}`, `/?plan=${ev}`); // the shared-link forms: the card on the map (sometimes before the real map exists), a one-stop plan
  list.push("/weekend/", "/art/gallery.html");
  return list;
}

function findChrome() {
  const c = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return c.find((p) => p && fs.existsSync(p));
}
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
  s.on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  // --url <base> (the smoke workflow runs it against the live site) or SMOKE_URL: test that server instead of starting one.
  const ai = process.argv.indexOf("--url"), given = ai > 0 ? process.argv[ai + 1] : process.env.SMOKE_URL;
  if (given) return { base: given.replace(/\/$/, ""), stop() {}, staticOnly: false };
  const port = await freePort();
  const p = spawn(process.execPath, [path.join(ROOT, "tools", "serve.js"), "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res, rej) => {
    p.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && res());
    p.on("exit", (c) => rej(new Error("serve.js exited " + c)));
    setTimeout(() => rej(new Error("serve.js did not start")), 10000);
  });
  return { base: `http://localhost:${port}`, stop() { p.kill(); }, staticOnly: true }; // tools/serve.js has no functions: /api/* answers 404 here
}

async function startChrome(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-smoke-"));
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "about:blank"];
  if (process.env.CI || (process.getuid && process.getuid() === 0)) args.push("--no-sandbox", "--disable-dev-shm-usage");
  const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const ws = await new Promise((res, rej) => {
    let buf = "";
    p.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
    p.on("exit", (c) => rej(new Error("Chrome exited " + c)));
    setTimeout(() => rej(new Error("Chrome did not start")), 20000);
  });
  return { ws, stop() { p.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked on Windows: leave it in tmp */ } } };
}

class CDP {
  constructor(url) { this.id = 0; this.cb = new Map(); this.on = new Map(); this.ws = new WebSocket(url); }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error("CDP socket error"));
      this.ws.onmessage = (m) => this.#msg(JSON.parse(m.data));
    });
  }
  #msg(m) {
    if (m.id && this.cb.has(m.id)) { const { res, rej } = this.cb.get(m.id); this.cb.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) for (const f of this.on.get(m.sessionId || "") || []) f(m.method, m.params);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.cb.set(id, { res, rej }));
  }
  listen(sessionId, f) { this.on.set(sessionId, [...(this.on.get(sessionId) || []), f]); }
  close() { this.ws.close(); }
}

const PROBE = `(() => { const q = (s) => document.querySelectorAll(s).length; const l = document.getElementById("loading"), e = document.getElementById("empty");
  return { rows: q("#list .row, #list li"), pins: q(".maplibregl-marker"), empty: !!e && !e.hidden, loading: !!l && !l.hidden && getComputedStyle(l).display !== "none" }; })()`;

async function checkPage(cdp, base, url, [w, h], opts = {}) {
  const apiOk = (u) => opts.staticOnly && u.startsWith(origin + "/api/"); // no functions on the static server: not a page error
  const t0 = Date.now(), origin = new URL(base).origin, errors = [], reqs = new Map();
  // background: true opens the tab behind the current one, so the page loads with document.hidden and a 0 by 0 window
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", background: !!opts.background });
  const { sessionId: sid } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  let loaded;
  const loadP = new Promise((r) => (loaded = r));
  cdp.listen(sid, (method, p) => {
    if (method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails;
      errors.push("exception: " + ((d.exception && (d.exception.description || d.exception.value)) || d.text).split("\n")[0]);
    } else if (method === "Network.requestWillBeSent") reqs.set(p.requestId, p.request.url);
    else if (method === "Network.responseReceived") {
      if (p.response.url.startsWith(origin) && p.response.status >= 400 && !p.response.url.endsWith("/favicon.ico") && !apiOk(p.response.url)) errors.push(`${p.response.status} ${p.response.url.slice(origin.length)}`);
    } else if (method === "Network.loadingFailed") {
      const u = reqs.get(p.requestId) || "";
      if (u.startsWith(origin) && !p.canceled && p.errorText !== "net::ERR_ABORTED") errors.push(`failed ${u.slice(origin.length)} ${p.errorText}`);
    } else if (method === "Page.loadEventFired") loaded();
  });
  const s = (m, p) => cdp.send(m, p, sid);
  await Promise.all([s("Page.enable"), s("Runtime.enable"), s("Network.enable")]);
  await s("Network.setCacheDisabled", { cacheDisabled: true });
  if (w && h) await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await s("Page.navigate", { url: base + url });
  await Promise.race([loadP, sleep(PAGE_TIMEOUT_MS)]);
  const probe = async () => (await s("Runtime.evaluate", { expression: PROBE, returnByValue: true })).result.value;
  let st = await probe();
  const home = url === "/", needPins = home && !opts.noPins;
  if (home) {
    const end = Date.now() + HOME_WAIT_MS;
    // a window with no room in view may show the empty state ("nothing in view, go there") instead of rows
    const listed = () => st.rows >= 1 || (opts.emptyOk && st.empty);
    while (Date.now() < end && (!listed() || (needPins && st.pins < 1) || st.loading)) { await sleep(250); st = await probe(); }
    if (!listed()) errors.push("home page rendered no list rows" + (opts.emptyOk ? " and no empty state" : ""));
    if (needPins && st.pins < 1) errors.push("home page rendered no pin markers");
    if (st.loading) errors.push("home page still shows the loading state after 10 s");
  } else await sleep(SETTLE_MS);
  await sleep(300);
  let label = url + (opts.tag ? " " + opts.tag : "");
  if (opts.background) {
    // say what the tab really was, so a Chrome that stops hiding background tabs shows up in the table
    const vis = (await s("Runtime.evaluate", { expression: "document.visibilityState + ' ' + innerWidth + 'x' + innerHeight", returnByValue: true })).result.value;
    label += " (" + vis + ")";
  }
  await cdp.send("Target.closeTarget", { targetId });
  return { url: label, w, errors: [...new Set(errors)], rows: home ? st.rows : "-", pins: home ? st.pins : "-", ms: Date.now() - t0 };
}

const bin = findChrome();
if (!bin) { console.error("smoke: no Chrome found. Set CHROME_PATH."); process.exit(2); }
const server = await startServer(), chrome = await startChrome(bin);
const cdp = new CDP(chrome.ws);
const results = [];
try {
  await cdp.open();
  for (const url of pages()) for (const size of SIZES) results.push(await checkPage(cdp, server.base, url, size, { staticOnly: server.staticOnly }));
  // a window with no room (1 by 1) and a tab that loads hidden: the list must still render and nothing may throw;
  // pins are not required (nothing is in a 1 px view, and a hidden tab gets no animation frames to place them)
  results.push(await checkPage(cdp, server.base, "/", [1, 1], { tag: "1x1 window", noPins: true, emptyOk: true, staticOnly: server.staticOnly }));
  results.push(await checkPage(cdp, server.base, "/", [0, 0], { tag: "background tab", background: true, noPins: true, emptyOk: true, staticOnly: server.staticOnly }));
} finally { cdp.close(); chrome.stop(); server.stop(); }

const pad = (v, n) => String(v).padEnd(n);
console.log(`\n${pad("page", 40)}${pad("width", 7)}${pad("errors", 8)}${pad("rows", 6)}${pad("pins", 6)}time`);
for (const r of results) console.log(`${pad(r.url, 40)}${pad(r.w, 7)}${pad(r.errors.length, 8)}${pad(r.rows, 6)}${pad(r.pins, 6)}${(r.ms / 1000).toFixed(1)}s`);
const bad = results.filter((r) => r.errors.length);
for (const r of bad) { console.log(`\nFAIL ${r.url} @${r.w}`); for (const e of r.errors) console.log("  " + e); }
console.log(bad.length ? `\nsmoke: ${bad.length} of ${results.length} checks failed` : `\nsmoke: all ${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
