# Matcha Map

## What this is

A map of matcha pop-ups across America, by day, so you can find one near you when you are free. Live at https://matchamap.app (see "Site and domain").

It is a plain HTML site on MapLibre GL over OpenFreeMap tiles (map data from OpenStreetMap contributors). A set of Node scripts finds pop-ups, writes `data/events.json` and builds the static pages. There is no server and no build step for the site. The only dynamic part is a few Cloudflare Pages Functions for the Add form. Node 20 or newer; no `npm install` is needed except for `wrangler` (deploy).

Counts move every day, so look at `data/events.json` for the real number. On the morning of 2026-11-23 it held 536 events and 236 brands in `data/sources.json`; after the day's wave 3 (an Instagram Graph read over the watch list, a verification pass over the held review items, nine metro sweeps) it held 710 events, 366 of them upcoming in 101 cities, and 238 brands; wave 4 the same afternoon (Graph planner, review queue, thin-metro crawler runs) took it to 717 events, 373 upcoming in 105 cities.

Never invent an event. Only real, public posts. If a source does not give a field, it stays empty.

## Run it

Commands that matter, one line each. Flags go after `--`.

- `npm run dev`: serves `site/` at http://localhost:8790 with a plain Node server. `-- --port 8791` changes the port.
- `npm test`: unit tests (`node --test`, folder `test/`).
- `npm run smoke`: headless Chrome over eight routes at 1440 and 390 wide; fails on a console error, a failed asset or an empty map. `-- --url <site>` tests a live site.
- `npm run ingest`: reads every active source, the inbox and the review folder, writes `data/events.json`, copies data into `site/data/`, then runs art, pages, feeds, weekend, event pages and sitemap extras. About a minute cold. Flags: `--source <id>`, `--paste`, `--inbox`, `--no-fetch`, `--no-art`, `--dry`, `--verbose`, `--help`.
- `npm run discover`: crawls the open web and APIs for new pop-ups and accounts, writes `data/review/<date>.json`. `-- --report` writes `docs/DISCOVERY-YIELD.md`. `-- --dry` plans only.
- `npm run watch`: reads the Instagram watch list by Graph API, plus Tavily by handle. `-- --dry` prints the plan with no network. Also `--all`, `--handle <h>`, `--promote`.
- `npm run art`: draws a cartoon for every drink and for every event without a photo into `site/art/`. See "Drink art".
- `npm run feeds`: writes `site/feeds/` (per-city and all-city ICS, one ICS per event, RSS of new pop-ups).
- `npm run event-pages`: writes `site/e/<id>/index.html`, a shareable page per event.
- `npm run weekend`: writes "This weekend in <city>" pages in `site/weekend/` and their preview cards.
- `npm run pages`: writes city and brand pages, `sitemap.xml` and the SEO head of `site/index.html`.
- `npm run audit`: read-only list of events with no matcha signal, brunch-style listings and duplicate-looking pairs. `-- --counts` adds a city table.
- `npm run review`: prints the review-folder items a human must check, with the evidence link. `-- --all` adds a count per file.
- `npm run search`: a Tavily search from the terminal, counted in the budget file. `-- "matcha pop up Denver"`; `--web` for any site.
- `npm run images`: shrinks downloaded event photos to 1200 px and 400 px thumbnails and writes `site/img/events/index.json`.
- `npm run deploy`: stamps the service worker version, then `wrangler pages deploy site` to the `matchamap` project.

The rest, in the order you will want them:

- `npm run daily`: the once-a-day run (pull, discover, watch, ingest, Yelp leads, new shops, smoke, report, commit, push, deploy; no model calls), started at 13:00 by the Windows task from `tools/windows-task.ps1`. See `docs/DAILY-RUN.md`.
- `npm run refresh`: discover, watch and ingest once. `npm run loop` repeats it every 6 hours (watch hourly) while the terminal stays open.
- `npm run clean`: applies the noise rules to events already on file.
- `npm run regeocode`: looks up venues that sit at their city centre on Nominatim (150 requests a run, cached in `data/geocache.json`).
- `npm run shops`: builds permanent matcha storefronts from OpenStreetMap (`data/shops.json`). Slow; run it now and then. Not part of refresh.
- `npm run yelp`: refuses to run. Yelp's API terms rule out storing or showing Yelp content; Yelp answers are storefront leads only (`npm run shops:keyed -- --provider yelp`, in `npm run refresh`). See `docs/YELP-TERMS.md`.
- `npm run brands`: rebuilds `site/data/brands.json` from the watch list and sources (no network). Brand pictures are never copied off Meta's servers (platform terms): a card carries the profile picture url from the newest Graph read only while that read is under 7 days old and the url's own expiry (`oe`) has not passed, else `picture` is null and the site draws the brand's initial. The watch run rebuilds the file hourly and every watched account is re-read within 72 hours, so the daily deploy carries live urls (`picture_at` says when each was read; `test/brands.test.js` checks the file).
- `npm run brands:apply`: merges `data/review/brand-facts.json` into `data/sources.json` where a field is empty.
- `npm run watchlist:apply`: merges `data/review/watchlist-additions.json` into `data/watchlist.json`.
- `npm run brand-extras`: per-brand `extra.json` (dates, drinks, price, story) for brand pages.
- `npm run sitemap-extras`: adds weekend pages, event pages and feeds to `sitemap.xml`.
- `npm run flyers`: Instagram flyers for @matchamap.app. See "Posts".
- `npm run og`: re-renders the link-preview cards with headless Chrome.
- `npm run icons`: re-renders the app icons from Mattie. Only when the look changes.
- `npm run sw-version`: stamps the service worker and the shell links with a hash. `deploy` runs it for you.
- `npm run preview`: `wrangler dev`, the site with the Functions running locally.

