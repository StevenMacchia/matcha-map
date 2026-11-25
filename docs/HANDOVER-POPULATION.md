# Population lane handover (third window, written 2026-11-25, UTC, by the third Population window)

Read with `docs/LANES.md` (the rung loop, merge rules, report shape), `docs/DISCOVERY-RECALL.md`, `docs/OVERTURE.md`, `docs/CASE-STUDIES.md`, `docs/SHOPS-WORKER.md`, `docs/YELP-TERMS.md`, `docs/CARD-COMPLETENESS.md`, `docs/HOSTED-MENUS.md`, `docs/LIVENESS.md`. This window worked in `C:\Users\swoly_uygf8xn\github-portfolio\matcha-map\.claude\worktrees\lane-population-3-c384cc` (branch `claude/lane-population-3-c384cc`, pushed to `main` by fast-forward). Report every landing to the command center (session id `local_d1f85d9d-f384-4538-a08d-93161d64aa6e`); never ask Steven anything in a box. Writing to a Windows path with the Bash tool halves backslashes in heredocs (a `\b` became a backspace character in a regex this window): write code with the Write or Edit tool, and run `cat >` only with a closed heredoc (a bare `cat > file` waits on stdin and hangs the tool).

Budget: Steven's ceiling 80% of the weekly all-models window, stop line 78%. Reading at the start and at the end of this window: 73% all models (Fable 82%); the window stopped for lack of rungs, not budget. Weekly reset 2026-11-28 09:00Z.

## Where things stand (all on main)

| Thing | State |
|---|---|
| Shops on the map | 3,885 rows the site draws (276 core, 3,609 matcha on the menu), 51 states plus DC, up from 1,651 at the start of the window; 3,937 kept in `data/shops.json` (52 unverified, data only). Live on matchamap.app (see `node tools/card-completeness.mjs`) |
| Cafe-menu loop | **finished**: cursor 153,911 of 153,911 (`.cache/overture/2026-11-18.0/menus-cursor.json`, in this worktree). The cursor wraps to 0 if the loop is run again, which only re-reads the same release's sites; a new pass needs the next Overture release (monthly) |
| Rows from the loop | `data/shops-zz-overture-serves.json`: 3,575 rows (cleaned by `tools/clean-overture-serves.mjs`); plus NC, Triangle and proof files |
| PDF menus | read now (`ingest/lib/shops/pdf-menus.js`, `docs/HOSTED-MENUS.md`): +37 rows nationally, Triangle +0; 1,653 PDF links point at dead hosts |
| Picture-only menus | 11,086 counted per metro and state in `docs/HOSTED-MENUS.md`; not read (no OCR) |
| Liveness | 2nd run 2026-11-25: 3,867 rows, 11 `check`, 0 closed (`docs/LIVENESS.md`); not yet wired into `ingest/daily.js` |
| Geocode | held: 2 Matcha Cafe Maiko rows (closed hold), 1 row with no city (Manzil Cafe, 3010 NJ-27, zip 08824: no city printed anywhere we hold; OpenStreetMap or a reverse geocode of its pin would give it) |
| Held | 21 Matcha Cafe Maiko rows (all stores reported closed Nov 8) |
| Yelp / Foursquare | unchanged: Yelp leads only (do NOT run `npm run yelp`); Foursquare is off, do not ask again |

## Per state, before and after this window (rows the site draws)

AK 4>7, AL 9>13, AR 7>23, AZ 25>67, CA 634>1106, CO 31>73, CT 5>26, DC 9>33, DE 0>3, FL 74>192, GA 32>89, HI 18>28, IA 4>27, ID 3>10, IL 61>155, IN 3>25, KS 5>20, KY 4>16, LA 8>25, MA 25>103, MD 14>45, ME 2>8, MI 10>98, MN 19>42, MO 7>33, MS 2>7, MT 3>5, NC 104>106, ND 1>6, NE 9>16, NH 2>14, NJ 23>99, NM 11>17, NV 29>54, NY 113>362, OH 15>100, OK 7>22, OR 30>64, PA 24>126, RI 0>13, SC 12>30, SD 1>5, TN 16>34, TX 120>257, UT 15>26, VA 31>85, VT 2>4, WA 60>115, WI 7>38, WV 1>9, WY 0>4 (total 1,651 > 3,885). Triangle unchanged by this window (the NC pass had landed it): Raleigh 19, Cary 12, Durham 7, Apex 4, Chapel Hill 4.

## What this window did (each its own landing, on main)

1. **Menu loop landed** (commit 57e270d90): cleaner, `shops`, `shops:fill`, pages, brand extras, smoke, card, shop, map gates; 1,651 > 3,830. Rows with no city now take it from their own address line; a state field carrying an address tail still gives the state (`checkRow`, tests added).
2. **PDF menu reader** (05e0a80ce): `pdf-menus.js`, `pdfjs-dist` added to `package.json`; national re-run from the previous window's fetch cache, no crawl; +37 rows. New flags on `node ingest/shops-overture.js --menus`: `--all` (every candidate, no cursor), `--shard i/n`, `--cache-dir <old .cache>` (pages from a cache, only PDFs downloaded), `--ids file.json`, `--held-out file.json` (every held candidate with its reason), `--no-pdf`.
3. **Picture menus counted** per metro (same commit; `docs/HOSTED-MENUS.md`).
4. **Liveness** second run, the last 3,311 loop candidates (cursor to the end, +18 rows), the hours re-read (`shops:fill -- --sites --blank-hours`; +10 hours, 574 hosts answer 429 each time), and the held-row fixes: this landing.

