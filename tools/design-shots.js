// node tools/design-shots.js --out qa/design/2026-11-23 [--only name]  Screens at 390x844 and 1440x900, light and dark.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import net from "node:net"; import { spawn } from "node:child_process";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "qa/design/2026-11-23"), ONLY = arg("--only");
const EV = "ea06c1e9874b", BR = "heyteausa";
const brand = fs.readdirSync("site/brand")[1];
const SCREENS = [["home", "/?motion=reduce"], ["card", `/?event=${EV}&motion=reduce`], ["brand", `/brand/${brand}/`], ["promote", `/promote/?event=${EV}`], ["claim", "/claim/"], ["share", `/e/${EV}/`], ["add", "/add/"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeBin = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn(process.execPath, ["tools/serve.js", "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => srv.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && r()));
const base = `http://localhost:${port}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-d-"));
const ch = spawn(chromeBin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((res) => { let b = ""; ch.stderr.on("data", (d) => { b += d; const m = b.match(/listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); });
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const cb = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && cb.has(j.id)) { cb.get(j.id)(j); cb.delete(j.id); } };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; cb.set(i, (j) => (j.error ? rej(new Error(j.error.message)) : res(j.result))); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
fs.mkdirSync(OUT, { recursive: true });
for (const [W, H] of [[390, 844], [1440, 900]]) for (const theme of ["light", "dark"]) for (const [name, url] of SCREENS) {
  if (ONLY && !ONLY.split(",").includes(name)) continue;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sid);
  await s("Page.enable"); await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("matchamap.theme","${theme}");localStorage.setItem("mm.seen","1")}catch(e){}` });
  await s("Page.navigate", { url: base + url });
  const start = Date.now(), end = start + 14000;
  while (Date.now() < end) { await sleep(300); try { const v = (await s("Runtime.evaluate", { expression: `document.querySelectorAll(".maplibregl-marker").length`, returnByValue: true })).result.value; if (v > 3 && Date.now() > start + 3000 || !/^\/($|\?)/.test(url) && Date.now() > end - 12500) break; } catch {} }
  await sleep(1800);
  const { data } = await s("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `${name}-${W}-${theme}.png`), Buffer.from(data, "base64"));
  await send("Target.closeTarget", { targetId });
}
ws.close(); ch.kill(); srv.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log("done");
