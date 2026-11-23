// npm run og: render site/og.png (1200x630), the shared link-preview card: Mattie, the wordmark, one line.
// Same headless Chrome path as tools/flyers.js. Re-run only when the look changes; the PNG is committed.
// Also exports the per-city variants (cityCardHtml, renderCards) used by tools/gen-weekend.js: one Chrome, many cards,
// written to site/og/weekend-<city>.png and site/og/city-<slug>.png. Each stays well under 150 KB (flat colours).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const MAX_OG_BYTES = 150 * 1024;

function defsOf(root = ROOT) {
  const sheet = fs.readFileSync(path.join(root, "site", "characters.svg"), "utf8");
  return '<svg width="0" height="0" style="position:absolute" xmlns="http://www.w3.org/2000/svg">' + sheet.slice(sheet.indexOf("<defs>"), sheet.indexOf("</defs>") + 7) + "</svg>";
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const HEAD = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@700;800&display=block">`;
const BASE_CSS = `*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:"M PLUS Rounded 1c",ui-rounded,Arial,sans-serif;color:#4B3426;font-weight:800;background:#FFF9EE;position:relative}
.band{position:absolute;inset:0 0 auto 0;height:380px;background:#DDEDCB}
.wave{position:absolute;left:0;top:362px;width:1200px;height:36px}
.m{position:absolute;left:70px;top:70px;width:470px;height:470px}
.t{position:absolute;left:570px;top:170px;width:600px}
.t h1{font-size:92px;line-height:1;white-space:nowrap;letter-spacing:-1px}
.t p{margin-top:30px;font-size:38px;line-height:1.2;color:#6E5040;font-weight:700}
.dots{position:absolute;inset:18px;border:4px dotted rgba(75,52,38,.3);border-radius:36px}`;
const WAVE = `<svg class="wave" viewBox="0 0 1200 36" preserveAspectRatio="none"><path d="M0 0H1200V12Q1170 36 1140 12T1080 12T1020 12T960 12T900 12T840 12T780 12T720 12T660 12T600 12T540 12T480 12T420 12T360 12T300 12T240 12T180 12T120 12T60 12T0 12Z" fill="#DDEDCB"/></svg>`;

export function baseHtml(root = ROOT) {
  return `${HEAD}<style>${BASE_CSS}</style></head><body>${defsOf(root)}<div class="band"></div>${WAVE}
<svg class="m" viewBox="0 0 64 64"><use href="#m-whisk"/></svg>
<div class="t"><h1>Matcha Map</h1><p>Every matcha pop-up, one map</p></div><div class="dots"></div></body></html>`;
}

// A city card: a small tag ("This weekend"), the city, one line. Long city names shrink to fit.
export function cityCardHtml({ tag, city, line, root = ROOT }) {
  const size = city.length > 20 ? 52 : city.length > 15 ? 64 : city.length > 10 ? 78 : 92;
  const css = `${BASE_CSS}
.m{left:50px;top:90px;width:430px;height:430px}.t{left:520px;top:130px;width:650px}
.tag{display:inline-block;padding:8px 22px;border:4px solid #6E9A5E;border-radius:999px;background:#FFFDF7;font-size:30px;margin-bottom:26px}
.t h1{font-size:${size}px;white-space:normal;line-height:1.05}
.t p{margin-top:26px;font-size:42px}.brand{position:absolute;right:56px;bottom:44px;font-size:28px;color:#6E5040}`;
  return `${HEAD}<style>${css}</style></head><body>${defsOf(root)}<div class="band"></div>${WAVE}
<svg class="m" viewBox="0 0 64 64"><use href="#m-whisk"/></svg>
<div class="t"><span class="tag">${esc(tag)}</span><h1>${esc(city)}</h1><p>${esc(line)}</p></div><div class="brand">Matcha Map</div><div class="dots"></div></body></html>`;
}

// Render many cards with one headless Chrome over the DevTools protocol. jobs: [{ html, out }]. Returns the files written.
export async function renderCards(jobs, { chrome = CHROME, timeoutMs = 120000 } = {}) {
  if (!jobs.length) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1",
    "--remote-debugging-port=0", `--user-data-dir=${path.join(tmp, "u")}`, "--window-size=1200,630", "about:blank"], { stdio: "ignore" });
  const done = [];
  const kill = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const portFile = path.join(tmp, "u", "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
    if (!fs.existsSync(portFile)) return done;
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let n = 0; const waiting = new Map(); const listeners = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else listeners.forEach((f) => f(d)); };
    const send = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
    for (const j of jobs) {
      const file = path.join(tmp, "card.html");
      fs.writeFileSync(file, j.html);
      const loaded = new Promise((res) => { const f = (d) => { if (d.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(f), 1); res(); } }; listeners.push(f); });
      await send("Page.navigate", { url: pathToFileURL(file).href });
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
      await send("Runtime.evaluate", { expression: "Promise.race([document.fonts.ready, new Promise(r=>setTimeout(r,4000))])", awaitPromise: true });
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
      if (shot.result && shot.result.data) {
        const buf = Buffer.from(shot.result.data, "base64");
        fs.mkdirSync(path.dirname(j.out), { recursive: true });
        fs.writeFileSync(j.out, buf); done.push(j.out);
      }
    }
    ws.close();
  } catch (e) {
    console.warn("og cards: " + e.message);
  } finally {
    clearTimeout(kill); proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* chrome may still hold the profile */ }
  }
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
  const file = path.join(tmp, "og.html");
  const out = path.join(ROOT, "site", "og.png");
  fs.writeFileSync(file, baseHtml());
  const a = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1",
    `--user-data-dir=${path.join(tmp, "u")}`, `--screenshot=${out}`, "--window-size=1200,630", "--virtual-time-budget=6000", pathToFileURL(file).href];
  const p = spawn(CHROME, a, { stdio: "ignore" });
  const t = setTimeout(() => p.kill(), 60000);
  p.on("exit", () => { clearTimeout(t); fs.rmSync(tmp, { recursive: true, force: true }); console.log(fs.existsSync(out) ? `wrote ${out}` : "render failed"); });
}
