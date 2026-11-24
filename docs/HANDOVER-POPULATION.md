# Population lane handover (second window, written 2026-11-24, UTC, by the second Population window)

Read with `docs/LANES.md` (the rung loop, merge rules, report shape), `docs/DISCOVERY-RECALL.md`, `docs/OVERTURE.md`, `docs/CASE-STUDIES.md`, `docs/SHOPS-WORKER.md`, `docs/YELP-TERMS.md`, and this window's four new docs: `docs/CARD-COMPLETENESS.md`, `docs/HOSTED-MENUS.md`, `docs/LIVENESS.md`. Work happens in the worktree `C:\Users\swoly_uygf8xn\github-portfolio\matcha-map\.claude\worktrees\lane-population-2-1ece53` (branch `claude/lane-population-2-1ece53`, pushed to `main` by fast-forward). Report every landing to the command center (session id `local_d1f85d9d-f384-4538-a08d-93161d64aa6e`); never ask Steven anything in a box. The session messaging tool pauses after 10 sends since the user last typed: batch messages. Writing to a Windows path with the Bash tool halves backslashes in heredocs: write regexes with the Write or Edit tool.

Budget: ceiling 75% all models, stop line 73% (Steven). Reading at the end of this window: 67% all models (Fable 76%), unchanged from the start; the window never came near the 73% line, so it stopped for lack of rungs, not budget. Check `mcp__ccd_session_mgmt__get_usage` before each worker.

## Where things stand (all on main)

| Thing | State |
|---|---|
| Shops on the map | 1,651 (276 core, 1,375 matcha on the menu), 48 states and DC; live on matchamap.app (see `node tools/card-completeness.mjs`), 46+ states; live on matchamap.app |
| Cafe-menu loop | cursor 39,600 of 153,911 (chunks 1 to 3 merged this window: 30,600 -> 39,600) (`.cache/overture/2026-11-18.0/menus-cursor.json`, in this worktree); about 30 minutes and 100 to 130 serves rows per 3,000-site chunk |
| North Carolina pass | done and merged (4,554 candidates, 66 serves rows; NC 71 -> 104 shops; Triangle 1 core + 54 serves, Durham 7); rows in `data/shops-zz-overture-nc.json`; the same command (`--state XX --tag xx --out data/shops-zz-overture-xx.json`) works for any state, but the national loop will reach them anyway |
| Card completeness | `docs/CARD-COMPLETENESS.md` has the baseline and the readings; fields filled by `npm run shops:fill` into `data/shops-extra.json` |
| Hosted menus | Square Online read from the sitemap; Toast is behind a Cloudflare bot check and is counted, not read; PDF and picture menus counted (`docs/HOSTED-MENUS.md`) |
| Liveness | `npm run shops:liveness` (weekly), `docs/LIVENESS.md`; first run flagged 8 "check", 0 closed; not yet wired into `ingest/daily.js` |
| Geocode | 2 rows held, both Matcha Cafe Maiko (closed hold) |
| Held | 21 Matcha Cafe Maiko rows (all stores reported closed Nov 8; the page test shows nothing new), 2 of them ungeocoded |
| Yelp / Foursquare | unchanged: Yelp leads only (do NOT run `npm run yelp`); Foursquare is off, do not ask again |

## What may still be running

At the time of writing (about 10:10 ET, 2026-11-24) the national loop is on chunk 4 (cursor 39,600 and moving), started from this worktree by a shell that is still alive (`loop3.sh` in the session scratchpad, 40 chunks, writes `data/shops-zz-overture-serves.json` at the end of each chunk). It is not merged: whoever lands next merges whatever chunks have finished. If this session's tools are gone and the shell died with them, restart as below.

