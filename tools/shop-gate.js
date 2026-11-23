// npm run gate:shop: open the storefront card (site/shopcard.js) on the real map for six fixture shops at nine widths,
// light and dark, base font 16 and 20 px, and fail on anything out of its box. Steven's gate for card work: no bugs, no
// overlaps, nothing coming out of its box. A case fails when, inside the card:
//   - an element is outside the viewport by more than 1 px (vertically only when no scrolling box holds it; the phone
//     sheet counts as one: it opens at peek, half the map, with the rest one drag up);
//   - an element is outside its parent by more than 1 px, except descendants of absolute or fixed boxes (viewport only)
//     and except along the scroll axis of a scrolling parent;
//   - two sibling block, flex or grid boxes intersect by more than 1 px;
//   - an element with white-space nowrap, text-overflow ellipsis or -webkit-line-clamp is wider inside than out (no
//     allowed selectors: the card uses none of them);
//   - the action row is not fully in view without scrolling (sheet: in the viewport; pop-up: inside the pop-up content).
// Failures get a screenshot in qa/shop/<date>/fail/. Exit 1 on any failure.
// Flags: --only <fixture,...> --widths 390,1440 --themes light --fonts 16 (a reduced run) --shots (also write the review
//   shots to qa/shop/<date>/shots/) --port <n> (serve.js port; default a free one) --date YYYY-MM-DD.
// Talks to Chrome over the DevTools protocol with Node's built-in WebSocket (Node 22+), no dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const list = (k, d) => String(arg(k, d)).split(",").map((s) => s.trim()).filter(Boolean);
const DATE = arg("--date", "2026-11-23");
const OUT = path.join(ROOT, "qa", "shop", DATE);
const HEIGHT = { 320: 568, 360: 740, 390: 844, 430: 932, 768: 1024, 1024: 768, 1280: 800, 1440: 900, 1920: 1080 };
const WIDTHS = list("--widths", Object.keys(HEIGHT).join(",")).map(Number);
const THEMES = list("--themes", "light,dark"), FONTS = list("--fonts", "16,20").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fixtures from site/data/shops.json, picked by what they stress (the ids are checked against the data below).
const SHOPS = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "shops.json"), "utf8")).shops;
const itemLen = (s) => Math.max(0, ...((s.menu && s.menu.items) || []).map((i) => (i.name || "").length + (i.note || "").length + (i.price || "").length));
const pick = (f) => SHOPS.slice().sort(f)[0];
const FIX = [
  ["most-items", pick((a, b) => ((b.menu && b.menu.items.length) || 0) - ((a.menu && a.menu.items.length) || 0))],
  ["longest-lines", pick((a, b) => itemLen(b) - itemLen(a))],
  ["menu-note", SHOPS.find((s) => s.menu && s.menu.note)],
  ["no-menu", SHOPS.find((s) => !s.menu && s.website && s.opening_hours && /;.*;.*;/.test(s.opening_hours)) || SHOPS.find((s) => !s.menu)],
  ["no-photo", SHOPS.find((s) => !s.menu && !s.image && !s.website && !s.instagram) || SHOPS.find((s) => !s.image)],
  ["longest-name", pick((a, b) => (b.name + b.address + b.city).length - (a.name + a.address + a.city).length)],
].filter(([, s]) => s).map(([name, s]) => ({ name, id: s.id, label: s.name }));
const ONLY = arg("--only") ? list("--only") : null;

function findChrome() {
  const c = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return c.find((p) => p && fs.existsSync(p));
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
async function startServer() {
  const given = process.env.GATE_URL;
  if (given) return { base: given.replace(/\/$/, ""), stop() {} };
  const port = +arg("--port", 0) || await freePort();
  const p = spawn(process.execPath, [path.join(ROOT, "tools", "serve.js"), "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res, rej) => {
    p.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && res());
    p.on("exit", (c) => rej(new Error("serve.js exited " + c)));
    setTimeout(() => rej(new Error("serve.js did not start")), 10000);
  });
  return { base: `http://localhost:${port}`, stop() { p.kill(); } };
}
async function startChrome(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-shopgate-"));
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
  return { ws, stop() { p.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked on Windows */ } } };
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

