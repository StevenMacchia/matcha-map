// node tools/triangle-count.mjs [--json]: shop rows the map draws in the Triangle (NC), per city and tier. Used for the before/after of a serves pass.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { shown } from "./card-completeness.mjs";
export const TRIANGLE = ["raleigh", "durham", "chapel hill", "cary", "morrisville", "apex", "holly springs", "wake forest", "garner", "fuquay-varina", "fuquay varina", "hillsborough", "carrboro", "knightdale", "rolesville", "wendell", "zebulon", "clayton", "pittsboro", "mebane"];
export function triangleCounts(shops) {
  const out = { core: 0, serves: 0, byCity: {} };
  for (const s of shops.filter((x) => shown(x) && x.state === "NC" && TRIANGLE.includes(String(x.city).toLowerCase()))) {
    const k = s.tier === "serves" ? "serves" : "core";
    out[k]++;
    const c = (out.byCity[s.city] = out.byCity[s.city] || { core: 0, serves: 0 });
    c[k]++;
  }
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = triangleCounts(JSON.parse(fs.readFileSync("data/shops.json", "utf8")).shops);
  console.log(process.argv.includes("--json") ? JSON.stringify(r) : `Triangle: ${r.core} core, ${r.serves} serves\n` + Object.entries(r.byCity).sort((a, b) => b[1].core + b[1].serves - a[1].core - a[1].serves).map(([c, v]) => `  ${c}: ${v.core} core, ${v.serves} serves`).join("\n"));
}
