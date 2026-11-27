# Metrics: what is counted and how

Branch `claude/lane-metrics-962e28`, not deployed. Dashboard at `/m/` (noindex, token gate), data from `GET /api/metrics`.

## What is counted

- **Page views** (`functions/_middleware.js` -> `functions/_lib/metrics.js`): every GET that answers 200 with HTML, except `/api/*` and `/m/*`. Per view: day, path (first 90 chars), path group (home, city, state, brand, event, weekend, other), US state from `request.cf.regionCode` (country code outside the US, `??` unknown), device class (mobile, tablet, desktop), referrer host (`direct`, `(this site)`, or the host), visitor class.
- **Bot or human**: bot when `request.cf.verifiedBotCategory` is set, the user agent is empty, or it matches the crawler list (`BOT_UA`: bot, crawl, spider, slurp, facebookexternalhit, preview, headless, lighthouse, python-requests, curl and similar). Everything else is human. Bots are counted as views and visitors, and left out of every other chart.
- **Unique visitors per day**: a row `mv:<day>:<salted SHA-256 of address + user agent + day>` with a two-day TTL. First sight of the hash that day marks the view `u:1`. The address is never stored, the hash cannot be turned back, and it changes every day, so nobody can be followed across days.
- **Feature taps** (`site/metrics.js` -> `POST /api/ev`): map moved, zoom in/out, pin tap, card opened (event or shop id), I'm going, Directions, Calendar, Share, Near me, search, date filter, list tap, Promote, Report, alerts sign-up, theme toggle. No identifiers. Nothing is sent when `navigator.doNotTrack` is "1" or `globalPrivacyControl` is true.

## Why one row per event

KV is eventually consistent and has no atomic increment, so `get -> +1 -> put` on a shared counter loses counts when two requests overlap. Instead every view or tap writes its **own** row, `mp:<day>:<random>` (views) or `mf:<day>:<random>` (taps), with its facts in the row's list **metadata** (under 200 bytes). Two requests never touch the same key, so nothing is lost. A day is counted with `list()` alone (1000 rows per call, no reads). Rows live 40 days.

Finished days are rolled up once, on the first dashboard read after midnight UTC, into `m:<day>:all` (the full counters) plus `m:<day>:state`, `m:<day>:group`, `m:<day>:feature`. After that the dashboard reads one row per past day. Today is always counted live from the raw rows. This replaces the `m:<day>:<dimension>:<value>` layout in the brief: one JSON row per dimension is far fewer writes than one per value.

Cost: one KV write per view plus one per first visit of the day, one write per tap. At 1,000 views a day that is about 1,500 writes. If traffic ever passes the paid plan's limits, sample by writing every Nth bot view.

## Not counted, on purpose

No cookies, no local storage ids, no fingerprinting, no per-person history, no Yelp content, no search text (only that a search happened).

## Changing the dashboard files

Cloudflare serves `m.css` and `m.js` with a 4-hour browser cache whatever `_headers` says (a zone-level Browser Cache TTL overrides the shorter value). The page itself is `no-cache`, so the fix is the version on its links: bump `?v=` on the two links in `site/m/index.html` whenever `m.css` or `m.js` change, or visitors keep the old files for up to four hours.
