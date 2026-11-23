// Before/after markdown tables from two percity.cjs snapshots: per city (cities with a change or 3+ upcoming) and distinct cities per state.
const fs = require("fs");
const [bf, af] = [process.argv[2], process.argv[3]].map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const keys = [...new Set([...Object.keys(bf.cities), ...Object.keys(af.cities)])];
const rows = keys.map((k) => ({ k, b: bf.cities[k] || 0, a: af.cities[k] || 0 })).sort((x, y) => y.a - x.a || y.b - x.b || x.k.localeCompare(y.k));
const out = [];
out.push(`| City | Before | After | Change |`, `|---|---:|---:|---:|`);
for (const r of rows) if (r.a !== r.b || r.a >= 3) out.push(`| ${r.k} | ${r.b} | ${r.a} | ${r.a - r.b >= 0 ? "+" : ""}${r.a - r.b} |`);
out.push(`| Total upcoming | ${bf.upcoming} | ${af.upcoming} | +${af.upcoming - bf.upcoming} |`);
out.push(`| Cities with an upcoming pop-up | ${Object.keys(bf.cities).length} | ${Object.keys(af.cities).length} | +${Object.keys(af.cities).length - Object.keys(bf.cities).length} |`);
const st = (snap) => { const m = {}; for (const [k, n] of Object.entries(snap.cities)) { const s = k.split(", ").pop(); (m[s] = m[s] || []).push([k.replace(/, [A-Z]{2}$/, ""), n]); } return m; };
const sb = st(bf), sa = st(af);
out.push("", `| State | Cities before | Cities after | After, by city |`, `|---|---:|---:|---|`);
for (const s of [...new Set([...Object.keys(sb), ...Object.keys(sa)])].sort((x, y) => (sa[y]?.length || 0) - (sa[x]?.length || 0) || x.localeCompare(y))) {
  const list = (sa[s] || []).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c} ${n}`).join(", ");
  out.push(`| ${s} | ${(sb[s] || []).length} | ${(sa[s] || []).length} | ${list} |`);
}
console.log(out.join("\n"));
