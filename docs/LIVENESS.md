# Closed-shop liveness check

`npm run shops:liveness` (`ingest/shops-liveness.js`, tests `test/shops-liveness.test.js`). Weekly; Mondays is the intended day (not yet wired into `ingest/daily.js`: that file and its step-list test are the data session's). Read-only on the web: public pages already allowed by robots.txt, the Graph bios we already hold in `data/watchlist.json`, and `data/roundup-closures.json` (closure lines the roundup reader keeps, `ingest/lib/sites/roundups.js` `closureLines`). It never fetches Instagram.

## Signals (a shop is judged by distinct kinds, not by how many times one fires)

| Kind | Fires when |
|---|---|
| `site` | the shop's own website returns 404 or 410 (a deep link is judged by its origin), its domain does not resolve, the page is parked or for sale (short page with parked wording), or a short page says it permanently closed |
| `instagram` | the bio read through the Graph says closed for good ("permanently closed", "we have closed", "thank you for 7 years"; "closed Mondays" and "temporarily closed" do not count) |
| `roundup` | a press or newsletter roundup line reporting a closure names the shop |

## What it does to a row (`data/shops-overrides.json`, keyed by shop id)

- One signal: `status: "check"`, `signals`, `check_reason`, `checked` (date), `checked_by: "liveness"` and a `why` line. The pin stays on the map.
- A second, different signal: `status: "closed"`. The row stays in `data/shops.json` (the step keeps watching it) and is left out of `site/data/shops.json` (`ingest/shops.js`).
- A hand check ends it: set `status` to `"open"` (not flagged again for 60 days) or `"closed"` with `checked_by: "hand"` and a `why`.
- Two clean runs in a row clear a machine flag. Hand checks are never overwritten.

The latest run is in `data/shops-liveness.json`. The held Matcha Cafe Maiko rows get the same page test as `npm run shops:recheck` (reported, never flipped).

## First run, 2026-11-24 (1,269 rows judged: every row the site draws, 1,231 with a website)

Flagged 8 with one signal, none closed: Amausaan Uji Matcha (Union City, Newark, Daly City CA) and Sip Matcha (Rowland Heights CA), Ms. Matcha (Washington DC), Matcha Boba (Thousand Oaks CA), Matcha Boba House (Ashland OR): the website's domain no longer resolves. Taiyo Matcha (Jacksonville FL): the site returns 404. Web searches found no closure report for Amausaan, Sip Matcha, Ms. Matcha or Taiyo Matcha (Matcha Boba and Matcha Boba House were not searched); Taiyo Matcha was hand-checked (MapQuest, Crema and Poyst list 10095 Beach Blvd open) and marked `open` for 60 days. 11 sites were unreadable (network errors, no signal). 17 Instagram bios were available (only those on the Graph watch list) and none said closed. The roundup closure list was empty (the reader has not run with the new capture yet).

Matcha Cafe Maiko: 21 held rows, the site `www.matchacafe-maiko.com` is up and readable, prints no "Matcha Toko", no date after 2026-11-08 and no closed wording. They stay held (the closure reports are Sacramento press of Nov 9 and 16, see data/maiko-check-2026-11-23.json); nothing on the page shows a store open.
