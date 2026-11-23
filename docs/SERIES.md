# Recurring pop-ups (series)

A weekly market stall, an "every Saturday" stand or a standing residency is one record in `data/series.json`. Each run turns it into dated events, one per day it is there, and flags them so the map, the city pages and the feeds show it on every day. Code: `ingest/lib/series.js`; commands: `npm run series` (expand now, no full ingest), `npm run series -- --detect` (patterns in the held events nobody has recorded), and step 2c of `npm run ingest` (the daily run).

## A record

`id`, `brand`, `source_id` (the held events' source, so ids and merges line up), `title`, `weekdays` (0 Sunday to 6 Saturday), `start_time` and `end_time` as local "HH:MM" (null start = all day), `tz`, the place (`venue`, `address`, `city`, `state`, `lat`, `lng`), `source_url` and `evidence` (public pages that state the rule), `rule_source` (the sentence that states it, with the date it was read), `confidence` (default `likely`), and the end rule:

- `from` / `until`: a declared first and last date. `until` always ends it.
- `extend: true`: open-ended ("every Tuesday", "weekly", a resident counter). Dates run six weeks (`horizon_days`, 42) past today, refreshed on every run, **only while `confirmed` is within 28 days**. `confirmed` moves to today when a `recheck {url, pattern}` page still shows the pattern (a brand site); a series sourced from a newsletter, a post or a guide has no recheck, so it stops growing after 28 days and its held dates run out. Re-read the source and bump `confirmed` to keep it going.
- `extend: false`: only the dates a source listed (`from`..`until`); nothing is projected.
- `skip`: dates the host is closed (holidays for a library or bakery residency; a stated closure). Not showing a date is safer than showing a false one.
- `ended: "YYYY-MM-DD"` or `active: false` or removing the record: future dates the series projected are removed on the next run; past dates stay and expire on the writer's clock.

## What an event gets

`series: { id, rule, weekdays, until, source_url, projected }`. `projected: true` is a date added from the rule; `false` is a date a source listed (the held event is flagged and keeps its id, merging by the review promote rules). `until` is the last date the series is shown, or null when it is open and unconfirmed. Schema in `data/schema/event.schema.json`; the site ignores unknown fields.

## Rules

- A date from the rule is `likely`, never `confirmed`; the page that states the rule is in `evidence`.
- Classes, workshops and networking meetups that repeat are not pop-ups and are not series.
- Irregular market days (SoWa, Westfield holiday markets) are not weekday rules: they stay as the dated events a source listed.
- Detection (`--detect`) proposes; a person reads the source before adding a record.
