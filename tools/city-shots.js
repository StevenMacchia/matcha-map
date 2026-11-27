// node tools/city-shots.js --out qa/city-pages/2026-11-27 --pages nc/raleigh,nc/clayton [--sizes 390,1280] [--dark]
// Full-page screenshots of city pages over headless Chrome (CDP): site/ is served by tools/serve.js, motion is off, the page is scrolled
// once so lazy pictures load. Writes <out>/<slug>-<st>-<width>[-dark].png and prints the page height.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import net from "node:net"; import { spawn } from "node:child_process";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "qa/city-pages"), PAGES = arg("--pages", "nc/raleigh").split(","), SIZES = arg("--sizes", "390,1280").split(",").map(Number), DARK = process.argv.includes("--dark");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeBin = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn(process.execPath, ["tools/serve.js", "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => srv.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && r()));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-c-"));
const ch = spawn(chromeBin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((res) => { let b = ""; ch.stderr.on("data", (d) => { b += d; const m = b.match(/listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); });
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const cb = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && cb.has(j.id)) { cb.get(j.id)(j); cb.delete(j.id); } };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; cb.set(i, (j) => (j.error ? rej(new Error(j.error.message)) : res(j.result))); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
fs.mkdirSync(OUT, { recursive: true });
for (const pg of PAGES) for (const W of SIZES) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sid);
  await s("Page.enable"); await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 500 });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("matchamap.theme","${DARK ? "dark" : "light"}")}catch(e){}` });
  await s("Page.navigate", { url: `http://localhost:${port}/city/${pg}/` });
  await sleep(1500);
  if (!process.argv.includes("--sticky")) await s("Runtime.evaluate", { expression: "document.head.insertAdjacentHTML('beforeend', '<style>.cv-sticky{display:none!important}</style>')" }); // a full-page capture would drop the phone button mid-page
  const H = (await s("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true })).result.value;
  for (let y = 0; y < H; y += 600) { await s("Runtime.evaluate", { expression: `scrollTo(0,${y})` }); await sleep(120); }
  await s("Runtime.evaluate", { expression: "scrollTo(0,0)" }); await sleep(600);
  const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  const f = path.join(OUT, `${pg.split("/")[1]}-${pg.split("/")[0]}-${W}${DARK ? "-dark" : ""}.png`);
  fs.writeFileSync(f, Buffer.from(data, "base64")); console.log(f, `${W}x${H}`);
  await send("Target.closeTarget", { targetId });
}
ws.close(); ch.kill(); srv.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