Tools without an npm script: `node tools/gen-cities.js` (city list and hashtags), `node tools/gen-zips.js` (zip centroids), `node tools/merge-sources.js` (merges `data/wave*/` into sources), `node tools/ig-token.js --check` (Instagram token expiry), `tools/windows-task.ps1` (Windows Task Scheduler jobs; not run for you).

## Where the data comes from

Only public pages and official APIs. Per-source detail is in [docs/SOURCES.md](docs/SOURCES.md). Yield numbers are from the run of 2026-11-23 (`docs/DISCOVERY-YIELD.md`; "promoted" means on the map or promoted by the next ingest). Zeros are real.

| Source | What it reads | Needs | Last measured yield | Notes |
|---|---|---|---|---|
| Instagram Graph API over the watch list | Posts of about 740 live accounts and 30 hashtags a week | `INSTAGRAM_TOKEN`, `INSTAGRAM_BUSINESS_ID` (set); Meta App Review for accounts we have no role on | Not yet measured. The first run hit Meta's hourly cap; 184 of 741 accounts read once | The one source that moves the count. 180 calls an hour, first full pass about 1.5 days. See `docs/INSTAGRAM-READINESS.md` |
| MATO (ma.to) | City pages, event pages through JSON-LD | nothing | 42 candidates, 4 promoted | Reliable for dated events |
| Eventbrite (public pages) | Matcha search page per city | nothing | 106 candidates, 17 promoted | Most are already held by a better source. Stops on HTTP 429 and resumes |
| Allevents.in | Matcha page per city | nothing | 45 candidates, 12 promoted | `likely` at most |
| Meetup | Public search per city | nothing | 17 candidates, 5 promoted | Ten more dropped as no matcha signal |
| Luma | Discover page and public paging API | nothing | 2 candidates, 2 promoted | Small but clean |
| Brand pages and ICS | Each brand's own schedule page | `schedule_url` in sources | Part of the base 536 events | About 50 brands have one |
| Tavily snippets | TikTok and Instagram search snippets, by handle and by city | `TAVILY_API_KEY` (set) | Not part of the 11-23 run (left off to save credits) | 737 of 900 monthly credits used. Snippets give a date, rarely a place |
| Brave Search | Instagram snippets, new accounts | `BRAVE_API_KEY` (off) | Off | Free plan, 1 query a second |
| Hand sweeps | A worker reads brand sites, Linktrees, market lists | nothing | 6 groups, about 145 items in `data/review/sweep-*.json` and 56 new brands | Few new dates on the open web; the brands feed the watch list |
| Paste inbox | A post pasted into `data/inbox/*.txt` | nothing | Hand-fed | Every confirmed item with a street address came this way or from a brand page |
| Add-your-pop-up queue | `/add/` form, approved at `/add/review.html` | KV namespace and `INTAKE_TOKEN` (not set up yet) | Zero until it is live | Pulled into the inbox at ingest |
| Bluesky search | Public post search | nothing | 17 searches, 0 candidates | Rotates 6 metros a run |
| Mastodon tags | Four hashtag timelines on five instances | nothing | 26 fetches, 0 candidates | Signed-out search returns nothing |
| GDELT news | Open news API, local press pages | nothing | 0 (host did not answer in time) | Google News RSS is closed by robots; Bing is personal use only |
| Reddit | Official API only | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (off) | 0, skipped | `reddit.com` robots disallows crawling |
| DoStuff, permits, markets, city feeds | Event pages, open-data permit tables, vendor lists, RSS | nothing | 0 each on 11-23 | Kept because a hit is worth having |
| Ticketmaster, Eventbrite API | Official APIs | `TICKETMASTER_API_KEY`, `EVENTBRITE_TOKEN` (off) | Off | Free keys; see "Keys". Yelp events is off for good (`docs/YELP-TERMS.md`) |

