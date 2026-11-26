// The structured data self-check: the real site passes, and the checker catches the faults Google rejects.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSite } from "../tools/check-jsonld.js";

function site(ld) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-ld-"));
  fs.mkdirSync(path.join(dir, "city", "nc", "raleigh"), { recursive: true });
  fs.writeFileSync(path.join(dir, "city", "nc", "raleigh", "index.html"), `<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  return dir;
}
const good = { "@type": "Event", name: "x", startDate: "2026-12-01T10:00:00-05:00", location: { "@type": "Place", name: "Y" }, image: ["https://a.test/i.png"],
  eventStatus: "https://schema.org/EventScheduled", description: "Moonbee matcha pop-up at Y, Raleigh.", performer: { "@type": "Organization", name: "Moonbee" } };

test("every generated page passes the JSON-LD check (npm run check:jsonld)", () => {
  const { stats, errors } = checkSite();
  assert.deepEqual(errors, []);
  assert.ok(stats.events > 0 && stats.listItems > 0);
});

test("the checker flags ListItem with url and item, a missing list image, bad dates and NaN strings", () => {
  assert.deepEqual(checkSite(site(good)).errors, []);
  const both = { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, url: "https://a.test/e/1/", item: good }] };
  assert.match(checkSite(site(both)).errors.join("\n"), /both url and item/);
  const noImg = { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, item: { ...good, image: undefined } }] };
  assert.match(checkSite(site(noImg)).errors.join("\n"), /without image/);
  assert.match(checkSite(site({ ...good, startDate: "soon" })).errors.join("\n"), /startDate/);
  assert.match(checkSite(site({ ...good, name: "NaN" })).errors.join("\n"), /bad string/);
  assert.match(checkSite(site({ ...good, image: ["/rel.png"] })).errors.join("\n"), /absolute/);
  assert.match(checkSite(site({ ...good, location: {} })).errors.join("\n"), /location/);
});

test("the checker fails an Event without eventStatus, description, image or performer", () => {
  const errs = (x) => checkSite(site(x)).errors.join("\n");
  assert.match(errs({ ...good, eventStatus: undefined }), /without eventStatus/);
  assert.match(errs({ ...good, description: " " }), /without description/);
  assert.match(errs({ ...good, image: undefined }), /without image/);
  assert.match(errs({ ...good, performer: undefined }), /without performer/);
  assert.match(errs({ ...good, performer: { "@type": "Organization" } }), /without performer|Organization without name/);
  // a performer or organizer with no site is fine; a relative one is not
  assert.deepEqual(checkSite(site({ ...good, organizer: { "@type": "Organization", name: "Moonbee" } })).errors, []);
  assert.match(errs({ ...good, performer: { "@type": "Organization", name: "Moonbee", url: "/brand/m/" } }), /url not absolute/);
});

test("the checker holds LocalBusiness, FAQPage, BreadcrumbList and opening hours to the fields Google reads", () => {
  const shop = { "@type": "CafeOrCoffeeShop", name: "Green Cup", url: "https://green.example", address: { "@type": "PostalAddress", streetAddress: "5 Oak St", addressLocality: "Raleigh", addressRegion: "NC" }, geo: { "@type": "GeoCoordinates", latitude: 35.8, longitude: -78.6 },
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["https://schema.org/Monday"], opens: "08:00", closes: "17:00" }] };
  assert.deepEqual(checkSite(site(shop)).errors, []);
  const errs = (x) => checkSite(site(x)).errors.join("\n");
  assert.match(errs({ ...shop, address: { streetAddress: "5 Oak St" } }), /full address/);
  assert.match(errs({ ...shop, geo: undefined }), /without geo/);
  assert.match(errs({ ...shop, aggregateRating: { ratingValue: 5 } }), /rating/);
  assert.match(errs({ ...shop, url: "/rel" }), /url not absolute/);
  assert.match(errs({ ...shop, openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Mo"], opens: "8am", closes: "17:00" }] }), /dayOfWeek[\s\S]*opens\/closes/);
  const faq = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "When?", acceptedAnswer: { "@type": "Answer", text: "Saturday." } }] };
  assert.deepEqual(checkSite(site(faq)).errors, []);
  assert.match(errs({ ...faq, mainEntity: [] }), /without questions/);
  assert.match(errs({ ...faq, mainEntity: [{ "@type": "Question", name: "When?", acceptedAnswer: { "@type": "Answer", text: " " } }] }), /acceptedAnswer/);
  const crumb = { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Matcha Map", item: "https://matchamap.app/" }, { "@type": "ListItem", position: 2, name: "North Carolina", item: "https://matchamap.app/state/nc/" }] };
  assert.deepEqual(checkSite(site(crumb)).errors, []);
  assert.match(errs({ ...crumb, itemListElement: [{ "@type": "ListItem", position: 2, name: "", item: "/state/nc/" }] }), /breadcrumb needs position 1/);
});