The loop (`loop3.sh` in the session scratchpad, 40 chunks of `node ingest/shops-overture.js --menus --limit 3000 --conc 10`, each followed by `node tools/clean-overture-serves.mjs data/shops-zz-overture-serves.json`) and the NC pass belong to the worktree above. If the machine restarted, nothing is running: restart the loop with that command in a background shell (`bash loop.sh`, not a trailing `&` inside a tool call: it dies with the tool's shell). Never run two loops on the same cursor.

One landing (merge the finished chunks): `node tools/clean-overture-serves.mjs data/shops-zz-overture-serves.json data/shops-zz-overture-nc.json data/shops-zz-overture-triangle.json data/shops-zz-overture-serves-proof.json`, `npm run shops:fill` (hours, menu link, image, Instagram for the new rows; 3 minutes per 130 rows), `npm run shops -- --no-osm --no-brands`, `npm test`, `npm run pages`, `npm run brand-extras`, `npm run sitemap-extras`, `npm run smoke` (the reduced shop and map gates pass; the two full-data failures from the first window were not re-run), explicit `git add`, fetch and merge `origin/main`, push, `npm run deploy`, check `https://matchamap.app/data/shops.json`.

## Findings worth keeping

- Hours was the biggest blank (27%). A plain-text hours reader (`ingest/lib/shops/hours.js`) took it to 45% with strict rules (day names first, a clear time range, at least three days, OSM shape check). The next lift is hours inside images, Google embeds and script widgets, which are not read; do not guess.
- Overture already carried its websites and phones onto the rows; the carry step found 3 Instagram handles and 7 phones. Do not repeat it for the same release.
- `ownSite()` lets `*.square.site` through as a shop's own site (it is the shop's storefront) and rejects Toast. Toast-only cafes in Overture (722 nationally) are skipped before they are candidates.
- Square (`square.site`) answers bursts with 429 and shares one gate in the reader. A 429 is not retried in the same pass: those candidates are lost until the cursor wraps. A later pass could re-read only the "square: rate limited (429)" ones.
- A bug fixed on the way: JSON-LD arrays holding null crashed the address reader (10 errors in the Triangle pass).
- Geocode: the bare-street retry never ran after the geocoder fell back to the city centre (it checked `lat == null`); fixed. Full state names ("ARIZONA") and name-led addresses held 8 serves rows; fixed in `checkRow`.
- `status: "closed"` on an override keeps a row in `data/shops.json` and out of the site layer; `shown()` in `tools/card-completeness.mjs` mirrors that filter.

## Host-venue calendar adapter (rung 6): feasibility only, nothing built

Probed 2026-11-24: Downtown Raleigh Partnership (`downtownraleigh.org/events`) and RiNo Art District (`rinoartdistrict.org/events`) answer 200 but their event pages carry no JSON-LD and no "matcha" in the listing, and `villagedistrict.com/events/` is a 114-byte shell. A host calendar names the event, not the vendors, so the yield for matcha pop-ups is the same problem as markets: read each event's detail page for a vendor list. Not worth an adapter until one host publishes vendors by date. Case studies stay at 31 of 50.

## Open items and who owns them

- Data-session asks (passed on by the command center): wire `npm run shops:liveness` into `ingest/daily.js` on Mondays; run the roundup reader once (`npm run discover -- --only roundups --no-social-search`) so `data/roundup-closures.json` exists.

- Wire `shops:liveness` into `ingest/daily.js` on Mondays (data session); run the roundup reader once so `data/roundup-closures.json` exists (`npm run discover -- --only roundups --no-social-search`).
- The weekly Maiko recheck: `npm run shops:recheck` (and the liveness report) say nothing new as of 2026-11-24.
- Seattle: Howdy Y'all Coffee (standing counter in Seattle Central Library, 1000 Fourth Ave) is a shops lead, not an event.
- Four OpenStreetMap rows have no city (OSM has no addr:city): Kyoto Matcha (33 Maryland Ave, MD, unverified), Moka Matcha (81 E 45th St, NJ), INU Matcha & Brew (671 N Nellis Blvd, NV), Nana's Green Tea (6925 S Buffalo Dr, NV). A reverse geocode of their pins would give the city; not done.
- Hashtag reads for the local tags after the Meta cap frees (about Nov 29); the 60-brand, 12-metro recall re-sample after the reset on 2026-11-28 09:00Z; ma.to completion; own-site schedule reader for the brands in `data/sources.json`; Overture incremental (monthly); outreach CSVs are with Steven.

## Next rungs, in order

1. Keep merging loop chunks and the NC pass (about 38 chunks left at 30 minutes; background work, no worker cost). After each landing run `npm run shops:fill`.
2. Re-read the Square 429 candidates and the Triangle's "own site not readable" 195 (many are chains and dead domains; the sample is worth one look).
3. Weekly: `npm run shops:liveness`; hand-check any "check" row older than two weeks and set its `status`.
4. After the reset: recall re-sample (workers), then the host-venue adapter only if a host publishes vendors by date.
