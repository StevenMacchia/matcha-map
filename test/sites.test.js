import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as common from "../ingest/lib/sites/common.js";
import * as luma from "../ingest/lib/sites/luma.js";
import * as eb from "../ingest/lib/sites/eventbrite.js";
import * as ds from "../ingest/lib/sites/dostuff.js";
import * as mu from "../ingest/lib/sites/meetup.js";
import * as ae from "../ingest/lib/sites/allevents.js";
import * as lt from "../ingest/lib/sites/linktree.js";
import { parseFlags, siteOn, dedupeItems, skipDominated, capConfidence, rankOf, NAMES } from "../ingest/lib/sites/index.js";
import ebAdapter, { readOrganizer, eventToItem } from "../ingest/adapters/eventbrite.js";
import { processItems, dropSuperseded } from "../ingest/lib/pipeline.js";
import { keepMatoEvent, isMatoSource } from "../ingest/lib/write.js";
import * as wl from "../ingest/lib/watchlist.js";

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/sites-${n}.json`, import.meta.url), "utf8"));
const now = new Date("2026-11-22T12:00:00Z");

// A fetcher that serves a url -> text map (404 otherwise) and counts calls.
const fake = (pages, { status = {} } = {}) => {
  const seen = [];
  return { seen, noFetch: false, get: async (u) => { seen.push(u); if (u in status) return { ok: false, status: status[u], text: "" }; return u in pages ? { ok: true, status: 200, text: pages[u] } : { ok: false, status: 404, text: "" }; } };
};

// ---- common --------------------------------------------------------------------------------------
test("sites: robots gate skips a 403 robots.txt and a site that disallows everything, passes 404 and open rules", async () => {
  const b1 = common.siteBudget(fake({}, { status: { "https://a.test/robots.txt": 403 } }), "t");
  assert.match((await common.gate(b1, "a.test")).reason, /HTTP 403/);
  const b2 = common.siteBudget(fake({ "https://b.test/robots.txt": "User-agent: *\nDisallow: /\n" }), "t");
  assert.match((await common.gate(b2, "b.test")).reason, /disallows/);
  const b3 = common.siteBudget(fake({}), "t");
  assert.ok((await common.gate(b3, "c.test")).ok);
  const b4 = common.siteBudget(fake({ "https://d.test/robots.txt": "User-agent: *\nDisallow: /api/\n" }), "t");
  assert.ok((await common.gate(b4, "d.test")).ok);
});

test("sites: budget stops at the cap and for good after a 429 or 403", async () => {
  const f = fake({ "https://x.test/1": "a", "https://x.test/2": "b", "https://x.test/3": "c" }, { status: { "https://x.test/4": 403 } });
  const b = common.siteBudget(f, "t", 2);
  assert.ok((await b.get("https://x.test/1")).ok);
  assert.ok((await b.get("https://x.test/2")).ok);
  assert.ok((await b.get("https://x.test/3")).skipped);
  assert.ok(b.st.hitCap);
  const b2 = common.siteBudget(f, "t", 10);
  assert.equal((await b2.get("https://x.test/4")).status, 403);
  assert.ok((await b2.get("https://x.test/1")).skipped);
  assert.equal(b2.st.stopped, 403);
});

test("sites: pseudo source id, brand, kind, no invented instagram; a known source wins", async () => {
  const raw = { organizer: { name: "Sunrise Tea Room!", url: "https://x.test/o/1" }, hints: { city: "Brooklyn", state: "NY", title: "x" }, handle: "sunrise.tea" };
  const s = common.pseudoSource("luma", raw, []);
  assert.equal(s.id, "luma:sunrise-tea-room");
  assert.equal(s.brand, "Sunrise Tea Room!");
  assert.equal(s.instagram, "sunrise.tea");
  assert.equal(s.kind, "popup");
  assert.equal(s.category, "matcha");
  assert.equal(common.pseudoSource("luma", { ...raw, handle: null }, []).instagram, null);
  const known = [{ id: "sunrise", instagram: "Sunrise.Tea" }];
  assert.equal(common.pseudoSource("luma", raw, known).id, "sunrise");
  const byOrg = [{ id: "kin", schedule_url: "https://www.eventbrite.com/o/10706971808" }];
  assert.equal(common.pseudoSource("eventbrite", { organizer: { name: "KinKa", url: "https://www.eventbrite.com/o/kinka-10706971808" }, hints: {} }, byOrg).id, "kin");
});

test("sites: pseudo ids behave like mato: ids in the writer", () => {
  for (const id of ["mato:a", "luma:a", "eventbrite:a", "dostuff:a", "meetup:a", "allevents:a"]) assert.ok(isMatoSource(id, {}), id);
  assert.ok(!isMatoSource("filo-cafe", {}));
  assert.ok(!keepMatoEvent({ source_id: "luma:x", title: "AI demo", brand: "Pangram", description: "", venue: "", menu: [] }));
  assert.ok(keepMatoEvent({ source_id: "luma:x", title: "Matcha night", brand: "Pangram", description: "", venue: "", menu: [] }));
  assert.ok(keepMatoEvent({ source_id: "real-source", title: "AI demo", brand: "x", description: "", venue: "", menu: [] }));
});

// ---- Luma ------------------------------------------------------------------------------------------
test("luma: discover page lists North American places, not Canada or Mexico", () => {
  const places = luma.parsePlaces(fx("luma").discover_html);
  assert.deepEqual(places.map((p) => p.slug).sort(), ["la", "nyc"]);
  assert.match(places[0].api_id, /^discplace-/);
});

test("luma: matcha filter, US only, in-person only, host calendar is the organizer", async () => {
  const out = luma.fromEntries(fx("luma").entries, []);
  assert.equal(out.items.length, 2); // tasting + hojicha; AI demo, online and Toronto are out
  const t = out.items.find((i) => i.hints.title === "Matcha tasting and sencha flight");
  assert.equal(t.source_url, "https://luma.com/mm-tasting");
  assert.equal(t.handle, "matchamondaysnyc");
  assert.equal(t.hints.city, "Brooklyn");
  assert.equal(t.hints.state, "NY");
  assert.equal(t.source_hint.id, "luma:matcha-mondays-nyc");
  assert.equal(t.source_hint.brand, "Matcha Mondays NYC");
  assert.ok(t.image_url);
  // kind mapping: "tasting" in the title makes it an organizer event, the other stays a pop-up.
  const a = await processItems([t], t.source_hint, { now, handle: t.handle });
  assert.equal(a.candidates[0].kind, "organizer");
  assert.equal(a.candidates[0].category, "matcha");
  assert.equal(a.candidates[0].links.instagram, "https://www.instagram.com/matchamondaysnyc/");
  const h = out.items.find((i) => /hojicha/i.test(i.hints.title));
  const b = await processItems([h], h.source_hint, { now, handle: h.handle });
  assert.equal(b.candidates[0].kind, "popup");
  assert.equal(b.candidates[0].links.instagram, null);
  assert.equal(b.candidates[0].handle, null);
  // candidates: one per new organizer, found_via search, found_from luma, handle only when the calendar gave one
  assert.equal(out.candidates.length, 2);
  const c = out.candidates.find((x) => x.handle === "matchamondaysnyc");
  assert.equal(c.found_via, "search");
  assert.equal(c.found_from, "luma");
  assert.match(c.evidence, /^site=luma; org=matcha-mondays-nyc; home=Brooklyn, NY; brand=Matcha Mondays NYC/);
  assert.ok(out.candidates.every((x) => /^[A-Za-z0-9._]+$/.test(x.handle)));
});

test("luma: crawl reads discover, then the paging API once per place; stops cleanly", async () => {
  const f = fx("luma");
  const api = (id) => `https://api2.luma.com/discover/get-paginated-events?discover_place_api_id=${id}&pagination_limit=50`;
  const places = luma.parsePlaces(f.discover_html);
  const pages = { "https://luma.com/discover": f.discover_html, [api(places[0].api_id)]: JSON.stringify({ entries: f.entries, has_more: false }) };
  const r = await luma.discover({ fetcher: fake(pages), now, sources: [] });
  assert.equal(r.stats.places, 2);
  assert.equal(r.items.length, 2);
  const blocked = await luma.discover({ fetcher: fake({}, { status: { "https://luma.com/robots.txt": 403 } }), now, sources: [] });
  assert.match(blocked.stats.skipped, /403/);
});

