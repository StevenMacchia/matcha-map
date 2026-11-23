# Matcha Map

## What this is

A map of matcha pop-ups across America, by day, so you can find one near you when you are free. It is a plain HTML site on MapLibre GL over OpenFreeMap vector tiles (map data from OpenStreetMap contributors, attribution shown on the map and in About), fed by a small ingest script that writes `data/events.json`.

Coverage, as of 2026-11-22: 151 brands in 31 states (82 with an Instagram handle, 2 with TikTok, 50 with a public schedule page), 39 pop-ups on file, 23 upcoming from 12 brands, 25 of them with a downloaded photo. The other brands post dates on Instagram or TikTok only, so they show as a pin with no dates until a post is added by hand.

## Run it

No `npm install` is needed. Node 20 or newer.

- `npm run dev` serves `site/` at http://localhost:8790 with `tools/serve.js`, a plain Node static server, so nothing is downloaded. Another port: `npm run dev -- --port 8791`. (`npx serve site -l 8790` also works if you have it.)
- `npm run ingest` reads every active source and rewrites `data/events.json`, then copies it and `data/sources.json` into `site/data/`. It takes about a minute on a cold cache and caches fetches and geocodes in `.cache/` and `data/geocache.json`.
- `npm test` runs the unit tests.
- Type a zip to jump there: the site flies to the zip's centroid, drops Chasen on it, sorts the list by distance and remembers the zip. `node tools/gen-zips.js` rebuilds `site/data/zips.json`.
- `npm run refresh` runs discover, watch and ingest once, in that order. `npm run loop` runs watch every hour and the full cycle every 6 hours while the window stays open. `npm run clean` applies the noise rules to the events on file. See "Run it on a schedule".

Ingest flags: `--source <id>`, `--paste`, `--inbox`, `--no-fetch`, `--dry`, `--verbose`.

## How to add a source

Edit `data/sources.json`, one object per brand (schema in `data/schema/source.schema.json`). Fields: `id`, `brand`, `home_city`, `home_state`, `website`, `instagram`, `tiktok`, `schedule_url`, `schedule_kind`, `adapter`, `active`, `notes`, `added`, `verified`.

The adapter is picked by the first match, in this order:

1. `mato`: `schedule_url` is on ma.to.
2. `luma`: `schedule_url` is on luma.com or lu.ma.
3. `ics`: `schedule_kind` is `ics`.
4. `website`: `schedule_kind` is `website`.
5. `manual`: `schedule_kind` is `manual` or `none`. Dates come from the inbox only.

Run `node tools/gen-cities.js`: it keeps every listed city and adds the home city of each source that is not one (geocoded once through Nominatim), or the brand will have no pin. Then run `npm run ingest -- --source <id>`.

## How to add a pop-up by hand

Put one post per file in `data/inbox/`, for example `data/inbox/sunny.txt`. First line is the post URL (optional), the rest is the caption:

    https://www.instagram.com/p/XXXXXXXX/
    Pop-up this Saturday 11am-3pm at @sunnybooks, 123 Main St, Los Angeles, CA 90012

Run `npm run ingest -- --inbox`. To paste straight from the clipboard, run `npm run ingest -- --paste` and feed the text on stdin, or add `--file <path>`.

The post is matched to a source by the handle in the URL or an @handle in the caption. No match means it is skipped, so add the brand first. The extractor reads dates, times and addresses by rule. Confidence is `confirmed` only with a dated, timed, street-addressed post. A date plus a time, address or venue gives `likely`. Anything vaguer, such as "this Saturday" with no place, is `unsure`. With `CLAUDE_API_KEY` set, a model helps with hard captions. Events from live sources not seen for 14 days lose one confidence step.

Only real, public posts. Nothing is invented.

## Where the data comes from

