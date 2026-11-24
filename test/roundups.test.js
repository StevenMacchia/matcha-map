import test from "node:test";
import assert from "node:assert/strict";
import { entries, brandFromEntry, brandFromLine, bodyItems, archiveLinks, loadRoundups } from "../ingest/lib/sites/roundups.js";

const ISSUE = "<p>Welcome to the weekly roundup. PIZZA, BREAD &amp; COOKIES | SODO — Good Luck Bread hosts a bake sale every weekend with focaccia. Saturdays, 12-4pm at 3810 Airport Way South #110 . " +
  "MATCHA &amp; HOJICHA | FREMONT — Nicho’s Matcha Cafe is popping up in Fremont with a collab menu at Snow Peak serving honey whip yuzu matcha. This week try the persimmon matcha. Sat 12/05, 11am-3pm at Snow Peak . " +
  "ICE CREAM | ROOSEVELT — Don Pepé Ice Cream Co. is popping up for a party. Sat 12/05, 4pm at Human People Beer . " + "x".repeat(600) + "</p>";

test("roundups: a long one-paragraph issue is split into its CATEGORY | PLACE — entries", () => {
  const parts = entries([ISSUE.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")]);
  assert.ok(parts.length >= 3);
  assert.ok(parts.some((p) => p.startsWith("MATCHA & HOJICHA | FREMONT")));
});

test("roundups: the brand is read from the entry head, never from a generic or date start", () => {
  assert.equal(brandFromEntry("MATCHA & HOJICHA | FREMONT — Nicho’s Matcha Cafe is popping up in Fremont with a collab menu"), "Nicho’s Matcha Cafe");
  assert.equal(brandFromLine("Saikō Matcha House at The Village District, Sat 11/28"), "Saikō Matcha House");
  assert.equal(brandFromLine("This week in matcha: nothing"), null);
  assert.equal(brandFromLine("Saturday 11/28 matcha pop-up"), null);
});

test("roundups: bodyItems keeps only matcha entries that name a brand, with the outlet's city", () => {
  const items = bodyItems(ISSUE, { link: "https://x.example/p/1", published: "2026-12-03T12:00:00Z", title: "This Week" }, { name: "Let It Simmer", url: "https://x.example/feed", city: "Seattle", state: "WA" });
  assert.equal(items.length, 1);
  assert.equal(items[0].organizer.name, "Nicho’s Matcha Cafe");
  assert.equal(items[0].feed.city, "Seattle");
  assert.equal(items[0].published_at, "2026-12-03T12:00:00Z");
});

test("roundups: archive links come from /p/ paths, and the source list is a file of feeds", () => {
  const links = archiveLinks('<a href="/p/issue-one">1</a><a href="https://x.example/p/issue-two">2</a><a href="/about">a</a><a href="/p/issue-one">dup</a>', "https://x.example/archive");
  assert.deepEqual(links, ["https://x.example/p/issue-one", "https://x.example/p/issue-two"]);
  assert.ok(loadRoundups().length >= 10);
});
