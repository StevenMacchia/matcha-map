// npm run gate:map: the map's density gate (2026-11-23, after the Triangle's brand faces piled on Raleigh's centre). Opens
// the map in headless Chrome at 320, 390, 1024, 1440 and 1920 wide, light and dark, and for each fixture (Manhattan, the Triangle, Los
// Angeles, Seattle) at zooms 10, 11, 12, 13, 14 and 16 moves the map there the way a visitor's zoom does (map.jumpTo),
// waits for the map to settle and the name labels to be laid out, then measures every marker and label on the map and
// fails the case when:
//   - a name label touches another label (2026-11-23, the pin look: labels keep 2 px apart);
//   - a name label touches a pin or group (its box with what sticks out of it: a count, a day pill, the cup), other than its own;
//   - a name label leaves the clear part of the map (under the top bar or the list grip on a phone, or off the map);
//   - two single pins (not groups, not the "place not posted" rings) stand closer than 20 px, centre to centre: such a
//     pair must be one stack that spreads on hover and tap (the uncluster rule, 2026-11-23);
//   - from zoom 6, a city pin is still shown while its places stand more than 20 px apart on screen (it must have opened);
//   - two markers' boxes overlap by more than 12 px both ways (an edge, a cup mark or a badge may tuck under a neighbour) (the "place not posted" rings are left out: they sit on a
//     city's centre by design).
// The national tier (2026-11-23, "a usa map of matcha"): the opening view (the contiguous states fitted, as the page opens)
// and zooms 4, 5, 7 and 10 over the middle of the country, at 390 and 1440, light and dark: no two city pins overlap (their
// circles, the 20 px rule at these zooms), and at the opening view the city pins cover every city that has anything (the
// app's own count, __matcha.ntStats()); that number is printed.
// The uncluster views (2026-11-23, "you have to zoom WAY too far in"): LA at 9, Houston at 9, Seattle at 10, Manhattan at 13
// and the Triangle at 11, plus LA and Houston at 7 and 8 inside the city band, at 390 and 1440, light and dark; the pin
// count of each view is printed.
// Prints a table, saves a screenshot of every failing case to qa/brands/2026-11-23/map-fail/, exits 1 on any failure.
// Flags: --url <base> (a running server instead of tools/serve.js), --only <fixture,...>, --zooms 12,13, --sizes 390x844.
// Exports runMapGate(cdp, base, opts) for tools/smoke.js. No dependencies (Node 22+ WebSocket).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAIL_DIR = path.join(ROOT, "qa", "brands", "2026-11-23", "map-fail");
export const FIXTURES = [["Manhattan", 40.745, -73.99], ["Triangle", 35.93, -78.80], ["LA", 34.05, -118.25], ["Seattle", 47.61, -122.33]];
export const ZOOMS = [10, 11, 12, 13, 14, 16];
export const SIZES = [[320, 568], [390, 844], [1024, 768], [1440, 900], [1920, 1080]];
export const NATIONAL = { fixture: ["USA", 38.5, -97], zooms: ["home", 4, 5, 7, 10], widths: [390, 1440] };
export const FOCUS = { cases: [["LA", 34.05, -118.25, 9], ["Houston", 29.76, -95.37, 9], ["Seattle", 47.61, -122.33, 10], ["Manhattan", 40.73, -73.99, 13], ["Triangle", 35.86, -78.72, 11], ["LA", 34.05, -118.25, 7], ["Houston", 29.76, -95.37, 8]], widths: [390, 1440] };
export const REDUCED = { zooms: [11, 13], sizes: [[390, 844], [800, 900], [1440, 900]], themes: ["light"], fixtures: ["Manhattan", "Triangle"], national: ["home", 5] }; // 800: the pane width where the list went empty
const MIN_PX = 20, SPLIT_PX = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHECK = `(() => {
  const out = [], MIN = ${MIN_PX}, SPLIT = ${SPLIT_PX};
  const shown = (el) => el.isConnected && !el.hidden && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
  const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const box = (el) => { let b = R(el.getBoundingClientRect()); el.querySelectorAll(".cl-n, .bx").forEach((n) => { if (!shown(n)) return; const q = n.getBoundingClientRect(); b = { l: Math.min(b.l, q.left), t: Math.min(b.t, q.top), r: Math.max(b.r, q.right), b: Math.max(b.b, q.bottom) }; }); return b; };
  const ov = (a, b) => [Math.min(a.r, b.r) - Math.max(a.l, b.l), Math.min(a.b, b.b) - Math.max(a.t, b.t)];
  const name = (el) => (el.getAttribute("aria-label") || el.className || "").toString().slice(0, 48);
  const map = window.__matcha && window.__matcha.map, mc = document.getElementById("map").getBoundingClientRect(), pad = (map && map.getPadding()) || {};
  const area = { l: mc.left, t: mc.top + (pad.top || 0), r: mc.right, b: mc.bottom - (pad.bottom || 0) };
  const onMap = (b) => b.r > mc.left && b.l < mc.right && b.b > mc.top && b.t < mc.bottom;
  const marks = [...document.querySelectorAll(".maplibregl-marker")].filter((el) => shown(el) && !el.classList.contains("leaving") && !el.classList.contains("fanned"))
    .map((el) => ({ el, b: box(el), group: el.classList.contains("mk-cl"), ap: el.classList.contains("mk-ap") || el.classList.contains("cl-ap") })).filter((m) => onMap(m.b));
  const labels = [...document.querySelectorAll(".maplibregl-marker .mk-lbl")].filter(shown).map((l) => ({ l, b: R(l.getBoundingClientRect()), own: l.closest(".maplibregl-marker") }));
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    if (a.b.l < area.l - 1 || a.b.t < area.t - 1 || a.b.r > area.r + 1 || a.b.b > area.b + 1) out.push("label leaves the map: " + a.l.textContent);
    for (let j = i + 1; j < labels.length; j++) { const [w, h] = ov(a.b, labels[j].b); if (w >= 0 && h >= 0) out.push("labels touch: " + a.l.textContent + " / " + labels[j].l.textContent); }
    for (const m of marks) { if (m.el === a.own) continue; const [w, h] = ov(a.b, m.b); if (w >= 0 && h >= 0) out.push("label touches a pin: " + a.l.textContent + " / " + name(m.el)); }
  }
  const singles = marks.filter((m) => !m.group && !m.ap), c = (b) => [(b.l + b.r) / 2, (b.t + b.b) / 2];
  for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) {
    const p = c(singles[i].b), q = c(singles[j].b), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < MIN) out.push("pins " + d.toFixed(1) + " px apart: " + name(singles[i].el) + " / " + name(singles[j].el));
  }
  // from zoom 6 a city pin stands only while its places sit within SPLIT px of each other on screen
  if (map && map.getZoom() >= 6 && window.__matcha.ntPlaces) for (const c of window.__matcha.ntPlaces()) {
    const q = c.lls.map((ll) => map.project(ll));
    let far = 0;
    for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) far = Math.max(far, Math.hypot(q[i].x - q[j].x, q[i].y - q[j].y));
    if (far > SPLIT + 0.5) out.push("city pin " + c.key + " shown while its places stand " + far.toFixed(1) + " px apart");
  }
  // city pins (the national tier) are round: their circles must not overlap
  const nat = marks.filter((m) => m.el.classList.contains("cl-nt")).map((m) => { const r = m.el.getBoundingClientRect(); return { m, x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width }; });
  for (let i = 0; i < nat.length; i++) for (let j = i + 1; j < nat.length; j++) {
    const a = nat[i], b = nat[j], dd = Math.hypot(a.x - b.x, a.y - b.y);
    if (dd < (a.d + b.d) / 2 - 1) out.push("city pins overlap, " + dd.toFixed(1) + " px apart: " + name(a.m.el) + " / " + name(b.m.el));
  }
  const solid = marks.filter((m) => !m.ap);
  // a single pin may tuck an edge under a neighbour (the mock's rule); a group may not be covered
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const [w, h] = ov(solid[i].b, solid[j].b);
    if ((solid[i].group || solid[j].group) && w > 12 && h > 12) out.push("markers overlap " + Math.round(w) + "x" + Math.round(h) + ": " + name(solid[i].el) + " / " + name(solid[j].el));
  }
  // the list must never show the sleepy empty state while pins are on the map (Steven's Triangle, 2026-11-23)
  const list = document.getElementById("list"), emp = document.getElementById("empty");
  if (marks.length && list && list.children.length === 0 && emp && !emp.hidden) out.push("the list shows the empty state while " + marks.length + " pins are on the map");
  const nt = window.__matcha.ntStats ? window.__matcha.ntStats() : null;
  return { nt, cityPins: nat.length, pins: marks.length, singles: singles.length, groups: marks.filter((m) => m.group).length, labels: labels.length, fails: [...new Set(out)] };
})()`;
// the map settled: no move, the sources loaded, then two frames and the label pass's frame
const SETTLE = `new Promise((res) => { const m = window.__matcha && window.__matcha.map; if (!m) return res(false);
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => res(true), 350)));
  let t = setTimeout(done, 6000); m.once("idle", () => { clearTimeout(t); done(); }); m.triggerRepaint(); })`;
