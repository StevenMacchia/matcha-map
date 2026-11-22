# Ladder

The work on this repo is split into rungs. One worker per rung, run in order. This board is the one place to see who is on what and where it stands. States: pending / running / done / blocked.

Budget for the whole build: under 10% of the weekly usage limit. Spend is noted after each rung as a share of that weekly limit.

| # | Rung | Worker | State | What it does | Spend after |
|---|------|--------|-------|--------------|-------------|
| 1 | Spec and data model | Sonnet subagent | done | Write `SPEC.md`: what the site does, the event schema, the honest rules on Instagram and TikTok. | all-models 10% (no visible change from baseline) |
| 2 | Seed list | Sonnet subagent | running | Research real US matcha pop-up brands and write `data/sources.json`. Only accounts that can be verified. | |
| 3 | Ingestion pipeline | Sonnet subagent | pending | `npm run ingest`: pluggable adapters, manual paste intake, geocoding with a cache, `data/events.json`. | |
| 4 | The map | Sonnet subagent | pending | MapLibre or Leaflet on OpenStreetMap tiles, clustered pins, date filters, near me, list view, cards. Phone first. | |
| 5 | Review | Sonnet subagent | pending | Run ingest end to end, check phone and desktop in the browser, fix what breaks, write `README.md`. | |

## Log

- 2026-11-22: repo created, board opened. Orchestrator: Claude (Fable) session, kept lean; workers are Sonnet.
- 2026-11-22 07:35: usage baseline before rung 1: weekly all-models 10%, weekly Fable 0%. Budget ceiling for this build: all-models 20%.
- 2026-11-22 07:40: rung 1 done. `SPEC.md` (203 lines), `data/schema/source.schema.json`, `data/schema/event.schema.json`. The event schema describes the whole file `{generated, events[]}`. Worker spent about 83k tokens.
