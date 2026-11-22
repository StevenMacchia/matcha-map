// Metro bounding boxes [south, west, north, east] for the Overpass queries: one per distinct city in
// site/cities.js and data/cities-discover.json (a national box times out on the public servers).
// lat +-0.35 and lng +-0.45 degrees around the city centre; the biggest metros get +-0.6.
// Overlaps are fine; shop ids dedupe.
import fs from "node:fs";

// Centres for discover-list cities that site/cities.js does not carry.
const EXTRA = {
  Philadelphia: [39.9526, -75.1652], "Washington DC": [38.9072, -77.0369], "Las Vegas": [36.1699, -115.1398],
  "San Jose": [37.3382, -121.8863], Cleveland: [41.4993, -81.6944], Indianapolis: [39.7684, -86.1581], Providence: [41.824, -71.4128],
};
const BIG = new Set(["Los Angeles", "New York", "San Francisco", "Oakland", "Chicago", "Houston", "Dallas"]);

export function metroBoxes(cities = {}, discover = []) {
  const centres = new Map();
  for (const [k, c] of Object.entries(cities)) centres.set(k.split("|")[0], c);
  for (const n of discover) if (!centres.has(n) && EXTRA[n]) centres.set(n, EXTRA[n]);
  const out = [];
  for (const [name, [lat, lng]] of centres) {
    const d = BIG.has(name) ? 0.6 : null;
    const dy = d ?? 0.35, dx = d ?? 0.45;
    out.push({ name, bbox: [+(lat - dy).toFixed(4), +(lng - dx).toFixed(4), +(lat + dy).toFixed(4), +(lng + dx).toFixed(4)] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadBoxes() {
  let cities = {}, discover = [];
  try { const t = fs.readFileSync("site/cities.js", "utf8"); cities = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1).replace(/,(\s*})/, "$1")); } catch { /* none */ }
  try { discover = JSON.parse(fs.readFileSync("data/cities-discover.json", "utf8")).cities || []; } catch { /* none */ }
  return metroBoxes(cities, discover);
}
