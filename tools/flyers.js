// npm run flyers: render flyer-style Instagram posts (images + captions) into tools/brand/outbox/<date>/.
// Nothing is posted. A human checks INDEX.md and posts by hand. Flags: --force (re-render existing),
// --logos (re-render logo.png and logo-mark.png), --date=YYYY-MM-DD (pretend today is that day).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = path.join(ROOT, "tools", "brand");
const TPL = path.join(BRAND, "templates");
const OUTBOX = path.join(BRAND, "outbox");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const LOGOS = args.includes("--logos");
const dateArg = (args.find((a) => a.startsWith("--date=")) || "").slice(7);

const read = (p) => fs.readFileSync(p, "utf8");
const events = JSON.parse(read(path.join(ROOT, "data", "events.json"))).events;
const sources = JSON.parse(read(path.join(ROOT, "data", "sources.json")));
const srcById = new Map(sources.map((s) => [s.id, s]));
const sheet = read(path.join(ROOT, "site", "characters.svg"));
const defs = '<svg width="0" height="0" style="position:absolute" xmlns="http://www.w3.org/2000/svg">' + sheet.slice(sheet.indexOf("<defs>"), sheet.indexOf("</defs>") + 7) + "</svg>";
const CSS = read(path.join(TPL, "base.css"));
const FITJS = read(path.join(TPL, "fit.js"));

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s || "x").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";
function hash(s) { let h = 5381; s = String(s || ""); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
function render(name, vars) {
  return read(path.join(TPL, name)).replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => vars[k] ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k]));
}
const FACE = '<svg viewBox="4 9 56 52"><use href="#m-happy" width="64" height="64"/></svg>';
const sym = (id, vb, cls, extra = "") => `<svg class="${cls}" viewBox="${vb}" ${extra}><use href="#${id}" width="${vb.split(" ")[2]}" height="${vb.split(" ")[3]}"/></svg>`;