Across all keyless crawlers on 2026-11-23: 944 fetches, 212 candidates, 199 dated, 60 geocoded, 40 promoted.

Not covered, and why:

- TikTok: its pages need a bot check, the Display API returns only the authorized user's own videos, and the Research API needs an approved application. A pasted link goes through oEmbed and the inbox.
- Instagram without the API: the terms forbid scraping and the pages need a login. We do not try.
- Partiful: private invite links, no public listing.
- Yelp event pages: robots.txt disallows everything. (The Yelp API is separate and off.)
- Posh: client-rendered, with its data behind a disallowed API.
- Linktree: robots disallows bots, so three brands on it stay unread.

About 100 of the brands post dates on Instagram or TikTok only. Without the Graph API they show as a pin with no dates until someone adds a post by hand.

## Keys

All optional. The map and the ingest work without them. Copy `.env.example` to `.env` (git-ignored). Names only here; never commit a value.

In `.env` today: `TAVILY_API_KEY`, `INSTAGRAM_TOKEN`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_BUSINESS_ID`. Everything else is off.

| Key | Where to get it (free unless noted) | What it unlocks | In `.env` |
|---|---|---|---|
| `INSTAGRAM_TOKEN`, `INSTAGRAM_BUSINESS_ID` | Meta app, `docs/INSTAGRAM-SETUP.md`. Token lasts 60 days | Graph API: hashtags and account posts | yes |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Same Meta app | Token refresh with `tools/ig-token.js`. Local only, never in CI | yes |
| `TAVILY_API_KEY` | tavily.com, about 1,000 credits a month | Snippet search of TikTok and Instagram; `npm run search`; the MCP server in `.mcp.json` | yes |
| `BRAVE_API_KEY` | api.search.brave.com, 1 query a second | Instagram snippets, new watch-list candidates | off |
| `YELP_API_KEY` | yelp.com/developers, no card | Storefront leads only, held under 24 hours, nothing stored (`docs/YELP-TERMS.md`) | leads |
| `TICKETMASTER_API_KEY` | developer.ticketmaster.com, 5000 calls a day | Ticketmaster matcha events | off |
| `EVENTBRITE_TOKEN` | eventbrite.com/platform/api-keys, 1000 calls an hour | Organizers of known brands and their venues | off |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | A "script" app at reddit.com/prefs/apps | Reddit through the official API | off |
| `CLAUDE_API_KEY` | console.anthropic.com (paid, small) | Quote-checked extraction of unsure finds, at most 20 calls a run | off |
| `MAPBOX_TOKEN` | mapbox.com | Geocoding instead of Nominatim | off |
| `INTAKE_URL`, `INTAKE_TOKEN` | You choose the token; the URL is the deployed site | Pull approved Add-form items at ingest | off |
| `OPENAI_API_KEY` | platform.openai.com/api-keys, about $0.01 to $0.02 an image | `npm run art -- --image-api`: PNG drink art, 5 a run | off |
| `STABILITY_API_KEY` | platform.stability.ai/account/keys, about $0.03 an image | Same, if OpenAI is not set | off |

Older optional keys named in code: `TIKTOK_KEY`, `INSTAGRAM_OEMBED_TOKEN`. Neither is set and neither is needed.

## Steven's steps, in order

Everything else is done or runs by itself.

1. Add form (details in `docs/INTAKE.md`). Create the KV namespace with `npx wrangler kv namespace create INTAKE`. Paste its id into the commented `kv_namespaces` block in `wrangler.jsonc` and commit. Set the moderator token with `npx wrangler pages secret put INTAKE_TOKEN --project-name matchamap`. Deploy, open `/add/`, then `/add/review.html` and paste the token. Until this is done, `/api/*` answers 503 and the forms say "Mattie is napping."
2. GitHub Actions secrets (Settings, Secrets and variables, Actions). For the daily job: `INSTAGRAM_TOKEN`, `INSTAGRAM_BUSINESS_ID`, `TAVILY_API_KEY`, `YELP_API_KEY`, `CLAUDE_API_KEY`, `INTAKE_URL`, `INTAKE_TOKEN`. For deploy: `CLOUDFLARE_API_TOKEN` (Pages edit) and `CLOUDFLARE_ACCOUNT_ID`. A missing secret turns only its own step off. The deploy step runs only when both Cloudflare secrets exist. `watch.yml` needs the two Instagram secrets.
3. Two things only Steven can do. (a) The Meta app password prompt, shown when the token is generated or refreshed and when App Review is submitted; it needs his password. Checklist: `docs/META-APP-REVIEW.md`. (b) The Tavily sign-in on his Chrome tab, which the `TAVILY_API_KEY` depends on.
4. Replace `STEVEN_EMAIL_HERE` with a real address in `site/privacy/index.html` and `site/data-deletion/index.html`. Meta wants both URLs for App Review.
5. Cloudflare Web Analytics: add the site, copy the snippet, put it before `</head>` in `site/index.html` and in the page shell of `tools/gen-pages.js`, and add `static.cloudflareinsights.com` to `script-src` and `cloudflareinsights.com` to `connect-src`. Steps in `docs/ANALYTICS.md`.
6. Optional: free keys from the table above (Ticketmaster, Eventbrite, Yelp, Reddit, Brave) each turn on a crawler with no code change. Check the Instagram token with `node tools/ig-token.js --check`; renew by day 50.

## How the pipeline fits together

`npm run discover` reads the open web and APIs and writes every finding, with its evidence, to `data/review/`. `npm run watch` does the same for Instagram. `npm run ingest` then reads the sources, the inbox, approved Add-form items and the review folder. Items at confirmed or likely confidence that pass the quality rules are promoted; unsure ones wait for a human (`npm run review`). Ingest merges, dedupes, geocodes and writes `data/events.json`, downloads photos, then runs art (a drawing for every drink and every event with no photo), pages, feeds, weekend pages, event pages and sitemap extras. `npm run smoke` checks the built site, and `npm run deploy` publishes it. The daily workflow `.github/workflows/daily.yml` (09:17 UTC) runs discover, art, ingest, feeds and event pages, commits the data, runs smoke, and deploys only if smoke passed. `watch.yml` runs every 6 hours (watch and a light ingest, commit data). `smoke.yml` runs tests and smoke on every push and pull request.

An event is `upcoming` until it ends, then `past`. Past events are kept 30 days, then dropped. An event from a live source not seen for 14 days loses a confidence step per 14 days. Merge rules: same source, day and venue keeps the best confidence and the first-seen date.

## Drink art

Every drink gets a cartoon, with or without a photo. The code is `tools/illustrate/drink.js` (no dependencies); `site/art.js` is the same file for the browser and a test checks they match. `npm run art` writes `site/art/drinks/<slug>.svg` per drink, `site/art/events/<id>.svg` per event with no downloaded photo, and `site/art/index.json`. A second run with the same code and text draws nothing.

A drink gets a picture in one of two ways. First, add it to `data/drinks.json` with a `name`, `aliases`, a `family`, a `popularity` from 1 to 5 and `components` (base, layers with hex colours, top, toppings, serve, hot, garnish) using only the words in the file's vocabulary. Any menu line that matches the name or an alias is drawn from these parts, and the file's colours win. Second, do nothing: a drink that only appears in a menu is read from its words (cup, flavour, ice, foam, toppings, straw, garnish). Words it does not know get no art; `npm run art` prints how many. To teach it a flavour, add a colour to `FLAVORS` in `drink.js`.

Look at the result at `/art/gallery.html` (light, dark, phone size, and a live box). The image API (`npm run art -- --image-api` with `OPENAI_API_KEY` or `STABILITY_API_KEY`) is off by default and adds PNGs beside the SVGs. Details: `docs/ART.md`. Which drinks are trending, with evidence: `docs/TRENDING-2026-11.md`.

## Site and domain

- Cards, pages and share: `/` the map; `/city/<state>/<slug>/`, `/brand/<handle>/`, `/weekend/<city>-<st>/`, `/e/<id>/` are static pages that link back with `/?city=`, `/?event=`, `/?brand=`. Search is `site/search.js`.
- Forms: `/add/`, `/report/?event=<id>`, `/claim/?brand=<id>`, `/alerts/` (collects an email; nothing mails it, no double opt-in yet), `/privacy/`, `/data-deletion/`. Empty-state strings are in `docs/COPY.md`.
- Installable: manifest, icons and `site/sw.js`. Shell files are network-first. `tools/sw-version.js` stamps the version; `npm run deploy` runs it, so do not deploy by another route.
- Domain: `https://matchamap.app` (Cloudflare Registrar, attached to the Pages project; `matchamap-cu7.pages.dev` redirects to it). The one place it is set is `SITE_URL` in `tools/site-url.js` (env `SITE_URL` overrides for a one-off run); canonicals, Open Graph, sitemap, JSON-LD, feeds, event and weekend pages and the outreach CSVs are built from it by `npm run ingest`. A later change is that default, `npm run ingest`, deploy, then the new property in Search Console with `sitemap.xml`.
- Calendar: `webcal://matchamap.app/feeds/all.ics`, or a city, for example `austin-tx.ics`.

## Layout

- `site/`: the static site (`index.html`, `app.js`, `style.css`, `cards.js`, `search.js`, `art.js`, `sw.js`) and its generated parts: `data/`, `city/`, `brand/`, `weekend/`, `e/`, `feeds/`, `art/`, `og/`, `img/events/`, `add/`, `report/`, `claim/`, `alerts/`. `site/INTEGRATION.md` says how the card and search pieces wire in.
- `ingest/`: `run.js`, `watch.js`, `loop.js`, `adapters/` (one per source kind), `lib/` (fetch, extract, geocode, quality, review, write) and `lib/sites/` (one crawler per site).
- `functions/`: Cloudflare Pages Functions for the Add, report, claim and alerts forms (KV namespace `INTAKE`).
- `data/`: `sources.json` (brands), `events.json`, `watchlist.json`, `drinks.json`, `cities.json`, `review/`, `inbox/`, `wave2` to `wave4/` (sweep output), `overrides.json`, `geocache.json`, `shops.json`, `schema/`, `tavily-budget.json`.
- `tools/`: dev server, page, feed, weekend and OG generators, `illustrate/` (drink art), `brand/` (flyer templates), smoke test, audit.
- `test/`: unit tests. `qa/`: QA screenshots and tables.
- `docs/`: setup and review notes. `.github/workflows/`: `daily.yml`, `watch.yml`, `smoke.yml`.
- `SPEC.md` is the contract. `LADDER.md` is the build log. `.mcp.json` gives a Claude Code session Tavily search (it reads `TAVILY_API_KEY` from the shell).

## Quality rules and corrections

What gets dropped (`ingest/lib/quality.js`, tested in `test/noise.test.js`):

- Hotel listings, craft or pottery classes, fitness sessions, generic place names, charity and networking titles, unless the title names matcha or the text names it as the point.
- Brunch: a find from an event site by a non-matcha brand with two brunch words, or one hard word (trivia, bingo, drag, happy hour, bottomless), and matcha only in the title.
- No matcha signal: a find that is not a source in `data/sources.json` needs matcha, hojicha, usucha, koicha, ceremonial grade or a drink from `data/drinks.json` in its text.
- Handle-like brand names are tidied ("bujimatcha" becomes "Buji Matcha").
- Everything that is a real matcha event stays visible by default. Pop-ups with no place are collapsed to one row per city and counted in quiet text; the Unconfirmed switch can hide them.

To override one event, put its id in `data/overrides.json`. `{"drop": true}` removes it; other fields patch it. Shops are hidden or fixed in `data/shops-overrides.json`. To report one, use `/report/?event=<id>` on the site, or add a pop-up at `/add/`; both land in the queue at `/add/review.html`. To add a pop-up by hand, put the post in `data/inbox/<name>.txt` (first line the post URL, then the caption) and run `npm run ingest -- --inbox`. Add a new brand to `data/sources.json` first or the post is skipped; then run `node tools/gen-cities.js`. Run `npm run audit` after a big ingest. Findings of the last pass: `docs/DATA-QUALITY-2026-11-23.md`.

## Posts, flyers, storefronts, Instagram account

- Flyers: `npm run flyers` writes Instagram posts for @matchamap.app (single pop-up flyers for the next 7 days, a "This weekend in <City>" roundup for cities with three or more, a welcome post) to `tools/brand/outbox/<date>/` with a caption and `INDEX.md`. Templates are in `tools/brand/templates/`, rendered with headless Chrome (`CHROME_PATH` if not at the default). `--force` redraws. Every caption credits the brand. Nothing is posted automatically; a human checks each source and posts by hand. Publishing through the Graph API needs `instagram_content_publish` and is not built.
- Storefronts: a map layer of permanent matcha shops from OpenStreetMap (`npm run shops`). A shop needs a name and a street address; it is drawn only when it has a website, hours or a phone. Data is (c) OpenStreetMap contributors, ODbL.
- Instagram account: the Meta app "Matcha Map" reads public posts of professional accounts and public hashtags, links back to each post, stores no personal profile data and never posts. Setup `docs/INSTAGRAM-SETUP.md`, readiness and budget `docs/INSTAGRAM-READINESS.md`, review `docs/META-APP-REVIEW.md`.

## License

MIT. See `LICENSE`.