// ---- Eventbrite ------------------------------------------------------------------------------------
test("eventbrite: city url and listing parse keep matcha events only", () => {
  assert.equal(eb.cityUrl("New York"), "https://www.eventbrite.com/d/ny--new-york/matcha/");
  assert.equal(eb.cityUrl("Washington DC"), "https://www.eventbrite.com/d/dc--washington/matcha/");
  assert.equal(eb.cityUrl("St. Louis"), "https://www.eventbrite.com/d/mo--st-louis/matcha/");
  const hits = eb.parseListing(fx("eventbrite").listing_html);
  const titles = hits.map((h) => h.title).sort();
  // the chocolate tour has no matcha word; the tea ceremony's description does, the 101 and the meetup say it in the title
  assert.deepEqual(titles, ["Japanese Tea Ceremony workshop at the Table", "Matcha + Meetup: Brooklyn", "Matcha 101 'Whisk & Sip'"]);
});

test("eventbrite: event page gives time, address, organizer, image, price; maps to a pseudo source", async () => {
  const f = fx("eventbrite");
  const url = "https://www.eventbrite.com/e/matcha-101-whisk-sip-tickets-2004290027426";
  const raw = eb.parseEventPage(f.event_html, url, { city: "New York", state: "NY" });
  assert.equal(raw.hints.start, "2026-11-29T11:00:00-05:00");
  assert.equal(raw.hints.venue, "KINKA");
  assert.equal(raw.hints.address, "63 East 7th Street, New York, NY 10003");
  assert.equal(raw.organizer.name, "KinKa");
  assert.equal(raw.price_hint, "$44.52");
  assert.ok(raw.image_url.startsWith("https://img.evbuc.com/"));
  const out = common.finish("eventbrite", [raw], []);
  assert.equal(out.items[0].source_hint.id, "eventbrite:kinka");
  assert.equal(out.candidates[0].found_from, "eventbrite");
  const { candidates } = await processItems(out.items, out.items[0].source_hint, { now, handle: null });
  assert.equal(candidates[0].kind, "organizer"); // title says 101
  assert.equal(candidates[0].brand, "KinKa");
  assert.equal(candidates[0].confidence, "confirmed");
  assert.match(candidates[0].address, /63 East 7th/);
});

