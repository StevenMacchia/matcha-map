import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as m from "../ingest/lib/mato-city.js";
import * as wl from "../ingest/lib/watchlist.js";
import { processItems, dropSuperseded } from "../ingest/lib/pipeline.js";
import { mergeEvents } from "../ingest/lib/write.js";

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const now = new Date("2026-11-22T12:00:00Z");
const D = "2026-11-22T12:00:00Z";

test("mato cities: every section parsed, US picked by its country heading", () => {
  const all = m.parseCities(fx("mato-cities.html"));
  assert.equal(all.length, 5);
  assert.deepEqual(m.usCities(all).map((c) => c.slug), ["chicago", "new-york", "pittsburgh"]);
  assert.equal(all.find((c) => c.slug === "birmingham").country, "United Kingdom");
  assert.equal(all.find((c) => c.slug === "new-york").name, "New York");
});

test("mato cities: the list is cached for a day", async () => {
  const f = `${process.env.TEMP || "/tmp"}/mato-cities-test-${process.pid}.json`;
  let calls = 0;
  const get = async () => { calls++; return { ok: true, text: fx("mato-cities.html") }; };
  const a = await m.loadCities(get, { file: f, now });
  const b = await m.loadCities(get, { file: f, now: new Date(now.getTime() + 3600000) });
  const c = await m.loadCities(get, { file: f, now: new Date(now.getTime() + 25 * 3600000) });
  fs.rmSync(f, { force: true });
  assert.equal(a.cities.length, 5);
  assert.ok(b.fromCache);
  assert.ok(!c.fromCache);
  assert.equal(calls, 2);
});

test("mato city page: cards carry title, venue and blurb; filter keeps matcha words only", () => {
  const cards = m.parseCityEvents(fx("mato-city-page.html"));
  assert.equal(cards.length, 5); // four cards plus one only the JSON-LD list has
  const pop = cards.find((c) => c.slug === "popup-at-bean-leaf-23-nov-2026");
  assert.equal(pop.title, "Pop-up at Bean & Leaf");
  assert.equal(pop.venue, "Bean & Leaf");
  const kept = m.matchaCards(cards).map((c) => c.slug).sort();
  // brunch: no; ceremonial-grade blurb: yes; matcha title: yes; hojicha only in the JSON-LD list: yes; "tea ceremony" without matcha: no.
  assert.deepEqual(kept, ["hojicha-night-06-dec-2026", "moody-matcha-workshop-05-dec-2026", "popup-at-bean-leaf-23-nov-2026"]);
});

test("matcha words", () => {
  for (const t of ["Matcha bar", "hojicha latte", "Genmaicha night", "usucha class", "Koicha tasting", "ceremonial grade", "matcha pop-up"]) assert.ok(m.hasMatcha(t), t);
  for (const t of ["Tea ceremony", "Sencha and quiet", "Wedding ceremonial dance", "Matchmaker night"]) assert.ok(!m.hasMatcha(t), t);
  assert.ok(m.slugHasMatcha("matchamania-05-dec-2026"));
  assert.ok(!m.slugHasMatcha("yoga-in-the-park-2026-12-06"));
});

test("mato sitemaps: index, structured pages, matcha slugs not long past", () => {
  const idx = m.parseSitemapIndex(fx("mato-sitemap-index.xml"));
  assert.equal(idx.events.length, 2);
  assert.match(idx.events[0], /type=events&page=1$/);
  assert.match(idx.structured, /events-structured/);
  const slugs = m.matchaSlugsFromSitemap(fx("mato-sitemap-events.xml"), now);
  assert.deepEqual(slugs, ["weekly-matcha-workshop-05-dec-2026", "hojicha-night-2026-12-06"]);
  const s = m.structuredPages(`<urlset><url><loc>https://ma.to/events/chicago</loc></url><url><loc>https://ma.to/events/chicago/anytime/markets</loc></url><url><loc>https://ma.to/events/chicago/this-weekend</loc></url></urlset>`);
  assert.deepEqual([...s.get("chicago")].sort(), ["", "/anytime/markets", "/this-weekend"]);
});

test("mato event page: organizer slug and name are the brand, US state from the page", () => {
  const f = m.parseEventPage(fx("mato-event-page.html"), { slug: "san-francisco", name: "San Francisco" });
  assert.equal(f.venueSlug, "moodymatcharitual");
  assert.equal(f.venueName, "Moody Matcha Ritual");
  assert.equal(f.city, "San Francisco");
  assert.equal(f.state, "CA");
  assert.equal(f.country, "US");
  const uk = m.parseEventPage(fx("mato-event-page-uk.html"));
  assert.equal(uk.country, "GB");
  assert.equal(uk.state, null);
});