// ---- dates (venue-local) ----
const today = dateArg || new Date().toLocaleDateString("en-CA");
const dayKey = (iso, tz) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz || "America/New_York" });
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
const dayLabel = (iso, tz, long) => new Date(iso).toLocaleDateString("en-US", { timeZone: tz, weekday: long ? "long" : "short", month: "short", day: "numeric" });
function clock(iso, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { h: p.hour, m: p.minute, ap: p.dayPeriod, hm: +p.hour === 12 && p.minute === "00" && false };
}
function timeText(e) {
  if (e.all_day) return null;
  const tz = e.tz || "America/New_York", a = clock(e.start, tz);
  if (a.h === "12" && a.m === "00" && a.ap === "AM") return null;   // midnight placeholder: the real time is not known
  const f = (c) => c.h + (c.m === "00" ? "" : ":" + c.m);
  if (!e.end) return f(a) + " " + a.ap;
  const b = clock(e.end, tz);
  return a.ap === b.ap ? `${f(a)} – ${f(b)} ${b.ap}` : `${f(a)} ${a.ap} – ${f(b)} ${b.ap}`;
}
function handleOf(e) {
  const s = srcById.get(e.source_id);
  let h = e.handle || (s && s.instagram) || ((e.links && e.links.instagram) || "").replace(/^.*instagram\.com\//, "").replace(/[\/?].*$/, "");
  h = String(h || "").replace(/^@/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+$/, "") + "…" : s);

// ---- selection ----
const end7 = addDays(today, 7);
const eligible = events.filter((e) => e.status === "upcoming" && ["popup", "cafe"].includes(e.kind) && e.category === "matcha" && e.confidence !== "unsure");
const inWeek = eligible.filter((e) => { const k = dayKey(e.start, e.tz); return k >= today && k <= end7; });
// weekend = Fri to Sun of this week (today counts when it is already Fri to Sun)
const d0 = dow(today), toSun = d0 === 0 ? 0 : 7 - d0, sun = addDays(today, toSun), fri = addDays(sun, -2);
const weekendOf = (e) => { const k = dayKey(e.start, e.tz); return k >= fri && k <= sun && k >= today; };
const byCity = new Map();
const seen = new Set();
for (const e of eligible.filter(weekendOf)) {
  const key = [e.brand, dayKey(e.start, e.tz), e.city].join("|");
  if (seen.has(key)) continue; seen.add(key);
  if (!e.city) continue;
  (byCity.get(e.city) || byCity.set(e.city, []).get(e.city)).push(e);
}

// ---- builders ----
// Every post is a character post: Mattie is large and touches the content (peeks over the photo, holds the
// sign or a speech bubble with the date, points at the venue, or whisks). Pose, side, colour, frame tilt and
// companions come from stable hashes, so a feed of posts varies and a re-render is identical.
const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16; return h >>> 0; };   // spread djb2 bits so poses balance
const SW = 952;   // stage width (canvas 1080 minus 64 a side); the stage sits at y 470 and is 766 tall
const SH = 766;
const SPARK = '<path d="M12 1C13 8 16 11 23 12C16 13 13 16 12 23C11 16 8 13 1 12C8 11 11 8 12 1Z" fill="#FFE7A0" stroke="#4B3426" stroke-width="1.8" stroke-linejoin="round"/>';
const spark = (x, y, s) => `<svg class="spk" viewBox="0 0 24 24" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px">${SPARK}</svg>`;
const petal = (x, y, s, r) => `<svg class="pet" viewBox="0 0 20 20" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;transform:rotate(${r}deg)"><use href="#c-petal" width="20" height="20"/></svg>`;
const PIN = '<svg class="pin" viewBox="0 0 42 52"><path d="M21 49C13 39 4 30 4 20a17 17 0 0 1 34 0c0 10-9 19-17 29z" fill="var(--strong)" stroke="#4B3426" stroke-width="3.5" stroke-linejoin="round"/><circle cx="21" cy="20" r="6.5" fill="#FFFDF7" stroke="#4B3426" stroke-width="3"/></svg>';
function band(h) {   // pastel upper tone with a scalloped, outlined lower edge
  let d = "M0 0";
  for (let x = 0; x < 1080; x += 60) d += " a30 18 0 0 0 60 0";
  return `<div class="band" style="height:${h}px"></div><svg class="wave" viewBox="0 0 1080 40" style="top:${h - 1}px"><path d="${d} V-2 H0z" style="fill:var(--top)"/><path d="${d}" fill="none" stroke="#4B3426" stroke-opacity=".85" stroke-width="3.5" stroke-linecap="round"/></svg>`;
}
function mattie(pose, x, y, s, flip, cls = "mt") {
  const vh = pose === "m-peek" ? 38 : 64;
  return `<svg class="${cls}${flip ? " flip" : ""}" viewBox="0 0 64 ${vh}" style="left:${x}px;top:${y}px;width:${s}px;height:${(s * vh) / 64}px"><use href="#${pose}" width="64" height="${vh}"/></svg>`;
}
function buddy(kind, x, y, h) {
  const [vb, w] = kind === "chasen" ? ["0 0 32 48", (h * 32) / 48] : ["0 0 32 64", h / 2];
  return `<svg class="co" viewBox="${vb}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><use href="#c-${kind}" width="${vb.split(" ")[2]}" height="${vb.split(" ")[3]}"/></svg>`;
}
// petals and one sparkle in the margins: three of five spots, by hash
function margins(seed, spots) {
  const pick = spots.map((_, i) => i).sort((a, b) => (hash(seed + ":" + a) & 255) - (hash(seed + ":" + b) & 255)).slice(0, 3);
  return pick.map((i, k) => { const [x, y, s, r] = spots[i]; return k === 2 ? spark(x, y, s * 0.9) : petal(x, y, s, r); }).join("");
}
const MARGIN_SPOTS = [[28, 452, 50, -24], [1004, 456, 46, 32], [30, 1150, 44, 18], [1006, 1176, 48, -28], [500, 1238, 40, 60]];
function headerHtml({ tag, sun, titleHtml, extra = "" }) {
  return `<div class="hdr"><div class="hrow"><div class="wm">${FACE}Matcha Map</div><div class="tag${sun ? " sun" : ""}">${esc(tag)}</div></div>${titleHtml}${extra}</div>`;
}

