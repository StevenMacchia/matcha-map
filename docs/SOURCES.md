# Sources in detail

The README has the one-page table. This file holds the per-source detail. Measured yield is in `docs/DISCOVERY-YIELD.md` (rewritten by `npm run discover -- --report`). Code for the event sites is in `ingest/lib/sites/<name>.js`; the URL patterns and robots lines are in each file's header.

Every crawler reads robots.txt first. It skips a site that answers 401, 403 or 429, or that disallows everything. It sends the project User-Agent and waits at least a second between requests.

## Brand sources (`data/sources.json`)

One object per brand, schema in `data/schema/source.schema.json`. The adapter is picked by the first match:

1. `mato`: `schedule_url` is on ma.to. Event pages are read through their JSON-LD.
2. `luma`: `schedule_url` is on luma.com or lu.ma. Embedded page data, with the calendar's ICS feed as a fallback.
3. `ics`: `schedule_kind` is `ics`.
4. `website`: `schedule_kind` is `website`. Dates are read by rule from the brand's own page.
5. `manual`: `schedule_kind` is `manual` or `none`. Dates come from the inbox only.

After adding a brand, run `node tools/gen-cities.js` (it adds the brand's home city if it is not listed, or the brand has no pin), then `npm run ingest -- --source <id>`.

## The paste inbox

One post per file in `data/inbox/`. First line is the post URL (optional), the rest is the caption. Run `npm run ingest -- --inbox`, or `-- --paste` to read stdin. A post is matched to a source by the handle in the URL or an @handle in the caption; no match means it is skipped, so add the brand first. Confidence is `confirmed` only with a dated, timed, street-addressed post. A date plus a time, address or venue is `likely`. Anything vaguer is `unsure`.

## Event sites (keyless, in `npm run discover`)

- MATO (`ma.to`): city pages and the sitemap, `ingest/lib/mato-city.js`.
- Luma: the places on `luma.com/discover`, then Luma's public paging API for each US place (3 pages of 50). The host calendar is the organizer. Luma's search needs a login and is not used.
- Eventbrite: the matcha search page of each city in `data/cities.json`, then event pages (JSON-LD). A source whose `schedule_url` is an Eventbrite organizer page is read by `ingest/adapters/eventbrite.js`.
- DoStuff network (DoNYC, Do312 and others): finds little, mostly concerts. Do512, DoTheBay and Do314 answer 403 and are skipped.
- Meetup: public search for "matcha" in each listed city. The hosting group is the organizer.
- Allevents.in: the matcha page of each listed city. Confidence is at most `likely`; an event another site has is dropped by title and day.
- Eventbrite, Allevents and Meetup walk the city list in population order, `CRAWL_CITIES_PER_RUN` cities a run (default 150), from a cursor in `.cache/crawl-state.json`. About seven runs cover every city. A city with a 404 or no matcha events is left alone for 7 days.
- Linktree: `linktr.ee/robots.txt` disallows every bot it does not name, so Linktree pages are skipped. Beacons allows crawling; no source is on it yet.
- Skipped on purpose: Yelp's own event pages (robots), Posh (client-rendered, disallowed API), Partiful (private invite links), Resident Advisor (club music).

## Open data, markets, feeds

Run inside `npm run discover` (`--only permits|markets|feeds|bluesky` runs one).

- permits: city open-data tables of temporary food and special event permits (NYC, Chicago, Los Angeles, San Francisco, Seattle, DC). A holder with matcha or hojicha in its name and a future date becomes an all-day pop-up marked "Temporary food permit on file". Austin and Los Angeles County have no usable table.
- markets: vendor pages of big markets. Renegade Craft Fair is read per fair. Most other sites give a roster without dates, which only adds a watch-list candidate.
- feeds: city food and events RSS in `data/feeds.json`. Add `{ "name", "url", "city", "state" }`.
- Google Alerts (a step for Steven): at google.com/alerts make alerts for `matcha pop up` and `matcha popup`, All results, deliver to RSS feed, and add each feed address to `data/feeds.json`.

## Social and news

- Bluesky: four national queries plus "matcha pop up <city>" and "matcha bar <city>" for 6 of the 40 biggest metros a run, rotating. A 403 or non-JSON answer is a quiet skip.
- Mastodon: public hashtag timelines of mastodon.social, mstdn.social, mas.to, hachyderm.io and mastodon.online for #matcha, #matchapopup, #matchalatte, #matchabar. Signed-out search returns nothing.
- News: Google News RSS is not read (its robots.txt disallows `/rss/search`); Bing news RSS is personal use only. The step uses the open GDELT DOC API, one request every 5 seconds, one national query and 4 metros a run. Local press articles it finds are opened with robots respected.
- Reddit: `reddit.com/robots.txt` disallows everything, so the public JSON pages are not read. With `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` it uses the official API: r/matcha, r/tea and 10 of the 40 metro subreddits a run, one request every 2 seconds, a 429 ends the run.
- Tavily (`social-search` and the watch pass): search snippets of TikTok and Instagram posts, no scraping. Budget in `data/tavily-budget.json`: 120 credits a run, 900 a month, basic search is 1 credit. Each run's cap is the per-run figure or what is left divided by the runs left, never below 5.
- Brave Search: watch-list candidates, and an Instagram result whose snippet announces a pop-up becomes an `instagram:` finding, `likely` at most. Free plan, 1 query a second.

## Official APIs, off until keyed

| Key | Reads | Limits |
|---|---|---|
| `TICKETMASTER_API_KEY` | Discovery API, `keyword=matcha` and `classificationName=food` | free, 5000 calls a day |
| `EVENTBRITE_TOKEN` | organizers of known brands, then other events at their venues (event search left API v3 in 2020) | free, 1000 calls an hour |
| `YELP_API_KEY` | Fusion `/v3/events?term=matcha` for 6 metros a run, and card enrichment | free, 500 a day, we stop at 400 |
| `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | Reddit, above | 100 queries a minute |

Not built: Google Programmable Search (closed to new customers) and Google Places (needs a billing account).

## Instagram Graph API

The one source that moves the count. It reads the watch list (`data/watchlist.json`) by Business Discovery and public hashtags. Rules: 200 calls per rolling hour (we stop at 180), hashtags first (capped at 90 calls a run), then accounts due on a 24, 72 or 168 hour cadence. Setup is in `docs/INSTAGRAM-SETUP.md`, budget math and the dry run in `docs/INSTAGRAM-READINESS.md`, review steps in `docs/META-APP-REVIEW.md`. Until the app passes review, only accounts with a role on the app can be read.

## Extraction

Rules first (`ingest/lib/extract.js`): dates, times, addresses, `pay`, `hours`, menu. With `CLAUDE_API_KEY`, a candidate the rules leave unsure goes to the Claude API (`ingest/lib/llm.js`, at most 20 calls a run) as strict JSON. Every field needs its exact supporting quote from the post; a field whose quote is missing is dropped.

## What a card shows and where each piece comes from

A field is filled only when the source gives it.

- `image`: MATO JSON-LD, Luma `cover_url`, ICS `ATTACH`, a brand page's `og:image`, a Graph `media_url`, an oEmbed thumbnail, or an `image:` line in a paste. Downloaded once to `site/img/events/<id>.<ext>` (2 MB or less) because CDN links expire. `npm run images` then makes 1200 px and 400 px copies.
- `posts`: any Instagram post or reel and TikTok video URL, plus the source page.
- `menu`: `menuFromText` (`ingest/lib/extract.js`, words in `ingest/lib/menu-terms.js`).
- `price`: MATO `offers.price`, or a price in the text.
- `description`: the brand's own first line, cleaned, 200 characters at most.
- `links`: website, Instagram and TikTok from `data/sources.json`.

## The review folder

Every finding of every crawler is written to `data/review/<yyyy-mm-dd>.json` after the quality rules and the geocoder. `npm run ingest` reads every `.json` in that folder (dated run files, kept 14 days, and hand-written `sweep-<group>.json` files, never touched) and promotes items at `confirmed` or `likely` that pass the quality rules. A note containing "placeholder", "inferred", "assumed", "sample date", "not checked" or "holiday risk" makes an item `unsure`. Dedupe: same brand or handle, same start day, same venue or within 300 m is one event, merged into the one already held.

`npm run review` prints the items a human must check. To accept one, check the link and set its confidence to `likely` in the file.

## Why TikTok and plain Instagram are not crawled

Their terms forbid scraping and the pages need a login. TikTok's Display API returns only the authorized user's own videos, and the Research API needs an approved application. oEmbed returns a caption for a link you already have; it cannot search. So pasted links go through oEmbed and the inbox, and nothing else touches either site.

## Population lane additions (2026-11-23)

- Eventbrite sitemap seeds: https://www.eventbrite.com/sitemap_xml/sitemap_index.xml (named in robots.txt) lists "top search pages"; the /d/<st>--<place>/matcha/ ones are read by the Eventbrite crawler on the default walk (about 30 places, cached a week in .cache/eventbrite-matcha-places.json; off with EVENTBRITE_SEEDS=0, skipped on --cities lists).
- Probed and not used: Eventeny, Posh, Partiful, SweatPals sitemaps, Luma search, Meetup events sitemap. Reasons in docs/DISCOVERY-YIELD.md.
