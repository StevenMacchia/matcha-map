import test from "node:test";
import assert from "node:assert/strict";
import { extract, parseAddress, findTime, splitPlace } from "../ingest/lib/extract.js";
import { tzFor, zonedIso, isoLocal } from "../ingest/lib/tz.js";

const source = { brand: "X Matcha", home_city: "Los Angeles", home_state: "CA", instagram: "xmatcha", tiktok: null };
const now = "2026-11-22T20:00:00Z"; // Sunday
const ex = (text, extra = {}) => extract({ source_url: "https://e.com/p", text, ...extra }, { source, now });

test("explicit date, time range, @venue and address", () => {
  const [e] = ex("Sat Nov 28, 11am-3pm at @sunnybooks 123 Main St, Los Angeles, CA 90012");
  assert.equal(e.start, "2026-11-28T11:00:00-08:00");
  assert.equal(e.end, "2026-11-28T15:00:00-08:00");
  assert.equal(e.venue, "@sunnybooks");
  assert.equal(e.address, "123 Main St");
  assert.equal(e.zip, "90012");
  assert.equal(e.confidence, "confirmed");
  assert.equal(e.extracted_by, "rule");
});
test("numeric date and bare time", () => {
  const [e] = ex("11/29 at 4");
  assert.equal(e.start, "2026-11-29T16:00:00-08:00");
});
test("day-month form", () => {
  const [e] = ex("29 Nov 2pm");
  assert.equal(e.start, "2026-11-29T14:00:00-08:00");
});
test("long weekday form is date-only", () => {
  const [e] = ex("Saturday, November 28th");
  assert.equal(e.start, "2026-11-28T00:00:00-08:00");
  assert.equal(e.all_day, true);
});
test("date range makes one event per day", () => {
  const r = ex("Nov 29-30 11:00 AM to 3 PM");
  assert.deepEqual(r.map((x) => x.start.slice(0, 10)), ["2026-11-29", "2026-11-30"]);
  assert.equal(r[1].end, "2026-11-30T15:00:00-08:00");
});
test("list with ampersand keeps just two days", () => {
  const r = ex("Dec 5 & 7 from 10 until sold out");
  assert.deepEqual(r.map((x) => x.start.slice(0, 10)), ["2026-12-05", "2026-12-07"]);
  assert.equal(r[0].start.slice(11, 16), "10:00");
  assert.equal(r[0].end, null);
});
test("multiple dates in one caption", () => {
  const r = ex("Pop-ups: Dec 6 11am-2pm and Dec 13 noon-3pm");
  assert.equal(r.length, 2);
  assert.equal(r[1].start, "2026-12-13T12:00:00-08:00");
});
test("relative words resolve against now", () => {
  assert.equal(ex("tomorrow 10am")[0].start, "2026-11-23T10:00:00-08:00");
  assert.equal(ex("this Saturday 11-3pm")[0].start, "2026-11-28T11:00:00-08:00");
  assert.equal(ex("next Saturday")[0].start.slice(0, 10), "2026-12-05");
  assert.equal(ex("this weekend")[0].start.slice(0, 10), "2026-11-22");
});
test("relative words resolve against published_at when given", () => {
  const [e] = ex("tomorrow 10am", { published_at: "2026-12-01T18:00:00Z" });
  assert.equal(e.start.slice(0, 10), "2026-12-02");
});
test("recurring talk is not an event", () => {
  assert.equal(ex("we are here every Saturday").length, 0);
});
test("year inference: next occurrence, never past", () => {
  assert.equal(ex("Jan 10 11am")[0].start.slice(0, 4), "2027");
  assert.equal(ex("Dec 6 11am")[0].start.slice(0, 4), "2026");
  assert.equal(ex("Nov 22 11am")[0].start.slice(0, 4), "2026"); // today stays this year
});
test("explicit year may be past", () => {
  assert.equal(ex("Nov 29, 2025 11am")[0].start.slice(0, 10), "2025-11-29");
});
test("times", () => {
  assert.deepEqual(findTime("11am-3pm").start, { h: 11, mi: 0 });
  assert.deepEqual(findTime("11-3pm").start, { h: 11, mi: 0 });
  assert.deepEqual(findTime("11-3pm").end, { h: 15, mi: 0 });
  assert.deepEqual(findTime("from 10").start, { h: 10, mi: 0 });
  assert.equal(findTime("noon").start.h, 12);
  assert.equal(findTime("until sold out 10am").untilSoldOut, true);
  assert.equal(findTime("no time here"), null);
});
test("address with suite, city, state, zip", () => {
  const a = parseAddress("Matcha & Creme, 10455 N Central Expy Ste 106, Dallas, TX 75230, USA");
  assert.equal(a.address, "10455 N Central Expy Ste 106");
  assert.equal(a.city, "Dallas");
  assert.equal(a.state, "TX");
  assert.equal(a.zip, "75230");
  assert.equal(parseAddress("no address here"), null);
});
test("place split", () => {
  assert.deepEqual(splitPlace("@citycovestudios, Fredericksburg, VA"), { venue: "@citycovestudios", city: "Fredericksburg", state: "VA" });
});
test("city and timezone come from the address, not the brand home", () => {
  const [e] = ex("Dec 6 11am-2pm 500 Elm St, Dallas, TX 75201");
  assert.equal(e.city, "Dallas");
  assert.equal(e.tz, "America/Chicago");
  assert.equal(e.start, "2026-12-06T11:00:00-06:00");
});
test("no address falls back to home city and unsure", () => {
  const [e] = ex("Dec 6 11am");
  assert.equal(e.city, "Los Angeles");
  assert.equal(e.confidence, "unsure");
});
test("structured date and time with a named venue is likely", () => {
  const [e] = extract({ source_url: "u", text: "Cookie night", hints: { start: "2026-12-14T17:00:00-05:00", venue: "@citycove, Fredericksburg, VA" } }, { source, now });
  assert.equal(e.confidence, "likely");
  assert.equal(e.state, "VA");
  assert.equal(e.tz, "America/New_York");
});
test("website stale guard drops far-ahead year-less dates", () => {
  assert.equal(ex("Feb 1 10am", { maxAheadDays: 60 }).length, 0);
  assert.equal(ex("Dec 12 10am", { maxAheadDays: 60 }).length, 1);
});