// rough width of a string in em at weight 800, to decide one line or two before the page lays out
const emWidth = (s) => [...String(s)].reduce((w, c) => w + (/[A-Z]/.test(c) ? 0.72 : /[a-z]/.test(c) ? 0.57 : /[0-9]/.test(c) ? 0.6 : c === " " ? 0.27 : 0.5), 0);

function flyerHtml(e, size) {
  const tz = e.tz || "America/New_York", hb = hash(e.brand), hi = mix(hash(e.id || e.brand)), handle = handleOf(e);
  const brand = String(e.brand || "").replace(/\s+/g, " ").trim();
  const local = e.image && e.image.local && fs.existsSync(path.join(ROOT, "site", e.image.local)) ? path.join(ROOT, "site", e.image.local) : null;
  const whisk = e.kind === "organizer" || e.kind === "cafe";
  const layout = local ? (whisk ? "point" : ["peek", "sign", "bubble", "point"][hi % 4]) : (whisk ? "bubble" : ["sign", "bubble"][hi % 2]);
  const flip = ((hi >>> 2) & 1) === 1;                          // which side the stage sits on
  const X = (x, w) => (flip ? SW - x - w : x);
  const pal = ["chasen", "dango", null, null][(hi >>> 4) % 4];   // a companion on about half the posts
  const rot = ((hi >>> 6) % 5) - 2;                               // frame tilt, -2 to 2 degrees
  const deco = (hi >>> 9) & 1;
  const face = whisk ? "m-whisk" : ["m-happy", "m-excited", "m-base"][(hi >>> 10) % 3];

  // header band height follows the brand (one line or two) and the credit pill
  const oneLine = emWidth(brand) * 84 <= 940;
  const bandH = 50 + 66 + 30 + (oneLine ? 124 : 206) + (handle ? 68 : 0) + 44;
  const top = bandH + 42, SH = 1236 - top;

  const day = dayLabel(e.start, tz), time = timeText(e) || "Time on the post";
  const when = (mx) => `<span class="pd" data-fit data-max="${mx}" data-min1="28">${esc(day)}</span><span class="pt" data-fit data-max="${mx}" data-min1="28">${esc(time)}</span>`;
  const cityLine = [e.city, e.state].filter(Boolean).join(", ");
  const vname = e.venue ? trunc(String(e.venue), 60) : cityLine;
  const subs = [e.address ? trunc(String(e.address), 52) : "", e.venue ? cityLine : ""].filter(Boolean);
  const vc = `<div class="vc">${PIN}<div class="tx"><div class="vn">${esc(vname)}</div>${subs.map((s) => `<div class="va">${esc(s)}</div>`).join("")}</div></div>`;
  const menuArr = (Array.isArray(e.menu) ? e.menu : []).filter(Boolean).slice(0, 5);
  const menu = (cap) => menuArr.length ? `<div class="menu" style="max-height:${cap}px">${menuArr.map((m) => `<span class="mp">${esc(trunc(String(m), 26))}</span>`).join("")}</div>` : "";
  const facts = (x, y, w, h, inner, just = "flex-start") => `<div class="facts" style="left:${X(x, w)}px;top:${y}px;width:${w}px;height:${h}px;justify-content:${just}">${inner}</div>`;
  const frame = (x, y, w, h) => {
    const d = deco ? `<svg class="fpet" viewBox="0 0 20 20" style="right:-30px;top:-34px;width:84px;height:84px;transform:rotate(28deg)"><use href="#c-petal" width="20" height="20"/></svg>`
      : `<div class="tape${hi & 1 ? " t2" : ""}" style="left:-46px;top:6px;transform:rotate(-38deg)"></div>`;
    return `<div class="frame" style="left:${X(x, w)}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg)"><div class="im"><img src="${pathToFileURL(local).href}" alt=""></div>${d}</div>`;
  };
  // Mattie under a prop (wooden sign on two sticks, or a speech bubble) that carries the date and time.
  // The prop sits just above Mattie's head; the sticks run behind him and end in his hands.
  const held = (kind, cx, pw, ph, ms, pose, lift = 1) => {
    const my = SH - ms - 6, mx = cx - ms / 2, head = my + 0.21 * ms;
    // lift the prop toward the top of the stage on tall stages so the space above it is not empty (the sticks grow)
    const room = head - (kind === "sign" ? 22 : 44) - ph;
    const py = Math.max(0, Math.round(kind === "sign" ? room * lift : room)), px = cx - pw / 2;
    let out = "";
    if (kind === "sign") {
      for (const f of [0.133, 0.867]) out += `<div class="stick" style="left:${X(mx + f * ms - 10, 20)}px;top:${py + ph - 30}px;height:${Math.round(my + 0.656 * ms + 10 - (py + ph - 30))}px"></div>`;
      out += `<div class="board" style="left:${X(px, pw)}px;top:${py}px;width:${pw}px;height:${ph}px">${when(42)}</div>`;
    } else {
      out += `<div class="bubble" style="left:${X(px, pw)}px;top:${py}px;width:${pw}px;height:${ph}px">${when(42)}</div>`;
    }
    out += mattie(pose, X(mx, ms), my, ms, flip);
    return { html: out, py, my, mx };
  };

  let stage = "";
  if (!local) {
    // no photo: Mattie is the picture, bigger, holding the sign (or under a speech bubble when whisking)
    const ms = Math.min(600, SH - 260), cx = SW + 30 - ms / 2;
    stage += `<div class="blob" style="left:${X(cx - ms * 0.53, ms * 1.06)}px;top:${SH - ms * 1.06 + 4}px;width:${ms * 1.06}px;height:${ms * 1.06}px"></div>`;
    stage += facts(0, 0, 420, pal ? SH - 230 : SH - 40, vc + menu(200), "center");
    if (pal) stage += buddy(pal, X(40, pal === "chasen" ? 120 : 90), SH - 200, 180);
    else stage += petal(X(70, 70), SH - 170, 70, -18) + petal(X(200, 50), SH - 90, 50, 34);
    const h = held(layout, cx, 500, 216, ms, whisk ? "m-whisk" : face, 0.4);
    stage += h.html + spark(X(cx + ms * 0.4, 46), h.my + ms * 0.08, 46);
  } else if (layout === "peek") {
    // photo on one side, Mattie peeking over its top edge with both hands hooked on the frame
    const fs_ = 460, fy = SH - fs_ - 22, pw = 580, ph = (pw * 38) / 64;
    stage += frame(SW - fs_ - 10, fy, fs_, fs_);
    stage += mattie("m-peek", X(SW - fs_ / 2 - 10 - pw / 2, pw), Math.round(fy - 0.921 * ph), pw);
    stage += facts(0, 0, 430, SH, `<div class="when">${when(46)}</div>${vc}${menu(132)}`, "center");
    if (pal) stage += buddy(pal, X(SW - 60, pal === "chasen" ? 100 : 76), SH - 150, 150);
    stage += spark(X(SW - fs_ - 40, 44), Math.max(0, fy - 330), 44);
  } else if (layout === "sign" || layout === "bubble") {
    // photo and menu on one side; venue card, the held prop and Mattie on the other
    const ms = SH >= 820 ? 440 : 400, cx = SW - 241;
    const fw = SH >= 820 ? 452 : 400;
    stage += facts(0, 0, fw + 10, SH, `${frame(0, 0, fw, fw * 1.25).replace('class="frame" style="left:' + X(0, fw) + "px;top:0px;", 'class="frame" style="position:relative;')}${menu(132)}`, "center");
    const h = held(layout, cx, 482, 200, ms, face);
    stage += facts(470, 0, 482, Math.max(170, h.py - 20), vc, "center");
    if (pal) stage += buddy(pal, X(SW - 70, pal === "chasen" ? 100 : 76), SH - 156, 150);
    stage += h.html + spark(X(452, 40), h.my + 60, 40);
  } else {
    // point: big photo in the upper corner, date pills beside it, the venue card under it, and Mattie
    // beside the card with an arm raised toward it and a dotted trail (whisking instead for cafes)
    const ms = 420, my = SH - ms - 4, mx = SW - ms + 10, pw = Math.min(500, SH - 216);
    const cy = Math.max(pw + 30, Math.min(SH - 186, Math.round(my + 0.47 * ms) - 84));
    stage += frame(0, 0, pw, pw);
    stage += facts(pw + 44, 12, SW - pw - 44, Math.max(200, my + 60), `<div class="when">${when(46)}</div>${menu(132)}`);
    stage += facts(0, cy, 470, 176, vc, "center");
    if (!whisk) stage += `<div class="trail" style="left:${X(482, mx + 0.1 * ms - 482)}px;top:${cy + 86}px;width:${Math.round(mx + 0.1 * ms - 482)}px"></div>`;
    if (pal) stage += buddy(pal, X(SW - 66, pal === "chasen" ? 100 : 76), SH - 156, 150);
    stage += mattie(whisk ? "m-whisk" : "m-wave", X(mx, ms), my, ms, !flip);
    stage += spark(X(mx + ms * 0.1, 40), my - 6, 40);
  }

  const inWeekend = weekendOf(e);
  const title = oneLine
    ? `<div class="brand" data-fit data-max="118" data-min1="60">${esc(brand)}</div>`
    : `<div class="brand" data-fit data-max="98" data-min1="98" data-lines="2" data-max2="98" data-min="56">${esc(brand)}</div>`;
  const scene = band(bandH) + headerHtml({ tag: inWeekend ? "this weekend" : e.kind === "cafe" ? "Matcha cafe" : "Matcha pop-up", sun: inWeekend, titleHtml: title, extra: handle ? `<div class="via">via @${esc(handle)}</div>` : "" }) +
    `<div class="stage" style="top:${top}px;height:${SH}px">${stage}</div>` + margins(e.id || brand, MARGIN_SPOTS.map((s, i) => (i < 2 ? [s[0], bandH + 22, s[2], s[3]] : s)));
  return render("flyer.html", { css: CSS, defs, fitjs: FITJS, size, variant: "v" + (hb % 4), scene });
}

