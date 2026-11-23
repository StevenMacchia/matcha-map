// docs/YELP-TERMS.md in force: Yelp answers are leads only, nothing from Yelp is stored or shown, npm run yelp refuses to run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as yelpEvents from "../ingest/lib/sites/yelp-events.js";
import { confirmCandidate, parseYelp } from "../ingest/lib/shops/providers.js";
import { rowKey } from "../ingest/shops-keyed.js";

const YELP_KEYS = new Set(["provider_id", "yelp_id", "yelp_url", "rating", "review_count", "yelp"]);
const YELP_TEXT = /yelp\.com|api\.yelp|yelp fusion/i;

// Every object in a JSON tree, with its path.
function* walk(v, p = "$") {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) yield* walk(v[i], `${p}[${i}]`); return; }
  if (v && typeof v === "object") { yield [p, v]; for (const [k, x] of Object.entries(v)) yield* walk(x, `${p}.${k}`); }
}

function yelpTraces(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (const [p, o] of walk(j)) {
    if (o.provider === "yelp") out.push(`${p}.provider`);
    if (p !== "$" && typeof o.attribution === "string" && /yelp/i.test(o.attribution)) out.push(`${p}.attribution`);
    for (const [k, v] of Object.entries(o)) {
      if (YELP_KEYS.has(k)) out.push(`${p}.${k}`);
      if (typeof v === "string" && YELP_TEXT.test(v)) out.push(`${p}.${k}=${v.slice(0, 60)}`);
    }
  }
  return out;
}

const published = () => [
  "data/shops.json", "data/events.json",
  ...fs.readdirSync("data").filter((f) => /^shops-.+\.json$/.test(f)).map((f) => `data/${f}`),
  ...fs.readdirSync("site/data").filter((f) => f.endsWith(".json")).map((f) => `site/data/${f}`),
].filter((f) => fs.existsSync(f));

test("npm run yelp refuses to run with one line that points at docs/YELP-TERMS.md and writes nothing", () => {
  const places = "site/data/places.json";
  const before = fs.existsSync(places) ? fs.readFileSync(places, "utf8") : null;
  const r = spawnSync(process.execPath, ["ingest/yelp.js"], { encoding: "utf8", env: { ...process.env, YELP_API_KEY: "k" } });
  assert.notEqual(r.status, 0, "exit code");
  const lines = (r.stdout + r.stderr).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, lines.join(" | "));
  assert.match(lines[0], /docs\/YELP-TERMS\.md/);
  assert.equal(fs.existsSync(places) ? fs.readFileSync(places, "utf8") : null, before, "places.json untouched");
  assert.ok(!fs.existsSync("ingest/lib/enrich/yelp.js"), "the enrichment module is gone");
  assert.ok(!/yelp/i.test(fs.readFileSync("ingest/watch.js", "utf8")), "watch has no Yelp step");
});

test("no Yelp field, business id, attribution line or yelp.com URL in the published data; places.json is empty", () => {
  for (const f of published()) assert.deepEqual(yelpTraces(f), [], f);
  const places = JSON.parse(fs.readFileSync("site/data/places.json", "utf8"));
  assert.deepEqual(places.places, []);
});

test("the Yelp events adapter is off with or without a key", async () => {
  for (const env of [{}, { YELP_API_KEY: "k" }]) {
    let calls = 0;
    const r = await yelpEvents.discover({ fetcher: { get: async () => { calls++; return { ok: true, text: "{}" }; } }, env, now: new Date() });
    assert.match(r.stats.skipped, /YELP-TERMS/);
    assert.equal(calls, 0);
  }
});

test("a confirmed Yelp lead becomes a row with nothing from Yelp on it, keyed by name and street number", async () => {
  const yelp = parseYelp({ businesses: [{ id: "abc123", name: "Leaf Matcha", location: { address1: "12 Main St", city: "Raleigh", state: "NC", zip_code: "27601" }, coordinates: { latitude: 35.78, longitude: -78.64 }, categories: [{ alias: "tea", title: "Tea Rooms" }], is_closed: false, url: "https://www.yelp.com/biz/leaf" }] });
  assert.equal(yelp.length, 1);
  const addr = '<script type="application/ld+json">{"@type":"CafeOrCoffeeShop","address":{"streetAddress":"12 Main St","addressLocality":"Raleigh","addressRegion":"NC","postalCode":"27601"}}</script>';
  const html = (body) => ({ ok: true, text: `<html><head><title>Leaf Matcha</title></head><body>${body}${addr}</body></html>` });
  const get = async (u) => (/menu/.test(u) ? html("<ul><li>Matcha Latte $6</li><li>Iced Matcha $6</li><li>Matcha Lemonade $7</li></ul>") : html("matcha"));
  const r = await confirmCandidate({ ...yelp[0], website: "https://leafmatcha.example", hint: "serves-check" }, get);
  assert.ok(r.row, JSON.stringify(r));
  for (const k of ["provider", "provider_id", "attribution"]) assert.equal(r.row[k], undefined, k);
  const traces = [];
  for (const [k, v] of Object.entries(r.row)) if (YELP_KEYS.has(k) || (typeof v === "string" && YELP_TEXT.test(v))) traces.push(k);
  assert.deepEqual(traces, []);
  assert.equal(rowKey(r.row), "leaf matcha|12");
});

test("the scheduled refresh runs the Yelp lead search after the ingest, nothing else from Yelp", () => {
  const src = fs.readFileSync(path.join("ingest", "loop.js"), "utf8");
  assert.match(src, /\["yelp-leads", \["ingest\/shops-keyed\.js", "--provider", "yelp", "--limit", "250"\]\]/);
  assert.match(src, /yelp-leads-day\.txt/, "once a UTC day");
  assert.match(src, /\["ingest", \["ingest\/run\.js"\]\], YELP_LEADS\]/);
  assert.ok(!/ingest\/yelp\.js/.test(src));
});
