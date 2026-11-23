import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { judge } from "../ingest/lib/quality.js";
import { mergeEvents, keepEvent, tidy, passesWatchRule, hasPopupIntent, isWatchPseudo } from "../ingest/lib/write.js";
import { downloadImages } from "../ingest/lib/images.js";

const now = new Date("2026-11-22T20:00:00Z");
const ev = (o = {}) => ({
  id: "e", brand: "Sunny", source_id: "sunny", title: "Sunny pop-up", description: "matcha pop-up at Sunny Books", venue: "Sunny Books", address: "",
  city: "Los Angeles", state: "CA", start: "2026-12-06T11:00:00-08:00", end: null, tz: "America/Los_Angeles", all_day: false, confidence: "likely", kind: "popup", menu: [], ...o,
});

// ---- placeholders, generic titles, lists -------------------------------------------------------
test("placeholder venues are blanked and the event marked unsure", () => {
  for (const v of ["Cafe of the day", "cafe of the week", "Spot of the Month", "Restaurant of the day", "Bar of the day", "shop of the week"]) {
    const t = tidy(ev({ venue: v }));
    assert.deepEqual([t.venue, t.confidence], ["", "unsure"], v);
  }
  assert.equal(tidy(ev()).venue, "Sunny Books");
  const r = mergeEvents([], [ev({ venue: "Cafe of the day" })], { now });
  assert.deepEqual([r.events[0].venue, r.events[0].confidence], ["", "unsure"]);
});
test("a title that is only Matcha event / pop-up with no brand is dropped; a branded one stays", () => {
  for (const t of ["Matcha event", "Matcha pop-up", "Matcha popup", "matcha pop up"]) assert.equal(keepEvent(ev({ title: t, brand: "Matcha" })), false, t);
  assert.equal(keepEvent(ev({ title: "Matcha pop-up", brand: "" })), false);
  assert.equal(keepEvent(ev({ title: "Matcha pop-up", brand: "Sunny" })), true);
  assert.equal(keepEvent(ev({ title: "Sunny pop-up", brand: "Matcha" })), true);
});
test("an event with no state is dropped (the schema needs one)", () => assert.equal(keepEvent(ev({ state: "" })), false));
test("a listing whose only matcha word sits in a long vendor list becomes an unsure organizer event", () => {
  const vendors = Array.from({ length: 10 }, (_, i) => `@vendor${i}`).join(", ");
  const listing = ev({ source_id: "eventbrite:market-co", title: "Holiday Night Market", description: `Vendors: ${vendors}, @matchagirl` });
  const t = tidy(listing);
  assert.deepEqual([t.confidence, t.kind], ["unsure", "organizer"]);
  assert.equal(tidy({ ...listing, title: "Matcha Night" }).kind, "popup", "matcha in the title stays");
  assert.equal(tidy({ ...listing, description: "Matcha tasting, tea and cake" }).kind, "popup", "a short description is not a list");
  assert.equal(tidy({ ...listing, source_id: "sunny" }).kind, "popup", "only for Eventbrite, Allevents and Meetup");
});

// ---- watch-list accounts -----------------------------------------------------------------------
test("watch-list accounts: matcha term, pop-up intent and a place are all needed", () => {
  const ids = new Set(["sunny"]);
  for (const t of ["Find us at the market", "we'll be at the stand", "serving matcha", "this weekend at Sunny", "catch us", "vendor booth", "come by"]) assert.ok(hasPopupIntent(t), t);
  assert.ok(!hasPopupIntent("Thanksgiving pre-orders are open!"));
  assert.ok(isWatchPseudo(ev({ source_id: "matelnabakes" }), ids));
  assert.ok(!isWatchPseudo(ev(), ids) && !isWatchPseudo(ev({ source_id: "mato:x" }), ids) && !isWatchPseudo(ev({ source_id: "hashtag:x" }), ids));
  assert.equal(keepEvent(ev({ source_id: "newbrand" }), { sourceIds: ids }), true);
  const preorder = ev({ source_id: "newbrand", title: "newbrand pop-up", description: "Thanksgiving pre-orders are open!", brand: "newbrand" });
  assert.equal(keepEvent(preorder, { sourceIds: ids }), false, "no matcha, no intent");
  assert.equal(keepEvent(ev({ source_id: "newbrand", description: "matcha pre-orders open", title: "x" }), { sourceIds: ids }), false, "no intent");
  assert.equal(keepEvent(ev({ source_id: "newbrand", venue: "", address: "", city: "" }), { sourceIds: ids }), false, "no place");
  assert.equal(keepEvent(ev({ source_id: "sunny", venue: "", address: "", city: "", description: "lunch" }), { sourceIds: ids }), true, "a source in sources.json is not judged");
  assert.ok(passesWatchRule(["Matcha pop-up Sunday"], { city: "Austin" }));
  const r = mergeEvents([ev({ id: "a", source_id: "newbrand", description: "pre-orders", title: "newbrand pop-up", brand: "newbrand" })], [], { now, sourceIds: ids });
  assert.equal(r.events.length, 0);
  assert.equal(r.stats.cleaned, 1);
});

