import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pageFacts, priceFromOffers, fillFrom, compareStart, timeFix, expectedTz, isEventPage } from "../ingest/lib/enrich-events.js";
import { offsetMinutes } from "../ingest/lib/tz.js";

const page = (ld, extra = "") => `<html><head>${extra}<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>x</body></html>`;
const EVENT = {
  "@type": "Event", name: "Matcha Pop-Up", startDate: "2026-12-05T11:00:00-06:00", endDate: "2026-12-05T15:00:00-06:00",
  description: "Whisked ceremonial matcha, ube latte and strawberry matcha. Hours: 11am-3pm. Cash and card accepted.",
  image: "https://img.example/poster.jpg", offers: { "@type": "Offer", price: "12.00", priceCurrency: "USD" },
};
const base = { id: "e1", brand: "B", start: "2026-12-05T11:00:00-06:00", end: null, tz: "America/Chicago", all_day: false, menu: [], price: null, hours: null, pay: null, description: null, image: null, image_url: null };

test("price from offers: free, one price, a range, other currencies ignored", () => {
  assert.equal(priceFromOffers({ price: 0, priceCurrency: "USD" }), "Free");
  assert.equal(priceFromOffers({ price: "12.00", priceCurrency: "USD" }), "$12");
  assert.equal(priceFromOffers([{ lowPrice: 10, highPrice: 25, priceCurrency: "USD" }]), "$10 to $25");
  assert.equal(priceFromOffers({ price: 7.5 }), "$7.50");
  assert.equal(priceFromOffers({ price: 9, priceCurrency: "EUR" }), null);
  assert.equal(priceFromOffers(undefined), null);
});

test("pageFacts reads the Event block; a page without one yields null; only event-page hosts are read", () => {
  const f = pageFacts(page(EVENT));
  assert.equal(f.price, "$12");
  assert.equal(f.image_url, "https://img.example/poster.jpg");
  assert.equal(f.startDate, EVENT.startDate);
  assert.equal(pageFacts(page({ "@type": "Organization", name: "x" })), null);
  assert.ok(isEventPage("https://www.eventbrite.com/e/abc-123") && isEventPage("https://ma.to/event/x") && isEventPage("https://allevents.in/city/x/1"));
  assert.ok(!isEventPage("https://www.instagram.com/p/abc/") && !isEventPage("https://letitsimmernewsletter.substack.com/p/x") && !isEventPage("https://www.kqed.org/arts/1"));
});

test("fillFrom fills only empty fields, from words the page prints", () => {
  const { patch, filled } = fillFrom(base, pageFacts(page(EVENT)), "https://www.eventbrite.com/e/abc");
  assert.equal(patch.price, "$12");
  assert.ok(patch.menu.includes("ube latte") || patch.menu.length > 0);
  assert.ok(patch.description && patch.description.length > 20);
  assert.equal(patch.image.url, "https://img.example/poster.jpg");
  assert.equal(patch.image.credit, "eventbrite.com");
  assert.ok(filled.includes("price") && filled.includes("image"));
  const keep = fillFrom({ ...base, price: "$5", description: "Own words that stay", menu: ["latte"], image_url: "https://x/y.jpg", hours: "9-1" }, pageFacts(page(EVENT)), "https://www.eventbrite.com/e/abc");
  assert.deepEqual(Object.keys(keep.patch).filter((k) => ["price", "description", "menu", "image", "image_url", "hours"].includes(k)), []);
  assert.deepEqual(fillFrom(base, null, "u").patch, {});
});

test("compareStart: same instant, same wall clock in a labelled zone, or different", () => {
  assert.equal(compareStart(base, { startDate: "2026-12-05T11:00:00-06:00" }), "same");
  assert.equal(compareStart(base, { startDate: "2026-12-05T11:00:00+00:00" }), "tz");
  assert.equal(compareStart(base, { startDate: "2026-12-06T11:00:00-06:00" }), "differs");
  assert.equal(compareStart(base, { startDate: null }), null);
});

test("timeFix: an all-day stored start gets the page's time in the event's zone; Allevents' +00:00 label is ignored; other days and midnight pages are left", () => {
  const allDay = { ...base, start: "2026-12-05T00:00:00-06:00", all_day: true };
  const fix = timeFix(allDay, { startDate: "2026-12-05T18:30:00-06:00", endDate: "2026-12-05T21:00:00-06:00" });
  assert.deepEqual(fix, { start: "2026-12-05T18:30:00-06:00", end: "2026-12-05T21:00:00-06:00", all_day: false });
  assert.equal(timeFix(allDay, { startDate: "2026-12-05T18:30:00+00:00", endDate: null }).start, "2026-12-05T18:30:00-06:00");
  assert.equal(timeFix(allDay, { startDate: "2026-12-12T18:30:00-06:00" }), null);
  assert.equal(timeFix(allDay, { startDate: "2026-12-05T00:00:00-06:00" }), null);
  assert.equal(timeFix(base, { startDate: "2026-12-05T18:30:00-06:00" }), null, "a timed event is not changed");
  const { patch } = fillFrom(allDay, { startDate: "2026-12-05T18:30:00-06:00", endDate: null, description: null }, "u");
  assert.equal(patch.all_day, false);
  assert.equal(patch.start, "2026-12-05T18:30:00-06:00");
});

test("time zones: a Honolulu, an El Paso and a Boise event are each in their own zone", () => {
  assert.equal(expectedTz({ state: "HI", city: "Honolulu", lat: 21.3, lng: -157.85 }), "Pacific/Honolulu");
  assert.equal(expectedTz({ state: "TX", city: "El Paso", lat: 31.76, lng: -106.49 }), "America/Denver");
  assert.equal(expectedTz({ state: "ID", city: "Boise", lat: 43.6, lng: -116.2 }), "America/Boise");
  assert.equal(expectedTz({ state: "AZ", city: "Phoenix", lat: 33.45, lng: -112.07 }), "America/Phoenix");
});

test("data: every event's zone matches its place, its start carries that zone's offset, and all-day means local midnight with no end", () => {
  const events = JSON.parse(fs.readFileSync("data/events.json", "utf8")).events;
  const zone = [], offset = [], allday = [];
  for (const e of events) {
    const x = expectedTz(e);
    if (x && e.tz !== x) zone.push(`${e.id} ${e.city},${e.state} ${e.tz} != ${x}`);
    const m = /([+-])(\d{2}):?(\d{2})$/.exec(e.start);
    if (m && (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) !== offsetMinutes(e.tz, Date.parse(e.start))) offset.push(`${e.id} ${e.start} ${e.tz}`);
    if (e.all_day && (!/T00:00:00/.test(e.start) || e.end)) allday.push(`${e.id} ${e.start} ${e.end}`);
    if (!e.all_day && /T00:00:00/.test(e.start)) allday.push(`${e.id} timed at local midnight`);
  }
  assert.deepEqual(zone.slice(0, 5), []);
  assert.deepEqual(offset.slice(0, 5), []);
  assert.deepEqual(allday.slice(0, 5), []);
});