- The city list (`data/cities.json`): the 20 most populous incorporated places in each state plus DC (981 cities), from the US Census Bureau (public domain, Vintage 2024 population estimates joined to the Gazetteer places file; the source URLs are in the file). `node tools/gen-cities.js` rebuilds it, `site/cities.js` and the candidate city hashtags in `data/hashtags.json`. Every city-driven part reads it, biggest city first: the event-site crawlers, the storefront boxes, the Tavily and Brave search rotation, the site's city jump, and the geocoder (a listing that names only a listed city and its state gets the Census point, no Nominatim call). Hawaii has one entry (Honolulu: the state has no incorporated places), Nevada 19 (that is all it has), New Hampshire and Rhode Island are filled from their towns.
- Zip centroids (`site/data/zips.json`): GeoNames postal codes, CC BY 4.0, https://www.geonames.org.
- MATO venue pages: event pages are read through their JSON-LD.
- Luma calendars: embedded page data, with the calendar's ICS feed as a fallback.
- Brand pages: schedule or events pages on a brand's own site, read by rule.
- The inbox: posts pasted by hand.

What a card shows beyond when and where, and where each piece comes from. A field is filled only when the source really gives it, otherwise it stays empty.

- `image`: MATO event page JSON-LD `image` (or the venue avatar), Luma `cover_url`, ICS `ATTACH`, a brand page's `og:image` when the page lists one or two dates, a Graph API `media_url`, a TikTok or Instagram oEmbed `thumbnail_url`, or an `image: <url>` line in an inbox paste. Each image is downloaded once to `site/img/events/<event id>.<ext>` (jpg, png or webp, 2 MB or less) because CDN links expire; the remote URL stays as a fallback. They are the brands' own public promo photos, shown with credit and a link to the post.
- `posts`: any `instagram.com/p/` or `/reel/` and `tiktok.com` video URL, plus the source page.
- `menu`: flavors and items found by `menuFromText` (`ingest/lib/extract.js`, vocabulary in `ingest/lib/menu-terms.js`) in the event text: a "Menu:" or "flavors:" list, a bullet or emoji-led list, "strawberry x matcha" combos, or known terms. Empty when the text names none.
- `price`: `offers.price` on MATO, or a price in the text (`$7`, `$6–9`, `from $5`, `free`).
- `description`: the brand's own first line, cleaned (no links, hashtags, mentions or emoji), 200 chars at most.
- `links`: the brand's website, Instagram and TikTok profiles from `data/sources.json`.

Not covered: Instagram and TikTok are not scraped. Their terms forbid it and the pages need a login, so this project does not try. No token is present today, so both adapters are off and every pop-up on the map came from a public brand page, MATO, Luma or the hand-paste inbox. That leaves most brands (about 100 of 151) as a pin with no dates. Two adapters are wired but off until keys exist:

- Instagram Graph API (`INSTAGRAM_TOKEN`): needs a business or creator account that is connected to a Meta app, and reads only that account's own posts, so it fits a brand that agrees to connect.
- TikTok Display or Research API (`TIKTOK_KEY`): needs an approved app, which is slow to get and limited to approved uses.
- oEmbed (`INSTAGRAM_OEMBED_TOKEN` for Instagram, public for TikTok) returns a post's caption for a link you already have. It cannot search or list posts.

Why TikTok cannot be crawled: its public pages sit behind bot checks, the Display API returns only the authorized user's own videos, the Research API needs an approved application, and oEmbed works only on single links someone pastes. So there is no TikTok crawler here; pasted links go through the oEmbed path and the inbox.

## Optional keys

Set as environment variables. All are optional; the site and ingest work without them.

| Variable | What it turns on |
|---|---|
| `CLAUDE_API_KEY` | Model help extracting dates and places from hard captions. |
| `MAPBOX_TOKEN` | Mapbox geocoding in place of Nominatim. |
| `INSTAGRAM_TOKEN` | Instagram Graph adapter (also reads `INSTAGRAM_USER_ID`). |
| `TIKTOK_KEY` | TikTok API adapter. |
| `INSTAGRAM_OEMBED_TOKEN` | Captions for pasted Instagram links. |
| `YELP_API_KEY` | Yelp Fusion: rating, hours, phone and a photo on the card for venues and shops (free, no card, 500 calls a day; the adapter stops at 400). |

## Richer place info

The card shows what the Instagram Graph read already gave us (`site/data/brands.json`: picture, name, followers, website, bio, the latest three posts; rebuilt by every `npm run watch` or on its own by `npm run brands`) and, for a venue or shop Yelp knows, its rating, review count, price, hours today and phone (`site/data/places.json`, written by `npm run yelp` and by each watch run). Yelp is off until `YELP_API_KEY` is in `.env`; get one free at yelp.com/developers (no card). A venue counts as a match only when its name words are all in Yelp's name and it lies within 30 km; answers are cached 7 days in `data/yelp-cache.json`, which also counts the day's calls. When Yelp matches a venue that is still drawn at its city's centre, the pin moves to Yelp's coordinates (`geocode_source` "yelp"). The card shows Yelp's attribution and links to the Yelp page.

