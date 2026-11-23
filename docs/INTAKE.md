# Self-serve intake, feeds and the daily job

What was added: a public form (`/add/`), a moderation page (`/add/review.html`), six Pages Functions (`functions/api/`), an ingest step that pulls approved submissions into `data/inbox/`, calendar and RSS feeds, one shareable page per event, and a daily GitHub Action. Nothing here writes `data/events.json` except the normal ingest.

## One-time setup (Steven runs these)

1. Create the KV namespace (copy the `id` it prints):

       npx wrangler kv namespace create INTAKE

2. Open `wrangler.jsonc`, paste the id into the commented `kv_namespaces` block and remove the `//` marks (add the comma after `"./site"`). Commit.
3. Set the moderator token. Use a long random string and keep it in your password manager:

       npx wrangler pages secret put INTAKE_TOKEN --project-name matchamap

4. Deploy (`npx wrangler pages deploy site --project-name matchamap --branch main`). Try `/add/`, then open `/add/review.html` and paste the token.
5. GitHub repo secrets (Settings, Secrets and variables, Actions) for `.github/workflows/daily.yml`. All optional; a missing one turns its step off:
   `INSTAGRAM_TOKEN`, `INSTAGRAM_BUSINESS_ID`, `TAVILY_API_KEY`, `YELP_API_KEY`, `CLAUDE_API_KEY`,
   `INTAKE_URL` (the site, e.g. `https://matchamap-cu7.pages.dev`), `INTAKE_TOKEN` (same value as step 3),
   `CLOUDFLARE_API_TOKEN` (Pages edit permission) and `CLOUDFLARE_ACCOUNT_ID` (the deploy step runs only when both exist).
6. Locally, put `INTAKE_URL` and `INTAKE_TOKEN` in `.env` to run the pull by hand: `npm run ingest`.

Until steps 1 to 4 are done, `/api/*` answers `503` with that kind message and the forms show "Mattie is napping. Try again in a little while."

## How a submission travels

1. `/add/` posts to `POST /api/submit`. The function checks the honeypot field (`company`, hidden) and a load stamp (forms sent in under 1.5 seconds by the phone's own clock are treated as bots and get a fake success, nothing stored; the form also sends its send time `n` so a wrong phone clock cannot trip it), validates the fields (`functions/_lib/validate.js`), limits each IP to 10 a day (a hash of the IP in KV, kept 2 days), and stores `pending:<id>` with a 30 day TTL.
2. `/add/review.html` (token once, kept in sessionStorage) lists `GET /api/queue` and calls `POST /api/approve` with `{id, action: approve|reject}`. `edit` takes a `patch` of fields. Approved items are kept 90 days, rejected 30.
3. `npm run ingest` (the daily job) calls `pullApproved` (`ingest/lib/intake.js`) when `INTAKE_URL` and `INTAKE_TOKEN` are set: each approved item becomes `data/inbox/<city>-<brand>-<yyyymmdd>-<id8>.txt` in the manual format, then `POST /api/approve {action: "consume"}` moves it to `consumed:<id>`. The manual adapter and brand matcher take it from there. A failure never fails the run.
4. A paste is matched to a source by @handle or brand name. A brand that is not in `data/sources.json` yet is reported as "no source matched" on every run; the file stays in `data/inbox/` until you add the brand. The daily job commits `data/inbox`.

API summary (token routes need `Authorization: Bearer <INTAKE_TOKEN>`): `POST /api/submit`, `GET /api/queue?kinds=pending,approved|report|claim` (40 per kind per call), `POST /api/approve`, `POST /api/report`, `POST /api/claim`, `POST /api/alerts`. KV keys: `pending:`, `approved:`, `rejected:`, `consumed:`, `report:`, `claim:`, `alert:<city>:<hash>`, `rl:` (rate limits).

## Other forms

- `/report/?event=<id>` posts to `/api/report`, stored as `report:<id>` (90 days). The card rung can link here. Read with `GET /api/queue?kinds=report`.
- `/claim/?brand=<id>` posts to `/api/claim`, stored as `claim:<id>`. `tools/gen-pages.js` can link brand pages here later.
- `/alerts/` posts to `/api/alerts`. It only collects an email, a city and a consent tick. **Double opt-in is out of scope:** no confirmation mail is sent and nothing sends alerts yet. Do not mail the list until a confirmation step exists.

## Expiry and merging rules (already in ingest)

- An event is `upcoming` until its end (or start + 3 h; + 24 h when all-day), then `past`. Past events are kept 30 days (`KEEP_PAST_DAYS` in `ingest/lib/write.js`), then dropped. Cancelled sticks.
- Events from live sources not seen for 14 days lose one confidence step per 14 days (`DECAY_DAYS`, sidecar `data/decay.json`).
- Merge: the same id (source + day + venue or address) keeps the best confidence; `first_seen` stays, `last_seen` updates; a real source supersedes a `mato:` or `luma:` style pseudo-source for the same handle, day and venue; previous image, posts and links are carried when a re-read brings none.
- `--expire-days` was not added: the 30 day window is one constant in `write.js`, which this change does not touch.

## Feeds and pages

`npm run feeds` writes `site/feeds/`: `all.ics`, `<city>-<st>.ics`, `events/<id>.ics`, `new.xml`, `index.json`. `npm run event-pages` writes `site/e/<id>/index.html`. Both run at the end of `npm run ingest` and in the daily job. Sitemap generation lives in `tools/gen-pages.js`, so `site/e/*` is not in `sitemap.xml` yet: add it there when that file is free (the feeds do not belong in a sitemap).

## Daily job

`.github/workflows/daily.yml` runs at 09:17 UTC (and by hand): discover, art (if the script exists), ingest, feeds, event pages, commits `data/events.json data/review data/geocache.json data/inbox site/data site/art site/feeds site/e site/city site/brand site/sitemap.xml` if changed, then deploys with wrangler when the two Cloudflare secrets exist. `watch.yml` is unchanged.
