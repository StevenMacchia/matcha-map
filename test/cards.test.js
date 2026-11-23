import test from "node:test";
import assert from "node:assert/strict";
import { cardHtml, rowHtml, brandCardHtml, brandRowHtml, bioLine, citySlug, followersWord, verdict, drinkArt, drinkSlug, alsoNearby, renderCard, esc } from "../site/cards.js";

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
const rowText = (html) => html.replace(/<span class="mm-initial">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
  // the page keeps the big picture; the phone sheet shows the same layers as a strip (photo over art, no blurred copy)
  const strip = cardHtml(ev({ image: { local: "img/events/aaaaaa000001.jpg", url: "https://cdn.example/p.jpg", credit: "@moonbee" } }), { now: NOW, art: ART, phone: true });
  assert.match(strip, /class="mm-strip mm-hero mm-hero-photo"[^]*class="mm-hero-art" src="art\/events\/aaaaaa000001\.svg"[^]*class="mm-hero-img" src="img\/events\/aaaaaa000001\.jpg"/);
  assert.doesNotMatch(strip, /mm-hero-blur/);
  assert.match(cardHtml(ev({ id: "bbbbbb000002" }), { now: NOW, phone: true, drawn: { card: (e, o) => `<svg id=${o.mode}></svg>` } }), /mm-hero-drawn"><svg id=strip>/);
  assert.doesNotMatch(cardHtml(ev(), { now: NOW, phone: false, art: ART }), /mm-hero|mm-strip/, "no photo in the desktop pop-up");
  const photo = cardHtml(ev({ image: { local: "img/events/aaaaaa000001.jpg", url: "https://cdn.example/p.jpg", credit: "@moonbee" } }), { now: NOW, art: ART, page: true });
  assert.match(photo, /mm-hero-photo[^]*class="mm-hero-art" src="art\/events\/aaaaaa000001\.svg"[^]*class="mm-hero-img" src="img\/events\/aaaaaa000001\.jpg" [^>]*data-remote="https:\/\/cdn\.example\/p\.jpg"/);
  assert.match(cardHtml(ev(), { now: NOW, art: ART, base: "/", page: true }), /class="mm-hero mm-hero-art"[^]*src="\/art\/events\/aaaaaa000001\.svg"/);
  assert.match(cardHtml(ev({ id: "bbbbbb000002" }), { now: NOW, art: ART, page: true, drawn: { card: () => "<svg id=drawn></svg>" } }), /mm-hero-drawn"><svg id=drawn>/);
  assert.match(cardHtml(ev({ id: "bbbbbb000002" }), { now: NOW, page: true }), /mm-hero-collage[^]*mm-sticker">Moonbee</);
  assert.doesNotMatch(cardHtml(ev({ image_url: "javascript:alert(1)" }), { now: NOW }), /javascript:/);
});

test("a card with only a date and a city still has every frame", () => {
  const bare = { id: "cccccc000003", start: "2026-12-06T00:00:00-06:00", all_day: true, city: "Brooklyn", state: "NY" };
  const html = cardHtml(bare, { now: NOW });
  const t = text(html);
  assert.match(t, /^Sun Dec 6 Matcha pop-up Date not confirmed When All day Where Brooklyn, NY/); // the sheet: day, name, When and Where
  assert.match(html, /mm-hero-collage/);
  assert.match(t, /Matcha pop-up/);
  assert.match(t, /Date not confirmed/);
  assert.match(t, /Brooklyn, NY/);
  assert.match(html, /href="feeds\/events\/cccccc000003\.ics"/);
  assert.match(html, /href="e\/cccccc000003\/" data-mm-share/);
  assert.match(html, /href="report\/\?event=cccccc000003"/);
  assert.doesNotMatch(t, /Hours/); // an all-day flag alone is no fact box
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
    now: NOW, page: true, brands: { brands: [{ handle: "moonbee.matcha", name: "Moonbee Matcha", bio: "Small-batch matcha from Houston.", followers: 4700, home_city: "Houston", home_state: "TX", picture: "https://cdn.example/a.jpg", recent: [] }] },
  });
  // the sheet and the pop-up fold the hours into When, and the price into the menu heading
  const sheet = text(cardHtml(ev({ hours: "10am until sold out", price: "$6-9", menu: ["latte"] }), { now: NOW, phone: true }));
  assert.match(sheet, /When 1pm to 5pm, until sold out Thu Nov 26/);
  assert.match(sheet, /On the menu · \$6-9/);
  assert.match(text(cardHtml(ev({ all_day: true, start: "2026-11-27T00:00:00-06:00", end: null, hours: "until sold out" }), { now: NOW, phone: false })), /When Until sold out Fri Nov 27/);
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
  assert.match(text(brandCardHtml(b, [], { now: NOW })), /No upcoming dates posted/);
  assert.doesNotMatch(text(brandCardHtml(b, [], { now: NOW })), /^No dates/, "no dates is never the headline");
});