Google Places would add a rating, opening hours, photos and reviews for almost every venue.
It needs a Google Cloud billing account (a card on file), so it is not built.
The Yelp and Instagram routes above are the no-card path; an "Open in Google Maps" link on every card with a venue covers the rest.

## Keep it fresh

The map keeps a watch list of accounts in `data/watchlist.json` (every Instagram handle in `data/sources.json`, 82 today, plus 22 candidates found by discovery; 104 accounts as of 2026-11-22).

- `npm run watch` also searches each due Instagram and TikTok account by handle through Tavily (1 credit each, highest-priority first, caps `WATCH_IG_CAP` 60 and `WATCH_TT_CAP` 40) and reads the post date from the snippet so "this Saturday" resolves against the post; MarketSpread vendor pages are read when a market names the vendor as attending.
- `npm run discover` finds new candidate accounts and matcha events: @mentions in captions we already hold, Instagram hashtags (needs a token), Brave search (needs `BRAVE_API_KEY`), TikTok and Instagram through search snippets and TikTok oEmbed (Tavily, `TAVILY_API_KEY`; no scraping), and the public event sites below. Add `-- --dry` to preview, `-- --no-<site>` to skip one site and `-- --only <site>` to run just one (`mato`, `luma`, `eventbrite`, `dostuff`, `meetup`, `linktree`, `allevents`, `social-search`). `npm run refresh` runs it first.
- `npm run watch` checks every account that is due (24, 72 or 168 hours apart) and writes new dates to the map. Flags: `-- --all`, `-- --handle <h>`, `-- --dry`, `-- --promote` (turns accounts with real hits into source records).
- Without any key, discover and watch still work: they read public MATO and Luma pages, the schedule pages of the brands that have one, and @mentions in text already held. They cannot see an Instagram or TikTok account, so a brand with no public schedule page stays a pin with no dates. `-- --promote` changes nothing unless an account has a real hit.
- Instagram runs only through Meta's official Graph API and stays off until `INSTAGRAM_TOKEN` and `INSTAGRAM_BUSINESS_ID` are in `.env`. Setup: `docs/INSTAGRAM-SETUP.md`. Copy `.env.example` to `.env`.
- `.github/workflows/watch.yml` runs discover, watch and ingest every 6 hours and commits the data. It only matters once the repo is on GitHub.

## Event sites

