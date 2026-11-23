// npm run icons: render the app icons (site/icons/) from Mattie's face on the cream background.
// Same headless Chrome path as tools/gen-og.js. Re-run only when the look changes; the PNGs are committed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sheet = fs.readFileSync(path.join(ROOT, "site", "characters.svg"), "utf8");
const defs = '<svg width="0" height="0" style="position:absolute" xmlns="http://www.w3.org/2000/svg">' + sheet.slice(sheet.indexOf("<defs>"), sheet.indexOf("</defs>") + 7) + "</svg>";
// size px, face as a share of the square. The maskable icon keeps the face inside the 80 percent safe circle.
const ICONS = [
  { file: "icon-192.png", size: 192, face: 0.78 },
  { file: "icon-512.png", size: 512, face: 0.78 },
  { file: "icon-maskable-512.png", size: 512, face: 0.56, full: true },
  { file: "apple-touch-icon.png", size: 180, face: 0.7, full: true },
  { file: "favicon-32.png", size: 32, face: 0.92 },
];
const OUT = path.join(ROOT, "site", "icons");
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));

function render(i) {
  const f = Math.round(i.size * i.face), pad = Math.round((i.size - f) / 2);
  const round = i.full ? "0" : Math.round(i.size * 0.22) + "px";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}html,body{width:${i.size}px;height:${i.size}px;overflow:hidden;background:transparent}
.b{width:${i.size}px;height:${i.size}px;background:#FBF6EA;border-radius:${round};position:relative}
svg.m{position:absolute;left:${pad}px;top:${pad}px;width:${f}px;height:${f}px}</style></head><body>${defs}<div class="b"><svg class="m" viewBox="0 0 64 64"><use href="#m-base"/></svg></div></body></html>`;
  const file = path.join(tmp, i.file + ".html"), out = path.join(OUT, i.file);
  fs.writeFileSync(file, html);
  const a = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1", "--default-background-color=00000000",
    `--user-data-dir=${path.join(tmp, "u-" + i.file)}`, `--screenshot=${out}`, `--window-size=${i.size},${i.size}`, "--virtual-time-budget=3000", pathToFileURL(file).href];
  return new Promise((res) => {
    const p = spawn(CHROME, a, { stdio: "ignore" });
    const t = setTimeout(() => p.kill(), 60000);
    p.on("exit", () => { clearTimeout(t); console.log(fs.existsSync(out) ? `wrote ${out}` : `render failed: ${i.file}`); res(); });
  });
}
for (const i of ICONS) await render(i);
fs.rmSync(tmp, { recursive: true, force: true });
