// node tools/card-shots.js --out qa/cards/2026-11-23/shots [--cases id@390:light,id@1440:dark] [--snap full|peek] [--font 20]
// Screenshots of the event card the way the gate opens it (/?event=<id>&motion=reduce, the going strip shown with a count).
// Without --cases: a dated event with a photo, the city-only event and a no-photo brand, each as the sheet at 390 light and
// dark and the pop-up at 1440 light, plus a 320 light sheet and a 1920 light pop-up. Phone shots are taken at the sheet's
// full snap (the whole card) unless --snap peek.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import net from "node:net"; import { spawn } from "node:child_process";
import { pickFixtures } from "./card-gate.js";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "qa/cards/2026-11-23/shots"), SNAP = arg("--snap", "full"), FONT = +arg("--font", 16);
const HEIGHT = { 320: 568, 360: 740, 390: 844, 430: 932, 768: 1024, 1024: 768, 1280: 720, 1440: 900, 1920: 1080 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = JSON.parse(fs.readFileSync("site/data/events.json", "utf8")).events, brands = JSON.parse(fs.readFileSync("site/data/brands.json", "utf8")).brands;
let cases;
if (arg("--cases")) cases = arg("--cases").split(",").map((c) => { const [id, rest] = c.split("@"), [w, theme] = rest.split(":"); return { name: id, id, w: +w, theme: theme || "light" }; });
else {
  const fx = pickFixtures(events, brands), get = (n) => fx.find((f) => f.name === n).id;
  const now = Date.now(), photo = events.find((e) => e.status !== "past" && Date.parse(e.start) > now && e.image && e.image.local && e.venue && !e.approx && Array.isArray(e.menu) && e.menu.length >= 2 && e.description);
  const set = [["dated-photo", photo.id], ["city-only", get("city only")], ["no-photo", get("no photo")]];
  cases = [];
  for (const [name, id] of set) cases.push({ name, id, w: 390, theme: "light" }, { name, id, w: 390, theme: "dark" }, { name, id, w: 1440, theme: "light" });
  cases.push({ name: "dated-photo", id: photo.id, w: 320, theme: "light" }, { name: "dated-photo", id: photo.id, w: 1920, theme: "light" });
}
const chromeBin = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => p && fs.existsSync(p));
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn(process.execPath, ["tools/serve.js", "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => srv.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && r()));
const base = `http://localhost:${port}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cs-"));
const ch = spawn(chromeBin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((res) => { let b = ""; ch.stderr.on("data", (d) => { b += d; const m = b.match(/listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); });
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const cb = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && cb.has(j.id)) { cb.get(j.id)(j); cb.delete(j.id); } };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; cb.set(i, (j) => (j.error ? rej(new Error(j.error.message)) : res(j.result))); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
fs.mkdirSync(OUT, { recursive: true });
for (const c of cases) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sid);
  const ev = async (expression) => (await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await s("Page.enable"); await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: c.w, height: HEIGHT[c.w] || 900, deviceScaleFactor: 1, mobile: c.w < 500 });
  if (FONT !== 16) await s("Page.setFontSizes", { fontSizes: { standard: FONT, fixed: FONT } });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("matchamap.theme","${c.theme}");localStorage.setItem("mm.seen","1")}catch(e){}` });
  await s("Page.navigate", { url: `${base}/?event=${c.id}&motion=reduce` });
  for (const end = Date.now() + 20000; Date.now() < end;) { await sleep(300); try { if (await ev(`!!document.querySelector("#sheet:not([hidden]) .mm-card, .mm-pop .mm-card")`)) break; } catch { /* loading */ } }
  await ev(`document.fonts.ready.then(() => 1)`); await sleep(1500);
  await ev(`document.querySelectorAll("[data-mm-go]").forEach((s) => { s.hidden = false; s.querySelector(".mm-gcount").textContent = "You and 12 others going"; })`);
  if (c.w < 900 && SNAP === "full") await ev(`(() => { const g = document.querySelector(".sheet-grip"); if (g && !g.hidden && document.getElementById("sheet").classList.contains("peek")) g.click(); })()`);
  await sleep(600);
  const { data } = await s("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, `${c.name}-${c.w < 900 ? "sheet" : "popup"}-${c.w}-${c.theme}${FONT !== 16 ? "-font" + FONT : ""}.png`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log(file, c.id);
  await send("Target.closeTarget", { targetId });
}
ws.close(); ch.kill(); srv.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ }
