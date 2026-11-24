import test from "node:test";
import assert from "node:assert/strict";
import { calendarCards, knownOnDay, readMarketPage } from "../ingest/lib/sites/markets.js";

const now = new Date("2026-11-24T15:00:00Z");
// The shape of shopvillagedistrict.com/events/ read 2026-11-24 (cards: EVENT, title, blurb, date line, Learn More).
const lines = [
  "EVENT", "Bailey's Fine Jewelry Pop-Up Bar Launch Party", "Join Bailey's on November 24 for a festive Pop-Up Bar Launch Party! Enjoy drinks.", "Tuesday, November 24th", "Learn More",
  "EVENT", "Saiko Matcha Pop Up", "Enjoy Saiko Matcha Pop Up at Village District! BLACK FRIDAY WEEKEND Nov 27 10AM-2PM MODE @ The Village District Nov 28th 11AM – 3PM Maeve...", "Friday, November 27th", "Learn More",
  "EVENT", "Photos with Santa at Barnes & Noble", "Join us at Barnes & Noble on Saturday, December 12, and Sunday, December 13, from 1–3 PM for.", "Saturday, December 12th", "Learn More",
  "EVENT", "Saiko Matcha Pop-Up", "Enjoy a Saiko Matcha Pop-Up every other weekend from September 12 – November 1 at Village District.", "Saturday, September 12th", "Learn More",
];

test("a host calendar gives a matcha card only its own dates, never the other cards' dates", () => {
  const c = calendarCards(lines, now);
  assert.equal(c.isCalendar, true);
  assert.equal(c.cards.length, 1, "the September card is past and the other cards are not matcha");
  assert.equal(c.cards[0].title, "Saiko Matcha Pop Up");
  const days = c.cards[0].dates.map((d) => `${d.mo}-${d.d}`).sort();
  assert.deepEqual(days, ["11-27", "11-28"]);
  assert.ok(!days.includes("12-12") && !days.includes("11-24"));
});

test("a page without event cards is not a calendar, and its roster logic is untouched", () => {
  assert.equal(calendarCards(["Vendors", "Alma Matcha", "Open Sat 9-1"], now).isCalendar, false);
  const p = readMarketPage("<html><body><p>Vendors</p><p>Alma Matcha Bar</p><p>Open Sat Nov 28 9am-1pm</p></body></html>", "https://m.example/vendors", { city: "Austin", state: "TX" }, now);
  assert.deepEqual(p.cards, []);
  assert.deepEqual(p.vendors, ["Alma Matcha Bar"]);
});

test("days our data already holds for the brand are not given again (accents and suffixes folded)", () => {
  const existing = [{ brand: "Saikō Matcha House", city: "Raleigh", start: "2026-11-27T10:00:00-05:00" }];
  assert.equal(knownOnDay(existing, "Saiko Matcha Pop Up", "Raleigh", "2026-11-27"), true);
  assert.equal(knownOnDay(existing, "Saiko Matcha Pop Up", "Raleigh", "2026-11-28"), false);
  assert.equal(knownOnDay(existing, "Saiko Matcha Pop Up", "Durham", "2026-11-27"), false);
});