`npm run discover` crawls these public sites for matcha events and new organizers (code in `ingest/lib/sites/<name>.js`, URL patterns and robots lines in each file's header). Every crawl reads robots.txt first and skips a site that answers it with 401, 403 or 429 or disallows everything; sends the project User-Agent; waits 1 second per host; uses the 6-hour disk cache; stops at 300 fetches per site and for good after an HTTP 429 or 403; prefers sitemaps, JSON-LD and the JSON a page embeds over scraping HTML; and never calls an endpoint that needs a login. Events keep only a matcha word (`hasMatcha` in `ingest/adapters/mato.js`). An event gets the pseudo-source id `<site>:<organizer slug>` (brand = organizer, kind popup, or organizer when the title says class, workshop, meetup, tasting, 101 or club); a new organizer becomes a watchlist candidate (`found_via: search`, `found_from: <site>`).

- **MATO** (`ma.to`): city pages and the sitemap, see `ingest/lib/mato-city.js`.
- **Luma** (`luma.com/discover`): the places on the discover page, then Luma's own public paging API for each US place (3 pages of 50); the host calendar is the organizer. Luma's search endpoint needs a login and is not used.
- **Eventbrite**: the matcha search page of each city in `data/cities.json`, then the event pages (JSON-LD with time, address, organizer, image). A source whose `schedule_url` is an Eventbrite organizer page (`/o/...`) is read by `ingest/adapters/eventbrite.js` from the page's embedded `upcomingEvents`.
- **DoStuff network** (DoNYC, Do312, Do206, Do214, Do713 and 11 more): the matcha search page and event pages of each city. Do512, DoTheBay and Do314 answer 403 to robots.txt and are skipped. It finds little (these sites are mostly concerts).
- **Meetup**: the public event search for "matcha" in each listed city (events embedded in the page). The hosting group is the organizer.
- **Allevents.in**: the matcha page of each listed city (JSON-LD events; times from its FAQ lines). Confidence is at most "likely", and an event another site already has is dropped by title and day.
- Eventbrite, Allevents and Meetup walk the whole city list in population order, `CRAWL_CITIES_PER_RUN` cities a run each (default 150), from a per-site cursor in `.cache/crawl-state.json`, so about seven runs cover every city once; a city that answers 404 or has no matcha events is left alone for 7 days. The search tier (Tavily, Brave) does not grow: it rotates through the biggest `SEARCH_CITIES_POOL` cities (default 100) at the same cost per run. Luma, DoStuff and MATO list their own places and are not driven by the city list.
- **Linktree and Beacons**: `linktr.ee/robots.txt` ends with "User-agent: * Disallow: /" for every bot it does not name, so Linktree pages are skipped today (the three brands on it stay unread); `beacons.ai` allows crawling, no source is on it yet. For each source whose website or schedule_url is on either, a dated pop-up line in the bio or a link title becomes an event for that brand; MATO, Luma, Eventbrite, Partiful, Posh and Shopify events links are written to `data/discover-leads.json` under the source id so a human can set `schedule_url`. No event is made from a bare link.
- Checked and skipped: **Yelp** (robots.txt disallows everything), **Posh** (client-rendered, data behind a disallowed API), **Partiful** (private invite links, no public listing), **Resident Advisor** (club music, no matcha).

## Run it on a schedule

- `npm run loop`: the full cycle (discover, watch, ingest) now and every 6 hours, and the watch pass alone every hour in between, while the terminal stays open. Each cycle prints one line with a timestamp, the result and time of each step, and the event counts. A step that fails is reported and the next one still runs. Ctrl+C stops it. `-- --every 6` and `-- --watch-every 1` change the intervals in hours.
- `npm run watch`: the hourly pass. With the Instagram token it first harvests the hashtags in `data/hashtags.json` into events, then reads the due accounts, at most 180 Graph calls a run (see docs/INSTAGRAM-SETUP.md). The Tavily spend is spread over the month: each run's cap is the configured per_run or what is left divided by the runs left, never below 5, and the run prints "Tavily: N this run, M left this month".
- `npm run refresh`: the same three steps once. Exit code 1 only if a step crashed.
- Windows, without leaving a terminal open: `powershell -ExecutionPolicy Bypass -File toolswindows-task.ps1` registers two Task Scheduler jobs as you, while you are signed in: "Matcha Map watch" runs `npm run watch` every hour (log `.cache/watch.log`) and "Matcha Map refresh" runs `npm run refresh` every 6 hours (log `.cache/refresh.log`). Remove both with `-Remove`. The script is not run for you.
- Refreshing writes `data/` and `site/data/`; the site picks it up on the next page load. It also reads the clock: a pop-up that has ended is shown as past even before the next refresh.

## Deploy later

Nothing is deployed yet. The plan is Cloudflare Pages serving the `site/` folder, with `npm run ingest` run before each publish. The pages load MapLibre GL from unpkg with pinned versions and SRI hashes.

## Layout

- `site/`: the static site (`index.html`, `app.js`, `style.css`, `cities.js`, `data/`, `img/events/` for downloaded event photos).
- `ingest/`: `run.js`, `watch.js`, `loop.js`, `adapters/` (one per source kind) and `lib/` (fetch, extract, geocode, write).
- `data/`: `sources.json`, `events.json`, `inbox/`, `schema/`, geocode cache and overrides.
- `docs/`: setup notes. `.github/workflows/`: the 6-hour watch job.
- `tools/`: `serve.js` (dev server), `windows-task.ps1`, `merge-sources.js`, `gen-cities.js`, `gen-zips.js`.
- `test/`: unit tests.
- `SPEC.md`: the contract. `LADDER.md`: the build log.

## License

MIT. See `LICENSE`.

## Search from a Claude session

`.mcp.json` registers Tavily's MCP server for Claude Code sessions opened in this folder. It reads `TAVILY_API_KEY` from the environment (set it in your shell, or let the session load it; the key in `.env` is for the pipeline). With it, a research worker can search with domain filters, which the built-in search cannot do.

## Storefronts

A third map layer shows permanent matcha shops as little storefront icons, on by default (Show > Storefronts turns it off). Pop-up pins stay on top, brand mochi below.

- `npm run shops` builds `data/shops.json` (every kept shop, with a `verified` flag) and `site/data/shops.json` (verified shops only, which is what the map draws). It asks OpenStreetMap through the Overpass API, one box at a time (one per city in `data/cities.json`, about 940 after boxes that lie more than 60 percent inside a bigger city's are dropped; a half-width of 12 km for cities over 500,000 people, 8 km over 100,000, 5 km otherwise; a run asks `SHOP_BOXES_PER_RUN` of them, default 120, from a cursor in `.cache/shops-cursor.json`, so about eight runs cover the country, and shops from boxes not asked this run stay), `[timeout:60]`, 1 request per second, a plain User-Agent, mirrors overpass-api.de, overpass.kumi.systems and overpass.private.coffee in that order, raw answers cached per box in `.cache/` for a day. An HTTP 429 or 504 makes it wait (15 s, doubling) before the next mirror. A box that times out is skipped and logged; three boxes in a row failing on every mirror stops the run and writes what finished. A match is a node or way whose name or brand says matcha, or whose name is on the confirmed chains list (`ingest/lib/shops/brands.js`). It also reads the site of every cafe-kind brand in `data/sources.json` (robots permitting), looks for a street address, geocodes it and adds the shop only when the geocode is a real street address (nominatim or mapbox, never a city fallback).
- Legitimacy (`legitimate()` in `ingest/lib/shops/merge.js`): a shop needs a name and a street address (`addr:housenumber` + `addr:street`, or `addr:full`) and must not be tagged `disused:*`, `abandoned:*`, `opening_hours=off`, `closed`, or an `end_date` in the past. `verified` is true when it has a website, opening hours or a phone number (brand-site shops are always verified); unverified shops stay in `data/shops.json` but are not drawn.
- Matches are deduped (same name within 150 m). A human hides or fixes mistakes in `data/shops-overrides.json`: `{ "osm:node/123": { "hide": true } }` or `{ "osm:way/9": { "lat": 40.7, "lng": -73.9, "name": "Better name" } }`.
- It is its own command and is not part of `npm run refresh`: the public Overpass servers are shared and can be slow, so a run takes many minutes. Run it now and then.
- The data is © OpenStreetMap contributors, ODbL; the file carries the attribution and each card links to its OpenStreetMap page.

## Posts

`npm run flyers` makes flyer-style Instagram posts for the @matchamap.us account, in the house style (cream canvas, petal pattern, Mattie, azuki outlines). It reads `data/events.json` and writes to `tools/brand/outbox/<yyyy-mm-dd>/`:

- one single pop-up flyer (1080x1350) for every upcoming event in the next 7 days whose kind is popup or cafe, category matcha, and confidence not "unsure";
- a "This weekend in <City>" roundup (feed and 1080x1920 story) for every city with three or more such events this weekend;
- a welcome post, once, in `tools/brand/outbox/welcome/`;
- a `.txt` caption beside each image (brand, day, time, place, "via @handle" when the brand has a handle, the city, a few hashtags, "Map: matchamap.us") and an `INDEX.md` listing each file with its event id and source URL.

Templates are plain HTML in `tools/brand/templates/`, rendered with headless Chrome (set `CHROME_PATH` if Chrome is not at the default Windows location). Re-running skips images that already exist; `--force` redraws them, `--logos` redraws `tools/brand/logo.png` and `logo-mark.png`, `--date=YYYY-MM-DD` picks the day.

Credit and consent: every flyer credits the brand's handle in its caption and links the map. Posting is a human step for now: read `INDEX.md`, check each source URL, then post by hand. Nothing is posted automatically.

Posting through the Instagram Graph API (content publishing) is possible later. It needs the `instagram_content_publish` permission and a public image URL. Two calls: `POST /{ig-user-id}/media` with `image_url` and `caption` returns a `creation_id`, then `POST /{ig-user-id}/media_publish` with that `creation_id` publishes it. This repo does not implement it.

## Open data, markets, feeds, Bluesky

Four more sources run inside `npm run discover` (`--only permits|markets|feeds|bluesky` runs one):

- **permits**: city open-data tables of temporary food, special event and street-use permits (NYC, Chicago, Los Angeles, San Francisco, Seattle, DC). A permit holder or event with "matcha" or "hojicha" in its name and a future date becomes an all-day pop-up marked "Temporary food permit on file". Austin and Los Angeles County have no usable table; the reasons are in `ingest/lib/sites/permits.js`.
- **markets**: vendor pages of the big markets. Renegade Craft Fair is read per fair (city, dates, vendor grid); other sites list vendors by script, so most return a roster at best, and a roster without dates only adds a watch-list candidate.
- **feeds**: city food and events RSS in `data/feeds.json`. Add a feed by adding `{ "name", "url", "city", "state" }`.
- **bluesky**: Bluesky's open search for matcha pop-up posts, no key.

### Google Alerts (a step for you)

1. Open google.com/alerts, search for `matcha pop up` (make a second for `matcha popup`), choose Show options, set "How many" to All results and "Deliver to" to RSS feed, then Create alert.
2. Click the RSS icon beside the alert and copy the feed address (it starts with `https://www.google.com/alerts/feeds/`).
3. Paste it into `data/feeds.json` as `{ "name": "Google Alert: matcha pop up", "url": "<address>", "city": "", "state": "", "kind": "alert" }`. Items with a date and a US place in the text become events; the rest are ignored.

### Embed captions for pasted links

`ingest/lib/embed-captions.js` reads the public embed page of an Instagram post or TikTok video that you pasted into `data/inbox/`, never anything found by search. Both hosts' robots.txt disallow the embed path today, so it makes no request; paste the caption as before. Rung 22's manual adapter can call `enrichFromEmbed(raw, { fetcher, file, state: newEmbedState() })` once per inbox file.

## Pages and SEO

A one-page map cannot be found by search, so `npm run pages` (`tools/gen-pages.js`) writes a static layer into `site/`, and `npm run ingest` runs it at the end of every ingest (never from `watch`).

- `site/city/<state>/<slug>/index.html`: one page per city of `data/cities.json` that has an upcoming pop-up, a brand based there with one coming, or a verified storefront within 25 km, plus the top 100 cities by population. Upcoming pop-ups by day, nearby shops, brands based there, the 6 nearest cities with pages, JSON-LD (BreadcrumbList and one Event per pop-up).
- `site/brand/<handle>/index.html`: one page per source and per named watch-list account, with upcoming and past pop-ups.
- `site/sitemap.xml`, `site/robots.txt`, and the SEO head of `site/index.html` (between the `seo:start` and `seo:end` markers; do not edit by hand).
- The pages load no map and no app script. They link in with `/?city=<slug>-<st>`, `/?event=<id>`, `/?brand=<handle>`; `/?q=` runs the Zip-or-city box (the WebSite SearchAction). Parsing is in `site/deeplink.js`. A guard stops the build if the page set nears 20,000 files or 15 MB (thin brand pages are dropped first).
- `site/og.png` is the shared link-preview card; `npm run og` re-renders it with headless Chrome. `site/_headers` sets caching for Cloudflare Pages. Per-city redirects without the state are not done: a slug can belong to several states.

Domain switch: edit `SITE_URL` in `tools/site-url.js` to `https://matchamap.us`, run `npm run pages`, deploy. Canonicals, Open Graph, the sitemap, robots and JSON-LD all follow.

Search Console, once the domain exists: add it as a property (domain verification by DNS), open Sitemaps, submit `sitemap.xml`. Bing Webmaster Tools can import the same property.

## Install it

Matcha Map is one site that also installs: open it in Chrome, Edge or Android and use "Add to home screen" (About, or the quiet bar on a second visit); on iPhone, Safari's Share sheet then Add to Home Screen. Nothing separate to download. Offline it opens the saved shell and the last data, with a note saying when that was.

Service worker (`site/sw.js`): the shell files are cached, `data/*.json` and `img/events/*` are stale-while-revalidate, pages are network-first, map tiles and Instagram images are never stored. The shell files are not fingerprinted, so **bump `VERSION` in `site/sw.js` whenever one of them changes** (and add new shell files to its `SHELL` list); activate drops older caches and visitors see "New version, tap to refresh". Icons come from `npm run icons`.
