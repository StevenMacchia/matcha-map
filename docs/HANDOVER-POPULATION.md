# Population lane handover (written 2026-11-24, UTC, by the first Population window)

Read with `docs/LANES.md` (the rung loop, merge rules, report shape), `docs/DISCOVERY-RECALL.md`, `docs/OVERTURE.md`, `docs/CASE-STUDIES.md`, `docs/SHOPS-WORKER.md`, `docs/YELP-TERMS.md`. Work happens in the worktree `C:\Users\swoly_uygf8xn\github-portfolio\matcha-map\.claude\worktrees\lane-population-8c0a13` (branch `claude/lane-population-8c0a13`), pushed to `main` by fast-forward after a union merge. Report every landing to the command center (session id `local_d1f85d9d-f384-4538-a08d-93161d64aa6e`, "Matcha popup tracker website"); never ask Steven anything in a box. The session messaging tool pauses after 10 sends since the user last typed: batch messages.

Budget: ceiling 75% all models, stop line 73% (Steven, 2026-11-23). Last reading 65% all models. Check `mcp__ccd_session_mgmt__get_usage` before each worker.

## Where things stand (all on main unless noted)

| Thing | State |
|---|---|
| Shops on the map | 910 (272 core, 638 "matcha on the menu") in 387 cities, 45 states (live on matchamap.app, deployed before the last two commits; city-case fix b3bd66aa and the roundup reader 2b5e4583 ship with the next deploy) |
| Researched shop files | `data/shops-<region>-<part>.json` (about 30 files, hand-research by workers; ids `brand:web-<slug>-<hash>`), read by `ingest/lib/shops/curated.js` |
| Overture core rows | `data/shops-zz-overture-core.json` (171 matcha-named places, 29 Maiko held); rebuild with `node ingest/shops-overture.js --build` |
| Overture serves rows | `data/shops-zz-overture-serves.json` (537 after cleaning), `-serves-proof.json` (83, six proof metros), `-triangle.json` (50, includes 35 "Menu mentions matcha" rows). These are rewritten by `node ingest/shops-overture.js --menus ...` |
| Pop-up rows | Saikō Nov 27 and 28 and amatō Nov 29 (Durham) and Dec 5 (Raleigh) promoted; Triangle pass found nothing else public |
| Held | the 21 Matcha Cafe Maiko rows (all stores reported closed Nov 8; overrides in `data/shops-overrides.json` carry the reason; weekly recheck asked of the Events lane), 7 researched rows that do not geocode |
| Evidence levels on shop rows | `own-site`, `instagram-bio`, `press+site` (verified); `public-page` and `overture` (shown, verified false) |
| Yelp | key in `.env`; leads only, nothing stored, 24 h cache (`docs/YELP-TERMS.md`); daily search handed to the data-owner session's scheduled run (`npm run shops:keyed -- --provider yelp --limit 250`, cursor `.cache/keyed-cursor.json` starting at 285 in the plain checkout); do NOT run `npm run yelp` |
| Foursquare | off, no key, do not ask again |

## What may still be running in the background

1. The national cafe-menu loop: `C:\Users\SWOLY_~1\AppData\Local\Temp\pop\ovloop2.sh` runs six chunks of `node ingest/shops-overture.js --menus --limit 3000 --conc 10`, each followed by the cleaner. Progress: cursor `.cache/overture/2026-11-18.0/menus-cursor.json` (next index into the 153,911 serves candidates; it was 12600 at handover), log `C:\Users\SWOLY_~1\AppData\Local\Temp\pop\ov-menus-loop2.log` (ends with LOOPDONE). Each chunk rewrites `data/shops-zz-overture-serves.json` at its end. If the machine restarted, nothing is running: restart with `node ingest/shops-overture.js --menus --limit 3000 --conc 10` (it resumes at the cursor).
2. Nothing else (the Triangle, proof-metro and Graph-read runs finished).

How to merge the chunks (one landing): `node tools/clean-overture-serves.mjs data/shops-zz-overture-serves.json data/shops-zz-overture-serves-proof.json data/shops-zz-overture-triangle.json` (drops description lines and headings counted as drinks; keeps "Menu mentions matcha" rows with one drink), `npm run shops -- --no-osm --no-brands`, `npm test`, `npm run pages`, `npm run brand-extras`, `npm run sitemap-extras`, `npm run smoke` (the new shop and map gates may fail on dense data: see below), `git add` explicit paths, merge origin/main (resolve generated files by regenerating, geocache by `node tools/merge-state.cjs geocache`), push, `npm run deploy`, then report per state for both tiers. Yield so far: 12,600 sites read, about 10% serves rows for tea rooms and bubble tea, lower for cafes.

## Open items and who owns them