// ---- images ------------------------------------------------------------------------------------
test("image_url is refreshed on every read and kept when a read brings none", () => {
  const prev = mergeEvents([], [ev({ image_url: "https://scontent.cdninstagram.com/old.jpg" })], { now }).events;
  assert.equal(prev[0].image_url, "https://scontent.cdninstagram.com/old.jpg");
  const fresh = mergeEvents(prev, [ev({ image_url: "https://scontent.cdninstagram.com/new.jpg" })], { now }).events;
  assert.equal(fresh[0].image_url, "https://scontent.cdninstagram.com/new.jpg");
  assert.equal(mergeEvents(fresh, [ev()], { now }).events[0].image_url, "https://scontent.cdninstagram.com/new.jpg");
});
test("a robots-blocked image is not a failure: its url is kept in image_url", async () => {
  const e = { id: "z1", image: { url: "https://scontent.cdninstagram.com/p.jpg", local: null }, image_url: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
  const stats = await downloadImages([e], { fetcher: { allowed: async () => false, throttle: async () => {} }, dir });
  assert.deepEqual([stats.robots, stats.failed, e.image_url], [1, 0, "https://scontent.cdninstagram.com/p.jpg"]);
});
test("the schema declares image_url (string or null, required) and every event on file carries it", () => {
  const schema = JSON.parse(fs.readFileSync("data/schema/event.schema.json", "utf8")).$defs.event;
  assert.deepEqual(schema.properties.image_url.type, ["string", "null"]);
  assert.ok(schema.required.includes("image_url"));
  for (const e of JSON.parse(fs.readFileSync("data/events.json", "utf8")).events) assert.ok(e.image_url === null || typeof e.image_url === "string", e.id);
});

test("brunch listing from an event site with matcha only in the title is dropped (Blind Tiger, Ybor City)", () => {
  const blind = { id: "539dec8897e6", brand: "Blind Tiger Coffee Roasters", source_id: "eventbrite:blind-tiger-coffee-roasters", title: "Ybor City Matcha & Mimosa Sundays", venue: "Blind Tiger Coffee Roasters- Ybor City Cafe", state: "FL", description: "Sunday Brunch at Blind Tiger Coffee Roasters with brunch favorites, mimosas, Cutwaters, and beer & wine—served with laid-back vibes.", menu: [] };
  assert.equal(judge(blind).reason, "brunch");
  assert.equal(keepEvent(blind), false);
  assert.equal(keepEvent({ ...blind, id: "2515797d489c", source_id: "allevents:blind-tiger-coffee-roasters" }), false);
  assert.equal(keepEvent({ ...blind, id: "zzzzzzzzzzzz", brand: "Cha Cha Matcha" }), true, "a matcha brand is not judged by this rule");
  assert.equal(keepEvent({ ...blind, id: "zzzzzzzzzzzy", source_id: "sunny" }), true, "only event-site finds");
});
test("data/overrides.json drop: true removes an event by id", () => {
  assert.equal(keepEvent(ev({ id: "539dec8897e6" })), false);
});

test("a matcha meetup that says 'brunch or coffee' once is not a brunch listing; two food words are", () => {
  const meet = { id: "m1", brand: "Press Cafe", source_id: "eventbrite:press-cafe", title: "Matcha Friends Meetup: Fort Worth", state: "TX", description: "Make new friends over brunch or coffee while supporting small businesses.", menu: [] };
  assert.equal(keepEvent(meet), true);
  assert.equal(keepEvent({ ...meet, id: "m2", description: "Brunch buffet with mimosas." }), false);
});
test("finds that are not a source need a matcha signal in brand or text; a source in sources.json is the signal itself", () => {
  const ids = new Set(["sunny"]);
  const find = ev({ id: "f1", source_id: "tiktok:somebody", brand: "Somebody", title: "Somebody pop-up", description: "come by for lattes" });
  assert.equal(keepEvent(find, { sourceIds: ids }), false, "no matcha anywhere");
  assert.equal(keepEvent({ ...find, id: "f2", description: "hojicha lattes and a ceremonial grade bar" }, { sourceIds: ids }), true);
  assert.equal(keepEvent({ ...find, id: "f3", description: "try our banana matcha latte" }, { sourceIds: ids }), true);
  assert.equal(keepEvent({ ...find, id: "f4", source_id: "sunny", description: "terse caption" }, { sourceIds: ids }), true, "a brand record counts as the signal");
});
test("a handle brand is written as a name (tidy), a written name is left alone", () => {
  assert.equal(tidy(ev({ brand: "bujimatcha", source_id: "tiktok:bujimatcha" })).brand, "Buji Matcha");
  assert.equal(tidy(ev({ brand: "mrs.stript", source_id: "tiktok:mrs.stript" })).brand, "Mrs Stript");
  assert.equal(tidy(ev({ brand: "Cube Tea Studio", source_id: "x" })).brand, "Cube Tea Studio");
});
