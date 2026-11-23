# Instagram Graph readiness (2026-11-22, planner updated 2026-11-23)

Written without spending a Meta call. The first real run hit Meta's hourly cap; this note says what the next one will do and how to watch it.

## Dry run

`npm run watch -- --dry` now prints a plan and stops. It reads only local files (`data/watchlist.json`, `data/sources.json`, `data/hashtags.json`, `.cache/ig-rate.json`). No Meta, Tavily or other call, nothing written. The planner is `ingest/lib/plan.js`, tested in `test/plan.test.js`.

Output on 2026-11-22, right after the first real run (the rate file still held 138 calls from the last hour, so this run's allowance showed 42):

- Watch list: 927 accounts (799 Instagram, 128 TikTok). By status: 158 watching, 711 candidate, 58 dropped. 741 Instagram accounts are not dropped; 647 are eligible for a Graph read (94 are skipped for 7 days after a Graph error); 184 of the 741 have been read at least once.
- By state: the watch list has no state field. Of the 741 live Instagram accounts, 94 map to a source with a home state (CA 13, NY 12, TX 7, NJ 7, FL 6, GA 5, WA 5, HI 4, IL 4, VA 4, DC 3, and 13 more states); the rest are hashtag finds and candidates with no state yet.
- Hashtags this slot: 20 tags from the week list, 30 ids cached, so no id lookups. Budgeted at up to 90 calls (`RUN_CALLS`).
- Not yet read by Graph: 463 of 647 (374 real brands, 89 guessed handles).

## Planner changes, 2026-11-23

Wave 3 measured a real run: 20 hashtag reads took up to 90 of the 180 calls, 82 account reads failed with HTTP 400 "Invalid user id", and about 10 accounts were read. Three changes (`ingest/lib/plan.js`, `ingest/lib/watchlist.js`, `ingest/watch.js`):

- **Never-read accounts first.** The read order (`graphOrder`) puts accounts Graph has never read (no `graph_checked_at`) ahead of everything, watching before candidate and real brands before guessed handles; then the accounts read before, longest since their last Graph read first. The old order (hits first) starved the backlog. Guessed handles are still capped at 15 a run.
- **Hashtag share capped.** While 50 or more accounts are never read (`BACKLOG_LIMIT`), the hashtag harvest gets 30 calls of the run (`HASHTAG_SHARE`), not 90; under 50 it gets 90 again. `hashtagBudget(backlog, full)` is the one rule; the dry planner and the real run both use it.
- **Unreadable accounts.** An account that fails with HTTP 400 "Invalid user id" is set to `status: "unreadable"`, with `graph_error`, `graph_error_at` (also `unreadable_at`) and the status it had (`unreadable_prior`). Graph never reads it again (it used to come back every 7 days). It stays on the by-handle Tavily recheck at the quiet cadence (168 h). Other Graph errors keep the 7-day skip; a guessed handle with the error is still dropped. The first run after this change converts the 327 stored "Invalid user id" errors (`migrateUnreadable`); they are saved with the watch list, so a `--dry` shows the effect but writes nothing.

`npm run watch -- --dry` now prints a `backlog:` line: never-read accounts, runs needed at this run's account reads (and on a fresh slot), the hashtag cap, and the unreadable count.

Dry plan on 2026-11-23, same watch list (1096 accounts), before and after:

- Before: `hashtags: up to 90 calls`; `accounts: 58 Graph reads of 372 due`; `total calls this run: 148 of 180`; `never read by Graph: 178 of 524 Instagram accounts; 9 runs = 2.3 days (43 real, 135 guessed) ... 90 account reads a fresh run`.
- After: `hashtags: up to 30 calls`; `accounts: 58 Graph reads of 372 due`; `total calls this run: 88 of 180`; `backlog: 178 never-read accounts; 9 runs at this run's 150 account reads`; `327 accounts unreadable by Graph (never retried)`.

What the numbers say: the 327 accounts the wave counted as never read are the ones that already failed with "Invalid user id"; they were parked for 7 days (until 2026-11-30), so today's plan is unchanged for accounts and the saving shows from the 8th day (327 calls a week, about 2 runs of budget). The real backlog is 178: 43 real brands (all read in the next run) and 135 guessed handles at 15 a run, which is what sets the 9 runs. About 90 calls of each run stay unspent while guessed handles wait past the cap.

## Token

The code does not record the token's expiry date anywhere (`.env` holds the four keys `TAVILY_API_KEY`, `INSTAGRAM_TOKEN`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_BUSINESS_ID`, with no metadata). Not checked here, to keep this at zero Meta calls. To check:

- `node tools/ig-token.js --check` calls Meta's `debug_token` endpoint (`GET /debug_token?input_token=...`) and prints valid or invalid, the expiry date and the scope count. It changes nothing. Without `--check` it exchanges the token for a fresh 60-day one and writes it to `.env`.
- A long-lived token lasts 60 days. If it was made on 2026-11-22 it ends about 2027-01-21; renew by day 50. If it was refreshed, copy the new token into the `INSTAGRAM_TOKEN` GitHub secret too.

## Budget math

- Cap: `HOURLY_LIMIT` 200 calls per rolling hour, counted in `.cache/ig-rate.json`. A run may spend `200 - 20 = 180` minus what the same hour already used.
- A run goes every 6 hours (4 a day, `.github/workflows/watch.yml`), so the hour's counter is empty at the start of each slot and one run can use all 180.
- Hashtags go first, capped at 90 calls (30 while 50 or more accounts are never read, see Planner changes) (30 unique hashtags per rolling 7 days, up to 3 pages of recent media and one top page a day per tag). That leaves at least 90 account reads per slot (150 while the backlog is 50 or more), 1 call each, highest priority first (accounts with hits, then watching, then candidates; guessed handles last and at most 15 a run). On a slot where hashtags are skipped or cheap, up to 180.
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