test("tz lookup", () => {
  assert.equal(tzFor({ state: "HI" }), "Pacific/Honolulu");
  assert.equal(tzFor({ city: "El Paso", state: "TX" }), "America/Denver");
  assert.equal(tzFor({ city: "Dallas", state: "TX" }), "America/Chicago");
  assert.equal(tzFor({ state: "ZZ" }), null);
  assert.equal(zonedIso("America/New_York", 2026, 7, 4, 12, 0), "2026-07-04T12:00:00-04:00");
  assert.equal(zonedIso("America/New_York", 2026, 12, 4, 12, 0), "2026-12-04T12:00:00-05:00");
  assert.equal(isoLocal("2026-11-22T19:00:00Z", "America/Chicago"), "2026-11-22T13:00:00-06:00");
});

// ---- menu, price, description -------------------------------------------------------------
import { menuFromText, priceFromText, descriptionFromText, postsFrom, richFields } from "../ingest/lib/extract.js";
import { parsePaste } from "../ingest/adapters/manual.js";
import { offerPrice, eventToRaw } from "../ingest/adapters/mato.js";
import { readHeader } from "../ingest/lib/images.js";
import { migrateEvent, clean } from "../ingest/lib/write.js";

test("menu: no menu words returns []", () => {
  assert.deepEqual(menuFromText("Pop-up this Saturday 11am-3pm at Sunny Books, 123 Main St. See you there!"), []);
  assert.deepEqual(menuFromText(""), []);
  assert.deepEqual(menuFromText(null), []);
});
test("menu: a Menu: list, in source order", () => {
  assert.deepEqual(menuFromText("Menu: strawberry matcha, ube latte & hojicha. Come by!"), ["strawberry matcha", "ube latte", "hojicha"]);
});
test("menu: mango matcha latte and mochi are found", () => {
  const m = menuFromText("We are pouring mango matcha latte and serving soft serve with mochi.");
  assert.deepEqual(m, ["mango matcha latte", "soft serve", "mochi"]);
});
test("menu: x and + combos become 'flavor matcha'", () => {
  assert.deepEqual(menuFromText("strawberry x matcha is back"), ["strawberry matcha"]);
  assert.deepEqual(menuFromText("ube + matcha all weekend"), ["ube matcha"]);
  assert.deepEqual(menuFromText("matcha x yuzu"), ["yuzu matcha"]);
});
test("menu: plural and spelling variants map to one name", () => {
  assert.deepEqual(menuFromText("Strawberries, houjicha and Einspänner"), ["strawberry", "hojicha", "einspanner"]);
  assert.deepEqual(menuFromText("cookies + softserve"), ["cookie", "soft serve"]);
});
test("menu: emoji-led list lines count when they name an item; address lines do not", () => {
  const t = "Saturday!\n🍓 strawberry cloud matcha\n🥥 coconut latte\n📍 123 Main St, Los Angeles";
  assert.deepEqual(menuFromText(t), ["strawberry cloud matcha", "coconut latte"]);
});
test("menu: bullet list after a header on its own line", () => {
  assert.deepEqual(menuFromText("On the menu:\n- hojicha latte\n- black sesame soft serve\n- yuzu tonic\n\nDM us!"), ["hojicha latte", "black sesame soft serve", "yuzu tonic"]);
});
test("menu: dedupes and keeps the longer item", () => {
  assert.deepEqual(menuFromText("ube latte, ube latte, latte"), ["ube latte"]);
});
test("menu: lowercase, never title case, capped at 8", () => {
  const m = menuFromText("Menu: Strawberry, Mango, Ube, Coconut, Yuzu, Lavender, Peach, Banana, Pistachio, Honey");
  assert.equal(m.length, 8);
  assert.ok(m.every((x) => x === x.toLowerCase() && x.length <= 40));
  assert.equal(m[0], "strawberry");
});
test("menu: words that need a partner are ignored alone", () => {
  assert.deepEqual(menuFromText("Oat milk, orange and a rose garden"), []);
  assert.deepEqual(menuFromText("oat latte"), ["oat latte"]);
});
test("menu: hashtag-only caption is empty", () => {
  assert.deepEqual(menuFromText("#matcha #popup #nyc"), []);
});
test("menu: prices inside a list are stripped from the item", () => {
  assert.deepEqual(menuFromText("Menu: matcha latte ($7), hojicha ($6)"), ["matcha latte", "hojicha"]);
});
test("price: single, range, from, all drinks", () => {
  assert.equal(priceFromText("drinks are $7"), "$7");
  assert.equal(priceFromText("$6-8 a cup"), "$6–8");
  assert.equal(priceFromText("$6–$9"), "$6–9");
  assert.equal(priceFromText("from $5"), "from $5");
  assert.equal(priceFromText("All drinks $8"), "$8");
  assert.equal(priceFromText("$6.50 each"), "$6.50");
});
test("price: free only when stated, not 'gluten free' or '$5 off'", () => {
  assert.equal(priceFromText("Free entry, all welcome"), "free");
  assert.equal(priceFromText("it's free!"), "free");
  assert.equal(priceFromText("gluten free and dairy free options"), null);
  assert.equal(priceFromText("$5 off your first cup"), null);
  assert.equal(priceFromText("win a $100 gift card"), null);
  assert.equal(priceFromText("no price here"), null);
});
test("description: strips urls, hashtags, mentions and emoji", () => {
  assert.equal(descriptionFromText("🍵✨ Our spring pop-up is back this Saturday!! @sunnybooks https://x.co/a #matcha #popup"), "Our spring pop-up is back this Saturday!!");
});
test("description: first line only", () => {
  assert.equal(descriptionFromText("Matcha and mochi at the market\nsecond line"), "Matcha and mochi at the market");
});
test("description: hashtag-only or too short caption is null", () => {
  assert.equal(descriptionFromText("#matcha #popup #nyc 🍵🍵🍵"), null);
  assert.equal(descriptionFromText("🍵"), null);
  assert.equal(descriptionFromText(""), null);
});
test("description: capped at 200 chars", () => {
  const d = descriptionFromText("A".repeat(10) + " " + "word ".repeat(80));
  assert.ok(d.length <= 200);
  const s = descriptionFromText("First sentence is short. " + "Second sentence is much longer than the cap allows so it should be dropped entirely. ".repeat(4));
  assert.ok(s.startsWith("First sentence is short.") && s.length <= 200 && s.endsWith("."));
});
test("posts: instagram and tiktok post urls are sorted, others go to other", () => {
  assert.deepEqual(postsFrom(["https://www.instagram.com/p/AbC_123/?igsh=x"], "https://www.instagram.com/p/AbC_123/?igsh=x"), { instagram: "https://www.instagram.com/p/AbC_123/", tiktok: null, other: null });
  assert.equal(postsFrom(["https://www.instagram.com/reel/Zz9/"]).instagram, "https://www.instagram.com/reel/Zz9/");
  assert.equal(postsFrom(["https://www.tiktok.com/@brand/video/7312345678901234567"]).tiktok, "https://www.tiktok.com/@brand/video/7312345678901234567");
  assert.deepEqual(postsFrom([], "https://ma.to/event/x"), { instagram: null, tiktok: null, other: "https://ma.to/event/x" });
  assert.equal(postsFrom(["https://www.instagram.com/brand/"], "https://www.instagram.com/brand/").instagram, null);
});
test("richFields: image credit, links from the source, description only from captions", () => {
  const src = { website: "https://b.com", instagram: "brandmatcha", tiktok: null };
  const r = richFields({ source_url: "https://ma.to/event/x", text: "Event. Menu: ube latte. $7", description: "Come sip ube latte.", image_url: "https://img.example/a.webp" }, src);
  assert.deepEqual(r.image, { url: "https://img.example/a.webp", local: null, credit: "@brandmatcha", width: null, height: null });
  assert.deepEqual(r.menu, ["ube latte"]);
  assert.equal(r.price, "$7");
  assert.equal(r.description, "Come sip ube latte.");
  assert.deepEqual(r.links, { website: "https://b.com", instagram: "https://www.instagram.com/brandmatcha/", tiktok: null });
  assert.equal(r.posts.other, "https://ma.to/event/x");
  const bare = richFields({ source_url: "https://b.com/events", text: "Sat Nov 28 11am" }, src);
  assert.equal(bare.image, null);
  assert.equal(bare.description, null);
  assert.deepEqual(bare.menu, []);
  assert.equal(bare.price, null);
});
test("richFields: a pasted Instagram caption fills post, description and menu", () => {
  const raw = parsePaste("https://www.instagram.com/p/XyZ12/\nimage: https://cdn.example/p.jpg\nPop-up Sat 11/28! Pouring strawberry matcha and hojicha, $7. #matcha");
  assert.equal(raw.image_url, "https://cdn.example/p.jpg");
  assert.ok(!raw.text.includes("image:"));
  const r = richFields(raw, { instagram: "b" });
  assert.equal(r.posts.instagram, "https://www.instagram.com/p/XyZ12/");
  assert.deepEqual(r.menu, ["strawberry matcha", "hojicha"]);
  assert.equal(r.price, "$7");
  assert.equal(r.description, "Pop-up Sat 11/28! Pouring strawberry matcha and hojicha, $7.");
});
test("mato: JSON-LD image, offers and description reach the RawItem", () => {
  assert.equal(offerPrice({ "@type": "Offer", price: "12", priceCurrency: "USD" }), "$12");
  assert.equal(offerPrice([{ price: 0 }]), "free");
  assert.equal(offerPrice({ lowPrice: 8, highPrice: 12, priceCurrency: "USD" }), "$8-12");
  assert.equal(offerPrice({ price: 9, priceCurrency: "EUR" }), null);
  assert.equal(offerPrice(undefined), null);
  const raw = eventToRaw({ "@type": "Event", name: "X", description: "D here.", startDate: "2026-12-06T11:00:00.000-08:00", image: "https://i.example/a.webp", offers: { price: 5, priceCurrency: "USD" } }, "https://ma.to/event/x");
  assert.equal(raw.image_url, "https://i.example/a.webp");
  assert.equal(raw.price_hint, "$5");
  assert.equal(raw.description, "D here.");
  assert.equal(eventToRaw({ "@type": "Event", name: "X", startDate: "2026-12-06T11:00:00-08:00" }, "u", "https://v.example/av.webp").image_url, "https://v.example/av.webp");
});
test("images: width and height come from the header bytes", () => {
  const png = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(400, 20);
  assert.deepEqual(readHeader(png), { ext: "png", width: 640, height: 400 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x90, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(readHeader(jpg), { ext: "jpg", width: 640, height: 400 });
  const webp = Buffer.alloc(32); webp.write("RIFF", 0); webp.write("WEBP", 8); webp.write("VP8X", 12); webp.writeUIntLE(1199, 24, 3); webp.writeUIntLE(629, 27, 3);
  assert.deepEqual(readHeader(webp), { ext: "webp", width: 1200, height: 630 });
  assert.equal(readHeader(Buffer.from("GIF89a..........................")), null);
});
test("migration: old events get the new keys; instagram source_url becomes a post", () => {
  const old = { id: "a", source_url: "https://www.instagram.com/p/Q1/", source_id: "b" };
  const m = migrateEvent(old, { website: "https://b.com", instagram: "bm", tiktok: "bt" });
  assert.equal(m.image, null);
  assert.deepEqual(m.menu, []);
  assert.equal(m.price, null);
  assert.equal(m.description, null);
  assert.equal(m.posts.instagram, "https://www.instagram.com/p/Q1/");
  assert.deepEqual(m.links, { website: "https://b.com", instagram: "https://www.instagram.com/bm/", tiktok: "https://www.tiktok.com/@bt" });
  assert.deepEqual(clean({}).posts, { instagram: null, tiktok: null, other: null });
});
test("menu: 'The menu features ...' and 'Drinks by X include ...' lists keep each item whole", () => {
  assert.deepEqual(menuFromText("The menu features four drinks: Oatly Maple Miso, Strawberry Cloud Matcha, and House Matcha. Come by!"), ["oatly maple miso", "strawberry cloud matcha", "house matcha"]);
  assert.deepEqual(menuFromText("Drinks by Matte Bar include apple crisp matcha, banana bread matcha. Pastries sell out."), ["apple crisp matcha", "banana bread matcha", "pastry"]);
});
test("menu: a brand name like 'Coffee House' is not a menu item", () => {
  assert.deepEqual(menuFromText("After School Coffee House at the market"), []);
});
test("price: a donation per cup is not the price", () => {
  assert.equal(priceFromText("$2 from every beverage sold is donated"), null);
});
