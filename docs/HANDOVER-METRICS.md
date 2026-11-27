# Metrics dashboard: hand-over (2026-11-27)

Branch `claude/lane-metrics-962e28`, pushed to origin, not merged, not deployed. Design and counting choices: `docs/METRICS.md`.

## Before this goes live (Steven or the merging session)
1. Merge, then `npm run deploy` (stamps sw-version, deploys). The `INTAKE` KV binding and `INTAKE_TOKEN` already exist; `METRICS_SALT` is optional (falls back to the token, then a constant).
2. Open `https://matchamap.app/m/`, paste the moderator token once (kept in sessionStorage for the tab).
3. Add `node tools/daily-status.js` after the report step of `ingest/daily.js` so the Run health tile follows `docs/DAILY.md` (not wired in, to stay out of the daily pipeline lane). `site/data/daily-status.json` is a snapshot from 2026-11-27.
4. Add `metrics.js` to other shell pages if wanted (today: home and `/alerts/`). City, brand and event pages are counted as views at the edge but send no taps.

## Known limits
- RSVP numbers read the whole `rsvp:` listing and one `get` per row (capped at 1,500 rows); fine at today's volume.
- `/api/ev` has no per-visitor rate limit (it would double KV writes); bots are dropped by the same classifier. Add a cap if taps ever look inflated.
- Shop card opens are labelled by the shop's name from the card, not an id.
- SEO gate rule 2 ("page changed after pages-lastmod") fails in this fresh worktree on city page mtimes, unrelated to this branch; rules 6 and 8 pass, `/m/` is noindex and not in the sitemap.
- Artifact: https://claude.ai/artifact/4xyE8wMmC5kFJmqowGQ5Zz (sample day, map size and run health are real). Screenshots: notes folder `metrics-2026-11-27/dashboard-390.jpg` and `dashboard-1280.jpg`.
