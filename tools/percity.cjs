// Upcoming events per city from data/events.json (upcoming = end date, or start, on or after today). Prints JSON {total, upcoming, cities:{"City, ST":n}}.
const fs = require("fs");
const today = process.argv[3] || new Date().toISOString().slice(0, 10);
const l = JSON.parse(fs.readFileSync(process.argv[2] || "data/events.json", "utf8")).events;
const up = l.filter((e) => String(e.end || e.start).slice(0, 10) >= today);
const cities = {};
for (const e of up) { const k = `${e.city}, ${e.state}`; cities[k] = (cities[k] || 0) + 1; }
console.log(JSON.stringify({ total: l.length, upcoming: up.length, today, cities }, null, 0));
