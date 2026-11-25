# Discovery yield

Written by `npm run discover -- --report` on 2026-11-23 13:34 UTC. Real numbers from that run, zeros included.

Columns: fetched = network fetches this run (cache hits are free); candidates = dated readings the extractor made; dated = starting today or later; geocoded = a real pin (not the city centre); promoted = confirmed or likely and kept (on the map now, or promoted from `data/review/` by the next `npm run ingest`); dropped = by reason (quality rule id, no state, a better source has it).

| source | fetched | candidates | dated | geocoded | promoted | dropped | note |
|---|---|---|---|---|---|---|---|

- fetched: 0
- candidates: 0
- dated: 0
- geocoded: 0
- promoted: 0

## Population lane, rung P1 (2026-11-23 evening)

Real numbers from the lane's runs; zeros included. Baseline 717 events, 373 upcoming, 105 cities in 34 states plus DC.

| source | fetched | candidates | dated | promoted | dropped | note |
|---|---|---|---|---|---|---|
| eventbrite city walk, cursor 130 to 157 plus 30 sitemap-seeded places (Eventbrite's own sitemap lists /d/<st>--<place>/matcha/ pages: Gilroy, Norman, Castroville, Smyrna ...) | 44 | 33 | 95 matcha events read | 0 new | 0 | Every event was already on the map; HTTP 429 after about 30 fetches |
| eventbrite, 30 biggest metros and suburbs, 3 tries 10 minutes apart | 1 | 0 | 0 | 0 | 0 | HTTP 429 on every try; stopped at the retry limit |
| allevents, 30 biggest metros and suburbs | 39 | 13 | 16 | 1 | 1 | The one new row was KINKA "Matcha 101 Whisk & Sip" (ticketed 45-minute class), dropped with its two upcoming siblings (overrides) |

Checked and closed this rung, with why (all read-only, robots respected):

- brand sites (38 real websites in data/sources.json, home page plus /pages/events, /pop-ups, /events, /find-us, /locations, /schedule): no new dated pop-ups; the dated lines were Makers Mart Sacramento (Dec 12, a market, matcha vendor not named), Matcha Fest Miami (Dec 12, already on the map) and past dates.
- Eventeny: robots allow /, but q=matcha does not filter, and none of its 70 MB of sitemap slugs (events, business pages) contains the word matcha.
- Posh (posh.vip): /e/ pages are allowed for everyone, but explore and event listings are client-rendered and its sitemap lists only static pages.
- Partiful: private invite links, no public listing.
- SweatPals: robots allow its day sitemaps (21,281 URLs); 18 slugs say matcha, all fitness classes (pilates, twerk cardio, yoga); event pages carry no Event JSON-LD. Not built.
- Luma keyword search: api.lu.ma/search answers 401 "not signed in"; the place crawler stays the route.
- Meetup events sitemap: slugs carry ids only, no titles.

## Host-venue calendars (markets adapter, 2026-11-24, second Population window)

`ingest/lib/sites/markets.js` gained eight host venues our own events already name (SoWa Boston, Texas Farmers' Market at Mueller, The Village District, Downtown Raleigh Partnership, RiNo Art District, Portland's Pearl District and Temescal farmers markets, Grant Park Market) and a reader for pages that list event cards (`calendarCards`: "EVENT / title / blurb / date / Learn More"). A matcha card is paired only with the dates printed inside its own card, never with the page's other dates (the roster-by-date pairing would have given the Village District Saikō card the Santa photos' dates), and days our data already holds for that brand and city are skipped (`knownOnDay`). Dry run on the live pages: 8 hosts, 45 pages, 1 matcha card (Village District, Saikō Matcha Pop Up, Nov 27 and 28), both days already in our data, so 0 new events; the other seven hosts carry no matcha text and no Event JSON-LD today. The Downtown Raleigh and RiNo pages list no card markers; Downtown Raleigh and RiNo are read for JSON-LD events only. Fixture test: `test/markets-calendar.test.js`.

## Own-site schedule reader (`ownsites`, 2026-11-25, third Population window)

`ingest/lib/sites/ownsites.js`, registered in `ingest/lib/sites/index.js` as a review-only site (`npm run discover -- --only ownsites --no-social-search`); tests `test/ownsites.test.js`. For every active source with its own website that the `website` adapter does not already read (14 of the 239 sources), it reads the home page and up to two same-host pages the home page links as events, upcoming, schedule, calendar or pop-ups (at most three requests a source, robots.txt through the shared gate). It keeps only lines under an events-type heading that stands once on the page (a nav link repeated in the header and footer is not a heading), up to the next section heading, and only a dated line whose printed text also carries a time of day; the lines before and after a date line (venue, time) travel with it. Nothing outside such a block is an event, and the finds go to `data/review/` (never straight to `data/events.json`), where `npm run ingest` promotes only confirmed or likely items.

First run: 14 sources, 30 pages, 1 source with a block. Littlefoot Matcha's find-us page printed two dated lines: Saturday Nov 28 10am-2pm (Small Business Saturday, 540 St Albans Dr, Raleigh) and Thursday Dec 3 4-7pm (UNCG Alumni Center, Greensboro). Both came out `unsure` with the city taken from the source (Greensboro) and "pin at the city centre"; the Nov 28 one is a Raleigh address on the page, so a hand check should settle both (public page, date, time and address are printed). The Saikō shape itself (heading "Upcoming Events", dated lines, venue on its own line) is covered by the test fixture; Saikō has a `schedule_url` and is read by the `website` adapter. 13 of the 14 sources are pop-up brands whose home page prints no events block today: the reader returns nothing for them rather than guess.
