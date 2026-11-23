import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseYelp, parseFoursquare, tierHint, matchaDrinks, confirmCandidate, createProviders } from "../ingest/lib/shops/providers.js";
import { checkRow } from "../ingest/lib/shops/curated.js";
import { run } from "../ingest/shops-keyed.js";

const YELP = { businesses: [
  { id: "y1", name: "Heirloom Brewshop", is_closed: false, location: { address1: "219 S West St", city: "Raleigh", state: "NC", zip_code: "27603" }, coordinates: { latitude: 35.77, longitude: -78.64 }, phone: "+19195947029", categories: [{ alias: "coffee", title: "Coffee & Tea" }] },
  { id: "y2", name: "Matcha Panda", is_closed: false, location: { address1: "202 N 9th St", city: "Philadelphia", state: "PA", zip_code: "19107" }, coordinates: { latitude: 39.95, longitude: -75.15 }, categories: [{ alias: "tea", title: "Tea Rooms" }] },
  { id: "y3", name: "Dive Bar", is_closed: false, location: { address1: "1 Main St", city: "Raleigh", state: "NC" }, categories: [{ alias: "bars", title: "Bars" }] },
  { id: "y4", name: "Gone Matcha", is_closed: true, location: {}, categories: [] },
] };
const FSQ = { results: [
  { fsq_place_id: "f1", name: "Tea Hill", location: { address: "318 W Franklin St", locality: "Chapel Hill", region: "NC", postcode: "27516" }, latitude: 35.91, longitude: -79.06, categories: [{ name: "Tea Room" }], website: "https://teahill.example", tel: "+19195550101", social_media: { instagram: "teahillnc" } },
  { fsq_place_id: "f2", name: "Closed Cafe", date_closed: "2026-01-01", categories: [{ name: "Cafe" }] },
] };

const page = (body, ld = "") => `<html><head><title>x</title>${ld}</head><body>${body}</body></html>`;
const siteGet = (map) => async (u) => (map[new URL(u).pathname] ? { ok: true, text: map[new URL(u).pathname] } : { ok: false, status: 404, text: "" });

test("provider answers parse to candidates; closed and non-shops are dropped by the tier test", () => {
  const y = parseYelp(YELP);
  assert.deepEqual(y.map((c) => c.name), ["Heirloom Brewshop", "Matcha Panda", "Dive Bar"]);
  assert.equal(tierHint(y[0]), "serves-check");
  assert.equal(tierHint(y[1]), "core");
  assert.equal(tierHint(y[2]), null);
  const f = parseFoursquare(FSQ);
  assert.equal(f.length, 1);
  assert.equal(f[0].website, "https://teahill.example");
  assert.equal(f[0].instagram, "teahillnc");
  assert.equal(tierHint({ name: "Cha Cha Matcha NoMad", categories: [] }), "core");
});

test("matchaDrinks keeps menu names, drops sentences, and de-duplicates", () => {
  const html = page("<ul><li>Matcha Latte $7</li><li>Matcha Tonic $7</li><li>Matcha Lemonade - $7.50</li><li>Matcha latte $7</li></ul><p>We source our matcha from Uji. Come visit us today.</p>");
  const d = matchaDrinks(html);
  assert.deepEqual(d.map((x) => x.name), ["Matcha Latte", "Matcha Tonic", "Matcha Lemonade"]);
  assert.equal(d[2].price, "$7.50");
});