// In the page: is the card for this shop open and settled? Returns the card's root or null.
const FIND = (id) => `(() => {
  const href = "?shop=" + encodeURIComponent(${JSON.stringify(id)});
  const cards = [...document.querySelectorAll(".mm-shop")].filter((c) => { const a = c.querySelector(".mm-shop-share"); return a && a.getAttribute("href") === href; });
  return cards.length ? (innerWidth >= 900 ? "pop" : "sheet") : "";
})()`;
// In the page: every rule above, for the open card. Returns a list of failure strings.
const CHECK = `(() => {
  const out = [], card = document.querySelector(innerWidth >= 900 ? ".mm-pop .mm-shop" : "#sheet-body .mm-shop");
  if (!card) return ["no storefront card open"];
  const W = innerWidth, H = innerHeight, T = 1;
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\\s+/).join("."); return s; };
  const cs = (el) => getComputedStyle(el);
  const scrolls = (el, ax) => { const o = cs(el)["overflow" + ax]; return (o === "auto" || o === "scroll") && (ax === "Y" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1); };
  // the phone sheet is a drag surface: it opens at peek, translated down with the rest one drag away, so it counts as a vertical scroller
  const scrollerAbove = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (scrolls(p, "Y") || p.id === "sheet") return p; return null; };
  const absUnder = (el) => { for (let p = el; p && p !== card.parentElement; p = p.parentElement) { const q = cs(p).position; if (q === "absolute" || q === "fixed") return true; } return false; };
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && cs(el).display !== "none" && cs(el).visibility !== "hidden"; };
  const els = [card, ...card.querySelectorAll("*")].filter((el) => !el.closest("svg") || el.tagName.toLowerCase() === "svg").filter(shown);
  for (const el of els) {
    const r = el.getBoundingClientRect(), n = name(el);
    // the viewport
    if (r.left < -T || r.right > W + T) out.push(n + " leaves the viewport sideways (" + Math.round(r.left) + " to " + Math.round(r.right) + " of " + W + ")");
    if (!scrollerAbove(el) && (r.top < -T || r.bottom > H + T)) out.push(n + " leaves the viewport (" + Math.round(r.top) + " to " + Math.round(r.bottom) + " of " + H + ")");
    // its parent
    const p = el.parentElement;
    if (p && el !== card && !absUnder(el)) {
      const q = p.getBoundingClientRect();
      if (!scrolls(p, "X") && (r.left < q.left - T || r.right > q.right + T)) out.push(n + " is wider than its parent " + name(p) + " (" + Math.round(Math.max(q.left - r.left, r.right - q.right)) + " px)");
      if (!scrolls(p, "Y") && cs(p).overflowY !== "auto" && (r.top < q.top - T || r.bottom > q.bottom + T)) out.push(n + " sticks out of its parent " + name(p) + " (" + Math.round(Math.max(q.top - r.top, r.bottom - q.bottom)) + " px)");
    }
    // nowrap, ellipsis, line clamp: never clipped
    const c = cs(el);
    if ((/nowrap|pre/.test(c.whiteSpace) || c.textOverflow === "ellipsis" || (c.webkitLineClamp && c.webkitLineClamp !== "none")) && el.scrollWidth > el.clientWidth + T && el.tagName.toLowerCase() !== "svg")
      out.push(n + " is cut off (" + el.scrollWidth + " in " + el.clientWidth + ")");
  }
  // siblings
  const boxy = (el) => /^(block|flex|grid|list-item|inline-block|inline-flex|inline-grid|flow-root|table)$/.test(cs(el).display) && !/absolute|fixed/.test(cs(el).position);
  for (const p of [card, ...card.querySelectorAll("*")]) {
    const kids = [...p.children].filter((k) => !k.closest("svg") && shown(k) && boxy(k));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > T && y > T) out.push(name(kids[i]) + " and " + name(kids[j]) + " overlap (" + Math.round(x) + " by " + Math.round(y) + " px)");
    }
  }
  // the action row, fully in view without scrolling
  const acts = card.querySelector(".mm-shop-acts");
  if (!acts) out.push("no action row");
  else {
    const r = acts.getBoundingClientRect(), sc = scrollerAbove(acts);
    const box = innerWidth >= 900 ? card.closest(".maplibregl-popup-content").getBoundingClientRect() : { left: 0, top: 0, right: W, bottom: H };
    const view = sc && sc.id !== "sheet" ? sc.getBoundingClientRect() : box;
    const lo = Math.max(box.top, view.top, 0), hi = Math.min(box.bottom, view.bottom, H);
    if (r.top < lo - T || r.bottom > hi + T || r.left < Math.max(box.left, 0) - T || r.right > Math.min(box.right, W) + T) out.push("the action row is not fully in view (" + Math.round(r.top) + " to " + Math.round(r.bottom) + ", visible " + Math.round(lo) + " to " + Math.round(hi) + ")");
  }
  // the sheet or the pop-up itself
  const frame = innerWidth >= 900 ? card.closest(".maplibregl-popup-content") : document.getElementById("sheet");
  const f = frame.getBoundingClientRect();
  if (f.left < -T || f.top < -T || f.right > W + T || (innerWidth >= 900 && f.bottom > H + T)) out.push((innerWidth >= 900 ? "the pop-up" : "the sheet") + " leaves the viewport (" + [f.left, f.top, f.right, f.bottom].map(Math.round).join(", ") + ")");
  return [...new Set(out)];
})()`;

