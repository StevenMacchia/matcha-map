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
const good = { "@type": "Event", name: "x", startDate: "2026-12-01T10:00:00-05:00", location: { "@type": "Place", name: "Y" }, image: ["https://a.test/i.png"] };

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