- Seattle review items (`data/review/2026-11-24.json`, from the roundup reader, all "unsure": no street address printed): Muni Cafe at Anh Ơi Bake Shop, Chinatown-International District, Nov 25 and Nov 29; Melon Matcha Nov 26 (venue not printed); Numa Coffee Bar and Seaglass Bakeshop at Driftwood, West Seattle, Nov 26 08:00. Each needs the venue's street address from its own public page (Anh Ơi Bake Shop, Driftwood, Melon Matcha's own site); then set `confidence: "likely"` and promote through `npm run ingest`. Sent to the Events lane's verification path on 2026-11-24.
- Gate failures with dense data (not code): shop gate "no-menu @320" and map gate Manhattan zoom 13; flagged to the site session. The deploys went out anyway.
- Hand-research rows held for geocoding: Matchaful Brookfield Place (250 Vesey St), a Maiko, Nana's Green Tea Seattle, Matsu Matcha, Evolve New Orleans; Nominatim sometimes returns 629, and `data/geocache.json` stores misses for 7 days: delete recent miss entries before retrying.
- The weekly Maiko recheck and the Nakama 2027-07-13 year bug are with the Events lane.

## The Overture incremental step

Release 2026-11-18.0 is pulled (`.cache/overture/2026-11-18.0/places-us.ndjson`, 196 MB, gitignored; 316,000 US food and drink places). New releases come about monthly (list: `https://overturemaps-us-west-2.s3.amazonaws.com/?prefix=release/&delimiter=/`). Step: `node ingest/shops-overture.js --pull --release <new> --build` (re-pull and rebuild the matcha-named core rows), then reset `.cache/overture/<release>/menus-cursor.json` and run `--menus` again; sites already read are served from the 6-hour fetch cache only, so a full re-read is a re-fetch. Each row keeps `overture_id` and `overture_sources` (per-source licenses: CDLA-Permissive-2.0, Apache-2.0); never strip them, and never store a Yelp, Facebook, Instagram, TripAdvisor or ordering-site URL as a shop's website (`ownSite()`).

## The press and newsletter roundup reader

`ingest/lib/sites/roundups.js`, sources in `data/roundups.json` (14 outlets: Let It Simmer, Indy Week, Raleigh Magazine, Triangle on the Cheap, This Is Raleigh, Rough Draft Atlanta, Denverite, Westword, Seattle Met, Eater Seattle, Phoenix Magazine, Dallas Observer, Nashville Scene, Boston Magazine). Run: `npm run discover -- --only roundups --no-social-search`; cadence weekly (Let It Simmer publishes Thursdays), or put it into the daily run. Items go to the review file, ingest promotes "likely" ones. Only Let It Simmer yielded (5 Seattle items); to widen, add outlets by row (any RSS feed with the issue body; Substack feeds carry the whole issue) and a splitter per issue format in `entries()`.

## Case studies and recall

`docs/CASE-STUDIES.md`: 31 of 50 entries (Saikō plus the 30 recall brands). Add one entry per newly found independent brand; at 50 write the analysis (channels ranked by coverage and readability, adapter order, recall against the 60-brand sample), then every 50. It states what the Graph reads today (business and creator accounts on the watch list, about 180 calls an hour, 30 hashtags a week capped and fully used until about Nov 29; not personal accounts, stories, hashtags past the cap). Recall baseline (`docs/DISCOVERY-RECALL.md`, `data/recall/`): 30 brands in 6 metros, 22 with a public dated pop-up, 44 pop-ups, 13 in our data; in our data's window 13 of 18 (72%), 7 of 12 (58%) without amatō's recurring dates; 8 of 30 brands have no public dated page. Weekly metric lives in LADDER.md. After the reset (Friday 2026-11-28 09:00Z) the sample widens to 60 brands in 12 metros (workers pick brands first, check our data second).

## City and state case

`normPlace()` in `ingest/lib/shops/merge.js` title-cases an ALL-CAPS or all-lower-case shop city (CARY became Cary), keeps mixed case and a list of odd names (McLean, La Jolla, ...), forces two-letter upper-case states; tests in `test/shops-curated.test.js` fail on any bad city or state in `data/shops.json`.

## Next rungs, in order

1. Merge the finished cafe-menu chunks (above), report per state for both tiers; continue the loop until the 153,911 candidates are read (about 40 more chunks: this is background work, no worker cost).
2. Promote the Seattle five once the Events lane returns the addresses; run the roundup reader weekly.
3. Hashtag reads for the local tags (#raleighmatcha, #durhammatcha, #ncmatcha, #trianglematcha) when the 30-hashtag allowance frees (about Nov 29): they were never queried; use `data/hashtags.json` `general` list or a one-off harvest.
4. After 2026-11-28 09:00Z: the 60-brand, 12-metro recall re-sample (workers), then the host-venue calendar adapter (Village District, Downtown Raleigh Partnership, RiNo Art District, markets), seeded from hosts our events already name.
5. ma.to completion (every US venue; fix why a read venue page missed Neighbor Matcha Nov 21), then the own-site schedule reader for every brand in `data/sources.json` (the Saikō "Upcoming Events" shape).
6. Overture incremental (monthly), "Report a pop-up we missed" is the site session's, outreach kit CSVs (`data/outreach/`, `npm run outreach`) are with Steven.
