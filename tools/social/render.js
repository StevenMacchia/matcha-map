// tools/social/render.js: the day's posts as PNG, drawn in the house style with headless Chrome over the DevTools protocol
// (the same way tools/gen-og.js renders its cards). Feed 1080x1350, story 1080x1920. Every picture is drawn art: the drawn
// card from site/drawn.js for a pop-up, the shop drawing for a shop, the brand-initial mochi in a list, and Mattie, all from
// site/characters.svg. No photo from Instagram or a brand's site is ever used (there is no permission flag for that yet).
// Each render also measures the page: the smallest text (36px is the floor), text that runs off the canvas or is cut short,
// and blocks that overlap. outbox.js prints those and the tests fail on them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hash } from "./plan.js";
import { drinkSvg } from "./drinks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TPL = path.join(ROOT, "tools", "social", "templates");
export const SIZES = { feed: [1080, 1350], story: [1080, 1920] };
export const MIN_TEXT_PX = 36;

export function chromePath(env = process.env) {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const c = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return c.find((p) => fs.existsSync(p)) || c[0];
}

const read = (p) => fs.readFileSync(p, "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const sheet = read(path.join(ROOT, "site", "characters.svg"));
  SHARED = {
    css: read(path.join(TPL, "social.css")),
    defs: '<svg class="sheet" width="0" height="0" style="position:absolute" xmlns="http://www.w3.org/2000/svg">' + sheet.slice(sheet.indexOf("<defs>"), sheet.indexOf("</defs>") + 7) + "</svg>",
    drawnjs: read(path.join(ROOT, "site", "drawn.js")),
    fitjs: read(path.join(ROOT, "tools", "brand", "templates", "fit.js")),
    bootjs: `(function(){var sym={};document.querySelectorAll("svg.sheet symbol[id]").forEach(function(s){sym[s.id]=s});Drawn.init(sym);
document.querySelectorAll("[data-drawn]").forEach(function(el){var o=JSON.parse(el.getAttribute("data-drawn")),svg=Drawn.card(o.e,o.opts);
if(o.opts.crop)svg=svg.replace('viewBox="0 0 640 400"','viewBox="0 0 640 262"').split('height="394"').join('height="256"');el.innerHTML=svg;});
function prune(){document.querySelectorAll(".pills").forEach(function(p){var c=p.children;if(!c.length)return;var top=c[0].offsetTop,h=c[0].offsetHeight;
var drop=[].filter.call(c,function(x){return x.offsetTop>top+h+20});drop.forEach(function(x){x.remove()});});}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){setTimeout(prune,300)});else prune();})();`,
  };
  return SHARED;
}
const fill = (tpl, vars) => tpl.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => vars[k] ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k]));

