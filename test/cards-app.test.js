// The live app's cards link to the city and brand pages that exist (data/pages.json), like the static pages do.
import test from "node:test";
import assert from "node:assert/strict";

const PAGES = { cities: [{ p: "nc/raleigh", n: "Raleigh", s: "NC", la: 35.78, lo: -78.64 }, { p: "nc/cary", n: "Cary", s: "NC", la: 35.79, lo: -78.78 }], brands: ["moonbee"] };

test("cards-app: cityHref and brandHref use only pages that exist", async () => {
  const listeners = [];
  globalThis.window = {};
  globalThis.document = { documentElement: {}, addEventListener: (...a) => listeners.push(a) };
  globalThis.fetch = async (u) => ({ ok: /pages\.json$/.test(u), json: async () => PAGES });
  const m = await import("../site/cards-app.js?t=" + Date.now());
  await globalThis.window.MatchaCards.ready;
  assert.deepEqual(m.cityHref({ city: "Raleigh", state: "NC" }), { href: "/city/nc/raleigh/", name: "Raleigh" });
  assert.deepEqual(m.cityHref({ city: "Garner", state: "NC", lat: 35.77, lng: -78.62 }), { href: "/city/nc/raleigh/", name: "Raleigh" }, "nearest city page within 25 km");
  assert.equal(m.cityHref({ city: "Charlotte", state: "NC", lat: 35.2, lng: -80.8 }), "", "too far");
  assert.equal(m.cityHref({ city: "Raleigh", state: "VA" }), "", "state must match");
  assert.equal(m.brandHref("@MoonBee"), "/brand/moonbee/");
  assert.equal(m.brandHref("nobody"), "");
  const html = globalThis.window.MatchaCards.render({ kind: "e", data: { id: "abcdef123456", brand: "Moonbee", handle: "moonbee", title: "Pop-up", start: "2099-01-02T10:00:00-05:00", city: "Raleigh", state: "NC", tz: "America/New_York" } }, {});
  assert.match(html, /More in Raleigh/);
  assert.match(html, /href="\/city\/nc\/raleigh\/"/);
  assert.match(html, /mm-bname-link" href="\/brand\/moonbee\/"/);
});
