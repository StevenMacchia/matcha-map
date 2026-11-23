# Discovery yield

Written by `npm run discover -- --report` on 2026-11-23 03:41 UTC. Real numbers from that run, zeros included.

Columns: fetched = network fetches this run (cache hits are free); candidates = dated readings the extractor made; dated = starting today or later; geocoded = a real pin (not the city centre); promoted = confirmed or likely and kept (on the map now, or promoted from `data/review/` by the next `npm run ingest`); dropped = by reason (quality rule id, no state, a better source has it).

| source | fetched | candidates | dated | geocoded | promoted | dropped | note |
|---|---|---|---|---|---|---|---|
| mato | 329 | 42 | 29 | 7 | 4 | no-matcha 5, craft 1, better source has it 1 |  |
| luma | 29 | 2 | 2 | 2 | 2 | 0 |  |
| eventbrite | 43 | 106 | 106 | 32 | 17 | fitness 4, craft 3, no-matcha 3, better source has it 28 |  |
| dostuff | 35 | 0 | 0 | 0 | 0 | 0 |  |
| meetup | 151 | 17 | 17 | 5 | 5 | no-matcha 10 |  |
| linktree | 1 | 0 | 0 | 0 | 0 | 0 |  |
| allevents | 151 | 45 | 45 | 14 | 12 | craft 1, no-matcha 1, better source has it 5 |  |
| permits | 13 | 0 | 0 | 0 | 0 | 0 |  |
| markets | 88 | 0 | 0 | 0 | 0 | 0 |  |
| feeds | 58 | 0 | 0 | 0 | 0 | 0 |  |
| bluesky | 17 | 0 | 0 | 0 | 0 | 0 |  |
| reddit | 1 | 0 | 0 | 0 | 0 | 0 | robots.txt disallows /; set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for the official API |
| mastodon | 26 | 0 | 0 | 0 | 0 | 0 |  |
| gnews | 2 | 0 | 0 | 0 | 0 | 0 |  |
| ticketmaster | 0 | 0 | 0 | 0 | 0 | 0 | off (set TICKETMASTER_API_KEY; free at developer.ticketmaster.com) |
| eventbrite-api | 0 | 0 | 0 | 0 | 0 | 0 | off (set EVENTBRITE_TOKEN; free at eventbrite.com/platform/api-keys) |
| yelpevents | 0 | 0 | 0 | 0 | 0 | 0 | off (set YELP_API_KEY; free at yelp.com/developers) |

- fetched: 944
- candidates: 212
- dated: 199
- geocoded: 60
- promoted: 40
Run notes (2026-11-23, `npm run discover -- --report --no-social-search`, Tavily left off to save the month's last credits; Brave has no key):

- reddit: 1 fetch (robots.txt, `Disallow: /` for every bot), so skipped; it needs `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` for the official API.
- gnews: Google News RSS not read (its robots.txt disallows `/rss/search`); GDELT's host did not answer robots.txt in time during this run (it answers 404, meaning no rules, when it is up), so no news query ran. Zero is the honest number for tonight.
- mastodon: 5 instances answered, 25 pages; no post in the four hashtag timelines carried a future date and a US place, and signed-out search returns no statuses.
- bluesky: 17 searches answered with JSON (the 4 national queries and 12 city queries); no post passed the date and place check.
- ticketmaster, eventbrite-api, yelpevents: off, no keys in `.env`.
- eventbrite stopped on an HTTP 429 after 43 fetches (its cursor resumes next run).
- The review file of this run, `data/review/2026-11-23.json`, holds 121 items (8 confirmed, 51 likely, 62 unsure); 28 of them are marked "dropped: better source has it" and are not promoted.
- Promote dry run over the whole review folder against the committed `data/events.json` (not written): 244 items read, 47 new, 42 merged into events held, 2 duplicates, 16 set aside (better source has it; the other 12 marked items are unsure anyway), 134 left for a human (24 of them "likely" but hedged in their notes), 3 past. The sweep files alone: 123 items, 45 new, 6 merged, 72 left for a human.
