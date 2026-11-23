# Data quality pass, 2026-11-23

Tool: `npm run audit` (tools/audit-events.js, read-only; `-- --counts` adds the city table). It lists events with no matcha signal by source, brunch/bar/fitness listings with matcha only in the title, duplicate-looking pairs (same brand, same day, within 300 m), and what the writer rules would drop.

Rules added (ingest/lib/quality.js, ingest/lib/write.js, tests in test/noise.test.js, test/feeds.test.js):
- Brunch rule: an event-site find (eventbrite, allevents, meetup, mato) from a non-matcha brand whose description has two different brunch words, or one hard word (trivia, bingo, drag, happy hour, bottomless, burgers, omelette), and matcha only in the title, is dropped. A lone "brunch or coffee" (the Matcha + Meetup series) stays.
- Signal rule: a find that is not a source in data/sources.json (watch-list, hashtag, review) needs matcha, hojicha, usucha, koicha, ceremonial grade or a data/drinks.json drink name in brand, title, description, venue or menu. A source in sources.json is the brand record and counts as the signal.
- Handle brands: `tidy()` now runs every written event's brand through names.js `displayName`, so "bujimatcha" reads "Buji Matcha". The tiktok, instagram and mato paths never called it; the harvest path did, the rest set the brand straight from the account name.
- data/overrides.json: `drop: true` removes an event by id (Blind Tiger ids 539dec8897e6, 2515797d489c).

Counts: simulated by applying the writer rules to the data/events.json in this worktree (the merge rung's ingest writes the real result; nothing regenerated here).

```
before: 536 total, 242 upcoming
after:  516 total, 225 upcoming
top 20 cities (upcoming), before | after
  New York, NY: 17 | 17
  Chicago, IL: 15 | 7
  Brooklyn, NY: 14 | 14
  Houston, TX: 10 | 10
  Los Angeles, CA: 10 | 10
  Austin, TX: 9 | 9
  Miami, FL: 9 | 8
  San Francisco, CA: 9 | 9
  San Diego, CA: 8 | 8
  Orlando, FL: 7 | 7
  Sacramento, CA: 7 | 7
  San Antonio, TX: 7 | 7
  Dallas, TX: 6 | 6
  Honolulu, HI: 6 | 6
  Seattle, WA: 6 | 6
  Washington, DC: 5 | 5
  Atlanta, GA: 4 | 4
  El Paso, TX: 4 | 4
  Mesa, AZ: 4 | 4
  Minneapolis, MN: 4 | 0
```
