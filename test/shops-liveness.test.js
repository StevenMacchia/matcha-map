import test from "node:test";
import assert from "node:assert/strict";
import { siteSignal, bioSignal, roundupSignal, judgeRow } from "../ingest/shops-liveness.js";

test("site signal: 404 and 410, parked or for-sale pages, a page that says it closed; a normal page and a server error are not signals", () => {
  assert.equal(siteSignal("", 404).why, "own site returns 404");
  assert.equal(siteSignal("", 410).kind, "site");
  assert.match(siteSignal("<html><body><h1>amausaan.us</h1><p>This domain may be for sale. Buy this domain.</p></body></html>", 200).why, /parked/);
  assert.match(siteSignal("<html><body><p>Thank you for 7 amazing years. We have permanently closed.</p></body></html>", 200).why, /says closed/);
  assert.equal(siteSignal("<html><body><p>Open daily 8-5. Closed on Thanksgiving.</p></body></html>", 200), null);
  assert.equal(siteSignal("", 503), null);
  assert.equal(siteSignal("", 403), null);
  // a long page that happens to mention a closure (a blog post) is not the shop saying it closed
  assert.equal(siteSignal("<p>x</p>".repeat(200) + "<p>permanently closed</p>", 200), null);
});

test("Instagram bio signal needs closed-for-good wording, not 'closed Mondays'", () => {
  assert.equal(bioSignal("Matcha bar. Closed Mondays. Open 8-4"), null);
  assert.equal(bioSignal("Temporarily closed for the holidays"), null);
  assert.match(bioSignal("We have closed. Thank you for 5 amazing years").why, /bio says closed/);
  assert.match(bioSignal("PERMANENTLY CLOSED").kind, /instagram/);
  assert.equal(bioSignal(null), null);
});

test("roundup signal matches a closure line that names the shop", () => {
  const closures = [{ line: "Kaya Matcha Cafe has permanently closed after six years, the owners said.", source: "Indy Week", source_url: "https://indyweek.com/x" }];
  assert.equal(roundupSignal({ name: "Kaya Matcha Cafe" }, closures).kind, "roundup");
  assert.equal(roundupSignal({ name: "Kaya Matcha Cafe" }, closures).url, "https://indyweek.com/x");
  assert.equal(roundupSignal({ name: "Other Cafe" }, closures), null);
  assert.equal(roundupSignal({ name: "Kaya" }, closures), null, "a one-word short name is too loose to match");
});

test("one signal sets check, a second different signal sets closed, a hand check wins, two clean runs clear it", () => {
  const site = { kind: "site", why: "own site returns 404" }, bio = { kind: "instagram", why: "Instagram bio says closed" };
  const one = judgeRow(undefined, [site], "2026-11-24");
  assert.equal(one.verdict, "check");
  assert.equal(one.entry.status, "check");
  assert.deepEqual(one.entry.signals, ["site"]);
  assert.match(one.entry.why, /^Check 2026-11-24: own site returns 404/);
  const two = judgeRow(one.entry, [site, bio], "2026-12-01");
  assert.equal(two.entry.status, "closed");
  // same signal twice is still one signal
  assert.equal(judgeRow(one.entry, [site, site], "2026-12-01").entry.status, "check");
  // a hand-checked open row is left alone for 60 days
  const hand = { status: "open", checked: "2026-11-24", checked_by: "hand" };
  assert.equal(judgeRow(hand, [site], "2026-12-20").entry, null);
  assert.equal(judgeRow(hand, [site], "2027-03-01").entry.status, "check");
  // a hand-checked closed row stays closed
  assert.equal(judgeRow({ status: "closed", checked_by: "hand" }, [], "2026-12-20").entry, null);
  // clear after two clean runs
  const c1 = judgeRow(one.entry, [], "2026-12-01");
  assert.equal(c1.verdict, "clearing");
  assert.equal(judgeRow(c1.entry, [], "2026-12-08").entry, "remove");
  // nothing to say about a row that was never flagged
  assert.equal(judgeRow(undefined, [], "2026-12-01").entry, null);
});
