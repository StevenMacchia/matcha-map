// npm run og: render site/og.png (1200x630), the shared link-preview card: Mattie, the wordmark, one line.
// Same headless Chrome path as tools/flyers.js. Re-run only when the look changes; the PNG is committed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sheet = fs.readFileSync(path.join(ROOT, "site", "characters.svg"), "utf8");
const defs = '<svg width="0" height="0" style="position:absolute" xmlns="http://www.w3.org/2000/svg">' + sheet.slice(sheet.indexOf("<defs>"), sheet.indexOf("</defs>") + 7) + "</svg>";
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@700;800&display=block">
<style>*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:"M PLUS Rounded 1c",ui-rounded,Arial,sans-serif;color:#4B3426;font-weight:800;background:#FFF9EE;position:relative}
.band{position:absolute;inset:0 0 auto 0;height:380px;background:#DDEDCB}
.wave{position:absolute;left:0;top:362px;width:1200px;height:36px}
.m{position:absolute;left:70px;top:70px;width:470px;height:470px}
.t{position:absolute;left:570px;top:170px;width:600px}
.t h1{font-size:92px;line-height:1;white-space:nowrap;letter-spacing:-1px}
.t p{margin-top:30px;font-size:38px;line-height:1.2;color:#6E5040;font-weight:700}
.dots{position:absolute;inset:18px;border:4px dotted rgba(75,52,38,.3);border-radius:36px}
</style></head><body>${defs}<div class="band"></div>
<svg class="wave" viewBox="0 0 1200 36" preserveAspectRatio="none"><path d="M0 0H1200V12Q1170 36 1140 12T1080 12T1020 12T960 12T900 12T840 12T780 12T720 12T660 12T600 12T540 12T480 12T420 12T360 12T300 12T240 12T180 12T120 12T60 12T0 12Z" fill="#DDEDCB"/></svg>
<svg class="m" viewBox="0 0 64 64"><use href="#m-whisk"/></svg>
<div class="t"><h1>Matcha Map</h1><p>Every matcha pop-up, one map</p></div><div class="dots"></div></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
const file = path.join(tmp, "og.html");
const out = path.join(ROOT, "site", "og.png");
fs.writeFileSync(file, html);
const a = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1",
  `--user-data-dir=${path.join(tmp, "u")}`, `--screenshot=${out}`, "--window-size=1200,630", "--virtual-time-budget=6000", pathToFileURL(file).href];
const p = spawn(CHROME, a, { stdio: "ignore" });
const t = setTimeout(() => p.kill(), 60000);
p.on("exit", () => { clearTimeout(t); fs.rmSync(tmp, { recursive: true, force: true }); console.log(fs.existsSync(out) ? `wrote ${out}` : "render failed"); });
