// Once-a-UTC-day gate shared by ingest/loop.js and ingest/daily.js: the stamp file holds the UTC day of the last completed Yelp lead search
// (.cache/yelp-leads-day.txt), so the lane never runs twice in a day whichever runner starts it. 250 cities a run keeps room under Yelp's plan.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DAY_STAMP = path.join(ROOT, ".cache", "yelp-leads-day.txt");
export const todayUTC = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
// Due unless the stamp holds today's UTC day. `read` and `today` are injectable for tests.
export function yelpDue(read = (f) => fs.readFileSync(f, "utf8"), today = todayUTC(), file = DAY_STAMP) {
  try { return read(file).trim() !== today; } catch { return true; }
}
export function stampYelp(file = DAY_STAMP, today = todayUTC()) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, today); }
