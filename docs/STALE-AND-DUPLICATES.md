# Stale events and duplicates

Applied by the writer on every ingest and watch run (`ingest/lib/write.js` `mergeEvents`, `ingest/lib/dedupe.js`), and on demand by `npm run tidy` (no crawl; `-- --dry` counts what would fold).

## Past events

Status is recomputed from the end (or start plus 3 hours; a day for all-day) on every write. A past event stays 30 days so "Recent" works, then is dropped. Future dates of an ended or removed series are removed on the next run (docs/SERIES.md).

## Duplicates (folded, never deleted blind)

Two records are one pop-up when they have the same brand (or handle), the same start day and the same city, and:

- both are placed: same normalised venue, or pins within 200 m;
- both are city-only: always, unless they name different places (a venue or address text that matches, contains the other, or is blank on one side counts as the same place);
- one is city-only and one placed: the city-only one names no place, or names the same place (an `@handle` of the venue counts).

Two timed records more than 3 hours apart are two sessions. A start at local midnight counts as "no time". Two placed records at different venues more than 200 m apart stay two events (a brand at two stalls the same day).

The richer record is kept with its id (a real pin, a venue, higher confidence, card fields); the other's evidence, menu, posts, links, description, image and series fold into it, the confidence takes the higher, `first_seen` the earlier. `npm run audit -- --counts` still lists "duplicate-looking pairs" (same brand and day within 300 m); what remains are different named venues the rules above keep apart.

## "Date not confirmed" and "place not posted yet"

Those are `confidence: "unsure"` (date read from a caption) and `approx: true` (no place found, drawn at the city centre). They are resolved by evidence only: a later read that brings the venue or a time merges into the record (same brand and day), and a city-only find folds into its placed twin. A source page is read only where public; Instagram and TikTok posts are behind a login wall and are not read.

Expiry rule: a city-only, unsure find that a live source has not shown again in 14 days (`DECAY_DAYS`) is let go (`stats.expired`). Hand-entered (`manual`) and sweep-verified records are exempt, and so is any record whose source was not fetched that run. The data is two days old, so nothing has aged into it yet; it starts to act on 2026-12-07 for the first reads.