const READY = `(() => { const l = document.getElementById("loading"); return !!(window.__matcha && window.__matcha.map && window.__matcha.map.loaded && window.__matcha.map.loaded() && !window.__matcha.map.isPre) && !(l && !l.hidden && getComputedStyle(l).display !== "none"); })()`;

export async function runMapGate(cdp, base, opts = {}) {
  const log = opts.log || console.log, M = opts.reduced ? REDUCED : {};
  const fixtures = FIXTURES.filter((f) => (!M.fixtures || M.fixtures.includes(f[0])) && (!opts.only || opts.only.includes(f[0])));
  const zooms = opts.zooms || M.zooms || ZOOMS, sizes = opts.sizes || M.sizes || SIZES, themes = opts.themes || M.themes || ["light", "dark"];
  const rows = [];
  for (const [W, H] of sizes) for (const theme of themes) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: sid } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sid);
    const ev = async (expression) => { const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };
    try {
      await s("Page.enable"); await s("Runtime.enable");
      await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
      await s("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("matchamap.theme","${theme}");localStorage.setItem("mm.seen","1")}catch(e){}` });
      const f0 = fixtures[0];
      await s("Page.navigate", { url: `${base}/?at=${f0[1]},${f0[2]},${zooms[0]}&motion=reduce` });
      let ok = false;
      for (const end = Date.now() + 30000; Date.now() < end && !ok;) { await sleep(300); try { ok = await ev(READY); } catch { /* navigating */ } }
      const cases = [];
      for (const [fname, lat, lng] of fixtures) for (const z of zooms) cases.push([fname, lat, lng, z]);
      // the uncluster views, at their own centres and zooms
      if (FOCUS.widths.includes(W)) for (const [fname, lat, lng, z] of opts.reduced ? FOCUS.cases.slice(0, 2) : FOCUS.cases) {
        if ((opts.only && !opts.only.includes(fname)) || (opts.zooms && !opts.zooms.includes(z))) continue;
        cases.push([fname + "@", lat, lng, z]);
      }
      const natZ = opts.reduced ? REDUCED.national : NATIONAL.zooms;
      if (!opts.only || opts.only.includes("USA")) if (NATIONAL.widths.includes(W) || opts.reduced) for (const z of natZ) cases.push([NATIONAL.fixture[0], NATIONAL.fixture[1], NATIONAL.fixture[2], z]);
      for (const [fname, lat, lng, z] of cases) {
        const row = { fixture: fname, z, size: W + "x" + H, theme, pins: 0, singles: 0, groups: 0, labels: 0, fails: [] };
        if (!ok) row.fails.push("the map never loaded");
        else {
          await ev(z === "home" ? `(() => { window.__matcha.map.fitBounds([[-125, 24.5], [-66.5, 49.5]], { padding: 16, animate: false }); return 1; })()`
            : `(() => { const m = window.__matcha.map; m.jumpTo({ center: [${lng}, ${lat}], zoom: ${z} }); return 1; })()`);
          await ev(SETTLE); await ev(SETTLE);
          let r = await ev(CHECK);
          // one more settle before a case counts as failed: a label pass or a marker fade can be one frame behind
          if (r && r.fails.length) { await sleep(500); await ev(SETTLE); r = await ev(CHECK); }
          if (!r) row.fails.push("checker did not run"); else Object.assign(row, r);
          if (r && z === "home") {
            const t = r.nt || {};
            row.note = `opening view: ${r.cityPins} city pins on screen, ${t.pins} in all, covering ${t.covered} of ${t.cities} cities with anything`;
            if (!(t.covered >= t.cities) || !(t.cities > 0)) row.fails.push("the city pins leave out a city: " + row.note);
          }
        }
        if (row.fails.length) {
          fs.mkdirSync(FAIL_DIR, { recursive: true });
          try { const { data } = await s("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(FAIL_DIR, `${fname}-z${z}-${W}-${theme}.png`), Buffer.from(data, "base64")); } catch { /* no frame */ }
        }
        rows.push(row);
      }
    } finally { await cdp.send("Target.closeTarget", { targetId }).catch(() => {}); }
  }
  const pad = (v, n) => String(v).padEnd(n);
  log(`\n${pad("fixture", 11)}${pad("zoom", 6)}${pad("size", 10)}${pad("theme", 7)}${pad("pins", 6)}${pad("single", 8)}${pad("groups", 8)}${pad("labels", 8)}${pad("result", 8)}first failures`);
  for (const r of rows) log(`${pad(r.fixture, 11)}${pad(r.z, 6)}${pad(r.size, 10)}${pad(r.theme, 7)}${pad(r.pins, 6)}${pad(r.singles, 8)}${pad(r.groups, 8)}${pad(r.labels, 8)}${pad(r.fails.length ? "FAIL" : "pass", 8)}${r.fails.slice(0, 2).join(" | ")}`);
  for (const r of rows) if (r.note) log(`${r.size} ${r.theme}: ${r.note}`);
  const failed = rows.filter((r) => r.fails.length).length;
  log(`\nmap gate: ${rows.length} cases, ${failed} failed`);
  return { cases: rows.length, failed, rows };
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const bin = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
  if (!bin) { console.error("map gate: no Chrome found. Set CHROME_PATH."); process.exit(2); }
  let base = arg("--url"), srv = null;
  if (!base) {
    const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    srv = spawn(process.execPath, [path.join(ROOT, "tools", "serve.js"), "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r, j) => { srv.stdout.on("data", (d) => /Matcha Map at/.test(String(d)) && r()); setTimeout(() => j(new Error("serve.js did not start")), 10000); });
    base = `http://localhost:${port}`;
  }
  base = base.replace(/\/$/, "");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-mapgate-"));
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
    res = await runMapGate(cdp, base, {
      reduced: process.argv.includes("--reduced"), only: arg("--only") ? arg("--only").split(",") : null,
      zooms: arg("--zooms") ? arg("--zooms").split(",").map(Number) : null,
      sizes: arg("--sizes") ? arg("--sizes").split(",").map((x) => x.split("x").map(Number)) : null,
    });
  } finally { ws.close(); ch.kill(); if (srv) srv.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ } }
  process.exit(res && res.failed === 0 ? 0 : 1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
