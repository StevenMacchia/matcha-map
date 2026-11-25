// npm run social:styles [-- --date YYYY-MM-DD] [--kind featured-shop|city|location|...] [--only a,b]: one card of the day drawn in every
// style (or the ones named), plus sheet.png, a contact sheet of them side by side. Writes tools/brand/outbox/styles-<date>/ (gitignored)
// and touches neither the history nor the site. The default card is the day's featured shop, the 2x2 drink tiles.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plan, loadData, tomorrowNY } from "./plan.js";
import { renderPages, itemHtml, SIZES } from "./render.js";
import { STYLE_NAMES, STYLES } from "./styles.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function styleSheet({ date = tomorrowNY(), kind = "featured-shop", only = null, out = path.join(ROOT, "tools", "brand", "outbox", "styles-" + date + (kind === "featured-shop" ? "" : "-" + kind)), data = loadData(ROOT) } = {}) {
  const p = plan({ date, data, history: {} });
  const it = p.items.find((x) => x.kind === kind) || p.items.find((x) => x.slot === "feed");
  if (!it) throw new Error("no card of that kind on " + date);
  const names = only ? STYLE_NAMES.filter((n) => only.includes(n)) : STYLE_NAMES;
  fs.mkdirSync(out, { recursive: true });
  const res = await renderPages(names.map((n) => ({ html: itemHtml({ ...it, style: n }), out: path.join(out, `${n}.png`), size: it.slot })));
  const checks = res.map((r, i) => ({ style: names[i], ok: r.ok, ...(r.check || {}) }));
  const [w, h] = SIZES[it.slot], cols = Math.min(5, names.length), rows = Math.ceil(names.length / cols), tw = 430, th = Math.round(tw * h / w);
  const cell = (n) => `<figure style="margin:0;width:${tw}px"><img src="${pathToUrl(path.join(out, n + ".png"))}" width="${tw}" height="${th}" style="display:block;border-radius:10px;box-shadow:0 3px 14px rgba(0,0,0,.3)"><figcaption style="font:700 24px system-ui,sans-serif;text-align:center;margin-top:8px;color:#4B3426">${n} · ${STYLES[n].word}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#EEE9DD"><div class="canvas" style="display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:24px;padding:28px;width:${cols * tw + (cols + 1) * 24 + 8}px">${names.map(cell).join("")}</div>`;
  const sw = cols * tw + (cols + 1) * 24 + 8, sh = rows * (th + 64) + 48;
  SIZES.sheet = [sw, sh];
  const s = await renderPages([{ html, out: path.join(out, "sheet.png"), size: "sheet" }]);
  delete SIZES.sheet;
  return { out, item: it.name, checks, sheet: s[0] && s[0].ok ? path.join(out, "sheet.png") : null };
}
const pathToUrl = (p) => "file:///" + p.replace(/\\/g, "/");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), val = (n) => { const i = a.indexOf(n); return i < 0 ? null : a[i + 1]; };
  styleSheet({ date: val("--date") || undefined, kind: val("--kind") || undefined, only: val("--only") ? val("--only").split(",") : null }).then((r) => {
    console.log(`${r.item} in ${r.checks.length} styles -> ${path.relative(ROOT, r.out)}${r.sheet ? " (sheet.png)" : ""}`);
    for (const c of r.checks) {
      const issues = [...(c.small || []).map((x) => "small: " + x), ...(c.off || []).map((x) => "off: " + x), ...(c.cut || []).map((x) => "cut: " + x), ...(c.overlap || []).map((x) => "overlap: " + x)];
      console.log(`  ${c.style.padEnd(10)} ${c.ok ? "ok" : "FAILED"} min ${c.min}px${issues.length ? "  " + issues.join("; ") : ""}`);
    }
  }).catch((e) => { console.error("styles: " + e.message); process.exit(1); });
}