async function session(cdp, base, w, h, theme, font, firstId) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const errors = [];
  cdp.listen(sid, (method, p) => { if (method === "Runtime.exceptionThrown") errors.push(((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text).split("\n")[0]); });
  const s = (m, p) => cdp.send(m, p, sid);
  await Promise.all([s("Page.enable"), s("Runtime.enable")]);
  await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await s("Page.setFontSizes", { fontSizes: { standard: font, fixed: Math.round(font * 0.8125) } });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("matchamap.theme",${JSON.stringify(theme)});localStorage.setItem("mm.seen","1");sessionStorage.setItem("matchamap.opened","1")}catch(e){}` +
    (font !== 16 ? `document.addEventListener("DOMContentLoaded",function(){var r=parseFloat(getComputedStyle(document.documentElement).fontSize);if(Math.abs(r-${font})>.5)document.documentElement.style.fontSize="${font}px";});` : "") });
  await s("Page.navigate", { url: `${base}/?motion=reduce&shop=${encodeURIComponent(firstId)}` });
  const ev = async (expr) => (await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  return { targetId, s, ev, errors, close: () => cdp.send("Target.closeTarget", { targetId }) };
}
async function waitCard(ev, id, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(FIND(id))) { await sleep(700); return true; } await sleep(200); }
  return false;
}
async function shot(s, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { data } = await s("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

const bin = findChrome();
if (!bin) { console.error("shop-gate: no Chrome found. Set CHROME_PATH."); process.exit(2); }
const fixtures = FIX.filter((f) => !ONLY || ONLY.includes(f.name));
const server = await startServer(), chrome = await startChrome(bin), cdp = new CDP(chrome.ws);
const rows = [];
let failDir = path.join(OUT, "fail");
try {
  await cdp.open();
  for (const w of WIDTHS) for (const theme of THEMES) for (const font of FONTS) {
    const h = HEIGHT[w] || 900;
    const pg = await session(cdp, server.base, w, h, theme, font, fixtures[0].id);
    for (const [i, fx] of fixtures.entries()) {
      // the first opens through the ?shop= deep link, the rest through the app's own opener (the same flyTo a pin tap uses)
      if (i > 0) await pg.ev(`(() => { if (window.MatchaCards && window.MatchaCards.open) window.MatchaCards.open(${JSON.stringify("s:" + fx.id)}); return 1; })()`);
      const ok = await waitCard(pg.ev, fx.id);
      const fails = ok ? await pg.ev(CHECK) : ["the card did not open" + (i === 0 ? " from ?shop=" : "")];
      fails.push(...pg.errors.splice(0).map((e) => "exception: " + e));
      const tag = `${fx.name}-${w}-${theme}-${font}`;
      if (fails.length) await shot(pg.s, path.join(failDir, tag + ".png"));
      rows.push({ fx: fx.name, w, theme, font, fails });
    }
    await pg.close();
  }
  if (process.argv.includes("--shots")) {
    const SHOTS = [];
    for (const fx of ["most-items", "no-menu", "no-photo"]) SHOTS.push([fx, 390, "light"], [fx, 390, "dark"], [fx, 1440, "light"]);
    SHOTS.push(["most-items", 320, "light"], ["most-items", 1920, "light"]);
    for (const [name, w, theme] of SHOTS) {
      const fx = FIX.find((f) => f.name === name);
      const pg = await session(cdp, server.base, w, HEIGHT[w], theme, 16, fx.id);
      // let the map draw its tiles under the card before the picture
      if (await waitCard(pg.ev, fx.id)) { for (let k = 0; k < 40 && !(await pg.ev("(() => { const m = window.__matcha && window.__matcha.map; return !!(m && m.loaded && m.loaded() && m.areTilesLoaded()); })()")); k++) await sleep(250); await sleep(500); await shot(pg.s, path.join(OUT, "shots", `${name}-${w}-${theme}.png`)); }
      else console.log(`shots: ${name} @${w} ${theme} did not open`);
      await pg.close();
    }
  }
} finally { cdp.close(); chrome.stop(); server.stop(); }

const pad = (v, n) => String(v).padEnd(n);
console.log("\nfixtures: " + fixtures.map((f) => `${f.name} = ${f.label} (${f.id})`).join("; "));
console.log(`\n${pad("width", 7)}${pad("theme", 7)}${pad("font", 6)}${fixtures.map((f) => pad(f.name, 15)).join("")}`);
for (const w of WIDTHS) for (const theme of THEMES) for (const font of FONTS) {
  const rs = rows.filter((r) => r.w === w && r.theme === theme && r.font === font);
  console.log(`${pad(w, 7)}${pad(theme, 7)}${pad(font, 6)}${fixtures.map((f) => { const r = rs.find((x) => x.fx === f.name); return pad(!r ? "-" : r.fails.length ? "FAIL " + r.fails.length : "ok", 15); }).join("")}`);
}
const bad = rows.filter((r) => r.fails.length);
for (const r of bad) { console.log(`\nFAIL ${r.fx} @${r.w} ${r.theme} ${r.font}px`); for (const f of r.fails.slice(0, 12)) console.log("  " + f); }
console.log(bad.length ? `\nshop-gate: ${bad.length} of ${rows.length} cases failed (screenshots in ${path.relative(ROOT, failDir)})` : `\nshop-gate: all ${rows.length} cases passed`);
process.exit(bad.length ? 1 : 0);
