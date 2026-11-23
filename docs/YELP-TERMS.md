# Yelp: what the API terms allow us, and the rule in force

Yelp's API Terms of Use (terms.yelp.com/developers/api_terms, last updated 2026-09-22; the Display Requirements are incorporated by reference) set these limits, read 2026-11-23:

- Section 5(a): no caching, recording, pre-fetching or storing of Yelp Content for more than 24 hours after receipt; no scraping or bulk download. The only carve-outs are non-commercial aggregate analysis and business ids kept "solely for back-end matching purposes".
- Section 5(b): Yelp Content may not be used to update or create a database of business listing information. Matcha Map's shop layer is exactly that, so no Yelp fact may enter it.
- Sections 1, 4 and 5(d): the API is for non-commercial use; anything that gains promotional or monetary value needs Yelp's prior written consent, and no Yelp data may be sold. If Matcha Map takes money (ads, affiliate links, listings, a paid tier), Yelp API use stops the same day unless written consent exists.
- Section 5(c): review ratings may not be shown alongside other user-generated content. Section 5(e): links in API content may not be altered or removed.
- Section 9: Yelp Content may not be used to train or fine-tune generative AI models or be put into prompts for them. A Yelp answer therefore never goes into a Claude worker's brief, a subagent prompt or a review file a model reads.

## The rule in force (2026-11-23)

1. **Yelp answers are leads only.** The one permitted use is `npm run shops:keyed -- --provider yelp` (`ingest/shops-keyed.js`, `ingest/lib/shops/providers.js`): a business search per city whose answers live in the gitignored `.cache/keyed-places.json` and `.cache/keyed-leads-yelp.json` for under 24 hours and are then dropped by the code itself. At most 290 calls a day (`DAILY_CAP.yelp`), cursor in `.cache/keyed-cursor.json`. The scheduled refresh (`ingest/loop.js`) runs it once per cycle after the ingest; the day cap holds across cycles.
2. **No Yelp field is stored.** Nothing from a Yelp answer is written under `data/` or `site/`: no rating, review count, price band, photo, hours, phone, coordinates, url, business id or attribution line. `provider`, `provider_id` and `attribution` are gone from shop rows; rows in `data/shops-keyed-*.json` are keyed by name and street number.
3. **Every stored fact comes from a non-Yelp public page with its URL.** A lead becomes a row only when code opens the shop's own site and finds the same street number (or zip) and the matcha evidence (`confirmCandidate`); the row's `source_url` is that page. A lead with no site to confirm expires with the cache. It is matched by code (`knownSites` by name against `data/sources.json` and `data/shops.json`), never handed to a worker.
4. **Card enrichment is off for good.** `npm run yelp` refuses to run and points here; `ingest/lib/enrich/yelp.js` (ratings, hours, phone, photo into `site/data/places.json` with a 7-day cache) is deleted; the Yelp step in `npm run watch` is gone; `site/data/places.json` stays an empty list so the site's optional layer loads nothing. The Yelp events adapter (`ingest/lib/sites/yelp-events.js`) is off with or without a key: event listings are Yelp Content too.
5. **Tests hold the line.** `test/yelp-terms.test.js` fails if `npm run yelp` runs, if a Yelp field, business id, attribution line or yelp.com URL appears in `data/shops*.json`, `data/events.json`, `site/data/*.json`, or if the keyed runner writes one.

Keys: `YELP_API_KEY` in `.env` (never committed). If Yelp asks in writing for content to be deleted, the cache files are the only place it can be; delete `.cache/keyed-places.json` and `.cache/keyed-leads-yelp.json` within 24 hours (section 4).
