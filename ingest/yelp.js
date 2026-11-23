// npm run yelp: look up upcoming events' venues and the storefronts on Yelp (needs YELP_API_KEY), write site/data/places.json,
// and give approximate pins the coordinates Yelp found. Without a key it prints one "Yelp: off" line.
import "./lib/env.js";
import fs from "node:fs";
import { readEvents, writeEvents } from "./lib/write.js";
import { enrich, fillApproxFromYelp, createYelp } from "./lib/enrich/yelp.js";
import { info } from "./lib/log.js";

const dry = process.argv.includes("--dry");
const yelp = createYelp();
let shops = [];
try { shops = JSON.parse(fs.readFileSync("site/data/shops.json", "utf8")).shops || []; } catch { /* none */ }
const events = readEvents();
const r = await enrich({ events, shops, yelp, dry });
if (r.on && !dry) {
  const moved = fillApproxFromYelp(events, yelp.places());
  if (moved.length) { writeEvents(events); info(`Yelp: ${moved.length} approximate pin(s) moved to the venue`); }
}
