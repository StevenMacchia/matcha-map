// node tools/build-metrics-artifact.js -> docs/metrics-dashboard.html: a self-contained copy of site/m/ (css and js inlined) with
// the numbers this branch can produce today: map size and the daily run from site/data, a sample day for visits and taps.
// RSVP rows live only in the production KV, so the RSVP cards are the sample too. Not served by the site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup, summarize, lastDays, FEATURES } from "../functions/_lib/metrics.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const slim = JSON.parse(read("site/data/events-slim.json")), shops = JSON.parse(read("site/data/shops.json")), run = JSON.parse(read("site/data/daily-status.json"));
const today = new Date().toISOString().slice(0, 10), names = {}, evs = slim.events;
for (const e of evs) names["e:" + e.id] = `${e.brand || e.title}${e.city ? ", " + e.city : ""}${e.state ? " " + e.state : ""}`;
const pick = evs.filter((e) => e.status !== "past").slice(0, 6);

// one made-up day: 112 people, 38 bots
const pageRows = [], featRows = [];
const states = ["CA", "NY", "TX", "WA", "IL", "FL", "NC", "MA", "GA", "OR", "CO", "NJ"], groups = ["home", "city", "city", "event", "brand", "weekend", "state", "other"], refs = ["direct", "direct", "google.com", "instagram.com", "(this site)", "l.instagram.com", "bing.com"];
for (let i = 0; i < 150; i++) {
  const bot = i >= 112, g = groups[i % groups.length];
  pageRows.push({ metadata: { c: bot ? "b" : "h", s: i % 6 === 0 ? ["GB", "CA", "NL", "SG"][i % 4] : states[(i * 7) % states.length], n: i % 6 === 0 ? ["GB", "CA", "NL", "SG"][i % 4] : "US", v: i % 5 ? "mobile" : "desktop", g, p: g === "home" ? "/" : `/${g}/example-${i % 9}/`, r: refs[i % refs.length], u: i < 100 || (bot && i < 125) ? 1 : 0 } });
}
FEATURES.forEach((k, i) => { for (let n = 0; n < Math.max(2, 60 - i * 4); n++) featRows.push({ metadata: { k, v: "", c: "h" } }); });
pick.forEach((e, i) => { for (let n = 0; n < 14 - i * 2; n++) featRows.push({ metadata: { k: "card_open", v: "e:" + e.id, c: "h" } }); });
const daily = rollup(pageRows, featRows), empty = rollup([], []);
const perDay = lastDays(30, today).map((day) => ({ day, counts: day === today ? daily : empty }));
const rsvpRows = pick.flatMap((e, i) => Array.from({ length: 6 - i }, () => ({ event: e.id, at: today + "T12:00:00Z" })));
const data = summarize(perDay, { names, rsvp: { rows: rsvpRows } });
data.map = { shops: shops.shops.length, events: evs.length, upcoming: evs.filter((e) => Date.parse(e.end || e.start) >= Date.now()).length };
data.run = run; data.sample = true; data.sampleRsvp = true;

const html = read("site/m/index.html")
  .replace(/<link rel="stylesheet" href="\/m\/m\.css[^"]*">/, () => `<style>${read("site/m/m.css").replace(/@font-face[^\n]*\n/g, "")}</style>`)
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, "")
  .replace(/<script src="\/m\/m\.js[^"]*"><\/script>/, () => `<script>window.MM_STATIC = true;</script>\n<script>${read("site/m/m.js")}</script>\n<script>MMDash.show(${JSON.stringify(data)});</script>`)
  .replace(/<form id="gate"[\s\S]*?<\/form>/, '<form id="gate" hidden></form>');
fs.writeFileSync(path.join(root, "docs", "metrics-dashboard.html"), html);
console.log("docs/metrics-dashboard.html", html.length, "bytes; map", JSON.stringify(data.map));