test("eventbrite: a listing hit without a readable event page stays as an all-day event", () => {
  const hit = eb.parseListing(fx("eventbrite").listing_html).find((h) => /Brooklyn/.test(h.title));
  const raw = common.ldToRaw(hit.ld, hit.url, { cityHint: { city: "Brooklyn", state: "NY" } });
  assert.equal(raw.hints.all_day, true);
  assert.match(raw.hints.start, /^2026-11-28T00:00:00-05:00$/);
  assert.equal(raw.hints.state, "NY");
});

test("eventbrite crawl: robots first, one page per city, event pages for hits", async () => {
  const f = fx("eventbrite");
  const hits = eb.parseListing(f.listing_html);
  const pages = { "https://www.eventbrite.com/d/ny--new-york/matcha/": f.listing_html };
  for (const h of hits) pages[h.url] = f.event_html;
  const fetcher = fake(pages);
  const crawlFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eb-")), "crawl.json");
  const r = await eb.discover({ fetcher, now, sources: [], cities: ["New York", "Atlantis"], crawlFile });
  assert.equal(fetcher.seen[0], "https://www.eventbrite.com/robots.txt");
  assert.equal(r.stats.listings, 1);
  assert.equal(r.stats.hits, 3);
  assert.ok(r.items.length >= 1);
  assert.ok(fetcher.seen.every((u) => !/instagram|tiktok|facebook/.test(u)));
});

