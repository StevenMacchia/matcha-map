// node tools/daily-status.js: docs/DAILY.md -> site/data/daily-status.json, the run health tile on /m/ reads it. Run after the daily report step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDaily } from "../functions/_lib/metrics.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = parseDaily(fs.readFileSync(path.join(root, "docs", "DAILY.md"), "utf8"));
fs.writeFileSync(path.join(root, "site", "data", "daily-status.json"), JSON.stringify(out) + "\n");
console.log("daily-status:", JSON.stringify(out));