// brands.json records for the brand card and row (2026-11-23: the Raleigh list read as six blank faces)
const FULL_B = { handle: "leafandwhisk", name: "Leaf & Whisk", website: "https://leafandwhisk.example/shop", followers: 12345, kind: "popup",
  bio: "Ceremonial matcha pop-ups across the Triangle. Weekends at the farmers market, weekdays by order.", picture: "https://cdn.example/leaf.jpg",
  home_city: "Raleigh", home_state: "NC",
  recent: [
    { permalink: "https://www.instagram.com/p/AAA/", image_url: "https://cdn.example/a.jpg", caption: "Oldest post", timestamp: "2026-10-01T15:00:00+0000" },
    { permalink: "https://www.instagram.com/p/CCC/", image_url: "https://cdn.example/c.jpg", caption: "Newest post\nsecond line", timestamp: "2026-11-20T15:00:00+0000" },
    { permalink: "https://www.instagram.com/p/BBB/", image_url: "https://cdn.example/b.jpg", caption: "Middle post", timestamp: "2026-11-02T15:00:00+0000" },
  ] };
const SRC_B = { id: "leaf-and-whisk", brand: "Leaf & Whisk", instagram: "leafandwhisk", kind: "popup", home_city: "Raleigh", home_state: "NC", website: null };
const ctxB = (rec) => ({ now: NOW, brands: { brands: [rec] } });