test("eventbrite adapter: organizer page upcomingEvents -> RawItems, matches only /o/ pages", async () => {
  assert.ok(ebAdapter.matches({ schedule_url: "https://www.eventbrite.com/o/dream-tea-nyc-115792355101" }));
  assert.ok(!ebAdapter.matches({ schedule_url: "https://www.eventbrite.com/e/x-tickets-1" }));
  assert.ok(!ebAdapter.matches({ schedule_url: null }));
  const html = fx("eventbrite").organizer_html;
  assert.equal(readOrganizer(html).upcomingEvents.length, 2);
  const it = eventToItem(readOrganizer(html).upcomingEvents[0]);
  assert.equal(it.hints.start, "2026-12-06T10:30:00-08:00");
  assert.equal(it.hints.venue, "Cafe of the Day");
  assert.equal(it.hints.state, "CA");
  const src = { id: "addventures", brand: "Matcha + Meetup", kind: "popup", schedule_url: "https://www.eventbrite.com/o/105305487311" };
  const ctx = { fetcher: fake({ [src.schedule_url]: html }), now };
  assert.equal((await ebAdapter.fetch(src, ctx)).length, 2);
  // an organizer or venue source keeps only matcha events, even when its brand says matcha
  const org = await ebAdapter.fetch({ ...src, kind: "organizer" }, ctx);
  assert.equal(org.length, 1);
  assert.equal(org[0].hints.title, "Matcha + Meetup: Echo Park");
});

// ---- DoStuff -----------------------------------------------------------------------------------------
test("dostuff: search cards with matcha words, upcoming only; event page graph resolves the Place", () => {
  const cards = ds.parseSearch(fx("dostuff").search_html);
  assert.deepEqual(cards.map((c) => c.path), ["/events/2026/12/6/matcha-mochi-pop-up-tickets", "/events/2026/11/1/matcha-social-tickets"]);
  const raw = ds.parseEventPage(fx("dostuff").event_html, "https://donyc.com/events/2026/12/6/matcha-mochi-pop-up-tickets", { city: "New York", state: "NY" });
  assert.equal(raw.hints.start, "2026-12-06T12:00:00-05:00");
  assert.equal(raw.hints.venue, "Club Cumming");
  assert.equal(raw.hints.address, "505 East 6th Street, New York, NY 10009");
  const out = common.finish("dostuff", [raw], []);
  assert.equal(out.items[0].source_hint.id, "dostuff:club-cumming");
  assert.equal(out.candidates[0].found_via, "search");
});

test("dostuff: a host that answers 403 to robots.txt is skipped, the others are read", async () => {
  const f = fx("dostuff");
  const ok = "https://donyc.com/search?q=matcha";
  const fetcher = fake({ [ok]: f.search_html, "https://donyc.com/events/2026/12/6/matcha-mochi-pop-up-tickets": f.event_html }, { status: { "https://do512.com/robots.txt": 403 } });
  const r = await ds.discover({ fetcher, now, sources: [], hosts: [["do512.com", "Austin", "TX"], ["donyc.com", "New York", "NY"]] });
  assert.equal(r.stats.skippedHosts.length, 1);
  assert.match(r.stats.skippedHosts[0], /do512\.com/);
  assert.equal(r.stats.sites, 1);
  assert.equal(r.items.length, 1);
});

