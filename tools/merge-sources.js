// Merge data/<wave>/*.json into data/sources.json (folder as the first argument, default data/wave2).
// Dedupes by id, by Instagram handle and by normalized brand name. Validates against the schema's required keys and enums.
import fs from "node:fs";
const schema = JSON.parse(fs.readFileSync("data/schema/source.schema.json", "utf8"));
const req = schema.required || [];
const enums = {};
for (const [k, v] of Object.entries(schema.properties || {})) if (v.enum) enums[k] = v.enum;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const base = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
const seenId = new Set(base.map((s) => s.id));
const seenIg = new Set(base.map((s) => norm(s.instagram)).filter(Boolean));
const seenBrand = new Set(base.map((s) => norm(s.brand)));
const out = [...base];
const report = [];
const dir = process.argv[2] || "data/wave2";
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  let arr = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8")); if (!Array.isArray(arr)) arr = arr.sources || [];
  let added = 0, dup = 0, bad = 0;
  for (const s of arr) {
    const missing = req.filter((k) => !(k in s));
    const badEnum = Object.entries(enums).filter(([k, vals]) => s[k] != null && !vals.includes(s[k]));
    if (missing.length || badEnum.length) { bad++; report.push(`  bad ${s.id}: ${missing.join(",")} ${badEnum.map(([k]) => k).join(",")}`); continue; }
    const ig = norm(s.instagram);
    if (seenId.has(s.id) || (ig && seenIg.has(ig)) || seenBrand.has(norm(s.brand))) { dup++; continue; }
    seenId.add(s.id); if (ig) seenIg.add(ig); seenBrand.add(norm(s.brand));
    out.push(s); added++;
  }
  report.push(`${f}: ${arr.length} in, ${added} added, ${dup} duplicates, ${bad} bad`);
}
out.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync("data/sources.json", JSON.stringify(out, null, 2) + "\n");
fs.mkdirSync("site/data", { recursive: true });
fs.writeFileSync("site/data/sources.json", JSON.stringify(out, null, 2) + "\n");
console.log(report.join("\n"));
console.log(`total ${out.length} sources, ${out.filter((s) => s.instagram).length} with Instagram, ${out.filter((s) => s.schedule_url).length} with a schedule page`);
const states = {}; for (const s of out) states[s.home_state] = (states[s.home_state] || 0) + 1;
console.log(Object.entries(states).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v).join(", "));
