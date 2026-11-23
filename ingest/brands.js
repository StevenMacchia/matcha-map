// npm run brands: rebuild site/data/brands.json from data/watchlist.json and data/sources.json (no network).
import fs from "node:fs";
import * as wlib from "./lib/watchlist.js";
import { buildBrands, writeBrands } from "./lib/enrich/brands.js";
import { info } from "./lib/log.js";

const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf8"));
const data = buildBrands(wlib.load(), sources);
const file = writeBrands(data);
info(`brands: ${data.brands.length} accounts (${data.brands.filter((b) => b.recent.length).length} with recent posts) -> ${file}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
