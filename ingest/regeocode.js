// npm run regeocode: look up the venue of events that sit at their city's centre (geocode_source "none", a venue name, no
// address) on Nominatim, upcoming ones first. At most 150 requests a run (1 per second); answers and misses are cached in
// data/geocache.json, so a second run only spends requests on venues not yet asked. Events that stay city-only keep
// geocode_source "none" and approx true. Flags: --dry (look up, do not write), --max=<n> (requests, default 150)
import { createGeocoder, lookableVenue } from "./lib/geocode.js";
import { findCity } from "./lib/cities.js";
import { readEvents, writeEvents } from "./lib/write.js";
import { info } from "./lib/log.js";

const dry = process.argv.includes("--dry");
const max = +(process.argv.find((a) => a.startsWith("--max="))?.slice(6) || 150);
const now = new Date();
const geocoder = createGeocoder({ maxRemote: max });
const events = readEvents();
const todo = events.filter((e) => e.geocode_source === "none" && e.venue && !e.address && lookableVenue(e.venue));
todo.sort((a, b) => (a.status === "upcoming" ? 0 : 1) - (b.status === "upcoming" ? 0 : 1));
let resolved = 0;
for (const e of todo) {
  const hit = await geocoder.lookupVenue(e.venue, e.city, e.state);
  if (!hit) continue;
  Object.assign(e, { lat: hit.lat, lng: hit.lng, geocode_source: hit.source, approx: false });
  if (e.confidence === "confirmed") e.confidence = "likely";
  resolved++;
}
// City-only events all sit on the one centre the city list gives (some older ones were placed by a free-text city lookup, a
// second, different point), so one city is one ring on the map.
let moved = 0;
for (const e of events) {
  const c = e.approx && e.city && e.state ? findCity(e.city, e.state) : null;
  if (c && (e.lat !== c.lat || e.lng !== c.lng)) { e.lat = c.lat; e.lng = c.lng; moved++; }
}
geocoder.save();
const up = (l) => l.filter((e) => e.status === "upcoming");
const approx = events.filter((e) => e.approx);
info(`regeocode: ${todo.length} city-centre events with a venue, ${resolved} resolved (${geocoder.remoteCalls()} requests); ${moved} moved onto their city's one centre; ${approx.length} approximate (${up(approx).length} upcoming)`);
if (!dry) writeEvents(events, { now });
