import fs from "node:fs";
import { drinkLooksOk } from "../ingest/lib/shops/providers.js";
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const b = j.shops.length;
  j.shops = j.shops.map((r) => ({ ...r, menu_matcha: (r.menu_matcha || []).filter((m) => drinkLooksOk(m.name)) })).filter((r) => r.menu_matcha.length >= (/^Menu mentions matcha/.test(r.note || "") ? 1 : 3));
  fs.writeFileSync(f, JSON.stringify(j, null, 1) + "\n");
  console.log(f, b, "->", j.shops.length);
}