function roundupHtml(city, list, size) {
  const story = size === "story";
  const sorted = [...list].sort((a, b) => new Date(a.start) - new Date(b.start));
  const max = 6, shown = sorted.slice(0, max);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const a = dayLabel(first.start, first.tz), b = dayLabel(last.start, last.tz);
  const h = hash(city);
  const cards = shown.map((e) => {
    const sub = (e.venue && e.venue.toLowerCase() !== String(e.brand).toLowerCase() ? e.venue : "") || [e.city, e.state].filter(Boolean).join(", ");
    const dango = `<svg class="db" viewBox="0 0 32 64"><use href="#c-dango" width="32" height="64"/></svg>`;
    const dl = esc(dayLabel(e.start, e.tz));
    return story
      ? `<div class="rc">${dango}<div class="tx"><div class="rb">${esc(e.brand)}</div><div class="rs">${esc(trunc(String(sub), 44))}</div></div><span class="rd">${dl}</span></div>`
      : `<div class="rc"><div class="r1">${dango}<span class="rd">${dl}</span></div><div class="rb">${esc(e.brand)}</div><div class="rs">${esc(trunc(String(sub), 34))}</div></div>`;
  }).join("");
  const more = sorted.length > max ? `+ ${sorted.length - max} more on the map` : "";
  const bandH = story ? 520 : 450;
  const title = `<div class="ttl" data-fit data-max="${story ? 100 : 92}" data-min1="70" data-lines="2" data-max2="${story ? 92 : 84}" data-min="52" style="width:${story ? 620 : 600}px">This weekend in ${esc(city)}</div>`;
  let scene = band(bandH) + headerHtml({ tag: "this weekend", sun: true, titleHtml: title, extra: `<span class="pd rng">${esc(a === b ? a : `${a} to ${b}`)}</span>` });
  scene += story ? mattie("m-wave", 700, 140, 330) : mattie("m-wave", 664, 96, 380);
  scene += story ? spark(640, 110, 44) + petal(980, 440, 50, 24) : spark(636, 100, 40) + petal(972, 404, 46, 24);
  const gridTop = story ? 568 : 498, odd = !story && shown.length % 2 === 1;
  const cell = odd ? `<div class="cell">${buddy("chasen", 110, 30, 150)}${buddy("dango", 270, 14, 176)}${spark(40, 40, 44)}${petal(370, 120, 46, 20)}</div>` : "";
  const spread = story ? "" : `height:${1226 - gridTop}px;grid-auto-rows:${shown.length > 4 ? 218 : 250}px;align-content:space-evenly;`;
  scene += `<div class="grid" style="top:${gridTop}px;${spread}">${cards}${cell}</div>`;
  if (story) {
    scene += `<div class="blob" style="left:315px;top:1420px;width:450px;height:450px;opacity:.4"></div>`;
    scene += buddy("chasen", 170, 1610, 160) + buddy("dango", 830, 1590, 180);
    scene += mattie(["m-happy", "m-excited"][h % 2], 320, 1366, 440);
    scene += petal(120, 1480, 54, -20) + spark(880, 1460, 46) + petal(940, 1740, 44, 30);
    if (more) scene += `<div class="more" style="top:${gridTop + shown.length * 134}px">${esc(more)}</div>`;
  } else {
    if (more) scene += `<div class="more" style="top:1206px">${esc(more)}</div>`;
    scene += margins(city, MARGIN_SPOTS.slice(2).concat([[30, 470, 46, -20], [1000, 520, 42, 30]]));
  }
  return render("roundup.html", { css: CSS, defs, fitjs: FITJS, size, variant: "v" + (h % 4), scene });
}

