// npm run social [-- --date YYYY-MM-DD] [--force] [--no-site]: the day's @matchamap.app outbox.
// Plans the day (tools/social/plan.js), draws every post (tools/social/render.js) and writes tools/brand/outbox/<date>/:
//   INDEX.md          one line per post: time, type, file, caption, tags, where to paste it
//   plan.json         the plan as data (publish.js reads it)
//   NN-<slot>-<kind>-<place>/image.png, caption.txt, tags.json
// and copies each image to site/social/<date>/<NN-...>.png so it has a public address on matchamap.app (the Graph API
// publishes from a URL). Nothing is posted: Steven picks, then posts or schedules by hand in Meta Business Suite until
// the app review passes (docs/SOCIAL.md). Idempotent for a date: the same plan is not redrawn unless --force, and the
// brand history (tools/brand/outbox/history.json) entry for the date is replaced, never added to twice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "../site-url.js";
import { plan, loadData, readHistory, recordHistory, tomorrowNY } from "./plan.js";
import { renderPages, itemHtml, pngSize, SIZES, MIN_TEXT_PX } from "./render.js";
import { addDays } from "../gen-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUTBOX = path.join(ROOT, "tools", "brand", "outbox");
export const SITE_SOCIAL = path.join(ROOT, "site", "social");
export const KEEP_SITE_DAYS = 14;
const ITEM_DIR = /^\d\d-(feed|story)-/;