// ---- Meetup ------------------------------------------------------------------------------------------
test("meetup: Apollo events with a matcha word, physical only; group is the organizer", () => {
  const items = mu.parseSearch(fx("meetup").html, { city: "New York", state: "NY" });
  assert.equal(items.length, 1);
  const i = items[0];
  assert.equal(i.hints.title, "Matcha & Walk | The High Line");
  assert.equal(i.hints.start, "2026-11-29T15:00:00-05:00");
  assert.equal(i.hints.venue, "Blue Bottle Coffee");
  assert.equal(i.hints.state, "NY");
  assert.equal(i.organizer.name, "Longevity New York");
  assert.ok(i.image_url);
  assert.equal(mu.cityUrl("New York"), "https://www.meetup.com/find/?keywords=matcha&source=EVENTS&location=us--ny--New%20York");
  const out = common.finish("meetup", items, []);
  assert.equal(out.items[0].source_hint.id, "meetup:longevity-new-york");
});

// ---- Allevents ---------------------------------------------------------------------------------------
test("allevents: city page events, times from the FAQ lines", () => {
  const items = ae.parseCityPage(fx("allevents").html, { city: "New York", state: "NY" });
  const kinka = items.find((i) => /Matcha 101/.test(i.hints.title));
  assert.equal(kinka.hints.title, "Matcha 101 'Whisk & Sip'");
  assert.equal(kinka.hints.start, "2026-11-22T11:00:00-05:00");
  assert.ok(!kinka.hints.all_day);
  const design = items.find((i) => /Design Matcha/.test(i.hints.title));
  assert.equal(design.hints.start, "2026-12-12T12:00:00-05:00");
  assert.equal(design.hints.venue, null); // the place name is just the city
  const out = common.finish("allevents", items, []);
  assert.ok(out.items.length >= 3);
  assert.ok(out.items.every((i) => i.source_hint.id.startsWith("allevents:")));
  assert.equal(ae.cityUrl("Los Angeles"), "https://allevents.in/los-angeles/matcha");
});

test("allevents: nothing is confirmed", () => {
  assert.equal(capConfidence({ source_id: "allevents:x", confidence: "confirmed" }).confidence, "likely");
  assert.equal(capConfidence({ source_id: "luma:x", confidence: "confirmed" }).confidence, "confirmed");
});

// ---- Linktree ----------------------------------------------------------------------------------------
test("linktree: dated pop-up lines become items with the brand's handle; schedule links become leads; no event from a bare link", () => {
  const parsed = lt.parseLinkPage(fx("linktree").html);
  assert.equal(parsed.links.length, 6);
  const src = { id: "plentea-matcha", brand: "Plentea Matcha", kind: "popup", instagram: "plenteamatcha", home_city: "Washington", home_state: "DC", website: "https://linktr.ee/plenteamatcha", schedule_url: "https://ma.to/venue/plenteamatcha" };
  const r = lt.readPage(parsed, src, "https://linktr.ee/plenteamatcha", now);
  assert.deepEqual(r.items.map((i) => i.text).sort(), ["Matcha pop-up Sat Dec 12 at Union Market, DC", "Pop-up this Saturday Dec 5, 11-3 at Eastern Market"]);
  assert.ok(r.items.every((i) => i.handle === "plenteamatcha" && i.source_hint.id === "plentea-matcha"));
  // the schedule_url it already has is not a lead; MATO is, via the other links: luma and eventbrite
  assert.deepEqual(r.leads.map((l) => l.kind).sort(), ["eventbrite", "luma"]);
  assert.ok(r.leads.every((l) => l.source_id === "plentea-matcha" && l.found_via === "search"));
  assert.ok(!r.items.some((i) => /shop matcha|Luma calendar|Tickets/.test(i.text)));
  assert.equal(lt.scheduleKind("https://ma.to/venue/x"), "mato");
  assert.equal(lt.scheduleKind("https://shop.myshopify.com/pages/events"), "shopify-events");
  assert.equal(lt.scheduleKind("https://example.com/"), null);
  assert.equal(lt.onLinkPage({ website: "https://linktr.ee/x" }), "https://linktr.ee/x");
  assert.equal(lt.onLinkPage({ website: "https://example.com", schedule_url: null }), null);
});

