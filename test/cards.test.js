import test from "node:test";
import assert from "node:assert/strict";
import { cardHtml, rowHtml, brandCardHtml, verdict, drinkArt, drinkSlug, alsoNearby, renderCard, esc } from "../site/cards.js";

// Thu 2026-11-26 12:30 in Houston (UTC-6).
const NOW = new Date("2026-11-26T18:30:00Z");
const ev = (o = {}) => ({
  id: "aaaaaa000001", brand: "Moonbee", kind: "popup", handle: "moonbee.matcha", start: "2026-11-26T13:00:00-06:00", end: "2026-11-26T17:00:00-06:00",
  tz: "America/Chicago", all_day: false, venue: "Kohiko Coffee", address: "1 Main St", city: "Houston", state: "TX", zip: "77002",
  lat: 29.76, lng: -95.37, approx: false, geocode_source: "nominatim", confidence: "confirmed", status: "upcoming",
  image: null, image_url: null, posts: { instagram: null, tiktok: null, other: null }, links: { website: null, instagram: null, tiktok: null },
  menu: [], price: null, description: null, source_url: null, ...o,
});
const ART = {
  drinks: { "strawberry-matcha": { file: "drinks/strawberry-matcha.svg", text: "strawberry matcha" }, "hojicha-latte": { file: "drinks/hojicha-latte.svg", text: "hojicha latte" }, "iced-matcha-latte": { file: "drinks/iced-matcha-latte.svg", text: "iced matcha latte" } },
  events: { aaaaaa000001: { file: "events/aaaaaa000001.svg" } },
  catalog: [{ slug: "iced-matcha-latte", name: "Iced matcha latte", aliases: ["iced matcha", "matcha latte"] }],
  families: {},
};
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("verdict: today, now, tomorrow, this weekend, weekday, a date, past", () => {
  assert.equal(verdict(ev(), { now: NOW }).text, "Today 1pm to 5pm, Houston");
  assert.equal(verdict(ev({ start: "2026-11-26T11:00:00-06:00", end: "2026-11-26T15:00:00-06:00" }), { now: NOW }).text, "Open now until 3pm, Houston");
  assert.equal(verdict(ev({ start: "2026-11-27T10:00:00-06:00", end: "2026-11-27T14:30:00-06:00" }), { now: NOW }).text, "Tomorrow 10am to 2:30pm, Houston");
  const sat = verdict(ev({ start: "2026-11-28T00:00:00-06:00", end: null, all_day: true }), { now: NOW });
  assert.equal(sat.kind, "weekend");
  assert.equal(sat.text, "This Saturday, Houston");
  assert.equal(verdict(ev({ start: "2026-12-01T08:00:00-06:00", end: "2026-12-01T12:00:00-06:00" }), { now: NOW }).day, "Tuesday");
  assert.equal(verdict(ev({ start: "2026-12-06T00:00:00-06:00", end: null, all_day: true, city: "Brooklyn" }), { now: NOW }).text, "Sun Dec 6, Brooklyn");
  assert.equal(verdict(ev({ start: "2026-11-21T10:00:00-06:00", end: "2026-11-21T12:00:00-06:00" }), { now: NOW }).day, "Was Sat Nov 21");
  assert.equal(verdict(ev(), { now: NOW, absolute: true }).text, "Thu Nov 26 1pm to 5pm, Houston");
  assert.equal(verdict(ev({ start: "2026-11-26T13:00:00-06:00", end: null }), { now: NOW }).time, "from 1pm");
  assert.equal(verdict(ev({ all_day: true, start: "2026-11-27T00:00:00-06:00", hours: "11am-3pm" }), { now: NOW }).text, "Tomorrow 11am-3pm, Houston");
  // today is read in the venue's zone: 18:30Z is still the 26th in Houston but the 27th in Tokyo
  assert.equal(verdict(ev({ start: "2026-11-27T10:00:00+09:00", end: "2026-11-27T12:00:00+09:00", city: "Tokyo" }), { now: NOW }).day, "Today");
});

test("distance shows only with here, and only when it is near", () => {
  assert.doesNotMatch(verdict(ev(), { now: NOW }).text, /mi/);
  assert.match(verdict(ev(), { now: NOW, here: { lat: 29.75, lng: -95.36 } }).text, /^Today 1pm to 5pm, 0\.9 mi$/);
  assert.match(verdict(ev(), { now: NOW, here: [29.75, -95.36] }).where, /mi$/);
  assert.match(verdict(ev({ approx: true }), { now: NOW, here: [29.75, -95.36] }).where, /^about /);
  assert.equal(verdict(ev(), { now: NOW, here: { lat: 40.7, lng: -74 } }).where, "Houston"); // 1400 mi: the city says more
  assert.equal(verdict(ev(), { now: NOW, here: { lat: 29.75, lng: -95.36 }, distanceKm: () => 1 }).where, "0.6 mi");
  assert.match(rowHtml(ev(), { now: NOW, here: [29.75, -95.36] }), /class="mm-rd">0\.9 mi</);
  assert.doesNotMatch(rowHtml(ev(), { now: NOW }), /mm-rd/);
});

