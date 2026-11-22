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
function flyerHtml(e, size) {
  const tz = e.tz || "America/New_York", h = hash(e.brand), v = h % 3, handle = handleOf(e);
  const brand = String(e.brand || "").replace(/\s+/g, " ").trim();
  const pose = ["m-happy", "m-excited", "m-wave"][(h >> 3) % 3];
  const local = e.image && e.image.local && fs.existsSync(path.join(ROOT, "site", e.image.local)) ? path.join(ROOT, "site", e.image.local) : null;
  const visual = local
    ? `<div class="photo"><div class="im"><img src="${pathToFileURL(local).href}" alt=""></div>${sym(pose, "0 0 64 64", "sticker")}</div>`
    : `<div class="blob"></div>` + sym(pose, "0 0 64 64", "m") +
      `<svg class="pet" style="left:4%;top:6%;width:70px;height:70px;transform:rotate(-20deg)" viewBox="0 0 20 20"><use href="#c-petal" width="20" height="20"/></svg>` +
      `<svg class="pet" style="right:6%;bottom:4%;width:48px;height:96px" viewBox="0 0 32 64"><use href="#c-dango" width="32" height="64"/></svg>`;
  const menu = (Array.isArray(e.menu) ? e.menu : []).filter(Boolean).slice(0, 5);
  const where = [];
  if (e.venue) where.push(`<span class="l">${esc(trunc(e.venue, 46))}</span>`);
  if (e.address) where.push(`<span class="l a">${esc(trunc(e.address, 52))}</span>`);
  where.push(`<span class="l a">${esc([e.city, e.state].filter(Boolean).join(", "))}</span>`);
  return render("flyer.html", {
    css: CSS, defs, fitjs: FITJS, face: FACE, size, variant: "v" + v,
    kindLabel: e.kind === "cafe" ? "Matcha cafe" : "Matcha pop-up",
    brand, nameClass: brand.length > 28 ? " two" : "",
    handleHtml: handle ? `<div class="handle">@${esc(handle)}</div>` : "",
    day: dayLabel(e.start, tz), time: timeText(e) || "Time on the post",
    whereHtml: where.join(""),
    pillsHtml: menu.length ? `<div class="pills">${menu.map((m) => `<span class="pill">${esc(trunc(String(m), 30))}</span>`).join("")}</div>` : "",
    visual,
  });
}

function roundupHtml(city, list, size) {
  const sorted = [...list].sort((a, b) => new Date(a.start) - new Date(b.start));
  const max = size === "story" ? 8 : 6, shown = sorted.slice(0, max);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const a = dayLabel(first.start, first.tz), b = dayLabel(last.start, last.tz);
  const rows = shown.map((e, i) => {
    const sub = (e.venue && e.venue.toLowerCase() !== String(e.brand).toLowerCase() ? e.venue : "") || [e.city, e.state].filter(Boolean).join(", ");
    const bullet = i % 2 ? sym("c-dango", "0 0 32 64", "b") : sym("m-happy", "4 9 56 52", "b");
    return `<div class="row">${bullet}<div class="tx"><div class="rb">${esc(e.brand)}</div><div class="rs">${esc(trunc(sub, 44))}</div></div><div class="rd">${esc(dayLabel(e.start, e.tz).split(",")[0])}</div></div>`;
  }).join("");
  const more = (sorted.length > max ? `<div class="more">+ ${sorted.length - max} more on the map</div>` : "") + (size === "story" ? `<div class="vis"><div class="blob"></div>${sym("m-excited", "0 0 64 64", "m")}</div>` : "");
  const title = "This weekend in " + city;
  return render("roundup.html", {
    css: CSS, defs, fitjs: FITJS, face: FACE, size, variant: "v" + (hash(city) % 3),
    city, titleClass: title.length > 24 ? " two" : "", range: a === b ? a : `${a} to ${b}`,
    rows, moreHtml: more,
  });
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
  if (FORCE || !fs.existsSync(png)) jobs.push(async () => { const ok = await shot(render("welcome.html", { css: CSS, defs, fitjs: FITJS, face: FACE, size: "feed" }), png, 1080, 1350); if (ok) made++; return ok; });
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