// ---- pieces ----
const FACE = '<svg viewBox="4 9 56 52"><use href="#m-happy" width="64" height="64"/></svg>';
const use = (id, vb, style, cls = "mt") => { const [, , w, h] = vb.split(" "); return `<svg class="${cls}" viewBox="${vb}" style="${style}"><use href="#${id}" width="${w}" height="${h}"/></svg>`; };
const mattie = (pose, x, y, s, flip = false) => use(pose, "0 0 64 64", `left:${x}px;top:${y}px;width:${s}px;height:${s}px`, "mt" + (flip ? " flip" : ""));
const petal = (x, y, s, r) => `<svg class="co" viewBox="0 0 20 20" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;transform:rotate(${r}deg)"><use href="#c-petal" width="20" height="20"/></svg>`;
const drawnBox = (cls, e, opts) => `<div class="${cls}" data-drawn="${esc(JSON.stringify({ e, opts }))}"></div>`;
const fitLine = (cls, text, max) => `<span class="line ${cls}" data-fit data-max="${max}" data-min1="${MIN_TEXT_PX}" data-min="${MIN_TEXT_PX}">${esc(text)}</span>`;
// "What they pour": one row per drink type, the drawn glyph and the name as the menu gives it, and a count of the rest.
const POUR_ROWS = { story: 5, feed: 3 };
const pourHtml = (pour, max, tight = false) => {
  if (!pour || !pour.items || !pour.items.length) return "";
  const shown = pour.items.slice(0, max), more = (pour.more || 0) + pour.items.length - shown.length;
  return `<div class="pour${tight && shown.length > 2 ? " tight" : ""}"><div class="ph"><span>What they pour</span>${more ? `<span class="pm">+ ${more} more drink${more === 1 ? "" : "s"}</span>` : ""}</div>` +
    shown.map((i, k) => `<div class="pr"><div class="pg">${drinkSvg(i.name, "pr" + k)}</div><span class="pn" data-fit data-max="44" data-min1="36" data-min="36">${esc(i.name)}</span></div>`).join("") + "</div>";
};
const trunc = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+$/, "") + "…" : s; };
const kindLabel = (k) => (k === "organizer" ? "Matcha event" : k === "cafe" ? "Matcha cafe" : k === "festival" ? "Matcha festival" : "Matcha pop-up");
const placeLine = (v) => v.venue || (v.venueHandle ? "@" + v.venueHandle : "");
// the street address once, with the city unless the address already names it
const cityLine = (v) => { const c = [v.city, v.state].filter(Boolean).join(", "), a = String(v.address || "").replace(/,?\s*\d{5}(-\d{4})?\s*$/, ""); return !a ? c : a.toLowerCase().includes(String(v.city || "").toLowerCase()) ? a : `${a}, ${c}`; };
const shortDay = (k) => { const d = new Date(k + "T12:00:00Z"); return `${DAYS[d.getUTCDay()].slice(0, 3)}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`; };

// Geometry per size. The column (headline, art, facts, pills) flows from `head` down to `bottom`; Mattie sits under it
// at the lower right and the pills stop short of him. Stories keep the top and bottom 220px clear of Instagram's own bars.
const G = {
  feed: { top: 56, head: 168, bottom: 1106, headMax: 92, headMax2: 80, gap: 26, foot: 1258, mattie: [846, 1116, 190], art: 420 },
  story: { top: 232, head: 350, bottom: 1380, headMax: 104, headMax2: 90, gap: 36, foot: 1636, mattie: [668, 1380, 352], art: 500 },
};

