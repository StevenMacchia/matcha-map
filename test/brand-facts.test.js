// tools/apply-brand-facts.js: fills only empty source fields, idempotent.
import test from "node:test";
import assert from "node:assert/strict";
import { applyFacts } from "../tools/apply-brand-facts.js";

const facts = () => ({
  generated: "2026-11-22",
  brands: {
    "a-matcha": { story: "Two sentences.", signature_drinks: ["Honey Matcha"], price_range: "$6 to $9", pay: "card", typical_hours: "9 to 1", website: "https://a.example", linktree: null, tiktok: "amatcha", evidence: ["https://a.example"], confidence: "high" },
    "ghost": { story: "x" },
  },
});
const sources = () => [{ id: "a-matcha", brand: "A", website: "https://own.example", tiktok: null, about: "" }, { id: "b", brand: "B" }];

test("fills empty fields, keeps existing ones", () => {
  const s = sources();
  const r = applyFacts(s, facts());
  assert.equal(s[0].about, "Two sentences.");
  assert.equal(s[0].website, "https://own.example");
  assert.equal(s[0].tiktok, "amatcha");
  assert.equal(s[0].hours_note, "9 to 1");
  assert.deepEqual(s[0].signature_drinks, ["Honey Matcha"]);
  assert.ok(!("linktree" in s[0]));
  assert.deepEqual(r.missing, ["ghost"]);
  assert.equal(r.touched, 1);
});

test("idempotent", () => {
  const s = sources();
  applyFacts(s, facts());
  const snap = JSON.stringify(s);
  const r = applyFacts(s, facts());
  assert.equal(JSON.stringify(s), snap);
  assert.equal(r.touched, 0);
});
