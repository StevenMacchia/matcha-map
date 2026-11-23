// npm run images: make the downloaded event pictures phone-sized (site/img/events). No image library and no native
// dependency: the pixels are redrawn by the headless Chrome the other tools already use (CHROME_PATH), through its
// DevTools protocol and a canvas. A file wider than MAX_W, or heavier than OVER bytes, is redrawn at MAX_W wide in its
// own format (jpg and webp at quality 0.82, png lossless), and kept only if it came out smaller. Same name, same type,
// so events.json needs no change; the aspect ratio stays, so the width and height on file still give the right shape.
// ingest/lib/images.js calls shrinkBuffer() for a download over its 2 MB line instead of dropping the picture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readHeader } from "../ingest/lib/images.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const MAX_W = 1200;
export const OVER = 250 * 1024;
export const WIDE = 1600;
export const THUMB_W = 400;
const TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One headless Chrome for a batch. -> { shrink(buf, ext, maxW) -> Buffer|null, close() }
export async function openShrinker() {
  if (!fs.existsSync(CHROME)) throw new Error("no Chrome at " + CHROME);
  const port = 9600 + Math.floor(Math.random() * 300);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "mm-shrink-"));
  const p = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  let list = [];
  for (let i = 0; i < 50 && !list.length; i++) {
    try { list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page"); } catch { /* starting */ }
    if (!list.length) await sleep(200);
  }
  if (!list.length) { p.kill(); throw new Error("Chrome did not start"); }
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  async function shrink(buf, ext, maxW = MAX_W, force = false) {
    const type = TYPE[ext];
    if (!type) return null;
    const src = `data:${type};base64,` + buf.toString("base64");
    const expr = `(async () => { const im = new Image(); im.src = ${JSON.stringify(src)}; await im.decode();
      const k = Math.min(1, ${maxW} / im.naturalWidth), w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
      x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, w, h);
      return c.toDataURL(${JSON.stringify(type)}, 0.82).split(",")[1]; })()`;
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    const b64 = r.result?.result?.value;
    if (!b64) return null;
    const out = Buffer.from(b64, "base64");
    return force || out.length < buf.length ? out : null;
  }
  async function close() { try { ws.close(); } catch { /* gone */ } p.kill(); await sleep(300); try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* locked */ } }
  return { shrink, close };
}

// For one buffer (ingest). -> Buffer (smaller) or null.
export async function shrinkBuffer(buf, ext, maxW = MAX_W, force = false) {
  const s = await openShrinker();
  try { return await s.shrink(buf, ext, maxW, force); } finally { await s.close(); }
}

// Skip logic (pure, no Chrome): does this file need a redraw? A file the index already has was handled once, so it
// is left alone even if it stayed over the line (a redraw that does not shrink it is not retried every run).
export function needsShrink({ size, width }, entry) {
  if (entry && entry.orig) return false;
  return size > OVER || (width || 0) > WIDE;
}
// A thumbnail is wanted for every picture that has none yet.
export const needsThumb = (hasThumb) => !hasThumb;

export async function run({ dir = path.join(ROOT, "site/img/events"), dry = false } = {}) {
  const thumbDir = path.join(dir, "thumbs"), indexPath = path.join(dir, "index.json");
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch { /* first run */ }
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const info = (f) => { const b = fs.readFileSync(path.join(dir, f)); return { b, h: readHeader(b) }; };
  const todo = files.filter((f) => { const { b, h } = info(f); return h && needsShrink({ size: b.length, width: h.width }, index[f]); });
  const thumbTodo = files.filter((f) => needsThumb(fs.existsSync(path.join(thumbDir, f))));
  const total = () => files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  const before = total();
  const r = { files: files.length, todo: todo.length, thumbs: 0, done: 0, before, after: before };
  if (dry || (!todo.length && !thumbTodo.length)) return r;
  const s = await openShrinker();
  try {
    for (const f of todo) {
      const p = path.join(dir, f), { b, h } = info(f);
      const out = await s.shrink(b, h.ext);
      index[f] = { orig: b.length, origWidth: h.width || null };
      if (out) { fs.writeFileSync(p, out); r.done++; }
    }
    fs.mkdirSync(thumbDir, { recursive: true });
    for (const f of thumbTodo) {
      const { b, h } = info(f);
      if (!h) continue;
      const out = await s.shrink(b, h.ext, THUMB_W, true);
      if (out) { fs.writeFileSync(path.join(thumbDir, f), out); r.thumbs++; }
    }
  } finally { await s.close(); }
  for (const f of files) if (fs.existsSync(path.join(thumbDir, f))) (index[f] ||= {}).thumb = `thumbs/${f}`;
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n");
  r.after = total();
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await run({ dry: process.argv.includes("--dry") });
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  console.log(`images: ${r.files} files, ${r.todo} over ${MAX_W} px or ${OVER / 1024} KB, ${r.done} redrawn, ${r.thumbs} thumbs, ${mb(r.before)} -> ${mb(r.after)}`);
}
