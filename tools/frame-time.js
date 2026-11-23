// node tools/frame-time.js [--at 40.73,-73.99,12] [--size 390x844] [--pins 200]: frame time of the map with its pins moving
// (2026-11-23, the pin look: bob, pulse, drop-in, all CSS). Loads the view with motion on, tops the pins in view up to
// --pins with copies of the real pins (the densest real view holds fewer once stacks and neighbourhoods fold them), then
// times requestAnimationFrame for 3 s idle and 3 s of a pan. Prints frames, median, mean and 95th percentile frame time and the
// frames over 20 ms. --calm: the same with motion off. Headless Chrome draws the map in software (SwiftShader), so a phone's GPU does better than this.
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CALM = process.argv.includes("--calm"), AT = arg("--at", "40.73,-73.99,12"), SIZE = arg("--size", "390x844"), PINS = +arg("--pins", 200);
const EVAL = `(async () => {
  const m = window.__matcha.map, real = document.querySelectorAll(".maplibregl-marker").length;
  const tpl = [...document.querySelectorAll(".maplibregl-marker")].filter((x) => x.querySelector(".pn") && (!x.classList.contains("mk-cl") || x.classList.contains("cl-nt")));
  const b = m.getBounds(); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; tpl.length && document.querySelectorAll(".maplibregl-marker").length < ${PINS} && i < 1000; i++) {
    const t = tpl[i % tpl.length].cloneNode(true); t.classList.remove("sel");
    new maplibregl.Marker({ element: t }).setLngLat([b.getWest() + rnd() * (b.getEast() - b.getWest()), b.getSouth() + rnd() * (b.getNorth() - b.getSouth())]).addTo(m);
  }
  if (${CALM ? "true" : "false"}) document.documentElement.classList.add("rm");
  m.getContainer().classList.toggle("pn-busy", document.querySelectorAll(".maplibregl-marker").length > 40); // as app.js does after a sync
  await new Promise((r) => setTimeout(r, 3500)); // the copies drop in, their pictures load and decode
  const n = document.querySelectorAll(".maplibregl-marker").length;
  const measure = (ms) => new Promise((res) => { const ts = []; const s = performance.now(); const f = (t) => { ts.push(t); if (t - s < ms) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); });
  const stats = (ts) => { const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b), mean = d.reduce((a, b) => a + b, 0) / d.length;
    return { frames: d.length, medianMs: +d[Math.floor(d.length / 2)].toFixed(2), meanMs: +mean.toFixed(2), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2), over20: d.filter((x) => x > 20).length, fps: +(1000 / mean).toFixed(1) }; };
  const idle = stats(await measure(3000));
  m.panBy([180, 90], { duration: 3000 }); // the same 200 px drag at any zoom
  const pan = stats(await measure(3000));
  return { at: ${JSON.stringify(AT)}, size: ${JSON.stringify(SIZE)}, realPins: real, pinsMeasured: n, idle, pan };
})()`;
const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "view-shot.js"), "--at", AT, "--size", SIZE, "--motion", "--out", path.join(os.tmpdir(), "mm-frame-time.png"), "--eval", EVAL], { encoding: "utf8", cwd: ROOT });
process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");
process.exit(r.status || 0);