test("synthetic source id and brand mapping", () => {
  const f = m.parseEventPage(fx("mato-event-page.html"));
  const s = m.syntheticSource(f);
  assert.equal(s.id, "mato:moodymatcharitual");
  assert.equal(s.brand, "Moody Matcha Ritual");
  assert.equal(s.instagram, "moodymatcharitual");
  assert.equal(s.schedule_url, "https://ma.to/venue/moodymatcharitual");
  assert.equal(s.adapter, "mato");
  // A slug that is not a handle gets no instagram link.
  assert.equal(m.syntheticSource({ ...f, venueSlug: "the-bulldog-pub" }).instagram, null);
  assert.ok(m.looksLikeHandle("bottom.feeder.books"));
  assert.ok(!m.looksLikeHandle("the-bulldog-pub"));
  assert.ok(!m.looksLikeHandle("ab"));
});

test("a venue that a source already reads uses that source, not mato:<slug>", () => {
  const f = m.parseEventPage(fx("mato-event-page.html"));
  const known = [{ id: "moody-matcha", brand: "Moody Matcha", instagram: "MoodyMatchaRitual", schedule_url: null }];
  assert.equal(m.foundToItem(f, "https://ma.to/event/x", known).source.id, "moody-matcha");
  const bySchedule = [{ id: "mm", brand: "MM", instagram: null, schedule_url: "https://ma.to/venue/moodymatcharitual/" }];
  assert.equal(m.foundToItem(f, "https://ma.to/event/x", bySchedule).source.id, "mm");
  assert.equal(m.foundToItem(f, "https://ma.to/event/x", []).source.id, "mato:moodymatcharitual");
});

test("found event becomes a normal event: mato: id, brand, handle, instagram link, image, city, state", async () => {
  const f = m.parseEventPage(fx("mato-event-page.html"));
  const { source, raw } = m.foundToItem(f, "https://ma.to/event/moody-matcha-workshop-05-dec-2026", []);
  const { candidates } = await processItems([raw], source, { now, handle: source.instagram });
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.source_id, "mato:moodymatcharitual");
  assert.equal(c.brand, "Moody Matcha Ritual");
  assert.equal(c.handle, "moodymatcharitual");
  assert.equal(c.links.instagram, "https://www.instagram.com/moodymatcharitual/");
  assert.equal(c.city, "San Francisco");
  assert.equal(c.state, "CA");
  assert.ok(c.image.url.endsWith("034c-original.webp"));
  assert.match(c.start, /^2026-12-05T16:00/);
  // No street address, a venue name only: not "confirmed".
  assert.notEqual(c.confidence, "confirmed");
  // The writer takes it.
  const out = mergeEvents([], [{ ...c, id: "abc123abc123" }], { now });
  assert.equal(out.events[0].source_id, "mato:moodymatcharitual");
});

test("a slug that is not a handle gets no instagram link on the event", async () => {
  const f = { ...m.parseEventPage(fx("mato-event-page.html")), venueSlug: "the-bulldog-pub", venueName: "The Bulldog Pub" };
  const { source, raw } = m.foundToItem(f, "https://ma.to/event/x", []);
  const { candidates } = await processItems([raw], source, { now, handle: null });
  assert.equal(candidates[0].links.instagram, null);
  assert.equal(candidates[0].handle, null);
  assert.equal(candidates[0].brand, "The Bulldog Pub");
});

test("watchlist candidate note round-trips and carries city and state", () => {
  const f = m.parseEventPage(fx("mato-event-page.html"));
  const note = m.candidateNote(f, "Moody Matcha Workshop");
  assert.ok(note.length <= 160);
  assert.deepEqual(m.readNote(note), { slug: "moodymatcharitual", city: "San Francisco", state: "CA", brand: "Moody Matcha Ritual" });
  assert.equal(m.readNote("Found via search."), null);
});