function welcomeHtml() {
  let scene = band(620) + headerHtml({ tag: "hello", sun: true, titleHtml: "" });
  scene += `<div class="blob" style="left:250px;top:150px;width:580px;height:580px"></div>`;
  scene += petal(150, 230, 90, -20) + petal(860, 300, 70, 30) + spark(820, 180, 56) + spark(196, 560, 40);
  scene += buddy("dango", 170, 600, 150) + buddy("chasen", 826, 620, 130);
  scene += mattie("m-whisk", 230, 140, 620);
  scene += `<div class="big" style="top:820px">Every matcha pop-up, one map</div>`;
  scene += `<div class="lead" style="top:1060px">Where and when, so you can find one near you</div>`;
  return render("welcome.html", { css: CSS, defs, fitjs: FITJS, size: "feed", variant: "v0", scene });
}

// ---- captions ----
const tag = (s) => "#" + String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
function captionFor(e) {
  const tz = e.tz || "America/New_York", t = timeText(e), h = handleOf(e);
  const place = [e.venue, e.address, e.city].filter(Boolean).join(", ");
  const s1 = `${e.brand} is popping up on ${dayLabel(e.start, tz, true)}${t ? ", " + t : ""}.`;
  const s2 = `Find them at ${place || [e.city, e.state].filter(Boolean).join(", ")}.`;
  const tags = ["#matcha", "#matchapopup", tag(e.city) + "matcha", tag(e.city) + "popup", "#matchamap"].filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 8);
  return [s1 + " " + s2, h ? `via @${h}` : "", [e.city, e.state].filter(Boolean).join(", "), tags.join(" "), "Map: link in bio"].filter(Boolean).join("\n\n") + "\n";
}
function captionRoundup(city, list) {
  const names = [...list].sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 6).map((e) => e.brand + (handleOf(e) ? " (@" + handleOf(e) + ")" : ""));
  const tags = ["#matcha", "#matchapopup", tag(city) + "matcha", tag(city) + "popup", "#matchamap"];
  return [`${list.length} matcha pop-ups in ${city} this weekend. See who is where and when on the map.`, names.join("\n"), city, tags.join(" "), "Map: link in bio"].join("\n\n") + "\n";
}
const WELCOME_CAPTION = ["Matcha Map is a map of matcha pop-ups across America. Every pop-up, where and when, in one place.", "We credit every brand we share and link back to them.", "#matcha #matchapopup #matchamap", "Map: link in bio"].join("\n\n") + "\n";

