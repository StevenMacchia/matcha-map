import test from "node:test";
import assert from "node:assert/strict";
import { hoursFromText } from "../ingest/lib/shops/hours.js";
import { menuLinkOk, imageOk, overtureFacts } from "../ingest/shops-fill.js";
import { attachExtras } from "../ingest/lib/shops/menus.js";
import { report, tally, FIELDS } from "../tools/card-completeness.mjs";

test("plain hours blocks become OpenStreetMap hours; events, ambiguous times and fewer than three days do not", () => {
  assert.equal(hoursFromText(["Hours", "Mon - Fri: 7am - 3pm", "Sat-Sun 8:30 AM – 4 PM"]), "Mo-Fr 07:00-15:00; Sa,Su 08:30-16:00");
  assert.equal(hoursFromText(["Monday", "7am - 3pm", "Tuesday", "7am - 3pm", "Wednesday", "7am - 3pm"]), "Mo-We 07:00-15:00");
  assert.equal(hoursFromText(["Daily 9-5pm"]), "Mo-Su 09:00-17:00");
  assert.equal(hoursFromText(["Mon–Thu 7:00 a.m.–6:00 p.m. | Fri–Sun 8 a.m.–8 p.m."]), "Mo-Th 07:00-18:00; Fr-Su 08:00-20:00");
  assert.equal(hoursFromText(["Join us Sat Nov 28 10am-4pm at the market"]), null);
  assert.equal(hoursFromText(["Open 10-6 every day"]), null);
  assert.equal(hoursFromText(["Saturday 8am-12pm farmers market"]), null);
});

test("menu links stay on the shop's site or its own order page; images never come from social CDNs", () => {
  assert.ok(menuLinkOk("https://shop.example.com/menu", "www.example.com"));
  assert.ok(menuLinkOk("https://order.toasttab.com/online/shop", "example.com"));
  assert.ok(!menuLinkOk("https://other.com/menu", "example.com"));
  assert.ok(!menuLinkOk("javascript:alert(1)", "example.com"));
  assert.ok(imageOk("https://example.com/cdn/hero.jpg"));
  assert.ok(!imageOk("https://scontent.cdninstagram.com/v/x.jpg"));
  assert.ok(!imageOk("https://lh3.googleusercontent.com/x"));
});

test("Overture facts: own website only, Instagram from socials or an Instagram listing, phone", () => {
  assert.deepEqual(overtureFacts({ website: "https://www.instagram.com/koko.matcha/", socials: [], phone: "+15551234567" }), { website: null, instagram: "koko.matcha", phone: "+15551234567" });
  assert.deepEqual(overtureFacts({ website: "https://yelp.com/biz/x", socials: ["https://www.instagram.com/x_cafe"] }), { website: null, instagram: "x_cafe", phone: null });
  assert.equal(overtureFacts({ website: "https://kokomatcha.com/" }).website, "https://kokomatcha.com/");
});

test("overlay fills only empty fields, website included", () => {
  const out = attachExtras([{ id: "a", website: null, phone: "1" }, { id: "b", website: "https://b.com" }], { a: { website: "https://a.com", phone: "2" }, b: { website: "https://other.com" } });
  assert.equal(out[0].website, "https://a.com");
  assert.equal(out[0].phone, "1");
  assert.equal(out[1].website, "https://b.com");
});

test("completeness tally counts each field per group", () => {
  const rows = [{ tier: "shop", state: "NC", website: "w", phone: "p" }, { tier: "serves", state: "NC", website: "w", note: "n" }];
  const t = tally(rows, (s) => s.state).get("NC");
  assert.equal(t.total, 2);
  assert.equal(t.fields.website, 2);
  assert.equal(t.fields.phone, 1);
  assert.equal(t.fields.note, 1);
  assert.ok(report(rows).tier.includes("serves"));
  assert.equal(FIELDS.length, 7);
});

import { normalizeHours } from "../ingest/lib/shops/hours.js";
test("normalizeHours repairs a joined openingHours list and drops what it cannot parse", () => {
  assert.equal(normalizeHours("Mo 08:00-16:00, , We 08:00-16:00"), "Mo 08:00-16:00; We 08:00-16:00");
  assert.equal(normalizeHours("Mo-Fr 07:00-15:00, Sa,Su 08:30-16:00"), "Mo-Fr 07:00-15:00; Sa,Su 08:30-16:00");
  assert.equal(normalizeHours("Mo-Th,Su 12:00-22:30; Fr,Sa 12:00-23:00"), "Mo-Th,Su 12:00-22:30; Fr,Sa 12:00-23:00");
  assert.equal(normalizeHours("Mo-Su 24/7"), null);
  assert.equal(normalizeHours("Mo-Fr 17:00-09:00"), null);
  assert.equal(normalizeHours(null), null);
});
