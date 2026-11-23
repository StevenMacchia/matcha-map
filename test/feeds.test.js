// Calendar and RSS feeds, and the per-event share pages.
import test from "node:test";
import assert from "node:assert/strict";
import { icsEscape, fold, utcStamp, dateValue, veventLines, calendar, rss, buildFeeds } from "../tools/gen-feeds.js";
import { buildEventPages, eventPage, ogImage } from "../tools/gen-event-pages.js";

const NOW = new Date("2026-11-25T15:00:00Z");
const cities = [{ name: "Austin", state: "TX", slug: "austin", lat: 30.27, lng: -97.74, pop: 900000 }, { name: "Raleigh", state: "NC", slug: "raleigh", lat: 35.8, lng: -78.6, pop: 500000 }];
const base = { brand: "Moonbee", source_id: "moonbee", handle: "moonbeematcha", title: "Moonbee pop-up", tz: "America/Chicago", all_day: false, venue: "Books & Co", address: "1 Main St", city: "Austin", state: "TX", lat: 30.27, lng: -97.74, approx: false, geocode_source: "nominatim", confidence: "likely", status: "upcoming", menu: ["hojicha latte"], price: "$6-9", last_seen: "2026-11-25T10:00:00Z", first_seen: "2026-11-24T10:00:00Z", image: null, posts: {}, links: {} };
const timed = { ...base, id: "aaaaaa000001", start: "2026-12-05T11:00:00-06:00", end: "2026-12-05T15:00:00-06:00" };
const allDay = { ...base, id: "aaaaaa000002", start: "2026-12-06T00:00:00-06:00", end: null, all_day: true, title: "Tea, cake; and \\ more\nline two" };
const oldOne = { ...base, id: "aaaaaa000003", start: "2026-12-07T10:00:00-05:00", end: null, city: "Raleigh", state: "NC", tz: "America/New_York", first_seen: "2026-10-01T10:00:00Z", image: { url: "https://cdn.example/x.jpg", local: null } };
const past = { ...base, id: "aaaaaa000004", start: "2026-11-01T10:00:00-05:00", end: "2026-11-01T12:00:00-05:00", status: "past" };

test("UTC conversion uses the offset in the ISO string", () => {
  assert.equal(utcStamp("2026-12-05T11:00:00-06:00"), "20261205T170000Z");
  assert.equal(utcStamp("2026-07-01T09:30:00-04:00"), "20260701T133000Z");
  assert.equal(utcStamp("nope"), null);
});

test("timed event: DTSTART/DTEND in UTC, UID is the event id, LAST-MODIFIED from last_seen", () => {
  const l = veventLines(timed).join("\n");
  assert.match(l, /^UID:aaaaaa000001@matchamap-cu7.pages.dev$/m);
  assert.match(l, /^DTSTART:20261205T170000Z$/m);
  assert.match(l, /^DTEND:20261205T210000Z$/m);
  assert.match(l, /^LAST-MODIFIED:20261125T100000Z$/m);
  assert.match(l, /^GEO:30\.270000;-97\.740000$/m);
  assert.doesNotMatch(l, /TZID|VTIMEZONE/);
});

test("timed start with a date-only or earlier end: DTEND is start plus 2 hours, never before DTSTART", () => {
  for (const end of ["2026-12-05", "2026-12-05T08:00:00-06:00"]) {
    const l = veventLines({ ...timed, end }).join("\n");
    assert.match(l, /^DTSTART:20261205T170000Z$/m);
    assert.match(l, /^DTEND:20261205T190000Z$/m);
  }
});

test("all-day event: DATE values with an exclusive end", () => {
  const l = veventLines(allDay).join("\n");
  assert.match(l, /^DTSTART;VALUE=DATE:20261206$/m);
  assert.match(l, /^DTEND;VALUE=DATE:20261207$/m);
  assert.equal(dateValue("2026-12-31T00:00:00-05:00", 1), "20270101");
});

test("text is escaped and long lines fold at 75 octets", () => {
  assert.equal(icsEscape("a, b; c \\ d\ne"), "a\\, b\\; c \\\\ d\\ne");
  const l = veventLines(allDay).join("\n");
  assert.match(l, /^SUMMARY:Tea\\, cake\\; and \\\\ more\\nline two$/m);
  const folded = fold("DESCRIPTION:" + "é".repeat(80));
  for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(folded.replace(/\r\n /g, ""), "DESCRIPTION:" + "é".repeat(80));
});

