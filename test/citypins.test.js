// City pins (site/citypins.js): one pin per city with anything on at the state and region zooms, merged only when two
// cities sit closer than 30 px at that zoom and never across more than 40 miles. Run on a fixture and on today's data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SITE = path.resolve("site");
const w = {};
vm.runInNewContext(fs.readFileSync(path.join(SITE, "citypins.js"), "utf8"), { window: w });
vm.runInNewContext(fs.readFileSync(path.join(SITE, "cities.js"), "utf8"), { window: w });
const CP = w.MatchaCityPins, CITIES = w.CITIES;

const item = (id, city, state, lat, lng) => ({ key: "e:" + id, ll: [lat, lng], data: { city, state } });
// Six California cities with their rough centres: LA and Monterey Park 7 miles apart, Oakland and SF 10, LA and San Diego 110.
const FIX = [
  item("a1", "Los Angeles", "CA", 34.05, -118.24), item("a2", "Los Angeles", "CA", 34.06, -118.3), item("a3", "Los Angeles", "CA", 34.0, -118.2),
  item("b1", "Monterey Park", "CA", 34.06, -118.12),
  item("c1", "San Diego", "CA", 32.72, -117.16), item("c2", "San Diego", "CA", 32.8, -117.1),
  item("d1", "San Francisco", "CA", 37.78, -122.42), item("d2", "San Francisco", "CA", 37.76, -122.44),
  item("e1", "Oakland", "CA", 37.8, -122.27),
  item("f1", "Sacramento", "CA", 38.58, -121.49),
];

test("fixture: a metro folds into its biggest city at zoom 5 and the suburbs stand on their own by zoom 8", () => {
  // Array.from copies the vm realm's arrays into this one, which deepEqual's prototype check needs
  const z5 = CP.cityPins(FIX, 5, CITIES);
  assert.deepEqual(Array.from(z5, (p) => p.city), ["Los Angeles", "San Francisco", "San Diego", "Sacramento"]);
  const la = z5[0];
  assert.equal(la.n, 4);
  assert.deepEqual(Array.from(la.cities, (c) => c.city), ["Los Angeles", "Monterey Park"]);
  assert.equal(z5[1].n, 3, "Oakland joins San Francisco");
  const z8 = CP.cityPins(FIX, 8, CITIES);
  assert.deepEqual(Array.from(z8, (p) => p.city).sort(), ["Los Angeles", "Monterey Park", "Oakland", "Sacramento", "San Diego", "San Francisco"]);
  for (const p of z8) assert.equal(p.cities.length, 1);
});

test("fixture: the pin sits on the biggest city's own centre, counts add up and keys are kept", () => {
  const z5 = CP.cityPins(FIX, 5, CITIES);
  const la = z5[0];
  assert.ok(CP.miles(la.ll, CITIES["Los Angeles|CA"]) < 1, "on the Census centre of Los Angeles");
  assert.equal(z5.reduce((s, p) => s + p.n, 0), FIX.length);
  assert.deepEqual([...la.keys].sort(), ["e:a1", "e:a2", "e:a3", "e:b1"]);
  // the pins come biggest first and in a stable order
  assert.deepEqual(Array.from(CP.cityPins(FIX.slice().reverse(), 5, CITIES), (p) => p.city), Array.from(z5, (p) => p.city));
});

test("a Census centre far from the city's own pop-ups is not used (San Francisco's is 44 miles out to sea)", () => {
  const sf = CITIES["San Francisco|CA"];
  assert.ok(sf[1] < -122.8, "the data still has the ocean centre this guards against");
  const pins = CP.cityPins([item("d1", "San Francisco", "CA", 37.78, -122.42), item("d2", "San Francisco", "CA", 37.76, -122.44)], 6, CITIES);
  assert.equal(pins.length, 1);
  assert.ok(Math.abs(pins[0].ll[1] - -122.43) < 0.02, "the pin is on the pop-ups, not at sea: " + pins[0].ll);
  // a city with no centre on file also uses its own pop-ups (arrays come from the vm realm, so compare by value)
  const none = CP.cityPins([item("x1", "Nowhere", "ZZ", 40, -100)], 6, CITIES);
  assert.equal(JSON.stringify(none[0].ll), "[40,-100]");
});

test("merge distance: 30 px at the zoom, capped at 40 miles", () => {
  assert.ok(Math.abs(CP.milesPerPx(0, 0) - 24901 / 512) < 0.01);
  assert.equal(CP.mergeMiles(37, 4), 40, "capped far out");
  assert.ok(CP.mergeMiles(37, 5) > 30 && CP.mergeMiles(37, 5) < 40);
  assert.ok(CP.mergeMiles(37, 8) < 5);
  // higher latitudes shrink a pixel, so the merge distance shrinks too
  assert.ok(CP.mergeMiles(47, 6) < CP.mergeMiles(30, 6));
});

// Today's data: every state with pop-ups, zooms 5 to 8.
const today = new Date().toISOString().slice(0, 10);
const events = JSON.parse(fs.readFileSync(path.join(SITE, "data", "events.json"), "utf8")).events
  .filter((e) => e.lat != null && e.lng != null && (e.end || e.start || "") >= today && e.status !== "cancelled");
const items = events.map((e) => ({ key: "e:" + e.id, ll: [e.lat, e.lng], data: e }));
const byState = {};
for (const it of items) (byState[it.data.state] ||= []).push(it);

test("today's data: counts add up, no city is more than 40 miles from its pin, and pins only split as the zoom grows", () => {
  for (const [st, its] of Object.entries(byState)) {
    let last = 0;
    for (const z of [5, 6, 7, 8]) {
      const pins = CP.cityPins(its, z, CITIES);
      assert.equal(pins.reduce((s, p) => s + p.n, 0), its.length, st + " z" + z + " counts");
      for (const p of pins) for (const c of p.cities) assert.ok(CP.miles(p.ll, c.ll) <= 40.01, st + " z" + z + ": " + c.city + " is " + CP.miles(p.ll, c.ll).toFixed(0) + " mi from the " + p.city + " pin");
      assert.ok(pins.length >= last, st + " z" + z + " lost pins");
      last = pins.length;
    }
  }
});

test("today's data: California shows its cities, not two or three clusters", () => {
  const ca = byState.CA || [];
  const cities = new Set(ca.map((it) => it.data.city)).size;
  assert.ok(cities >= 10, "California has at least ten cities with pop-ups today: " + cities);
  const z6 = CP.cityPins(ca, 6, CITIES), z8 = CP.cityPins(ca, 8, CITIES);
  assert.ok(z6.length >= Math.ceil(cities / 2), "zoom 6: " + z6.length + " pins for " + cities + " cities");
  assert.ok(z6.length >= 7, "zoom 6: " + z6.length + " pins");
  assert.ok(z8.length >= cities - 2, "zoom 8: " + z8.length + " pins for " + cities + " cities (only next-door pairs may still share one)");
  for (const p of z6) assert.ok(p.city, "a pin names its city");
});

test("the page loads citypins.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const a = html.indexOf('src="citypins.js'), b = html.indexOf('src="app.js');
  assert.ok(a > 0 && b > a, "citypins.js before app.js");
  assert.match(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"), /"\/citypins\.js"/);
});