5. **Own-site schedule reader** (`ingest/lib/sites/ownsites.js`, `test/ownsites.test.js`, review-only; notes in `docs/DISCOVERY-YIELD.md`): reads the "Upcoming Events" block of the 14 sources' own websites that the website adapter does not read; 2 finds on its first run (Littlefoot Matcha), 13 sources print no events block. Code only, no site change, so no deploy.

## Findings worth keeping

- The previous window's fetch cache (`C:\Users\swoly_uygf8xn\github-portfolio\matcha-map\.claude\worktrees\lane-population-2-1ece53\.cache`, 373,000 pages, 6 hour TTL ignored with `noFetch`) turns any new reader over the cafe pages into a ten-minute offline pass (14 shards at once on 32 cores). Keep that folder until the picture-menu decision is made; it is gitignored and not on main.
- PDF yield is small: of ~3,700 menu PDFs, 59 listed matcha, 37 survived the name rules. 1,523 have no matcha drink, 348 are scans, 1,653 are links to domains that no longer resolve.
- Hours is the card's biggest blank (30%). The own-site reader cannot get past 429 hosts (574) and does not read hours from images, Google or script widgets. Do not guess.
- The social overflow gate and two events tests (zone, review queue 47 open) failed in this worktree at first; after merging the data session's fix to main only the events zone test and the review-queue test remain, both the events lane's.
- `ownSite()` lets `*.square.site` through and rejects Toast; Toast reads nothing anywhere (2,722 bot checks, 1,546 not cached, 492 robots disallow): do not try to get around it.
- Square answers bursts with 429 (12 candidates, kept as is).

## Open items and who owns them

- Data-session asks: wire `npm run shops:liveness` into `ingest/daily.js` on Mondays; run the roundup reader once (`npm run discover -- --only roundups --no-social-search`) so `data/roundup-closures.json` exists.
- Hand-check the 11 liveness `check` rows (older than two weeks: set `status`); Kale Me Crazy (3 rows) and Sweet Palm are new this run.
- The events lane: `test/enrich-events.test.js` zone test and `test/settled.test.js` review queue (47 open items) fail on main data.
- Seattle: Howdy Y'all Coffee (standing counter in Seattle Central Library, 1000 Fourth Ave) is a shops lead, not an event.
- Four OpenStreetMap rows have no city (Kyoto Matcha MD, Moka Matcha NJ, INU Matcha & Brew NV, Nana's Green Tea NV); Manzil Cafe NJ; a reverse geocode of their pins would give the city. Not done.
- Hashtag reads for the local tags after the Meta cap frees (about Nov 29); the 60-brand, 12-metro recall re-sample after the reset on 2026-11-28 09:00Z; ma.to completion; Overture incremental (monthly); outreach CSVs are with Steven.

## Next rungs, in order

1. **Decide on OCR for picture-only menus** with the numbers in `docs/HOSTED-MENUS.md`: run tesseract locally on the pictures of the top 20 metros first (about 2,000 cafes, 259 in New York, 225 in Houston), count the rows it gives, then decide on the other ~9,000. Only images on a cafe's own `/menu` page; none stored; menu words only.
2. **Settle the two Littlefoot Matcha finds** the new own-site reader makes (Sat Nov 28 10am-2pm at 540 St Albans Dr, Raleigh; Thu Dec 3 4-7pm at the UNCG Alumni Center, Greensboro; both print date, time and place on littlefootmatcha.com/pages/find-us but come out `unsure` with the source city): open the page, then promote or set the city by hand. Events lane.
3. Overture's next release: `node ingest/shops-overture.js --pull --build`, then `--menus` again (cursor starts at 0 for a new release) and the same landing steps as rung 1.
4. Re-read the 574 rate-limited own sites for hours after a few days (`node ingest/shops-fill.js --sites --blank-hours` skips rows marked `fill_status: "read"`), and the weekly `npm run shops:liveness`.
5. After the reset: recall re-sample (workers); the host-venue calendar adapter only if a host publishes vendors by date (`DOWNTOWN RALEIGH`, `RiNo`, `Village District` probed 2026-11-24: no vendor lists).

## One landing (the steps that worked this window, in order)

`node tools/clean-overture-serves.mjs data/shops-zz-overture-serves.json data/shops-zz-overture-nc.json data/shops-zz-overture-triangle.json data/shops-zz-overture-serves-proof.json`, `npm run shops -- --no-osm --no-brands`, `npm run shops:fill` (about 25 minutes per 1,000 sites), `npm run shops -- --no-osm --no-brands` again, `npm test`, `npm run pages`, `npm run brand-extras`, `npm run sitemap-extras`, `CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run smoke` (smoke, then the card gate, the reduced shop gate and the reduced map gate), explicit `git add` of data, site, docs and the changed code, fetch and merge `origin/main`, push the branch and `HEAD:main`, `npm run deploy`, `curl https://matchamap.app/data/shops.json` and count.