test("calendar wraps events with CRLF and a VCALENDAR header", () => {
  const c = calendar("Test", [timed, allDay]);
  assert.ok(c.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0"));
  assert.ok(c.endsWith("END:VCALENDAR\r\n"));
  assert.equal((c.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.doesNotMatch(c.replace(/\r\n/g, ""), /[^\r]\n/);
});

test("approximate places keep the street out of LOCATION and GEO", () => {
  const l = veventLines({ ...timed, approx: true, address: "" }).join("\n");
  assert.match(l, /^LOCATION:Austin\\, TX$/m);
  assert.doesNotMatch(l, /^GEO:/m);
});

test("buildFeeds: all, city, per-event files, upcoming only, index.json", () => {
  const { files, counts } = buildFeeds({ events: [timed, allDay, oldOne, past], cities, now: NOW, generated: "2026-11-25T14:00:00Z" });
  assert.equal(counts.events, 3);
  assert.ok(files.has("all.ics") && files.has("new.xml") && files.has("index.json"));
  assert.ok(files.has("austin-tx.ics") && files.has("raleigh-nc.ics"));
  assert.ok(files.has("events/aaaaaa000001.ics") && !files.has("events/aaaaaa000004.ics"));
  assert.equal((files.get("austin-tx.ics").match(/BEGIN:VEVENT/g) || []).length, 2);
  const ix = JSON.parse(files.get("index.json"));
  assert.equal(ix.cities["austin-tx"], "/feeds/austin-tx.ics");
  assert.equal(ix.all, "/feeds/all.ics");
});

test("RSS 2.0: well formed, newest first, only the last 14 days, image enclosure", () => {
  const withImg = { ...timed, first_seen: "2026-11-25T12:00:00Z", image: { url: "https://cdn.example/pic.jpg?x=1&y=2", local: null } };
  const xml = rss([timed, withImg, oldOne, { ...allDay, title: "x" }].map((e, i) => ({ ...e, id: e.id + (i === 0 ? "" : "") })), { now: NOW });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.equal((xml.match(/<item>/g) || []).length, (xml.match(/<\/item>/g) || []).length);
  assert.equal((xml.match(/<channel>/g) || []).length, 1);
  assert.doesNotMatch(xml, /aaaaaa000003/); // first seen in October: out
  const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.equal(guids[0], withImg.id); // newest first (same id as timed here, so both rows share it)
  assert.match(xml, /<enclosure url="https:\/\/cdn\.example\/pic\.jpg\?x=1&amp;y=2" length="0" type="image\/jpeg"\/>/);
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;)/);
  assert.match(xml, /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} 2026 \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
});

test("event page: own title, canonical, og:image order, Event JSON-LD, the full card and a link to the map", () => {
  const html = eventPage(timed, { hasArt: () => false });
  assert.match(html, /<title>Moonbee matcha pop-up, [A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]+, Austin [|] Matcha Map</);
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+\/e\/aaaaaa000001\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og\.png">/);
  // The page carries the full card (site/cards.js), so it no longer bounces to the map; a button goes there.
  assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.match(html, /<a class="pg-map" href="\/\?event=aaaaaa000001"/);
  assert.match(html, /<article class="mm-card mm-page[^]*href="\/feeds\/events\/aaaaaa000001\.ics"/);
  assert.match(html, /<link rel="stylesheet" href="\/cards\.css">/);
  assert.match(html, /<script type="module" src="\/cards-page\.js"><\/script>/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(ld["@type"], "Event");
  assert.equal(ld.startDate, "2026-12-05T11:00:00-06:00");
  assert.ok(Buffer.byteLength(html) < 20000);
  assert.equal(ogImage(oldOne), "https://cdn.example/x.jpg");
  assert.match(ogImage(timed, { hasArt: () => true }), /\/art\/events\/aaaaaa000001\.svg$/);
  assert.match(ogImage({ ...timed, image: { local: "img/events/z.jpg" } }, { hasArt: () => true }), /\/img\/events\/z\.jpg$/);
});

test("buildEventPages: one page per upcoming event, none for past", () => {
  const out = buildEventPages({ events: [timed, allDay, past], sources: [], now: NOW });
  assert.deepEqual([...out.files.keys()].sort(), ["e/aaaaaa000001/index.html", "e/aaaaaa000002/index.html"]);
});

test("feeds: UID has a domain, RSS title reads like prose and is capped, calendars drop past events", () => {
  assert.match(veventLines(timed).join("\n"), /^UID:aaaaaa000001@matchamap-cu7\.pages\.dev$/m);
  const xml = rss([timed], { now: NOW });
  assert.match(xml, /<title>Moonbee, Sat Dec 5, Austin<\/title>/);
  const many = Array.from({ length: 130 }, (_, i) => ({ ...timed, id: "m" + String(i).padStart(11, "0"), first_seen: new Date(Date.parse("2026-11-20T00:00:00Z") + i * 6e4).toISOString() }));
  const x2 = rss(many, { now: NOW });
  assert.equal((x2.match(/<item>/g) || []).length, 100);
  assert.ok(x2.indexOf("m00000000129") < x2.indexOf("m00000000100"), "newest first");
  const ended = { ...timed, id: "aaaaaa000009", start: "2026-11-24T10:00:00-06:00", end: "2026-11-24T12:00:00-06:00" };
  const { files } = buildFeeds({ events: [timed, ended], cities, now: NOW, generated: "2026-11-25T14:00:00Z" });
  assert.doesNotMatch(files.get("all.ics"), /aaaaaa000009/);
  assert.match(files.get("all.ics"), /aaaaaa000001/);
});