// ---- chrome ----
function shot(htmlText, out, w, h, transparent) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flyer-"));
  const file = path.join(tmp, "p.html");
  fs.writeFileSync(file, htmlText);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const a = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1", "--allow-file-access-from-files",
    `--user-data-dir=${path.join(tmp, "u")}`, `--screenshot=${out}`, `--window-size=${w},${h}`, "--virtual-time-budget=6000"];
  if (transparent) a.push("--default-background-color=00000000");
  a.push(pathToFileURL(file).href);
  return new Promise((res) => {
    const p = spawn(CHROME, a, { stdio: "ignore" });
    const t = setTimeout(() => p.kill(), 60000);
    p.on("exit", () => { clearTimeout(t); fs.rmSync(tmp, { recursive: true, force: true }); res(fs.existsSync(out)); });
  });
}
async function pool(jobs, n) {
  let i = 0, ok = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const j = jobs[i++]; if (await j()) ok++; } }));
  return ok;
}

// ---- main ----
const dir = path.join(OUTBOX, today);
fs.mkdirSync(dir, { recursive: true });
const index = [];
const jobs = [];
let made = 0, skipped = 0;
function queue(name, htmlFn, size, caption, meta) {
  const png = path.join(dir, name + ".png"), txt = path.join(dir, name + ".txt");
  index.push({ file: name + ".png", ...meta });
  if (caption != null && (FORCE || !fs.existsSync(txt))) fs.writeFileSync(txt, caption);
  if (!FORCE && fs.existsSync(png)) { skipped++; return; }
  jobs.push(async () => { const ok = await shot(htmlFn(), png, 1080, size === "story" ? 1920 : 1350); if (ok) made++; else console.error("failed:", name); return ok; });
}