test("linktree: a venue or organizer source keeps only lines that say matcha", () => {
  const parsed = { title: "", bio: "Open Dec 5, bring a friend. Pop-up day", links: [{ title: "Matcha pop-up Dec 6", url: "https://x.test/a" }] };
  const src = { id: "v", brand: "Hall", kind: "venue", instagram: "hall", home_city: "Dallas", home_state: "TX" };
  assert.deepEqual(lt.readPage(parsed, src, "https://linktr.ee/hall", now).items.map((i) => i.text), ["Matcha pop-up Dec 6"]);
});

// ---- flags, duplicates, watchlist ------------------------------------------------------------------
test("flags: --no-<site> and --only <site>", () => {
  const f = parseFlags(["--no-luma", "--no-allevents"]);
  assert.ok(!siteOn("luma", f));
  assert.ok(siteOn("eventbrite", f));
  const o = parseFlags(["--only", "meetup"]);
  assert.ok(siteOn("meetup", o));
  assert.ok(!siteOn("mato", o));
  assert.ok(!siteOn("meetup", o, true)); // --no-fetch
  for (const n of ["mato", "luma", "eventbrite", "dostuff", "meetup", "linktree", "allevents"]) assert.ok(NAMES.includes(n), n);
});

test("duplicates: the same title on the same day keeps the better-ranked site; real sources beat sites", () => {
  const mk = (id, title, start) => ({ source: { id }, raw: { hints: { title, start } } });
  const list = dedupeItems([mk("eventbrite:kinka", "Matcha 101 'Whisk & Sip'", "2026-11-29T11:00:00-05:00"), mk("allevents:kinka", "Matcha 101 &amp; 'Whisk & Sip'".replace("&amp; ", ""), "2026-11-29T00:00:00-05:00"), mk("luma:x", "Other", "2026-11-29T11:00:00-05:00")]);
  assert.deepEqual(list.map((x) => x.source.id), ["eventbrite:kinka", "luma:x"]);
  assert.ok(rankOf("mato:a") < rankOf("luma:a") && rankOf("luma:a") < rankOf("allevents:a") && rankOf("real") < rankOf("mato:a"));
  const existing = [{ title: "Matcha 101", start: "2026-11-29T11:00:00-05:00", source_id: "eventbrite:kinka" }];
  const cands = [{ title: "Matcha 101", start: "2026-11-29T00:00:00-05:00", source_id: "allevents:kinka" }, { title: "Matcha 101", start: "2026-11-29T11:00:00-05:00", source_id: "eventbrite:kinka" }, { title: "Matcha 101", start: "2026-11-29T11:00:00-05:00", source_id: "kinka" }];
  assert.deepEqual(skipDominated(cands, existing).map((c) => c.source_id), ["eventbrite:kinka", "kinka"]);
  // a real source reading the same event later replaces the pseudo copy
  const kept = dropSuperseded([{ id: "1", source_id: "allevents:kinka", title: "Matcha 101", start: "2026-11-29T11:00:00-05:00" }], [{ source_id: "eventbrite:kinka", title: "Matcha 101", start: "2026-11-29T11:00:00-05:00" }]);
  assert.equal(kept.length, 0);
});

test("watchlist: a site candidate keeps the schema's handle pattern and a note", () => {
  const list = { updated: null, accounts: [] };
  const raw = { organizer: { name: "The Tea Room & Co", url: null }, hints: { city: "Austin", state: "TX", title: "Matcha night" } };
  const src = common.pseudoSource("meetup", raw, []);
  const c = common.candidateFor("meetup", raw, src);
  assert.match(c.handle, /^[A-Za-z0-9._]+$/);
  const acc = wl.addCandidate(list, { handle: c.handle, found_via: c.found_via, found_from: c.found_from, notes: c.evidence }, now);
  assert.equal(acc.found_from, "meetup");
  assert.equal(acc.found_via, "search");
  assert.equal(acc.status, "candidate");
  assert.ok(acc.notes.length <= 160);
});
