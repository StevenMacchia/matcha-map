# Ladder

The work on this repo is split into rungs. One worker per rung, run in order. This board is the one place to see who is on what and where it stands. States: pending / running / done / blocked.

Budget for the whole build: under 10% of the weekly usage limit. Spend is noted after each rung as a share of that weekly limit.

| # | Rung | Worker | State | What it does | Spend after |
|---|------|--------|-------|--------------|-------------|
| 1 | Spec and data model | Sonnet subagent | done | Write `SPEC.md`: what the site does, the event schema, the honest rules on Instagram and TikTok. | all-models 10% (no visible change from baseline) |
| 2 | Seed list | Sonnet subagent | done | Research real US matcha pop-up brands and write `data/sources.json`. Only accounts that can be verified. | all-models 10% (unchanged) |
| 3 | Ingestion pipeline | Sonnet subagent | done | `npm run ingest`: pluggable adapters, manual paste intake, geocoding with a cache, `data/events.json`. | all-models 11% |
| 4 | The map | Sonnet subagent | running | MapLibre or Leaflet on OpenStreetMap tiles, clustered pins, date filters, near me, list view, cards. Phone first. | |
| 5 | Review | Sonnet subagent | pending | Run ingest end to end, check phone and desktop in the browser, fix what breaks, write `README.md`. | |

## Log

- 2026-11-22: repo created, board opened. Orchestrator: Claude (Fable) session, kept lean; workers are Sonnet.
- 2026-11-22 07:35: usage baseline before rung 1: weekly all-models 10%, weekly Fable 0%. Budget ceiling for this build: all-models 20%.
- 2026-11-22 07:40: rung 1 done. `SPEC.md` (203 lines), `data/schema/source.schema.json`, `data/schema/event.schema.json`. The event schema describes the whole file `{generated, events[]}`. Worker spent about 83k tokens.
- 2026-11-22 07:50: rung 2 done. `data/sources.json`: 37 sources across 12 states, 31 with an Instagram handle seen on a fetched page, 17 with a machine-readable schedule page (13 MATO venue pages, 2 Luma calendars, 2 brand event pages), 20 Instagram-only (manual). No pop-up brand confirmed in Philadelphia, Portland or Phoenix. Rejections and gaps in `data/SOURCES-NOTES.md`. Worker spent about 171k tokens.
- 2026-11-22 08:10: rung 3 done. `npm run ingest` reads 37 sources through adapters (MATO venue pages via JSON-LD on event pages, Luma via embedded page data with an ICS fallback, brand pages, manual inbox; Instagram Graph and TikTok wired but off without tokens), geocodes with Nominatim and a committed cache, writes `data/events.json`. `npm test`: 31 pass. Live run: 18 events, 4 upcoming (Dallas, Miami, Fredericksburg VA, Seattle); most MATO pages list no upcoming dates in late November, and 20 sources post dates on Instagram only. No events invented. Worker spent about 209k tokens.