// logos (once)
for (const [tpl, out, w, h] of [["logo.html", "logo.png", 1024, 512], ["logo-mark.html", "logo-mark.png", 1024, 1024]]) {
  const o = path.join(BRAND, out);
  if (LOGOS || !fs.existsSync(o)) jobs.push(() => shot(render(tpl, { css: CSS, defs, face: FACE }), o, w, h, true));
}
// welcome (once, outside the dated folder)
{
  const wdir = path.join(OUTBOX, "welcome"), png = path.join(wdir, "welcome.png");
  fs.mkdirSync(wdir, { recursive: true });
  if (!fs.existsSync(path.join(wdir, "welcome.txt")) || FORCE) fs.writeFileSync(path.join(wdir, "welcome.txt"), WELCOME_CAPTION);
  if (FORCE || !fs.existsSync(png)) jobs.push(async () => { const ok = await shot(welcomeHtml(), png, 1080, 1350); if (ok) made++; return ok; });
}
for (const e of inWeek) {
  queue(`${slug(e.brand)}-${dayKey(e.start, e.tz)}-${e.id}`, () => flyerHtml(e, "feed"), "feed", captionFor(e),
    { kind: "flyer", id: e.id, brand: e.brand, when: dayKey(e.start, e.tz), city: e.city, url: e.source_url });
}
let roundups = 0;
for (const [city, list] of byCity) {
  if (list.length < 3) continue;
  roundups++;
  const base = `weekend-${slug(city)}-${fri}`;
  const meta = { kind: "roundup", id: list.map((e) => e.id).join(", "), brand: list.length + " pop-ups", when: fri + " to " + sun, city, url: list.map((e) => e.source_url).join(" ; ") };
  queue(base, () => roundupHtml(city, list, "feed"), "feed", captionRoundup(city, list), meta);
  queue(base + "-story", () => roundupHtml(city, list, "story"), "story", null, { ...meta, kind: "roundup (story)" });
}

const t0 = Date.now();
await pool(jobs, 4);

const cell = (s) => String(s == null ? "" : s).replace(/\|/g, "/");
let md = `# Outbox ${today}\n\nReview each image and caption before posting. Nothing here has been posted. Check the source URL still shows the event.\n\n`;
md += `Welcome post (post once): \`../welcome/welcome.png\` with \`welcome.txt\`.\n\n| File | Kind | Event id | Brand | Date | City | Source URL |\n|---|---|---|---|---|---|---|\n`;
for (const r of index) md += `| ${cell(r.file)} | ${r.kind} | ${cell(r.id)} | ${cell(r.brand)} | ${r.when} | ${cell(r.city)} | ${cell(r.url)} |\n`;
fs.writeFileSync(path.join(dir, "INDEX.md"), md);
console.log(`flyers: ${inWeek.length} single, ${roundups} roundup city(ies); rendered ${made}, skipped ${skipped} existing; ${((Date.now() - t0) / 1000).toFixed(0)}s; ${dir}`);
