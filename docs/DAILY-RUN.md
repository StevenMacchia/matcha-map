# The daily run

`npm run daily` (`ingest/daily.js`) is the once-a-day job. The Windows scheduled task **Matcha Map daily** starts it at 13:00 local time in the plain checkout `C:\Users\swoly_uygf8xn\github-portfolio\matcha-map`. The machine is on America/New_York, so the task follows daylight saving. The Windows task is authoritative: the GitHub Actions `daily.yml` and `watch.yml` have no schedule any more (manual `workflow_dispatch` only). The hourly **Matcha Map watch** task stays. The old 6-hourly **Matcha Map refresh** task is retired.

## What runs, in order

Each step is its own child process with a timing and `ok` or `FAILED`. A failed step is recorded and the next one still runs. Commit, push and deploy need the smoke and the SEO gate to have passed.

1. `pull`: `node tools/sync-checkout.js`, a fast-forward to `origin/main` that first discards dirty generated outputs, unions dirty state files (`tools/merge-state.cjs`) and keeps every local copy in `.cache/sync/<timestamp>/`; any other dirty tracked file stops it with a line naming it. So the task never runs stale code. A failure is recorded; the run goes on with the code present.
2. `discover`: `ingest/lib/discover.js` (press and newsletter readers, host calendars, ma.to and the other adapters that live there).
3. `watch`: `ingest/watch.js` (Graph reads of the watch list).
4. `ingest`: `ingest/run.js` (series, expiry, dedupe, enrich, pages, sitemap, feeds, event pages, weekend pages, brand extras).
5. `yelp-leads`: `ingest/shops-keyed.js --provider yelp --limit 250`, once per UTC day. The gate is `ingest/lib/day-gate.js` (stamp `.cache/yelp-leads-day.txt`), shared with `npm run refresh` and `npm run loop`, so the lane never runs twice in a day. Terms: `docs/YELP-TERMS.md`.
6. `overture`: `node ingest/overture.js --incremental` when that adapter exists; otherwise recorded as `off (no adapter yet)`.
7. `deepen`: `ingest/shops-deepen.js --new`, only shop rows with no entry in `data/shops-extra.json` yet, so the daily cost is the new storefronts. A row read that gained nothing is stamped so it is not read again.
8. `pages`: the page generators again, but only when steps 5 to 7 changed `data/shops.json`, `data/events.json` or the shop extras (a hash before and after); otherwise skipped with a note.
9. `seo-gate`: `node tools/seo-gate.js` (with `--dry` when the run is dry): the nine SEO rules over the generated `site/` (docs/SEO-RULES.md): earned index, real lastmod, stable URLs with 301s, no duplicates, no thin pages, sitemap hygiene, JSON-LD, robots, publishing pace. It prints one line per rule and a summary, and on a pass moves `data/seo-state.json` forward. A failure is recorded with the failing rules, and commit, push and deploy are skipped. The daily run never passes `--baseline`; a person records the first set once.
10. `social`: `node tools/social/outbox.js` (`npm run social`), which writes `tools/brand/outbox/<date>/` with an `INDEX.md` and public copies under `site/social/<date>/`. It is a soft step: a failure is recorded as `social FAILED (soft)`, is not counted as a failed step (no issue, no failed exit) and never blocks commit, push or deploy. `site/social` is in the commit paths. `docs/DAILY.md` and the LADDER line name the day's outbox folder and its item count (entries in `INDEX.md`, else the files in the folder, `none` when the folder is missing).
11. `smoke`: `node tools/smoke.js` (`CHROME_PATH` defaults to `C:/Program Files/Google/Chrome/Application/chrome.exe`).
12. `report`: writes `docs/DAILY.md` (one screen, overwritten each run) and appends one line to `LADDER.md` under a trailing `## Daily runs` heading.
13. `commit`: `git add` by explicit paths only (never `-A`), message `daily: <date> <events> events, <upcoming> upcoming, <new> new`, identity Steven Macchia. Skipped when nothing is staged or the smoke or the SEO gate failed. The explicit paths include `site/_redirects`, `data/pages-lastmod.json` and `data/seo-state.json`.
14. `push`: `git fetch origin`; if `origin/main` is an ancestor of `HEAD`, push `HEAD:main`; otherwise merge `origin/main` first. A merge conflict is aborted, recorded as a failure, and the deploy is skipped.
15. `deploy`: only when the smoke and the SEO gate passed and the push succeeded: `npm run deploy`, then `node tools/smoke.js --url https://matchamap.app`, recorded as `live-smoke`.
16. `notify`: see "When it opens an issue".

Flags: `--dry` does everything except commit, push, deploy and the issue, and prints what it would do (it also does not append to `LADDER.md`). `--steps a,b,c` runs only those steps, by the names above (`pull, discover, watch, ingest, yelp-leads, overture, deepen, pages, seo-gate, social, smoke, report, commit, push, deploy, notify`). Proof of the report on current data: `node ingest/daily.js --dry --steps report`.

## Why it is model-free

`ingest/lib/pipeline.js` calls `ingest/lib/llm.js` for posts the rules leave "unsure"; that is the only model path in the repo, gated on `CLAUDE_API_KEY`. The daily run strips `CLAUDE_API_KEY` and `ANTHROPIC_API_KEY` from its own environment and from every child's, and sets `MATCHA_NO_MODEL=1`. Because `ingest/lib/env.js` reads `.env` in each child, it skips those two keys when the flag is set, and `llm.js` refuses to call out with the flag on even if a key got through. `test/daily.test.js` covers all three.

## Schedule

From the plain checkout (not a worktree), once the code is merged:

```
powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1            # register daily (13:00 local) and watch (hourly), retire refresh
powershell -ExecutionPolicy Bypass -File tools\windows-task.ps1 -Remove    # remove daily, watch and the retired refresh
```

`-Repo <path>` registers a different folder; `-DailyAt 13:00` changes the time. The task runs as the signed-in user, starts a missed run when the machine wakes (`StartWhenAvailable`), never starts a second copy over a running one, and is stopped after 3 hours.

## Where to look

- Report: `docs/DAILY.md` (first line is the headline: `Daily run <date>: ok, N new events`, `... zero new events` or `... FAILED <steps>`). It is committed with the run, so the previous days are in git history. One line per run is also appended to `LADDER.md`.
- Log: `.cache\daily.log` (the task appends stdout and stderr of `npm run daily`; the hourly watch writes `.cache\watch.log`).
- Numbers come from the data files: events and upcoming from `data/events.json`, shops shown (verified rows) from `site/data/shops.json`, new today by source from each event's `first_seen` and `source_id`, keyed calls from `.cache/keyed-places.json` (`days[<date>][provider]`), pages by counting `index.html` files under `site/city`, `site/brand`, `site/e` and `site/weekend`. "Today" is the UTC date.

## When it opens an issue

When any step is `FAILED` (including `live-smoke`), or no event has a `first_seen` of today. The `notify` step rewrites `docs/DAILY.md` with the final steps, then, with `C:\Program Files\GitHub CLI\gh.exe`: creates the label `daily-run` if missing, looks for an open `daily-run` issue for the same date and comments on it, otherwise runs `gh issue create --title "Daily run <date>: <failed steps | zero new events>" --label daily-run --body-file docs/DAILY.md`. A missing or logged-out `gh` is recorded and never fails the run. The final rewrite of `docs/DAILY.md` happens after the commit, so it is committed by the next run.
