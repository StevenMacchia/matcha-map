// npm run gate:card: the event card's acceptance gate (design rung 3). Opens /?event=<id>&motion=reduce in headless Chrome
// for a set of hard fixtures picked from site/data/events.json at run time, at nine widths, light and dark, 16 px and 20 px
// base font, forces the going strip visible (as a visitor sees it once the API answers) and adds the Featured pill on one
// pass, then measures every element of the card root (the sheet body under 900 px, the popup content from 900 px) and fails
// the case when:
//   - an element's box leaves the viewport by more than 1 px (not along the axis a scrolling ancestor scrolls);
//   - an element's box leaves its parent's box by more than 1 px (absolute and fixed boxes and everything inside them are held
//     to the viewport only; a parent that scrolls lets its children run along the axis it scrolls);
//   - two in-flow sibling boxes (block, flex or grid items) overlap by more than 1 px both ways;
//   - an element that cannot wrap (white-space nowrap, text-overflow ellipsis, -webkit-line-clamp) is wider inside than it is
//     (scrollWidth > clientWidth + 1), except ALLOW below;
//   - the button row (.mm-dock .mm-acts) is not fully on screen without scrolling: inside the viewport and the sheet body's
//     visible box (sheet), inside the popup content with the popup not scrolling (popup);
//   - the sheet, which opens half way (motion.js), covers When and Where with its pinned row or has the row off screen there.
// The sheet is measured at both snaps: half open (the button row and the boxes), then full (everything). A sticky box (the
// pinned row) is meant to ride over what scrolls under it, so it is not counted as overlapping its siblings.
// Prints a table, saves a screenshot of every failing case to qa/cards/2026-11-23/fail/, exits 1 on any failure.
// Flags: --reduced (the smoke's matrix), --url <base> (a running server instead of tools/serve.js), --only <fixture,...>,
// --widths 320,390. Exports runCardGate(cdp, base, opts) for tools/smoke.js. No dependencies (Node 22+ WebSocket).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAIL_DIR = path.join(ROOT, "qa", "cards", "2026-11-23", "fail");
const HEIGHT = { 320: 568, 360: 740, 390: 844, 430: 932, 768: 1024, 1024: 768, 1280: 720, 1440: 900, 1920: 1080 };
export const FULL = { widths: [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920], fixtures: null };
export const REDUCED = { widths: [320, 390, 1024, 1440], fixtures: ["longest brand", "city only", "no photo", "unsure"] };
// Cut on purpose, and only here: the quote (two lines in the sheet, one in the popup); the whole text is on /e/<id>/,
// one tap away through "more" or "Full details and photo".
export const ALLOW = [".mm-q-text"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures ----------------------------------------------------------------------------------------------------
const upcoming = (e, now) => e && e.id && e.status !== "past" && e.status !== "cancelled" &&
  (Date.parse(e.end || e.start) + (e.all_day || !e.end ? 864e5 : 0)) > now && typeof e.lat === "number";
export function pickFixtures(events, brands, now = Date.now()) {
  const up = events.filter((e) => upcoming(e, now));
  const by = (f) => up.slice().sort((a, b) => f(b) - f(a))[0];
  const pics = new Map((brands || []).map((b) => [String(b.handle || "").toLowerCase(), b]));
  const hasPhoto = (e) => !!((e.image && (e.image.url || e.image.local)) || e.image_url);
  const brandPic = (e) => { const b = pics.get(String(e.handle || "").replace(/^@/, "").toLowerCase()); return !!(b && b.picture); };
  const approx = (e) => e.approx === true || (e.geocode_source === "none" && !e.address);
  const soldOut = (e) => /sold out/i.test([e.description, e.notes, e.status, e.hours].join(" "));
  const list = [
    ["longest brand", by((e) => String(e.brand || "").length)],
    ["longest venue", by((e) => String(e.venue || "").length)],
    ["longest description", by((e) => String(e.description || "").length)],
    ["city only", up.find((e) => approx(e) && !e.address)],
    ["no photo", up.find((e) => !hasPhoto(e) && !brandPic(e))],
    ["sold out", up.find(soldOut)],
    ["unsure", up.find((e) => e.confidence === "unsure")],
  ];
  return list.map(([name, e]) => ({ name, id: e ? e.id : null, label: e ? `${e.brand} (${e.id})` : "none in the data" }));
}

// ---- the checker, run in the page --------------------------------------------------------------------------------
const CHECK = (allow) => `(() => {
  const allow = ${JSON.stringify(allow)}, out = [], vw = innerWidth, vh = innerHeight, T = 1;
  const phone = !document.querySelector(".mm-pop .maplibregl-popup-content .mm-card");
  const root = phone ? document.getElementById("sheet-body") : document.querySelector(".mm-pop .maplibregl-popup-content");
  if (!root || !root.querySelector(".mm-card")) return { error: "no card" };
  const cs = (el) => getComputedStyle(el);
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  const scrolls = (el, ax) => { const s = cs(el), o = ax === "x" ? s.overflowX : s.overflowY;
    return /auto|scroll/.test(o) && (ax === "x" ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight); };
  const shown = (el) => { const s = cs(el); return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0; };
  const fail = (el, why) => { out.push(name(el) + ": " + why); };
  const els = [root, ...root.querySelectorAll("*")].filter((el) => !el.closest("svg") || el.tagName.toLowerCase() === "svg").filter(shown);
  for (const el of els) {
    const r = el.getBoundingClientRect(), s = cs(el);
    if (r.width <= 1 && r.height <= 1) continue; // nothing drawn: empty, or the visually hidden label of an icon button
    // free: an absolute or fixed box, or one inside one (held to the viewport only)
    let free = false, sx = false, sy = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a !== el && scrolls(a, "x")) sx = true;
      if (a !== el && scrolls(a, "y")) sy = true;
      if (a === root.parentElement) break;
    }
    for (let a = el; a && a !== root.parentElement; a = a.parentElement) if (/absolute|fixed/.test(cs(a).position)) { free = true; break; }
    if (!sx && (r.left < -T || r.right > vw + T)) fail(el, "leaves the viewport sideways (" + Math.round(r.left) + " to " + Math.round(r.right) + " of " + vw + ")");
    if (!sy && (r.top < -T || r.bottom > vh + T)) fail(el, "leaves the viewport (" + Math.round(r.top) + " to " + Math.round(r.bottom) + " of " + vh + ")");
    const p = el.parentElement;
    if (!free && el !== root && p) {
      const q = p.getBoundingClientRect(), px = scrolls(p, "x"), py = scrolls(p, "y");
      if (!px && (r.left < q.left - T || r.right > q.right + T)) fail(el, "leaves its parent sideways by " + Math.round(Math.max(q.left - r.left, r.right - q.right)) + " px");
      if (!py && (r.top < q.top - T || r.bottom > q.bottom + T)) fail(el, "leaves its parent by " + Math.round(Math.max(q.top - r.top, r.bottom - q.bottom)) + " px");
    }
    const clamp = s.whiteSpace === "nowrap" || s.textWrapMode === "nowrap" || s.textOverflow === "ellipsis" || (s.webkitLineClamp && s.webkitLineClamp !== "none");
    if (clamp && !/^inline$/.test(s.display) && !/auto|scroll/.test(s.overflowX) && el.scrollWidth > el.clientWidth + T && !allow.some((a) => el.matches(a)))
      fail(el, "text cut: " + el.scrollWidth + " wide in " + el.clientWidth);
  }
  // in-flow siblings that overlap
  const flow = (el) => { const s = cs(el), pd = el.parentElement ? cs(el.parentElement).display : "";
    if (/absolute|fixed|sticky/.test(s.position) || s.float !== "none") return false;
    return /flex|grid/.test(pd) || /^(block|flex|grid|list-item|table|flow-root)$/.test(s.display); };
  for (const p of els) {
    const kids = [...p.children].filter((k) => els.includes(k) && flow(k));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > T && h > T) fail(kids[j], "overlaps " + name(kids[i]) + " by " + Math.round(w) + "x" + Math.round(h));
    }
  }
  // the button row, on screen without scrolling
  const acts = root.querySelector(".mm-dock .mm-acts");
  if (!acts) out.push("no button row (.mm-dock .mm-acts)");
  else {
    const a = acts.getBoundingClientRect();
    let box = { left: 0, top: 0, right: vw, bottom: vh };
    const clip = (q) => { box = { left: Math.max(box.left, q.left), top: Math.max(box.top, q.top), right: Math.min(box.right, q.right), bottom: Math.min(box.bottom, q.bottom) }; };
    clip(root.getBoundingClientRect());
    if (!phone) { const sc = root.querySelector(":scope > div"); if (sc) { clip(sc.getBoundingClientRect()); if (sc.scrollHeight > sc.clientHeight + T) out.push("popup scrolls: " + sc.scrollHeight + " in " + sc.clientHeight); } }
    if (a.left < box.left - T || a.right > box.right + T || a.top < box.top - T || a.bottom > box.bottom + T)
      out.push("button row not fully in view (" + [a.left, a.top, a.right, a.bottom].map(Math.round) + " in " + [box.left, box.top, box.right, box.bottom].map(Math.round) + ")");
  }
  return { phone, fails: [...new Set(out)] };
})()`;

const FORCE_GOING = `document.querySelectorAll("[data-mm-go]").forEach((s) => { s.hidden = false; const c = s.querySelector(".mm-gcount"); if (c) c.textContent = "You and 12 others going"; })`;
// the same element and place featured.js uses: a span.mm-feat appended to the card's .mm-bname
const ADD_FEATURED = `document.querySelectorAll(".mm-card[data-id]").forEach((el) => { const h = el.querySelector(".mm-bname"); if (h && !el.querySelector(".mm-feat")) { const s = document.createElement("span"); s.className = "mm-feat"; s.textContent = "Featured"; h.appendChild(s); } })`;
const SET_THEME = (t) => `(() => { try { localStorage.setItem("matchamap.theme", "${t}"); } catch (e) {} if ("${t}" === "dark") document.documentElement.setAttribute("data-theme", "dark"); else document.documentElement.removeAttribute("data-theme"); })()`;
const FRAMES = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))`;
// the sheet opens half way (motion.js): there the buttons must be on screen and must not cover the When and Where boxes
const PEEK = `(() => { const out = [], vh = innerHeight, vw = innerWidth, d = document.querySelector("#sheet-body .mm-dock"), a = d && d.querySelector(".mm-acts"), b = document.querySelector("#sheet-body .mm-boxes");
  if (!a || !b) return ["half-open: no button row or no When and Where"];
  const r = a.getBoundingClientRect(), dr = d.getBoundingClientRect(), br = b.getBoundingClientRect();
  if (r.top < -1 || r.bottom > vh + 1 || r.left < -1 || r.right > vw + 1) out.push("half-open: button row off screen (" + Math.round(r.top) + " to " + Math.round(r.bottom) + " of " + vh + ")");
  if (br.bottom > dr.top + 1) out.push("half-open: the pinned row covers When and Where by " + Math.round(br.bottom - dr.top) + " px");
  return out; })()`;
const SNAP = (want) => `(() => { const sh = document.getElementById("sheet"), g = document.querySelector(".sheet-grip"); if (!sh || !g || g.hidden) return "full";
  const now = sh.classList.contains("peek") ? "peek" : "full"; if (now !== "${want}") g.click(); return sh.classList.contains("peek") ? "peek" : "full"; })()`;
const READY = `(() => { const c = document.querySelector("#sheet:not([hidden]) #sheet-body .mm-card, .mm-pop .maplibregl-popup-content .mm-card"); return !!c; })()`;

// cdp: { send(method, params, sessionId) }; base: http origin; opts: { reduced, only, widths, log, events, brands }
export async function runCardGate(cdp, base, opts = {}) {
  const log = opts.log || console.log;
  const events = opts.events || JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "events.json"), "utf8")).events;
  const brands = opts.brands || JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "brands.json"), "utf8")).brands;
  const M = opts.reduced ? REDUCED : FULL;
  let fixtures = pickFixtures(events, brands);
  const skipped = fixtures.filter((f) => !f.id);
  fixtures = fixtures.filter((f) => f.id && (!M.fixtures || M.fixtures.includes(f.name)) && (!opts.only || opts.only.includes(f.name)));
  for (const f of fixtures) log(`  fixture ${f.name.padEnd(20)} ${f.label}`);
  for (const f of skipped) log(`  fixture ${f.name.padEnd(20)} skipped: ${f.label}`);
  const widths = opts.widths || M.widths, rows = [];
  for (const f of fixtures) for (const w of widths) for (const font of [16, 20]) {
    const h = HEIGHT[w] || 900;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: sid } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sid);
    const ev = async (expression) => { const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };
    try {
      await s("Page.enable"); await s("Runtime.enable");
      await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      await s("Page.setFontSizes", { fontSizes: { standard: font, fixed: font === 16 ? 13 : 20 } });
      await s("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("matchamap.theme","light");localStorage.setItem("mm.seen","1")}catch(e){}` });
      await s("Page.navigate", { url: `${base}/?event=${f.id}&motion=reduce` });
      let ok = false;
      for (const end = Date.now() + 20000; Date.now() < end;) { await sleep(250); try { if (await ev(READY)) { ok = true; break; } } catch { /* navigating */ } }
      if (ok) { await ev(`document.fonts ? document.fonts.ready.then(() => 1) : 1`); await sleep(700); }
      for (const [theme, feat] of [["light", false], ["dark", false], ["light", true]]) {
        const row = { fixture: f.name, w, theme: theme + (feat ? "+featured" : ""), font, fails: [] };
        if (!ok) row.fails.push("the card never opened");
        else {
          await ev(SET_THEME(theme)); await ev(FORCE_GOING); if (feat) await ev(ADD_FEATURED);
          await ev(FRAMES);
          if (w < 900) { if ((await ev(SNAP("peek"))) === "peek") { await ev(FRAMES); row.fails.push(...((await ev(PEEK)) || [])); } await ev(SNAP("full")); await ev(FRAMES); }
          const r = await ev(CHECK(ALLOW));
          if (!r || r.error) row.fails.push((r && r.error) || "checker did not run"); else row.fails.push(...r.fails);
        }
        if (row.fails.length) {
          fs.mkdirSync(FAIL_DIR, { recursive: true });
          try { const { data } = await s("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(FAIL_DIR, `${f.name.replace(/\s+/g, "-")}-${w}-${row.theme}-${font}.png`), Buffer.from(data, "base64")); } catch { /* no frame */ }
        }
        rows.push(row);
      }
    } finally { await cdp.send("Target.closeTarget", { targetId }).catch(() => {}); }
  }
  const pad = (v, n) => String(v).padEnd(n);
  log(`\n${pad("fixture", 22)}${pad("width", 7)}${pad("theme", 16)}${pad("font", 6)}${pad("result", 8)}first failures`);
  for (const r of rows) log(`${pad(r.fixture, 22)}${pad(r.w, 7)}${pad(r.theme, 16)}${pad(r.font, 6)}${pad(r.fails.length ? "FAIL" : "pass", 8)}${r.fails.slice(0, 3).join(" | ")}`);
  const failed = rows.filter((r) => r.fails.length).length;
  log(`\ncard gate: ${rows.length} cases, ${failed} failed${skipped.length ? `; skipped: ${skipped.map((f) => f.name).join(", ")} (none in the data)` : ""}`);
  return { cases: rows.length, failed, rows, skipped: skipped.map((f) => f.name) };
}