test("promotion: a MATO find gets home city, state, schedule url, website kind and the mato adapter", () => {
  const f = m.parseEventPage(fx("mato-event-page.html"));
  const list = { updated: null, accounts: [] };
  const acc = wl.addCandidate(list, { handle: "moodymatcharitual", found_via: "search", found_from: "ma.to/san-francisco", notes: m.candidateNote(f) }, now);
  assert.equal(acc.status, "candidate");
  // Before a hit: nothing promoted. The pseudo source already reads the MATO venue page.
  assert.equal(wl.promote(list, [], { now }).promoted.length, 0);
  const ps = wl.pseudoSource(acc);
  assert.equal(ps.id, "mato:moodymatcharitual");
  assert.equal(ps.adapter, "mato");
  wl.recordCheck(acc, { now, hitCount: 1, foundCount: 1 });
  const { sources, promoted } = wl.promote(list, [], { now });
  assert.deepEqual(promoted, ["moodymatcharitual"]);
  const s = sources[0];
  assert.equal(s.id, "moodymatcharitual");
  assert.equal(s.home_city, "San Francisco");
  assert.equal(s.home_state, "CA");
  assert.equal(s.schedule_url, "https://ma.to/venue/moodymatcharitual");
  assert.equal(s.schedule_kind, "website");
  assert.equal(s.adapter, "mato");
  assert.equal(s.instagram, "moodymatcharitual");
  // The record satisfies the source schema.
  const schema = JSON.parse(fs.readFileSync(new URL("../data/schema/source.schema.json", import.meta.url), "utf8"));
  for (const k of schema.required) assert.ok(k in s, k);
  assert.match(s.home_state, /^[A-Z]{2}$/);
  assert.match(s.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.deepEqual(Object.keys(s).filter((k) => !(k in schema.properties)), []);
  assert.equal(acc.source_id, "moodymatcharitual");
});

test("a MATO account without a state is not promoted (the schema needs one)", () => {
  const list = { updated: null, accounts: [] };
  const acc = wl.addCandidate(list, { handle: "nostate", found_via: "search", found_from: "ma.to/x", notes: "mato_venue=nostate; home=Somewhere, ; brand=No State" }, now);
  wl.recordCheck(acc, { now, hitCount: 1, foundCount: 1 });
  assert.equal(wl.promote(list, [], { now }).promoted.length, 0);
});

test("after promotion the mato: copy of the same event is replaced, not shown twice", () => {
  const old = { id: "a", source_id: "mato:moodymatcharitual", handle: "moodymatcharitual", start: "2026-12-05T16:00:00-08:00", venue: "Jiaren Cafe", address: null };
  const other = { id: "b", source_id: "mato:other", handle: "other", start: "2026-12-05T16:00:00-08:00", venue: "Jiaren Cafe", address: null };
  const fresh = { id: "c", source_id: "moodymatcharitual", handle: "moodymatcharitual", start: "2026-12-05T16:00:00-08:00", venue: "Jiaren Cafe" };
  assert.deepEqual(dropSuperseded([old, other], [fresh]).map((e) => e.id), ["b"]);
  assert.deepEqual(dropSuperseded([old], [{ ...fresh, source_id: "mato:moodymatcharitual" }]).map((e) => e.id), ["a"]);
});

test("crawl: cap, 429 stop and robots, with a fake fetcher", async () => {
  const pages = {
    "https://ma.to/cities": fx("mato-cities.html"),
    "https://ma.to/events/chicago": fx("mato-city-page.html"),
    "https://ma.to/event/moody-matcha-workshop-05-dec-2026": fx("mato-event-page.html"),
  };
  const seen = [];
  const fetcher = { get: async (u) => { seen.push(u); return u in pages ? { ok: true, status: 200, text: pages[u] } : { ok: false, status: 404, text: "" }; } };
  const cityFile = `${process.env.TEMP || "/tmp"}/mato-crawl-cities-${process.pid}.json`;
  const out = await m.crawlMato(fetcher, { now, sources: [], sitemap: false, cityFile, reserve: 0 });
  fs.rmSync(cityFile, { force: true });
  assert.equal(out.stats.usCities, 3);
  assert.equal(out.stats.matchaCards, 3);
  assert.ok(out.kept.some((k) => k.slug === "moody-matcha-workshop-05-dec-2026" && k.found.state === "CA"));
  assert.ok(seen.every((u) => !u.includes("/api/")));
  assert.equal(out.candidates[0].handle, "moodymatcharitual");
  assert.equal(out.candidates[0].found_from, "ma.to/chicago");
  assert.equal(out.candidates[0].found_via, "search");

  // 429 stops everything after it.
  let n = 0;
  const limited = { get: async (u) => { n++; return u.endsWith("/cities") ? { ok: true, status: 200, text: fx("mato-cities.html") } : { ok: false, status: 429, text: "" }; } };
  const f2 = `${process.env.TEMP || "/tmp"}/mato-crawl-cities2-${process.pid}.json`;
  const o2 = await m.crawlMato(limited, { now, sources: [], sitemap: false, cityFile: f2, reserve: 0 });
  fs.rmSync(f2, { force: true });
  assert.ok(o2.stats.stopped429);
  assert.equal(n, 2); // the city list, then one 429
  assert.equal(o2.items.length, 0);

  // The cap counts network fetches only.
  const b = m.budgeted({ get: async () => ({ ok: true, status: 200, text: "", fromCache: false }) }, 2);
  await b.get("https://ma.to/a"); await b.get("https://ma.to/b");
  const third = await b.get("https://ma.to/c");
  assert.ok(third.skipped && b.st.hitCap);
});

// ---- follow-ups: matcha filter, writer cleanup, hyphenated slugs, inbox brand match ----------------
import { needsMatchaFilter, rawHasMatcha } from "../ingest/adapters/mato.js";
import { keepMatoEvent } from "../ingest/lib/write.js";
import { matchSource } from "../ingest/adapters/manual.js";

test("matcha filter applies to mato: and venue/organizer sources only; missing kind keeps everything", () => {
  assert.ok(needsMatchaFilter({ id: "mato:x" }));
  assert.ok(needsMatchaFilter({ id: "x", kind: "venue" }));
  assert.ok(needsMatchaFilter({ id: "x", kind: "organizer" }));
  for (const kind of [undefined, "popup", "cafe", "tea-brand", "festival"]) assert.ok(!needsMatchaFilter({ id: "x", kind }), String(kind));
  const src = { id: "mato:x", brand: "Flower Shop" };
  assert.ok(rawHasMatcha({ text: "Matcha night. Come.", hints: {} }, src));
  assert.ok(rawHasMatcha({ text: "Night. Come.", tags: "hojicha, tea", hints: {} }, src));
  assert.ok(rawHasMatcha({ text: "Night.", hints: { venue: "Matcha Bar" } }, src));
  assert.ok(!rawHasMatcha({ text: "Pottery. Clay and wine.", hints: { venue: "Studio" } }, src));
});

test("writer cleanup drops non-matcha mato: events, keeps matcha ones and every other source", () => {
  const base = { id: "i", state: "CA", source_id: "mato:x", brand: "Flower Shop", title: "Pottery night", description: null, venue: "Studio", start: "2026-12-05T16:00:00-08:00", end: null, confidence: "likely", first_seen: D, last_seen: D };
  const events = [
    { ...base, id: "a" },
    { ...base, id: "b", title: "Matcha workshop" },
    { ...base, id: "c", source_id: "some-popup", brand: "Other Shop" },
  ];
  assert.deepEqual(events.map(keepMatoEvent), [false, true, true]);
  const out = mergeEvents(events, [], { now });
  assert.deepEqual(out.events.map((e) => e.id).sort(), ["b", "c"]);
  assert.equal(out.stats.cleaned, 1);
});

test("hyphenated venue slug: candidate kept with a schema-safe handle, promoted with instagram null", () => {
  assert.equal(m.handleFor("the-bulldog-pub"), "the_bulldog_pub");
  assert.equal(m.handleFor("bottom.feeder.books"), "bottom.feeder.books");
  const f = { venueSlug: "the-bulldog-pub", venueName: "The Bulldog Pub", city: "Pittsburgh", state: "PA", ld: { name: "Matcha night" } };
  const list = { updated: null, accounts: [] };
  const acc = wl.addCandidate(list, { handle: m.handleFor(f.venueSlug), found_via: "search", found_from: "ma.to/pittsburgh", notes: m.candidateNote(f) }, now);
  assert.match(acc.handle, /^[A-Za-z0-9._]+$/);
  assert.equal(wl.pseudoSource(acc).instagram, null);
  assert.equal(wl.pseudoSource(acc).schedule_url, "https://ma.to/venue/the-bulldog-pub");
  wl.recordCheck(acc, { now, hitCount: 1, foundCount: 1 });
  const s = wl.promote(list, [], { now }).sources[0];
  assert.equal(s.id, "the-bulldog-pub");
  assert.equal(s.instagram, null);
  assert.equal(s.home_state, "PA");
  assert.equal(s.schedule_url, "https://ma.to/venue/the-bulldog-pub");
});

test("inbox: handle match first, then brand in the first 300 characters, then brand slug in the file name", () => {
  const sources = [
    { id: "dream-tea-nyc", brand: "Dream Tea NYC", instagram: null, tiktok: null },
    { id: "other", brand: "Other Tea House", instagram: "otherteahouse", tiktok: null },
    { id: "short", brand: "Tea", instagram: null, tiktok: null },
  ];
  const file = "new-york-dream-tea-nyc-20261201.txt";
  assert.equal(matchSource({ text: "Matcha night Dec 1" }, sources, { file }).source.id, "dream-tea-nyc");
  assert.equal(matchSource({ text: "Hello from Dream Tea NYC: matcha Dec 1" }, sources).source.id, "dream-tea-nyc");
  assert.equal(matchSource({ text: "x ".repeat(200) + "Dream Tea NYC" }, sources), null); // beyond 300 characters
  assert.equal(matchSource({ text: "Pop-up with @otherteahouse and Dream Tea NYC" }, sources).source.id, "other"); // handle first
  assert.equal(matchSource({ text: "nothing here" }, sources, { file: "boston-tea-20261201.txt" }), null); // short brand never matches
  assert.equal(matchSource({ text: "nothing" }, sources, { file: "new-york-dream-tea-nycx-20261201.txt" }), null);
});
