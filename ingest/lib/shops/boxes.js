// Bounding boxes [south, west, north, east] for the Overpass queries: one per city of data/cities.json (a national box times out on
// the public servers). The half-width depends on the population: 12 km over 500,000 people, 8 km over 100,000, 5 km otherwise.
// A smaller city whose box lies more than 60 percent inside a bigger city's box is dropped (the bigger box already covers it).
// Boxes come out in rank_us order, biggest city first, so a limited run budget goes to the biggest cities.
import fs from "node:fs";
import path from "node:path";
import { loadCities } from "../cities.js";

const KM_PER_DEG = 111.32;
export const OVERLAP_DROP = 0.6;
export const radiusKm = (pop) => (pop > 500000 ? 12 : pop > 100000 ? 8 : 5);

export function boxOf(c) {
  const km = radiusKm(c.pop);
  const dy = km / KM_PER_DEG, dx = km / (KM_PER_DEG * Math.cos((c.lat * Math.PI) / 180));
  return [+(c.lat - dy).toFixed(4), +(c.lng - dx).toFixed(4), +(c.lat + dy).toFixed(4), +(c.lng + dx).toFixed(4)];
}

// Share of box a that lies inside box b.
export function overlapShare(a, b) {
  const h = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), w = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (h <= 0 || w <= 0) return 0;
  return (h * w) / ((a[2] - a[0]) * (a[3] - a[1]));
}

// cities (entries, any order) -> [{name, state, rank_us, bbox}] in rank_us order, overlapping boxes of smaller cities removed.
export function metroBoxes(cities = loadCities()) {
  const out = [];
  for (const c of cities.slice().sort((a, b) => a.rank_us - b.rank_us)) {
    const bbox = boxOf(c);
    if (out.some((o) => overlapShare(bbox, o.bbox) > OVERLAP_DROP)) continue;
    out.push({ name: c.name, state: c.state, rank_us: c.rank_us, bbox });
  }
  return out;
}

export const loadBoxes = () => metroBoxes(loadCities());

// ---- which boxes this run asks about --------------------------------------------------------------
export const SHOP_CURSOR_FILE = ".cache/shops-cursor.json";
export const boxesPerRun = (env = process.env) => Math.max(1, +env.SHOP_BOXES_PER_RUN || 120);

// The next `perRun` boxes from the saved position, wrapping round the list. -> { batch, commit(done) } where done is how many of the
// batch were actually asked (a run that stops early moves the cursor only that far).
export function nextBoxes(boxes, { perRun = boxesPerRun(), file = SHOP_CURSOR_FILE } = {}) {
  let start = 0;
  try { start = JSON.parse(fs.readFileSync(file, "utf8")).next || 0; } catch { /* first run */ }
  const n = boxes.length;
  start = n ? start % n : 0;
  const batch = Array.from({ length: Math.min(perRun, n) }, (_, i) => boxes[(start + i) % n]);
  return {
    batch,
    commit(done = batch.length) {
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ next: n ? (start + done) % n : 0 })); } catch { /* cache only */ }
    },
  };
}