// ---- standalone ----------------------------------------------------------------------------------------------------
async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const bin = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
  if (!bin) { console.error("card gate: no Chrome found. Set CHROME_PATH."); process.exit(2); }
  let base = arg("--url"), srv = null;
  if (!base) {
    const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    srv = spawn(process.execPath, [path.join(ROOT, "tools", "serve.js"), "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r, j) => { srv.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && r()); setTimeout(() => j(new Error("serve.js did not start")), 10000); });
    base = `http://localhost:${port}`;
  }
  base = base.replace(/\/$/, "");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-gate-"));
  const ch = spawn(bin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "about:blank",
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [])], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((res, rej) => { let b = ""; ch.stderr.on("data", (d) => { b += d; const m = b.match(/listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); setTimeout(() => rej(new Error("Chrome did not start")), 20000); });
  const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const cb = new Map();
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && cb.has(j.id)) { cb.get(j.id)(j); cb.delete(j.id); } };
  const cdp = { send: (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; cb.set(i, (j) => (j.error ? rej(new Error(j.error.message)) : res(j.result))); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }) };
  let res;
  try {
    if (fs.existsSync(FAIL_DIR)) for (const f of fs.readdirSync(FAIL_DIR)) if (f.endsWith(".png")) fs.rmSync(path.join(FAIL_DIR, f));
    res = await runCardGate(cdp, base, { reduced: process.argv.includes("--reduced"), only: arg("--only") ? arg("--only").split(",") : null, widths: arg("--widths") ? arg("--widths").split(",").map(Number) : null });
  } finally { ws.close(); ch.kill(); if (srv) srv.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ } }
  process.exit(res && res.failed === 0 ? 0 : 1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