test("confirmCandidate: a serves row needs the site's own address and three matcha drinks; a core chain needs matcha on its site", async () => {
  const addr = '<script type="application/ld+json">{"@type":"CafeOrCoffeeShop","address":{"streetAddress":"318 W Franklin St","addressLocality":"Chapel Hill","addressRegion":"NC","postalCode":"27516"},"telephone":"919-555-0101","openingHours":["Mo-Su 08:00-18:00"]}</script>';
  const menu = page("<ul><li>Matcha Latte $6</li><li>Iced Matcha $6</li><li>Matcha Lemonade $7</li></ul>", addr);
  const f = parseFoursquare(FSQ)[0];
  const ok = await confirmCandidate({ ...f, hint: "serves-check" }, siteGet({ "/": page("hello", addr), "/menu": menu }));
  assert.equal(ok.row.tier, "serves");
  assert.equal(ok.row.confirmed_via, "own-site");
  assert.equal(ok.row.menu_matcha.length, 3);
  assert.equal(ok.row.provider_id, "f1");
  assert.match(ok.row.attribution, /Foursquare/);
  assert.equal(ok.row.opening_hours, "Mo-Su 08:00-18:00");
  assert.equal(checkRow({ ...ok.row }).shop.tier, "serves", "the researched-row loader accepts it");
  // a different street number on the site: held
  const wrong = await confirmCandidate({ ...f }, siteGet({ "/": page("hi", addr.replace("318", "999").replace("27516", "27599")) }));
  assert.match(wrong.held, /no matching street address/);
  // no website from the provider (Yelp): held for a worker
  assert.match((await confirmCandidate(parseYelp(YELP)[1], siteGet({}))).held, /no website/);
  // a coffee shop whose menu has two matcha drinks: held
  const two = await confirmCandidate({ ...f }, siteGet({ "/": page("hi", addr), "/menu": page("<li>Matcha Latte $6</li><li>Iced Matcha $6</li>", addr) }));
  assert.match(two.held, /fewer than three/);
});

test("providers: no key means no calls; a key searches once and a second ask is served from the 24 hour cache; 429 stops the provider", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyed-"));
  const cachePath = path.join(dir, "k.json");
  let calls = 0, status = 200;
  const http = async (url, opts) => { calls++; assert.match(opts.headers.Authorization, /^Bearer k/); return { ok: status === 200, status, json: async () => (/yelp/.test(url) ? YELP : FSQ) }; };
  const off = createProviders({ env: {}, http, cachePath, gapMs: 0 });
  assert.equal((await off.search("yelp", "Raleigh", "NC")).skipped, "no key");
  assert.equal(calls, 0);
  const on = createProviders({ env: { YELP_API_KEY: "k1", FOURSQUARE_API_KEY: "k2" }, http, cachePath, gapMs: 0 });
  const a = await on.search("yelp", "Raleigh", "NC");
  assert.deepEqual(a.candidates.map((c) => c.name), ["Heirloom Brewshop", "Matcha Panda"]);
  await on.search("yelp", "Raleigh", "NC");
  assert.equal(calls, 1);
  status = 429;
  assert.equal((await on.search("foursquare", "Raleigh", "NC")).skipped, "HTTP 429");
  assert.equal((await on.search("foursquare", "Durham", "NC")).skipped, "stopped");
});

test("the keyed run writes only confirmed rows, keeps provider ids, and does nothing without keys", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyed-run-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const none = await run({ argv: ["--cities", "Raleigh NC", "--dry"], env: {}, http: async () => { throw new Error("no calls expected"); }, fetcher: { get: async () => ({ ok: false }) }, out: (p) => path.join(dir, `k-${p}.json`) });
    assert.equal(none.yelp.off, true);
    const addr = '<script type="application/ld+json">{"@type":"CafeOrCoffeeShop","address":{"streetAddress":"318 W Franklin St","addressLocality":"Chapel Hill","addressRegion":"NC","postalCode":"27516"}}</script>';
    const get = siteGet({ "/": page("hi", addr), "/menu": page("<li>Matcha Latte $6</li><li>Iced Matcha $6</li><li>Matcha Lemonade $7</li>", addr) });
    const s = await run({ argv: ["--provider", "foursquare", "--cities", "Raleigh NC"], env: { FOURSQUARE_API_KEY: "k" }, http: async () => ({ ok: true, status: 200, json: async () => FSQ }), fetcher: { get }, out: (p) => path.join(dir, `k-${p}.json`) });
    assert.equal(s.foursquare.serves, 1);
    const file = JSON.parse(fs.readFileSync(path.join(dir, "k-foursquare.json"), "utf8"));
    assert.equal(file.shops.length, 1);
    assert.equal(file.shops[0].provider_id, "f1");
    assert.equal(file.shops[0].rating, undefined);
  } finally { process.chdir(cwd); }
});
