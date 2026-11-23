import { test } from "node:test";
import assert from "node:assert/strict";
import { hoursFromLd, facts } from "../ingest/shops-deepen.js";
import { attachExtras } from "../ingest/lib/shops/menus.js";
import { readSite } from "../ingest/menus.js";

test("opening hours come only from JSON-LD and are written in the shop rows' style", () => {
  assert.equal(hoursFromLd({ openingHoursSpecification: [
    { dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], opens: "10:00", closes: "17:00" },
    { dayOfWeek: "https://schema.org/Sunday", opens: "13:00", closes: "17:00" }] }), "Mo-Sa 10:00-17:00; Su 13:00-17:00");
  assert.equal(hoursFromLd({ openingHours: ["Mo-Fr 08:00-18:00", "Sa 09:00-14:00"] }), "Mo-Fr 08:00-18:00; Sa 09:00-14:00");
  assert.equal(hoursFromLd({ name: "no hours" }), null);
});

test("facts: phone, Instagram handle, photo and menu link from a shop page; post links and bad numbers are ignored", () => {
  const html = `<html><head><meta property="og:image" content="/img/shop.jpg"><script type="application/ld+json">${JSON.stringify({ "@type": "CafeOrCoffeeShop", telephone: "+1 919-555-0142", sameAs: ["https://www.instagram.com/p/abc/", "https://www.instagram.com/littlefootmatcha/"], openingHours: "Mo-Sa 10:00-17:00" })}</script></head><body><a href="/pages/menu">Our menu</a><a href="tel:12">x</a></body></html>`;
  const f = facts(html, "https://shop.example/");
  assert.equal(f.phone, "+1 919-555-0142");
  assert.equal(f.instagram, "littlefootmatcha");
  assert.equal(f.hours, "Mo-Sa 10:00-17:00");
  assert.equal(f.image_url, "https://shop.example/img/shop.jpg");
  assert.equal(f.menu_link, "https://shop.example/pages/menu");
  assert.equal(facts("<html><a href=\"tel:12\">x</a></html>", "https://a.example/").phone, null);
});

test("attachExtras fills only the empty fields of a row", () => {
  const out = attachExtras([{ id: "a", phone: "111", opening_hours: null, image_url: null }, { id: "b" }], { a: { phone: "999", opening_hours: "Mo 09:00-10:00", image_url: "https://x/y.jpg", image_credit: "x", read: "2026-11-23", source_url: "https://x" } });
  assert.equal(out[0].phone, "111");
  assert.equal(out[0].opening_hours, "Mo 09:00-10:00");
  assert.equal(out[0].image_credit, "x");
  assert.deepEqual(out[1], { id: "b" });
});

test("title-case names with a one-sentence description and section headings between items", async () => {
  const html = "<p>FALL SPECIAL</p><p>Matcha</p><p>Strawberry Matcha Latte</p><p>Matcha and milk layered with puree.</p><p>$6.85</p><p>Classics</p><p>Matcha Latte</p><p>$6.00</p><p>Our Gallery</p>";
  const m = await readSite({ get: async () => ({ ok: true, text: html }) }, { host: "x.test", urls: ["https://x.test/"], mode: "nameSentencePrice", start: /^FALL SPECIAL$/, end: /^Our Gallery$/ }, "2026-11-23");
  assert.deepEqual(m.items.map((i) => [i.name, i.price]), [["Strawberry Matcha Latte", "$6.85"], ["Matcha Latte", "$6.00"]]);
});
