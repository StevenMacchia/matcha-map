import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mapAccountFacts, recentPosts } from "../ingest/adapters/instagram-graph.js";
import { recordGraph } from "../ingest/lib/watchlist.js";
import { buildBrands, cleanBio, freshPicture, pictureExpiry, META_PICTURE, PICTURE_DAYS } from "../ingest/lib/enrich/brands.js";

// A small JSON Schema checker (enough for data/schema/event.schema.json): type, enum, required,
// additionalProperties, anyOf, pattern, minimum, maximum, maxLength, maxItems, items, $ref.
function check(schema, v, root, at, errs) {
  if (schema.$ref) return check(root.$defs[schema.$ref.split("/").pop()], v, root, at, errs);
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => { const e = []; check(s, v, root, at, e); return !e.length; });
    if (!ok) errs.push(`${at}: matches none of anyOf`);
    return;
  }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${at}: not in enum`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) { errs.push(`${at}: type ${t}, wanted ${types}`); return; }
  }
  if (typeof v === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${at}: pattern`);
    if (schema.maxLength && v.length > schema.maxLength) errs.push(`${at}: too long`);
  }
  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) errs.push(`${at}: below minimum`);
    if (schema.maximum !== undefined && v > schema.maximum) errs.push(`${at}: above maximum`);
  }
  if (Array.isArray(v)) {
    if (schema.maxItems && v.length > schema.maxItems) errs.push(`${at}: too many items`);
    if (schema.items) v.forEach((x, i) => check(schema.items, x, root, `${at}[${i}]`, errs));
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${at}: missing ${k}`);
    for (const [k, x] of Object.entries(v)) {
      if (schema.properties?.[k]) check(schema.properties[k], x, root, `${at}.${k}`, errs);
      else if (schema.additionalProperties === false) errs.push(`${at}: extra key ${k}`);
    }
  }
}


const load = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const media = (n, extra = {}) => ({ id: "m" + n, permalink: `https://www.instagram.com/p/C${n}/`, timestamp: `2026-11-${10 + n}T12:00:00+0000`, caption: "x".repeat(120), media_type: "IMAGE", media_url: `https://scontent.cdninstagram.com/${n}.jpg`, ...extra });

test("recentPosts keeps the newest three with a picture, 80-char captions, urls only", () => {
  const r = recentPosts([media(1), media(2), media(3), media(4), media(5, { media_url: null })]);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((m) => m.permalink), [4, 3, 2].map((n) => `https://www.instagram.com/p/C${n}/`));
  assert.ok(r.every((m) => m.caption.length === 80 && /^https:/.test(m.image_url)));
  assert.deepEqual(Object.keys(r[0]).sort(), ["caption", "image_url", "permalink", "timestamp"]);
});
test("a video post uses its thumbnail", () => {
  const r = recentPosts([media(1, { media_type: "VIDEO", media_url: "https://v.mp4", thumbnail_url: "https://t.jpg" })]);
  assert.equal(r[0].image_url, "https://t.jpg");
});
test("mapAccountFacts carries recent and recordGraph stores at most three on the account", () => {
  const f = mapAccountFacts({ business_discovery: { name: "A", followers_count: 5, media: { data: [1, 2, 3, 4].map((n) => media(n)) } } });
  assert.equal(f.recent.length, 3);
  const acc = recordGraph({ handle: "a" }, f);
  assert.equal(acc.recent.length, 3);
  recordGraph(acc, { name: "A", recent: [] });
  assert.equal(acc.recent.length, 3, "an empty read does not wipe the last good posts");
});
test("cleanBio caps at 160 and removes emails and phone numbers", () => {
  const b = cleanBio("Matcha pop-ups. Email hello@brand.com or call (404) 555-0199 or +1 404 555 0199. " + "z".repeat(200));
  assert.ok(b.length <= 160);
  assert.ok(!/@|555/.test(b));
});
test("buildBrands: one entry per read Instagram account, kind and city from sources, under 400 KB", () => {
  const wl = { accounts: [
    { handle: "OohmamiMatcha", platform: "instagram", source_id: "oohmami", status: "watching", graph_checked_at: "2026-11-22T00:00:00Z", name: "Oohmami Matcha", followers_count: 12400, bio: "Hi hi@x.com", profile_picture_url: "https://p/1.jpg", website: "https://oohmami.com", recent: [{ permalink: "https://www.instagram.com/p/A/", image_url: "https://i/1.jpg", timestamp: "2026-11-20T00:00:00Z", caption: "c" }] },
    { handle: "unread", platform: "instagram", source_id: null, status: "candidate", graph_checked_at: null },
    { handle: "gone", platform: "instagram", status: "dropped", graph_checked_at: "2026-11-22T00:00:00Z", name: "Gone" },
    { handle: "tt", platform: "tiktok", status: "watching", graph_checked_at: "2026-11-22T00:00:00Z", name: "T" },
  ] };
  const d = buildBrands(wl, [{ id: "oohmami", kind: "popup", home_city: "Atlanta", home_state: "GA", instagram: "oohmamimatcha" }], new Date("2026-11-22T00:00:00Z"));
  assert.equal(d.brands.length, 1);
  const b = d.brands[0];
  assert.deepEqual([b.name, b.followers, b.home_city, b.home_state, b.kind, b.bio, b.recent.length], ["Oohmami Matcha", 12400, "Atlanta", "GA", "popup", "Hi", 1]);
  const errs = []; const schema = load("data/schema/brands.schema.json"); check(schema, d, schema, "$", errs);
  assert.deepEqual(errs, []);
});
test("a huge watch list is trimmed to fit 400 KB", () => {
  const accounts = Array.from({ length: 400 }, (_, i) => ({ handle: "h" + i, platform: "instagram", status: "watching", graph_checked_at: "x", name: "N" + i, followers_count: i, bio: "b".repeat(300), profile_picture_url: "https://p/" + "u".repeat(300),
    recent: [0, 1, 2].map((n) => ({ permalink: "https://www.instagram.com/p/" + n, image_url: "https://i/" + "v".repeat(350), timestamp: "t", caption: "c".repeat(90) })) }));
  const d = buildBrands({ accounts }, []);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 400 * 1024);
});
test("recordGraph dates the picture url; a card shows it only while the read is under 7 days old and the url has not expired", () => {
  const t0 = new Date("2026-11-23T12:00:00Z");
  const oe = (d) => Math.floor(Date.parse(d) / 1000).toString(16); // Meta's expiry parameter: epoch seconds in hex
  const url = `https://scontent.cdninstagram.com/v/pp.jpg?stp=x&oe=${oe("2026-11-27T12:00:00Z")}`;
  assert.equal(pictureExpiry(url).toISOString(), "2026-11-27T12:00:00.000Z");
  assert.equal(pictureExpiry("https://brand.example/logo.png"), null);
  const acc = recordGraph({ handle: "a" }, { name: "A", profile_picture_url: url }, t0);
  assert.equal(acc.profile_picture_at, t0.toISOString());
  recordGraph(acc, { name: "A", profile_picture_url: null }, new Date("2026-11-24T12:00:00Z"));
  assert.equal(acc.profile_picture_at, t0.toISOString(), "a read with no picture keeps the old url and its own date");
  assert.deepEqual(freshPicture(acc, new Date("2026-11-26T00:00:00Z")), { picture: url, at: t0.toISOString() });
  assert.deepEqual(freshPicture(acc, new Date("2026-11-27T12:00:01Z")), { picture: null, at: null }, "cleared once the url's oe expiry passes");
  const noOe = { profile_picture_url: "https://scontent.cdninstagram.com/pp.jpg", graph_checked_at: t0.toISOString() };
  assert.equal(freshPicture(noOe, new Date("2026-11-30T11:00:00Z")).picture, noOe.profile_picture_url, "an account read before profile_picture_at existed goes by its read date");
  assert.equal(freshPicture(noOe, new Date("2026-11-30T13:00:00Z")).picture, null, "and is cleared after 7 days");
  assert.equal(freshPicture({ profile_picture_url: "https://x/y.jpg" }).picture, null, "no read date, no picture");
  const d = buildBrands({ accounts: [
    { handle: "fresh", platform: "instagram", status: "watching", graph_checked_at: "2026-11-22T00:00:00Z", profile_picture_at: "2026-11-22T00:00:00Z", name: "F", profile_picture_url: "https://scontent.cdninstagram.com/f.jpg" },
    { handle: "stale", platform: "instagram", status: "watching", graph_checked_at: "2026-11-10T00:00:00Z", name: "S", profile_picture_url: "https://scontent.cdninstagram.com/s.jpg", followers_count: 3 },
  ] }, [], new Date("2026-11-23T00:00:00Z"));
  const by = Object.fromEntries(d.brands.map((b) => [b.handle, b]));
  assert.deepEqual([by.fresh.picture, by.fresh.picture_at], ["https://scontent.cdninstagram.com/f.jpg", "2026-11-22T00:00:00.000Z"]);
  assert.deepEqual([by.stale.picture, "picture_at" in by.stale], [null, false], "a stale read's picture is cleared, the card stays");
  const errs = []; const schema = load("data/schema/brands.schema.json"); check(schema, d, schema, "$", errs);
  assert.deepEqual(errs, []);
});
test("site/data/brands.json: no Meta picture url is older than its Graph read by more than 7 days, none has expired", () => {
  if (!fs.existsSync("site/data/brands.json")) return;
  const d = load("site/data/brands.json"), gen = Date.parse(d.generated);
  const meta = d.brands.filter((b) => META_PICTURE.test(b.picture || ""));
  const old = meta.filter((b) => !b.picture_at || gen - Date.parse(b.picture_at) > PICTURE_DAYS * 86400e3).map((b) => b.handle);
  assert.deepEqual(old, [], "Meta pictures with no read date or a read over 7 days before the file was built");
  const expired = meta.filter((b) => { const e = pictureExpiry(b.picture); return e && e <= gen; }).map((b) => b.handle);
  assert.deepEqual(expired, [], "Meta pictures already expired when the file was built");
});
test("site/data/brands.json and places.json (when present) validate", () => {
  for (const [f, s] of [["site/data/brands.json", "data/schema/brands.schema.json"], ["site/data/places.json", "data/schema/places.schema.json"]]) {
    if (!fs.existsSync(f)) continue;
    const schema = load(s), errs = []; check(schema, load(f), schema, "$", errs);
    assert.deepEqual(errs.slice(0, 5), [], f);
    assert.ok(fs.statSync(f).size < 400 * 1024, f + " under 400 KB");
  }
});