test("brand card with everything: picture, one bio line, kind, @handle, website pill, followers, two latest posts, alerts, claim", () => {
  const html = brandCardHtml(SRC_B, [], ctxB(FULL_B)), t = text(html);
  assert.match(html, /<img src="https:\/\/cdn\.example\/leaf\.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">/);
  assert.match(t, /Leaf &amp; Whisk/);
  assert.match(html, /<p class="mm-bio mm-bio1">Ceremonial matcha pop-ups across the Triangle\.<\/p>/, "the first sentence only");
  assert.match(html, /<span class="mm-kind">pop-up<\/span>/);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/leafandwhisk\/"[^>]*>@leafandwhisk</);
  assert.match(html, /class="mm-webpill" href="https:\/\/leafandwhisk\.example\/shop"[^>]*>.*leafandwhisk\.example</);
  assert.match(t, /12\.3k followers/);
  const posts = [...html.matchAll(/class="mm-rpost" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(posts, ["https://www.instagram.com/p/CCC/", "https://www.instagram.com/p/BBB/"], "the two most recent, newest first");
  assert.match(t, /Nov 20/); assert.match(t, /Nov 2/);
  assert.match(html, /<span class="mm-rsnip">Newest post<\/span>/, "a one-line snippet behind each picture");
  assert.match(html, /href="\/alerts\/\?city=raleigh-nc"[^>]*>.*Get alerts/);
  assert.match(html, /href="\/claim\/\?brand=Leaf%20%26%20Whisk&amp;handle=leafandwhisk"/);
  assert.ok(html.indexOf("mm-recent") < html.indexOf("No upcoming dates posted"), "the no-dates line sits under the posts");
  assert.doesNotMatch(t, /No dates posted here yet/);
  const row = rowText(brandRowHtml(SRC_B, ctxB(FULL_B)));
  assert.equal(row, "Leaf &amp; Whisk pop-up 12.3k followers");
});

test("brand with no picture: the initial, no image, no placeholder text", () => {
  const rec = { ...FULL_B, picture: "", followers: 120 };
  const html = brandCardHtml(SRC_B, [], ctxB(rec));
  assert.doesNotMatch(html, /leaf\.jpg/);
  assert.match(html, /<span class="mm-initial">L<\/span>/);
  assert.doesNotMatch(text(html), /followers|undefined|null/, "120 followers is under the 500 floor");
  const row = brandRowHtml(SRC_B, ctxB(rec));
  assert.match(row, /mm-initial">L</); assert.doesNotMatch(row, /<img/);
  assert.equal(rowText(row), "Leaf &amp; Whisk pop-up Ceremonial matcha pop-ups across the Triangle.", "the bio line when the followers word is empty");
  // a sources.json record with no brands.json match at all
  const bare = brandCardHtml({ id: "habibtea-raleigh", brand: "HabibTea", kind: "tea-brand", home_city: "Raleigh", home_state: "NC", instagram: null }, [], { now: NOW, brands: { brands: [] } });
  assert.doesNotMatch(bare, /instagram\.com|<img|@/);
  assert.match(bare, /href="\/claim\/\?brand=HabibTea"/);
  assert.equal(rowText(brandRowHtml({ id: "habibtea-raleigh", brand: "HabibTea", kind: "tea-brand" }, {})), "HabibTea tea brand");
});

test("brand with no recent posts: no Latest posts section, the no-dates line once", () => {
  const html = brandCardHtml(SRC_B, [], ctxB({ ...FULL_B, recent: [] }));
  assert.doesNotMatch(html, /Latest posts|mm-rpost/);
  assert.equal((text(html).match(/No upcoming dates posted/g) || []).length, 1);
  const noImg = brandCardHtml(SRC_B, [], ctxB({ ...FULL_B, recent: [{ permalink: "https://www.instagram.com/p/X/", image_url: null }] }));
  assert.doesNotMatch(noImg, /mm-rpost/, "a post without an image is left out");
});

test("brand with a long bio: one line, at most 14 words, cut on a word", () => {
  const long = "We are a small family run matcha cart that pops up at markets breweries and bookstores all over the city every single weekend no matter the weather";
  assert.equal(bioLine(long), "We are a small family run matcha cart that pops up at markets breweries…");
  assert.equal(bioLine("Short one! Then more."), "Short one!");
  assert.equal(bioLine(""), "");
  assert.equal(bioLine("Ceremonial grade\n\nmatcha 🍵 | Austin"), "Ceremonial grade matcha 🍵 | Austin");
  const html = brandCardHtml(SRC_B, [], ctxB({ ...FULL_B, bio: long }));
  const line = /<p class="mm-bio mm-bio1">([^<]*)<\/p>/.exec(html)[1];
  assert.ok(line.replace(/…$/, "").split(" ").length <= 14);
  assert.equal(citySlug("St. Louis", "MO"), "st-louis-mo");
  assert.equal(citySlug("Washington", "DC"), "washington-dc");
  assert.equal(followersWord(501), "501 followers"); assert.equal(followersWord(500), ""); assert.equal(followersWord(1200000), "1.2M followers");
});

test("brand card: the menu from data/menus.json after the dates, only when the website host has one", async () => {
  const menus = JSON.parse((await import("node:fs")).readFileSync(new URL("../site/data/menus.json", import.meta.url), "utf8"));
  const host = Object.keys(menus.menus).find((h) => menus.menus[h].items.length > 8);
  const m = menus.menus[host];
  const b = { handle: "moonbee.matcha", brand: "Moonbee", kind: "popup", home_city: "Houston", home_state: "TX", website: "https://www." + host + "/" };
  const html = brandCardHtml(b, [ev({ start: "2026-11-27T10:00:00-06:00", end: null })], { now: NOW, menus });
  assert.match(html, /<section class="mm-sec mm-menu-sec" aria-label="Menu">/);
  assert.equal((html.match(/class="mm-menu-item"/g) || []).length, 8, "eight lines");
  assert.ok(html.indexOf("Coming up") < html.indexOf("mm-menu-sec") && html.indexOf("mm-menu-sec") < html.indexOf("class=\"mm-acts\""), "after the dates, before the links");
  assert.match(text(html), new RegExp("See the full menu From " + host.replace(/./g, "\.") + ", read "));
  if (m.items[0].price) assert.ok(text(html).includes(m.items[0].price.trim()), "the price as written");
  const none = brandCardHtml({ ...b, website: "https://no-menu.example/" }, [], { now: NOW, menus });
  assert.doesNotMatch(none, /mm-menu/, "no menu, no section");
  assert.doesNotMatch(brandCardHtml(b, [], { now: NOW }), /mm-menu/, "menus.json absent");
});

test("renderCard builds an element through the given document and wires it", () => {
  const made = [];
  const fake = { createElement: () => { const el = { set innerHTML(h) { this.html = h; }, get firstElementChild() { const c = { html: this.html, listeners: [], addEventListener(t) { this.listeners.push(t); } }; made.push(c); return c; } }; return el; } };
  const el = renderCard(ev(), { now: NOW, document: fake });
  assert.match(el.html, /^<article class="mm-card/);
  assert.deepEqual(el.listeners.sort(), ["click", "error"]);
  assert.throws(() => renderCard(ev(), { now: NOW }), /needs a document/);
});

test("description loses markdown markers; list row name sits in its own ellipsis span", () => {
  const html = cardHtml(ev({ description: "**Event Details** ***menu*** `x`" }), { now: NOW });
  assert.ok(!html.includes("**"));
  assert.match(html, /<p class="mm-q-text">Event Details menu x<\/p>/);
  assert.match(cardHtml(ev({ description: "**Event Details** ***menu*** `x`" }), { now: NOW, page: true }), /<p class="mm-desc">Event Details menu x<\/p>/);
  assert.match(rowHtml(ev(), { now: NOW }), /<span class="mm-rname">Moonbee<\/span>/);
});


test("the desktop map pop-up is the compact card: fewer posts and neighbours; pages and the phone sheet are not", () => {
  const me = ev({ lat: 40.7, lng: -74 });
  const others = [1, 2, 3].map((i) => ev({ id: "dddddd00000" + i, lat: 40.7 + i * 0.001, lng: -74, brand: "Other " + i, posts: {} }));
  const html = cardHtml(me, { now: NOW, phone: false, events: [me, ...others] });
  assert.match(html, /class="mm-card mm-compact /);
  assert.ok((html.match(/class="mm-row mm-mini/g) || []).length <= 2, "two neighbours at most");
  assert.ok((html.match(/class="mm-post /g) || []).length <= 2, "two posts at most");
  assert.doesNotMatch(cardHtml(me, { now: NOW, page: true, events: [me, ...others] }), /mm-compact/);
  assert.doesNotMatch(cardHtml(me, { now: NOW, phone: true, events: [me, ...others] }), /mm-compact/);
  assert.doesNotMatch(cardHtml(me, { now: NOW }), /mm-compact/);
});

test("links in: the foot links to the city page and the brand name to its brand page, only when the page exists", () => {
  const e = { id: "aaaaaa000001", brand: "Moonbee", handle: "moonbee", start: "2026-12-05T11:00:00-05:00", city: "Raleigh", state: "NC", lat: 35.8, lng: -78.6, menu: [] };
  const on = cardHtml(e, { base: "/", page: true, cityHref: () => ({ href: "/city/nc/raleigh/", name: "Raleigh" }), brandHref: (h) => (h === "moonbee" ? "/brand/moonbee/" : "") });
  assert.match(on, /<a class="mm-report mm-morecity" href="\/city\/nc\/raleigh\/"><span>More in Raleigh<\/span><\/a>/);
  assert.match(on, /<a class="mm-bname-link" href="\/brand\/moonbee\/">Moonbee<\/a>/);
  assert.match(on, /Report a problem/);
  const plain = cardHtml(e, { base: "/", page: true, cityHref: () => "", brandHref: () => "" });
  assert.doesNotMatch(plain, /mm-morecity|mm-bname-link/);
  assert.doesNotMatch(cardHtml(e, { base: "/", page: true }), /mm-morecity|mm-bname-link/);
  assert.match(cardHtml(e, { cityHref: () => "/city/nc/raleigh/" }), /More in Raleigh/, "a plain string works and takes the event's city name");
});