test("drink chips: art by slug, by alias and by '<item> matcha', else a cup", () => {
  assert.equal(drinkSlug("Strawberry Matcha", ART), "strawberry-matcha");
  assert.equal(drinkSlug("matcha latte", ART), "iced-matcha-latte"); // alias
  assert.equal(drinkSlug("strawberry", ART), "strawberry-matcha");
  assert.equal(drinkSlug("hojicha", ART), "hojicha-latte");
  assert.equal(drinkSlug("croissant", ART), "");
  assert.equal(drinkArt("iced matcha", ART, "/"), "/art/drinks/iced-matcha-latte.svg");
  const html = cardHtml(ev({ menu: ["strawberry", "croissant"] }), { now: NOW, art: ART });
  assert.match(html, /<img class="mm-chip-art" src="art\/drinks\/strawberry-matcha\.svg"/);
  assert.match(html, /<svg class="mm-cup"[^]*Croissant/);
});

test("hero: photo over art, then event art, then drawn, then a drink collage", () => {
  const photo = cardHtml(ev({ image: { local: "img/events/aaaaaa000001.jpg", url: "https://cdn.example/p.jpg", credit: "@moonbee" } }), { now: NOW, art: ART });
  assert.match(photo, /mm-hero-photo[^]*class="mm-hero-art" src="art\/events\/aaaaaa000001\.svg"[^]*class="mm-hero-img" src="img\/events\/aaaaaa000001\.jpg" [^>]*data-remote="https:\/\/cdn\.example\/p\.jpg"/);
  assert.match(cardHtml(ev(), { now: NOW, art: ART, base: "/" }), /class="mm-hero mm-hero-art"[^]*src="\/art\/events\/aaaaaa000001\.svg"/);
  assert.match(cardHtml(ev({ id: "bbbbbb000002" }), { now: NOW, art: ART, drawn: { card: () => "<svg id=drawn></svg>" } }), /mm-hero-drawn"><svg id=drawn>/);
  assert.match(cardHtml(ev({ id: "bbbbbb000002" }), { now: NOW }), /mm-hero-collage[^]*mm-sticker">Moonbee</);
  assert.doesNotMatch(cardHtml(ev({ image_url: "javascript:alert(1)" }), { now: NOW }), /javascript:/);
});

test("a card with only a date and a city still has every frame", () => {
  const bare = { id: "cccccc000003", start: "2026-12-06T00:00:00-06:00", all_day: true, city: "Brooklyn", state: "NY" };
  const html = cardHtml(bare, { now: NOW });
  const t = text(html);
  assert.match(t, /^Sun Dec 6 Brooklyn/);
  assert.match(html, /mm-hero-collage/);
  assert.match(t, /Matcha pop-up/);
  assert.match(t, /Unsure/);
  assert.match(t, /Brooklyn, NY/);
  assert.match(html, /href="feeds\/events\/cccccc000003\.ics"/);
  assert.match(html, /href="e\/cccccc000003\/" data-mm-share/);
  assert.match(html, /href="report\/\?event=cccccc000003"/);
  assert.match(t, /Hours All day/);
  for (const k of ["mm-menu", "mm-posts", "mm-story", "mm-nearby", "mm-desc", "undefined", "null", "NaN"]) assert.doesNotMatch(html, new RegExp(k), k);
  assert.doesNotMatch(cardHtml({}, {}), /undefined|NaN/);
  assert.match(rowHtml(bare, { now: NOW }), /Sun Dec 6/);
});

test("approximate place: a gentle note, no Directions", () => {
  const html = cardHtml(ev({ approx: true, venue: "", address: "" }), { now: NOW });
  assert.match(html, /Near Houston/);
  assert.match(html, /Exact spot not posted yet/);
  assert.doesNotMatch(html, /Directions/);
  assert.match(cardHtml(ev(), { now: NOW }), /maps\/dir\/\?api=1&amp;destination=29\.76,-95\.37/);
});

test("facts, confidence, posts and brand story", () => {
  const html = cardHtml(ev({ hours: "10am until sold out", pay: "Cash or Venmo", price: "$6-9", confidence: "likely",
    posts: { instagram: "https://www.instagram.com/p/XYZ/", tiktok: "https://www.tiktok.com/@m/video/1", other: null },
    source_url: "https://www.eventbrite.com/e/1", evidence: ["https://www.instagram.com/p/XYZ/?igsh=1"] }), {
    now: NOW, brands: { brands: [{ handle: "moonbee.matcha", name: "Moonbee Matcha", bio: "Small-batch matcha from Houston.", followers: 4700, home_city: "Houston", home_state: "TX", picture: "https://cdn.example/a.jpg", recent: [] }] },
  });
  const t = text(html);
  assert.match(t, /Hours 10am until sold out/);
  assert.match(t, /Price \$6-9/);
  assert.match(t, /Pay with Cash or Venmo/);
  assert.match(html, /mm-conf-likely" title="The date is posted/);
  assert.equal((html.match(/class="mm-post /g) || []).length, 3); // instagram (deduped with evidence), tiktok, eventbrite
  assert.match(t, /Instagram post TikTok Eventbrite/);
  assert.match(t, /About Moonbee Small-batch matcha from Houston\. Based in Houston, TX · 4\.7k followers/);
  assert.match(html, /mm-avatar[^]*src="https:\/\/cdn\.example\/a\.jpg"/);
});

test("also nearby: upcoming, within 10 km, soonest first, at most three, never itself", () => {
  const me = ev();
  const others = [
    ev({ id: "n00000000001", brand: "Far", lat: 30.3, lng: -97.7 }),
    ev({ id: "n00000000002", brand: "Past", start: "2026-11-20T10:00:00-06:00", end: "2026-11-20T12:00:00-06:00" }),
    ev({ id: "n00000000003", brand: "Later", start: "2026-12-03T10:00:00-06:00", end: null, lat: 29.78 }),
    ev({ id: "n00000000004", brand: "Sooner", start: "2026-11-27T10:00:00-06:00", end: null, lat: 29.77 }),
    ev({ id: "n00000000005", brand: "Cancelled", status: "cancelled" }),
    ev({ id: "n00000000006", brand: "Third", start: "2026-11-29T10:00:00-06:00", end: null }),
    ev({ id: "n00000000007", brand: "Fourth", start: "2026-12-10T10:00:00-06:00", end: null }),
    ev({ id: "n00000000008", brand: "NoCoords", lat: null, lng: null }),
  ];
  const near = alsoNearby(me, { now: NOW, events: [me, ...others] });
  assert.deepEqual(near.map((e) => e.brand), ["Sooner", "Third", "Later"]);
  const html = cardHtml(me, { now: NOW, events: [me, ...others], eventHref: (id) => `/e/${id}/` });
  assert.equal((html.match(/class="mm-row mm-mini/g) || []).length, 3);
  assert.match(html, /href="\/e\/n00000000004\/"/);
  assert.deepEqual(alsoNearby(ev({ lat: null }), { now: NOW, events: others }), []);
});

test("every field is escaped", () => {
  const X = `<img src=x onerror=alert(1)>"'&`;
  const bad = ev({ id: "x\"><script>", brand: X, venue: X, address: X, city: X, state: X, menu: [X], price: X, hours: X, pay: X, description: X, handle: X,
    image: { url: "https://cdn.example/a.jpg\"onerror=\"x", credit: X }, posts: { instagram: "javascript:alert(1)", tiktok: X, other: "https://ok.example/\"><b>" }, source_url: X, evidence: [X] });
  const brands = { brands: [{ handle: X, name: X, bio: X, picture: X, website: "javascript:x", recent: [{ permalink: X, image_url: X }] }] };
  for (const html of [cardHtml(bad, { now: NOW, brands, events: [bad], here: [0, 0], art: ART }), rowHtml(bad, { now: NOW }), brandCardHtml({ handle: X, brand: X, kind: X, home_city: X, website: X, tiktok: X }, [bad], { now: NOW, brands })]) {
    assert.doesNotMatch(html, /<img src=x|<script|<b>|javascript:/i);
    // every tag is well formed: known names, quoted attributes, no event handlers
    for (const [tag] of html.matchAll(/<[^>]*>/g)) {
      assert.match(tag, /^<\/?[a-z][a-z0-9]*((\s+[a-zA-Z][a-zA-Z0-9:-]*(="[^"<>]*")?)*)\s*\/?>$/, tag);
      assert.doesNotMatch(tag.replace(/="[^"]*"/g, ""), /\son[a-z]+/i, tag);
    }
  }
  assert.equal(esc(`<a href="x">'&\``), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#96;");
});

test("brand card: next date, coming up, or no dates", () => {
  const b = { handle: "moonbee.matcha", brand: "Moonbee", kind: "popup", home_city: "Houston", home_state: "TX" };
  const html = brandCardHtml(b, [ev({ start: "2026-11-27T10:00:00-06:00", end: null })], { now: NOW });
  assert.match(text(html), /^Next: Tomorrow from 10am Houston/);
  assert.match(html, /Coming up/);
  assert.match(text(brandCardHtml(b, [], { now: NOW })), /^No dates posted yet/);
});

test("renderCard builds an element through the given document and wires it", () => {
  const made = [];
  const fake = { createElement: () => { const el = { set innerHTML(h) { this.html = h; }, get firstElementChild() { const c = { html: this.html, listeners: [], addEventListener(t) { this.listeners.push(t); } }; made.push(c); return c; } }; return el; } };
  const el = renderCard(ev(), { now: NOW, document: fake });
  assert.match(el.html, /^<article class="mm-card/);
  assert.deepEqual(el.listeners.sort(), ["click", "error"]);
  assert.throws(() => renderCard(ev(), { now: NOW }), /needs a document/);
});
