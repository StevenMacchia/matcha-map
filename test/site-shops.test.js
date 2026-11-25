// The site's storefront files (perf lane, 2026-11-25): a slim first-paint list, one details file per state, and the photo
// addresses, all built from data/shops.json by ingest/lib/site-shops.js. See docs/PERFORMANCE.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { SLIM, DETAIL, slimRow, detailRow, shardName, isSiteRow, readSiteShops } from "../ingest/lib/site-shops.js";

const slimDoc = () => JSON.parse(fs.readFileSync("site/data/shops.json", "utf8"));

test("slim row keeps only what a pin, a group and a list row read; detail row keeps what the card reads", () => {
  const s = { id: "a:1", name: "Cup", lat: 35.123456789, lng: -78.9876543, city: "Cary", state: "NC", tier: "serves", opening_hours: "Mo-Su 08:00-17:00",
    address: "1 Main St", website: "https://x.example/", phone: "+19195550100", menu_matcha: [{ name: "Matcha", price: null }], overture_sources: [{ a: 1 }], fetched: "2026-11-25", image_url: "https://x.example/a.jpg", note: null };
  const r = slimRow(s);
  assert.deepEqual(Object.keys(r), ["id", "name", "lat", "lng", "city", "state", "tier", "opening_hours"]);
  assert.equal(r.lat, 35.12346);
  const d = detailRow(s);
  assert.deepEqual(Object.keys(d).sort(), ["address", "image_url", "menu_matcha", "website"]);
  assert.ok(!("phone" in d) && !("overture_sources" in d) && !("fetched" in d), "fields the site never reads stay in data/shops.json");
  assert.equal(shardName("NC"), "NC");
  assert.equal(shardName(null), "_");
  assert.equal(shardName("north carolina"), "_");
});

test("site layer rule: verified or public-page or overture, not closed, serves unless SHOPS_SERVES=0", () => {
  assert.ok(isSiteRow({ verified: true }, {}));
  assert.ok(isSiteRow({ confirmed_via: "overture" }, {}));
  assert.ok(!isSiteRow({ verified: true, status: "closed" }, {}));
  assert.ok(!isSiteRow({ verified: false }, {}));
  assert.ok(!isSiteRow({ verified: true, tier: "serves" }, { SHOPS_SERVES: "0" }));
});

test("committed files: slim list is current, small, and the details and photos cover every row", () => {
  const full = readSiteShops(".").shops, slim = slimDoc().shops;
  assert.equal(slim.length, full.length, "the slim list is the site layer, rebuilt with npm run shops (or node ingest/lib/site-shops.js)");
  const raw = fs.readFileSync("site/data/shops.json");
  const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  assert.ok(br < 200 * 1024, `the first-paint list is ${br} bytes compressed, over the 200 KB budget`);
  const shards = {}, photos = JSON.parse(fs.readFileSync("site/data/shops-photos.json", "utf8")).photos;
  full.forEach((s, i) => {
    assert.equal(slim[i].id, s.id);
    for (const k of Object.keys(slim[i])) assert.ok(SLIM.includes(k), `slim row carries ${k}`);
    const k = shardName(s.state);
    shards[k] ??= JSON.parse(fs.readFileSync(`site/data/shops/${k}.json`, "utf8")).shops;
    const want = detailRow(s);
    if (Object.keys(want).length) assert.deepEqual(shards[k][s.id], want, `${s.id} details`);
    if (s.image_url) assert.equal(photos[s.id], s.image_url);
  });
  for (const f of fs.readdirSync("site/data/shops")) assert.ok(shards[f.slice(0, -5)], `${f} has rows`);
  assert.ok(DETAIL.includes("address") && DETAIL.includes("menu_matcha"));
});

test("app.js reads the slim list, fetches a shop's details before its card, and the photo list after the first touch", () => {
  const app = fs.readFileSync("site/app.js", "utf8");
  assert.match(app, /fetch\("data\/shops\.json"\)/);
  assert.match(app, /SHARD_DIR = "data\/shops\/"/);
  assert.match(app, /fetch\(SHARD_DIR \+ k \+ "\.json"\)/);
  assert.match(app, /it\.kind === "s" && !it\.data\._d/);
  assert.match(app, /fetch\("data\/shops-photos\.json"\)/);
  assert.match(app, /MatchaPics\.whenOpen\(loadShopPhotos\)/);
});
