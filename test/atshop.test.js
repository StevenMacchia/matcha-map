// A pop-up at a shop's address (site/atshop.js): the same spot or the same street address in another spelling pair
// up, a past pop-up and a different street do not; the page loads the module before app.js and the worker precaches it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const w = {};
vm.runInNewContext(fs.readFileSync(path.join(SITE, "atshop.js"), "utf8"), { window: w });
const A = w.MatchaAtShop;

test("atshop: one spelling for a street address", () => {
  assert.equal(A.norm("224 East Hennepin Avenue"), "224 e hennepin ave");
  assert.equal(A.norm("224 E Hennepin Ave"), "224 e hennepin ave");
  assert.equal(A.norm("10250 Santa Monica Blvd Suite 1625"), "10250 santa monica blvd");
  assert.equal(A.norm("10250 Santa Monica Blvd, Los Angeles, CA 90067"), "10250 santa monica blvd");
  assert.equal(A.norm("Hennepin Avenue"), "", "no house number, no match");
  assert.equal(A.norm(""), "");
  assert.equal(A.norm(null), "");
});

test("atshop: pairs by spot or by address, nearest shop first, never a past pop-up", () => {
  const shops = [
    { id: "s1", lat: 44.987698, lng: -93.256485, address: "224 E Hennepin Ave" },
    { id: "s2", lat: 44.9879, lng: -93.2567, address: "230 E Hennepin Ave" }, // about 25 m away: within range, but farther than s1
    { id: "s3", lat: 39.95232, lng: -75.174681, address: "2033 Chestnut Street" },
    { id: "s4", lat: 1, lng: 2, address: "1 Main St" },
  ];
  const events = [
    { id: "e-spot", lat: 44.987698, lng: -93.256485, address: "", status: "upcoming" },
    { id: "e-addr", lat: null, lng: null, address: "2033 Chestnut St, Philadelphia, PA 19103", status: "upcoming" },
    { id: "e-past", lat: 44.987698, lng: -93.256485, address: "224 East Hennepin Avenue", status: "past" },
    { id: "e-far", lat: 44.99, lng: -93.26, address: "500 Central Ave", status: "upcoming" },
    { id: "e-other", lat: 39.95232, lng: -75.174681, address: "", status: "upcoming" },
  ];
  const r = JSON.parse(JSON.stringify(A.pair(events, shops))); // the module runs in its own realm: compare plain values
  assert.deepEqual(r.byEvent, { "e-spot": "s1", "e-addr": "s3", "e-other": "s3" });
  assert.deepEqual(r.byShop, { s1: ["e-spot"], s3: ["e-addr", "e-other"] });
  const J = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(J(A.pair([], shops)), { byEvent: {}, byShop: {} });
  assert.deepEqual(J(A.pair(events, [])), { byEvent: {}, byShop: {} });
  assert.deepEqual(J(A.pair([{ id: "x", lat: "44.9", lng: "-93.2" }], shops).byEvent), {}, "strings are not coordinates");
});

test("the page loads atshop.js before app.js and the worker precaches it", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8"), sw = fs.readFileSync(path.join(SITE, "sw.js"), "utf8");
  const a = html.indexOf('src="atshop.js'), b = html.indexOf('src="app.js');
  assert.ok(a > 0 && b > a, "atshop.js before app.js");
  assert.match(sw, /"\/atshop\.js"/);
});