function scene(it, size) {
  const g = G[size], hb = hash(it.city + it.kind + it.title);
  const flip = (hb >>> 3) & 1;
  const ev = it.events || [];
  const tag = ["shop", "featured-shop", "city"].includes(it.kind) ? it.tag : it.kind === "weekend" ? "This weekend" : it.kind === "soon" ? "Coming up" : ev[0] ? shortDay(ev[0].day) : it.tag;
  let s = `<div class="top" data-blk style="top:${g.top}px"><div class="wm">${FACE}Matcha Map</div><div class="tag" data-fit data-max="36" data-min1="36" data-min="36">${esc(tag)}</div></div>`;
  const head = (text, two) => `<div class="head" data-fit data-max="${g.headMax}" data-min1="64" ${two ? `data-lines="2" data-max2="${g.headMax2}"` : ""} data-min="56">${esc(text)}</div>`;
  const pills = (list) => list.length ? `<div class="pills">${list.map((m) => `<span class="pill">${esc(trunc(m, 26))}</span>`).join("")}</div>` : "";
  const col = (inner, bottom = g.bottom, gap = g.gap) => `<div class="main" data-blk style="top:${g.head}px;height:${bottom - g.head}px;gap:${gap}px">${inner}</div>`;
  const PB = { story: 1600, feed: 1196 }[size];      // the column runs lower when it carries a pour block; Mattie then steps aside
  const foot = `<div class="foot" data-blk style="top:${g.foot}px">matchamap.app · link in bio</div>`;
  const [mx, my, ms] = g.mattie;

  if (it.kind === "location") {
    // each listed shop or pop-up with its top two drinks, drawn by the drink engine; rows with drinks are tall, so two fit
    const all = it.group.rows || [], hasDr = all.some((r) => r.drinks && r.drinks.length);
    const rows = all.slice(0, hasDr ? 2 : 3).map((r, k) => `<div class="row loc"><div class="rt"><div class="mochi" data-drawn="${esc(JSON.stringify({ e: { id: r.id, brand: r.brand, kind: r.kind }, opts: { mode: "thumb" } }))}"></div>` +
      `<div class="tx"><span class="rb" data-fit data-max="48" data-min1="38" data-min="38">${esc(trunc(r.brand, 34))}</span><span class="rs" data-fit data-max="36" data-min1="36" data-min="36">${esc(trunc(r.sub, 36))}</span></div></div>` +
      ((r.drinks || []).length ? `<div class="dr">${r.drinks.map((n, j) => `<div class="pg">${drinkSvg(n, "lr" + k + j)}</div>`).join("")}</div>` : "") + "</div>").join("");
    // the picture takes the room the rows leave (a lone row gets a big picture), within 240 to 460px
    const nRows = Math.min(all.length, hasDr ? 2 : 3), rowsH = nRows * (hasDr ? 336 : 176), A = Math.max(240, Math.min(460, 960 - rowsH)), mS = Math.round(A * 0.92);
    const art = `<div class="shopart" style="height:${A}px"><div class="blob" style="left:60px;top:15px;width:${Math.round(A * 0.88)}px;height:${Math.round(A * 0.88)}px"></div>` +
      `<svg viewBox="0 0 64 64" style="left:${68}px;top:${Math.round(A * 0.09)}px;width:${Math.round(A * 0.8)}px;height:${Math.round(A * 0.8)}px"><use href="#s-shop" width="64" height="64"/></svg>` +
      `<svg viewBox="0 0 64 64" style="left:${900 - mS}px;top:${Math.round(A * 0.04)}px;width:${mS}px;height:${mS}px"><use href="#${["m-wave", "m-happy", "m-excited"][hb % 3]}" width="64" height="64"/></svg>` +
      `<svg viewBox="0 0 20 20" style="left:${Math.round(60 + A * 0.95)}px;top:${Math.round(A * 0.2)}px;width:54px;height:54px;transform:rotate(24deg)"><use href="#c-petal" width="20" height="20"/></svg></div>`;
    s += col(head(it.title, true) + art + `<div class="rows loc">${rows}</div>`, PB, 22);
    return s + foot;
  }

  if (it.kind === "shop" || it.kind === "featured-shop") {
    const sh = it.shop, pv = !!(sh.pour && sh.pour.items && sh.pour.items.length), artH = pv ? (size === "story" ? 180 : it.kind === "featured-shop" ? 150 : 250) : g.art, big = Math.round(artH * 0.86), m = Math.round(artH * 0.7);
    const art = `<div class="shopart" style="height:${artH}px"><div class="blob" style="left:40px;top:${artH - big - 20}px;width:${big + 40}px;height:${big + 40}px"></div>` +
      `<svg viewBox="0 0 64 64" style="left:60px;top:${artH - big - 16}px;width:${big}px;height:${big}px"><use href="#s-shop" width="64" height="64"/></svg>` +
      `<svg viewBox="0 0 64 64" style="left:${930 - m - 30}px;top:${artH - m - 16}px;width:${m}px;height:${m}px"><use href="#m-whisk" width="64" height="64"/></svg>` +
      `<svg viewBox="0 0 20 20" style="left:560px;top:36px;width:60px;height:60px;transform:rotate(24deg)"><use href="#c-petal" width="20" height="20"/></svg>` +
      `<svg viewBox="0 0 20 20" style="left:840px;top:60px;width:42px;height:42px;transform:rotate(-30deg)"><use href="#c-petal" width="20" height="20"/></svg></div>`;
    const info = `<div class="info">${fitLine("mid", trunc(cityLine(sh), 48), 44)}${fitLine("sub", sh.tier === "serves" ? "Matcha on the menu" : "Matcha shop", 38)}</div>`;
    if (pv) return s + col(head(sh.name, true) + art + info + pourHtml(sh.pour, size === "story" ? 4 : it.kind === "featured-shop" ? 5 : POUR_ROWS.feed), PB, 18) + (size === "feed" ? mattie("m-wave", 930, 1204, 110, !flip) : "") + foot;
    s += col(head(sh.name, true) + art + info + pills(sh.drinks));
    s += mattie("m-wave", mx + 20, my + 20, ms - 20, !flip);
    return s + foot;
  }

  if (ev.length === 1) {
    const v = ev[0];
    const card = { id: v.id, brand: v.brand, kind: v.kind === "organizer" ? "organizer" : "popup" };
    const lines = [fitLine("big", v.time, 60)];
    if (placeLine(v)) lines.push(fitLine("mid", trunc(placeLine(v), 46), 44));
    lines.push(fitLine("sub", trunc(cityLine(v), 48), 38));
    const pv = !!(v.pour && v.pour.items && v.pour.items.length);
    const inner = head(it.title, false) + drawnBox("panel", card, { mode: "card", when: kindLabel(v.kind), crop: 1 }) + `<div class="info">${lines.join("")}</div>`;
    if (pv) return s + col(inner + pourHtml(v.pour, size === "story" ? 3 : POUR_ROWS.feed, true), PB, 18) + (size === "feed" ? mattie("m-happy", 930, 1204, 110, !flip) : "") + foot;
    s += col(inner + pills(v.menu.slice(0, 3)));
    s += mattie(["m-wave", "m-happy", "m-excited"][hb % 3], mx, my, ms, !flip);
    s += petal(mx - 30, my + 6, 44, 20);
    return s + foot;
  }

  // a list of two to four
  const rows = `<div class="rows">` + ev.map((v) => {
    const when = it.kind === "weekend" || it.kind === "soon" ? `${DAYS[new Date(v.day + "T12:00:00Z").getUTCDay()].slice(0, 3)} ${v.time}` : v.time;
    const where = placeLine(v) || v.city;
    return `<div class="row"><div class="mochi" data-drawn="${esc(JSON.stringify({ e: { id: v.id, brand: v.brand, kind: v.kind }, opts: { mode: "thumb" } }))}"></div>` +
      `<div class="tx"><span class="rb" data-fit data-max="48" data-min1="38" data-min="38">${esc(trunc(v.brand, 34))}</span><span class="rs" data-fit data-max="36" data-min1="36" data-min="36">${esc(trunc(`${when} · ${where}`, 36))}</span></div></div>`;
  }).join("") + `</div>`;
  s += col(head(it.title, true) + rows + (it.more ? `<div class="more">+ ${it.more} more on the map</div>` : ""), g.bottom, size === "feed" ? 12 : g.gap);
  s += mattie("m-wave", mx + 20, my + 10, ms - 20, flip);
  return s + foot;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayName = (k) => { const d = new Date(k + "T12:00:00Z"); return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

export function itemHtml(it, size = it.slot) {
  const S = shared();
  const tpl = read(path.join(TPL, size === "story" ? "story.html" : "featured.html"));
  return fill(tpl, { ...S, variant: "v" + (hash(it.city || it.title) % 3), scene: scene(it, size) });
}

// Measured inside the page after layout: text size floor, text off the canvas or cut short, overlapping blocks.
const CHECK = `(() => {
  const W = innerWidth, H = innerHeight, small = [], off = [], cut = [], overlap = [];
  let min = 1e9;
  const tw = document.createTreeWalker(document.querySelector(".canvas"), NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) {
    const t = tw.currentNode, el = t.parentElement;
    if (!t.textContent.trim() || !el || el.closest("defs,symbol,style,script,title")) continue;
    let px = parseFloat(getComputedStyle(el).fontSize);
    if (el instanceof SVGElement && el.getScreenCTM) { const m = el.getScreenCTM(); px *= Math.hypot(m.a, m.b); }
    min = Math.min(min, px);
    if (px < ${MIN_TEXT_PX} - 0.5) small.push(t.textContent.trim().slice(0, 40) + " " + px.toFixed(1));
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) off.push(t.textContent.trim().slice(0, 40));
    if (!(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") cut.push(t.textContent.trim().slice(0, 40));
  }
  for (const m of document.querySelectorAll(".main")) if (m.scrollHeight > m.clientHeight + 1) cut.push("column runs past its space by " + (m.scrollHeight - m.clientHeight) + "px");
  const BOXES = "[data-blk],.pr,.row,.pill,.ph,.info,.panel,.shopart,.mt,.more,.top>*";
  const blks = [...document.querySelectorAll(BOXES)].filter((e) => !e.closest("defs,symbol")).map((e) => [e, e.getBoundingClientRect()]);
  const nm = (e) => (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || e.tagName;
  for (const [e, r] of blks) if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) off.push("block " + nm(e));
  for (let i = 0; i < blks.length; i++) for (let j = i + 1; j < blks.length; j++) {
    const [ea, a] = blks[i], [eb, b] = blks[j];
    if (ea.contains(eb) || eb.contains(ea)) continue;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap.push(nm(ea) + " / " + nm(eb));
  }
  // text that runs out of the box it sits in (a name wider than its row, a line past its pill)
  const tw2 = document.createTreeWalker(document.querySelector(".canvas"), NodeFilter.SHOW_TEXT);
  while (tw2.nextNode()) {
    const t = tw2.currentNode, el = t.parentElement;
    if (!t.textContent.trim() || !el || el.closest("defs,symbol,style,script,title")) continue;
    const bx = el.closest(".pr,.row,.pill,.tag,.wm,.more,.ph,.info,.head,.foot,.panel,.shopart");
    if (!bx) continue;
    const rg = document.createRange(); rg.selectNodeContents(t);
    const q = rg.getBoundingClientRect(), r = bx.getBoundingClientRect();
    if (q.width && (q.left < r.left - 3 || q.right > r.right + 3)) cut.push("outside its box: " + t.textContent.trim().slice(0, 40));
  }
  return { min: Math.round(min * 10) / 10, small, off, cut, overlap, fonts: document.fonts.check("800 40px 'M PLUS Rounded 1c'") };
})()`;

// Render jobs [{ html, out, size }] with one Chrome. Returns [{ out, ok, check }].
export async function renderPages(jobs, { chrome = chromePath(), timeoutMs = 180000 } = {}) {
  if (!jobs.length) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-"));
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-sandbox", "--force-device-scale-factor=1",
    "--remote-debugging-port=0", `--user-data-dir=${path.join(tmp, "u")}`, "--window-size=1080,1920", "about:blank"], { stdio: "ignore" });
  const results = [];
  const kill = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const portFile = path.join(tmp, "u", "DevToolsActivePort");
    for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
    if (!fs.existsSync(portFile)) throw new Error(`Chrome did not start (${chrome}); set CHROME_PATH`);
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let n = 0; const waiting = new Map(); const listeners = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else listeners.forEach((f) => f(d)); };
    const send = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    await send("Page.enable");
    for (const j of jobs) {
      const [w, h] = SIZES[j.size];
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      const file = path.join(tmp, "p.html");
      fs.writeFileSync(file, j.html);
      const loaded = new Promise((res) => { const f = (d) => { if (d.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(f), 1); res(); } }; listeners.push(f); });
      await send("Page.navigate", { url: pathToFileURL(file).href });
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 20000))]);
      await send("Runtime.evaluate", { expression: "Promise.race([document.fonts.ready, new Promise(r=>setTimeout(r,6000))]).then(()=>new Promise(r=>setTimeout(r,400)))", awaitPromise: true });
      const chk = await send("Runtime.evaluate", { expression: CHECK, returnByValue: true });
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      const ok = !!(shot.result && shot.result.data);
      if (ok) { fs.mkdirSync(path.dirname(j.out), { recursive: true }); fs.writeFileSync(j.out, Buffer.from(shot.result.data, "base64")); }
      results.push({ out: j.out, ok, check: chk.result && chk.result.result ? chk.result.result.value : null });
    }
    ws.close();
  } finally {
    clearTimeout(kill); proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile */ }
  }
  return results;
}

// PNG width and height from the IHDR chunk.
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export async function renderItems(items, dir, opts) {
  return renderPages(items.map((it) => ({ html: itemHtml(it), out: path.join(dir, it.name, "image.png"), size: it.slot })), opts);
}
