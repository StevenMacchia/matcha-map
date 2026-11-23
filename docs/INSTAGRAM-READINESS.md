# Instagram Graph readiness (2026-11-22)

Written without spending a Meta call. The first real run hit Meta's hourly cap; this note says what the next one will do and how to watch it.

## Dry run

`npm run watch -- --dry` now prints a plan and stops. It reads only local files (`data/watchlist.json`, `data/sources.json`, `data/hashtags.json`, `.cache/ig-rate.json`). No Meta, Tavily or other call, nothing written. The planner is `ingest/lib/plan.js`, tested in `test/plan.test.js`.

Output on 2026-11-22, right after the first real run (the rate file still held 138 calls from the last hour, so this run's allowance showed 42):

- Watch list: 927 accounts (799 Instagram, 128 TikTok). By status: 158 watching, 711 candidate, 58 dropped. 741 Instagram accounts are not dropped; 647 are eligible for a Graph read (94 are skipped for 7 days after a Graph error); 184 of the 741 have been read at least once.
- By state: the watch list has no state field. Of the 741 live Instagram accounts, 94 map to a source with a home state (CA 13, NY 12, TX 7, NJ 7, FL 6, GA 5, WA 5, HI 4, IL 4, VA 4, DC 3, and 13 more states); the rest are hashtag finds and candidates with no state yet.
- Hashtags this slot: 20 tags from the week list, 30 ids cached, so no id lookups. Budgeted at up to 90 calls (`RUN_CALLS`).
- Not yet read by Graph: 463 of 647 (374 real brands, 89 guessed handles).

## Token

The code does not record the token's expiry date anywhere (`.env` holds the four keys `TAVILY_API_KEY`, `INSTAGRAM_TOKEN`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_BUSINESS_ID`, with no metadata). Not checked here, to keep this at zero Meta calls. To check:

- `node tools/ig-token.js --check` calls Meta's `debug_token` endpoint (`GET /debug_token?input_token=...`) and prints valid or invalid, the expiry date and the scope count. It changes nothing. Without `--check` it exchanges the token for a fresh 60-day one and writes it to `.env`.
- A long-lived token lasts 60 days. If it was made on 2026-11-22 it ends about 2027-01-21; renew by day 50. If it was refreshed, copy the new token into the `INSTAGRAM_TOKEN` GitHub secret too.

## Budget math

- Cap: `HOURLY_LIMIT` 200 calls per rolling hour, counted in `.cache/ig-rate.json`. A run may spend `200 - 20 = 180` minus what the same hour already used.
- A run goes every 6 hours (4 a day, `.github/workflows/watch.yml`), so the hour's counter is empty at the start of each slot and one run can use all 180.
- Hashtags go first, capped at 90 calls (30 unique hashtags per rolling 7 days, up to 3 pages of recent media and one top page a day per tag). That leaves at least 90 account reads per slot, 1 call each, highest priority first (accounts with hits, then watching, then candidates; guessed handles last and at most 15 a run). On a slot where hashtags are skipped or cheap, up to 180.
- First coverage: 374 real brands at 75 a run plus 89 guessed at 15 a run is 6 runs, about 1.5 days. The 25 additions in `data/review/watchlist-additions.json` (1 already on the list, 24 new, all real) change nothing: 398 real accounts, still 6 runs, about 1.5 days. The 94 accounts Graph refused come back after 7 days.
- Steady state: cadences (24 h for a recent hit, 72 h otherwise, 168 h quiet) ask for about 288 reads a day. The cap gives about 360. It fits, with little room; every new watched handle costs reads.

## Rate limit (code 4, 17, 80002)

The call raises `Stop`, the run logs "Meta rate limit (code N); stopping", sets `rateStopped`, and ends the Graph reads cleanly. Accounts past that point are not marked checked and stay due. The rest of the run (Tavily, website adapters, ingest) carries on and data is written. The next 6-hour run tries again. Nothing is retried in a loop.

## Commands

```
npm run watch -- --dry                    # plan, no network
npm run watch -- --dry --all              # plan as if every account were due
npm run watch                             # the real run: hashtags, then accounts, then writes data
npm run discover -- --dry                 # plans the Instagram parts (Brave searches, Tavily), skips them, runs the rest
node tools/ig-token.js --check            # token expiry (one debug_token call)
```

The daily workflow (`.github/workflows/watch.yml`, cron `17 */6 * * *`) runs `npm test`, `npm run discover`, `npm run watch`, `npm run ingest -- --no-fetch`, then commits `data/*.json` and `site/data/*.json`.

## GitHub secrets

`INSTAGRAM_TOKEN`, `INSTAGRAM_BUSINESS_ID` (watch and daily), `TAVILY_API_KEY` (daily and local; watch.yml does not pass it yet, so by-handle Tavily searches only run where it is set), `BRAVE_API_KEY`, `MAPBOX_TOKEN`, `YELP_API_KEY`. The token refresh needs `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` in `.env` only, never in CI.

## Only Steven can do these

1. The Meta app password prompt: the prompt that appears on the Meta app when the token is generated or refreshed. It needs his password, so no script can answer it.
2. The Tavily sign-in on his Chrome tab (the `TAVILY_API_KEY` Tavily search depends on it).