export const imageUrl = (date, it) => `${SITE_URL}/social/${date}/${it.name}.png`;
const oneLine = (s, n = 140) => { const t = String(s).split("\n")[0].replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

export function indexMd(p) {
  const lines = [`# Social outbox ${p.date}`, "",
    "Nothing here has been posted. Steven picks which to use; until the Meta app review passes, post or schedule each by hand in Meta Business Suite (Planner, then Create post or Create story). Times are Eastern. Full captions are in each folder's caption.txt; tags.json has the handles. Every image is drawn art; no brand photo is reused. Check the brand's own post still shows the date before posting.", "",
    "| Time | Type | File | Caption | Tags | Paste where |", "|---|---|---|---|---|---|"];
  const groups = [];
  for (const it of p.items) {
    const tags = it.mentions.map((h) => "@" + h).join(" ") || "none in our data";
    const where = it.slot === "feed"
      ? `Business Suite > Create post: upload image.png, paste caption.txt, Add location "${it.city}, ${it.state}"${it.mentions.length ? `, Tag people ${tags}` : ""}`
      : `Business Suite > Create story: upload image.png, add a link sticker to ${it.link}${it.mentions.length ? ` and a mention sticker for ${tags}` : ""}`;
    if (it.group && !groups.find((g) => g.key === it.group.key)) groups.push(it.group);
    lines.push(`| ${it.time} | ${it.slot} (${it.why || it.kind}${it.group ? ", " + it.group.place : ""}) | ${it.name}/image.png | ${oneLine(it.caption).replace(/\|/g, "/")} | ${tags} | ${where.replace(/\|/g, "/")} |`);
  }
  if (!p.items.length) lines.push("| | | | Nothing to post for this date: no pop-up, shop or series in the data that was not featured in the last 7 days. | | |");
  if (groups.length) {
    lines.push("", "## Stories by place", "", "Each place opens with its title story, then its own stories, close together in time. Post them in this order.", "");
    for (const g of groups) { const st = p.items.filter((i) => i.group && i.group.key === g.key); lines.push(`${g.n}. **${g.title}** (${st[0].time} to ${st[st.length - 1].time}): ${st.map((i) => i.name).join(", ")}`); }
  }
  return lines.join("\n") + "\n";
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escH = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// The public index of a day's images at /social/<date>/ (noindex; the images are the only public part of the outbox).
// Every asset is addressed from the root: this page lives two folders down, and a relative address would miss.
export function socialIndexHtml(date, items) {
  const figs = (items || []).map((it) => `<figure class="so-fig"><img src="/social/${escH(date)}/${escH(it.name)}.png" alt="${escH(it.title)}" loading="lazy" decoding="async" width="${it.slot === "story" ? 1080 : 1080}" height="${it.slot === "story" ? 1920 : 1350}"><figcaption>${escH(it.time)} · ${escH(it.slot)} · ${escH(it.title)}</figcaption></figure>`).join("\n");
  return `<!doctype html>
<html lang="en" class="pg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; base-uri 'self'; form-action 'none'; manifest-src 'self'; connect-src 'self' https://cloudflareinsights.com">
<title>Matcha Map on Instagram, ${escH(date)}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#FBF6EA">
<script src="/theme.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/pages.css">
<link rel="stylesheet" href="/social/social.css">
</head>
<body class="pg">
<header class="pg-top"><a class="pg-home" href="/"><svg class="pg-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-base"/></svg><span>Matcha Map</span></a><a class="pg-map" href="/">Open the map</a></header>
<main class="pg-main pg-wide">
<h1>Matcha Map on Instagram, ${escH(date)}</h1>
<p class="pg-intro">The day's drawn posts. Follow <a href="https://www.instagram.com/matchamap.app/" rel="noopener">@matchamap.app</a> for them as they go up.</p>
<div class="so-grid">
${figs}
</div>
</main>
<footer class="pg-foot"><p><a href="/privacy/">Privacy</a> &middot; <a href="/data-deletion/">Remove my data</a></p></footer>
</body>
</html>
`;
}

export async function buildOutbox({ date = tomorrowNY(), root = ROOT, outbox = path.join(root, "tools", "brand", "outbox"), siteDir = path.join(root, "site", "social"),
  historyFile = path.join(outbox, "history.json"), force = false, site = true, sample = false, style = null, render = renderPages, data = loadData(root), log = console.log } = {}) {
  const history = readHistory(historyFile);
  const p = plan({ date, data, history });
  for (const it of p.items) { it.image_url = imageUrl(date, it); if (style) it.style = style; }      // --style forces one look on every card
  const dir = path.join(outbox, sample ? "sample-" + date : date);      // a sample day is drawn beside the live folders and touches neither the history nor the site
  fs.mkdirSync(dir, { recursive: true });

  // the same plan as last time keeps its drawings (unless --force); anything else is cleared and redrawn
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")); } catch { return null; } })();
  const keep = !force && prev && same(prev.items, p.items) && p.items.every((it) => fs.existsSync(path.join(dir, it.name, "image.png")));
  if (!keep) for (const f of fs.readdirSync(dir)) if (ITEM_DIR.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });

  let checks = [];
  if (!keep && p.items.length) {
    const res = await render(p.items.map((it) => ({ html: itemHtml(it), out: path.join(dir, it.name, "image.png"), size: it.slot })));
    checks = res.map((r, i) => ({ name: p.items[i].name, ok: r.ok, ...(r.check || {}) }));
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) throw new Error("render failed: " + failed.map((c) => c.name).join(", "));
  }
  for (const it of p.items) {
    const d = path.join(dir, it.name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "caption.txt"), it.slot === "story" ? `(Stories have no caption. For the record, and for the link and mention stickers:)\n\n${it.caption}` : it.caption);
    fs.writeFileSync(path.join(d, "tags.json"), JSON.stringify({ slot: it.slot, time: it.time, image_url: it.image_url, location: `${it.city}, ${it.state}`, link: it.link,
      user_tags: it.user_tags, mentions: it.mentions, hashtags: it.hashtags }, null, 2) + "\n");
  }
  const flyerIndex = path.join(dir, "INDEX.md");
  if (fs.existsSync(flyerIndex) && !fs.readFileSync(flyerIndex, "utf8").startsWith("# Social outbox")) fs.renameSync(flyerIndex, path.join(dir, "INDEX-flyers.md"));   // npm run flyers wrote one here first
  fs.writeFileSync(path.join(dir, "INDEX.md"), indexMd(p));
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ date: p.date, items: p.items, featured: p.featured }, null, 2) + "\n");
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  if (!sample) fs.writeFileSync(historyFile, JSON.stringify(recordHistory(history, p), null, 2) + "\n");

  // public copies for the Graph API, kept two weeks
  if (site && !sample) {
    const sd = path.join(siteDir, date);
    fs.rmSync(sd, { recursive: true, force: true });
    if (p.items.length) fs.mkdirSync(sd, { recursive: true });
    for (const it of p.items) fs.copyFileSync(path.join(dir, it.name, "image.png"), path.join(sd, it.name + ".png"));
    if (p.items.length) fs.writeFileSync(path.join(sd, "index.html"), socialIndexHtml(date, p.items));
    const cut = addDays(date, -KEEP_SITE_DAYS);
    if (fs.existsSync(siteDir)) for (const f of fs.readdirSync(siteDir)) if (/^\d{4}-\d{2}-\d{2}$/.test(f) && f < cut) fs.rmSync(path.join(siteDir, f), { recursive: true, force: true });
  }

  for (const c of checks) {
    const issues = [...(c.small || []).map((x) => `text under ${MIN_TEXT_PX}px: ${x}`), ...(c.off || []).map((x) => `off the canvas: ${x}`), ...(c.cut || []).map((x) => `cut short: ${x}`), ...(c.overlap || []).map((x) => `overlap: ${x}`)];
    if (issues.length) log(`  check ${c.name}: ${issues.join("; ")}`);
  }
  for (const it of p.items) {
    const buf = fs.readFileSync(path.join(dir, it.name, "image.png")), sz = pngSize(buf), want = SIZES[it.slot];
    if (!sz || sz.width !== want[0] || sz.height !== want[1]) throw new Error(`${it.name}: image is ${sz ? sz.width + "x" + sz.height : "not a PNG"}, want ${want.join("x")}`);
  }
  log(`social ${date}: ${p.items.filter((i) => i.slot === "feed").length} feed, ${p.items.filter((i) => i.slot === "story").length} stories${keep ? " (unchanged, kept)" : ""}; ${path.relative(root, dir)}`);
  return { plan: p, dir, checks, kept: keep };
}

const flagValue = (a, name) => { const i = a.findIndex((x) => x === name || x.startsWith(name + "=")); return i < 0 ? null : a[i].includes("=") ? a[i].split("=")[1] : a[i + 1]; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const i = a.findIndex((x) => x === "--date" || x.startsWith("--date="));
  const date = i < 0 ? tomorrowNY() : a[i].includes("=") ? a[i].split("=")[1] : a[i + 1];
  buildOutbox({ date, force: a.includes("--force"), site: !a.includes("--no-site"), sample: a.includes("--sample"), style: flagValue(a, "--style") }).then((r) => {
    for (const it of r.plan.items) console.log(`  ${it.time} ${it.slot.padEnd(5)} ${it.name} ${it.mentions.map((h) => "@" + h).join(" ")}`);
  }).catch((e) => { console.error("social: " + e.message); process.exit(1); });
}
