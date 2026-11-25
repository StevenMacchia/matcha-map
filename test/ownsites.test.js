import test from "node:test";
import assert from "node:assert/strict";
import * as os from "../ingest/lib/sites/ownsites.js";
import { NAMES } from "../ingest/lib/sites/index.js";

const NOW = new Date("2026-11-25T15:00:00Z");
const saiko = { id: "saiko-matcha-house", brand: "Saikō Matcha House", kind: "popup", home_city: "Raleigh", home_state: "NC", website: "https://www.saikomatchahouse.com/", instagram: "saikomatchahouse", active: true };

const PAGE = `<html><body><header><nav><a href="/">Home</a> <a href="/events">Events</a> <a href="/shop">Shop</a></nav></header>
<h1>Saikō Matcha House</h1><p>Ceremonial first-harvest matcha, made in Raleigh.</p>
<h2>Upcoming Events</h2>
<p>Nov 27, 10am-2pm</p><p>MODE, The Village District, 1832 Cameron St, Raleigh</p>
<p>Nov 28, 11am-3pm</p><p>Maeve, The Village District, Raleigh</p>
<h2>About</h2><p>Founded in 2024. Our spring sale ends Dec 31.</p>
<footer>Posted Oct 3 on the journal. Copyright 2026</footer></body></html>`;

test("an Upcoming Events block gives one item per dated line, with the venue line and the brand's handle; dates outside the block are not events", () => {
  const items = os.readOwnPage(PAGE, saiko, "https://www.saikomatchahouse.com/", NOW);
  assert.equal(items.length, 2);
  assert.match(items[0].text, /Nov 27, 10am-2pm/);
  assert.match(items[0].text, /MODE, The Village District/);
  assert.match(items[1].text, /Nov 28/);
  assert.match(items[1].text, /Maeve/);
  assert.ok(items.every((i) => i.handle === "saikomatchahouse" && i.source_hint === saiko && i.maxAheadDays === 60));
  assert.ok(!items.some((i) => /Dec 31|Oct 3|Copyright/.test(i.text)));
});

test("a page with no events heading, or a heading with nothing dated under it, gives nothing", () => {
  assert.deepEqual(os.readOwnPage("<h1>Shop</h1><p>Order by Nov 30 for holiday delivery</p>", saiko, "https://x.com/", NOW), []);
  assert.deepEqual(os.readOwnPage("<h2>Upcoming Events</h2><p>Nothing scheduled right now. Follow us for news.</p><h2>About</h2><p>Nov 30 we opened</p>", saiko, "https://x.com/", NOW), []);
});

test("which sources are read, and which links lead to an events page", () => {
  assert.equal(os.ownSiteUrl(saiko), "https://www.saikomatchahouse.com/");
  assert.equal(os.ownSiteUrl({ ...saiko, schedule_kind: "website", schedule_url: "https://www.saikomatchahouse.com/" }), null);
  assert.equal(os.ownSiteUrl({ ...saiko, website: "https://linktr.ee/saiko" }), null);
  assert.equal(os.ownSiteUrl({ ...saiko, website: "https://www.instagram.com/saiko/" }), null);
  assert.equal(os.ownSiteUrl({ ...saiko, active: false }), null);
  assert.equal(os.ownSiteUrl({ ...saiko, website: null }), null);
  assert.deepEqual(os.eventLinks(PAGE, "https://www.saikomatchahouse.com/"), ["https://www.saikomatchahouse.com/events"]);
  assert.deepEqual(os.eventLinks('<a href="https://other.com/events">Events</a><a href="/logo.png">Events</a>', "https://x.com/"), []);
});

test("discover reads the home page and the events page it links, honours robots.txt, and registers as a site", async () => {
  const pages = {
    "https://www.saikomatchahouse.com/robots.txt": "User-agent: *\nAllow: /\n",
    "https://www.saikomatchahouse.com/": `<a href="/events">Events</a><p>Welcome</p>`,
    "https://www.saikomatchahouse.com/events": PAGE,
  };
  const asked = [];
  const fetcher = { get: async (u) => { asked.push(u); return pages[u] != null ? { ok: true, status: 200, text: pages[u] } : { ok: false, status: 404, text: "" }; } };
  const out = await os.discover({ fetcher, sources: [saiko, { ...saiko, id: "x", website: "https://linktr.ee/x" }], now: NOW });
  assert.equal(out.items.length, 2);
  assert.equal(out.stats.sources, 1);
  assert.deepEqual(asked, ["https://www.saikomatchahouse.com/robots.txt", "https://www.saikomatchahouse.com/", "https://www.saikomatchahouse.com/events"]);
  const closed = await os.discover({ fetcher: { get: async (u) => (/robots/.test(u) ? { ok: true, status: 200, text: "User-agent: *\nDisallow: /\n" } : { ok: true, status: 200, text: PAGE }) }, sources: [saiko], now: NOW });
  assert.equal(closed.items.length, 0);
  assert.ok(NAMES.includes("ownsites"));
});
