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
- `npm run refresh` runs discover, watch and ingest once, in that order. `npm run loop` does the same every 6 hours while the window stays open. See "Run it on a schedule".

Ingest flags: `--source <id>`, `--paste`, `--inbox`, `--no-fetch`, `--dry`, `--verbose`.

## How to add a source

Edit `data/sources.json`, one object per brand (schema in `data/schema/source.schema.json`). Fields: `id`, `brand`, `home_city`, `home_state`, `website`, `instagram`, `tiktok`, `schedule_url`, `schedule_kind`, `adapter`, `active`, `notes`, `added`, `verified`.

The adapter is picked by the first match, in this order:

1. `mato`: `schedule_url` is on ma.to.
2. `luma`: `schedule_url` is on luma.com or lu.ma.
3. `ics`: `schedule_kind` is `ics`.
4. `website`: `schedule_kind` is `website`.
5. `manual`: `schedule_kind` is `manual` or `none`. Dates come from the inbox only.

Add the home city to `site/cities.js` or the brand will have no pin. Then run `npm run ingest -- --source <id>`.

## How to add a pop-up by hand

Put one post per file in `data/inbox/`, for example `data/inbox/sunny.txt`. First line is the post URL (optional), the rest is the caption:

    https://www.instagram.com/p/XXXXXXXX/
    Pop-up this Saturday 11am-3pm at @sunnybooks, 123 Main St, Los Angeles, CA 90012

Run `npm run ingest -- --inbox`. To paste straight from the clipboard, run `npm run ingest -- --paste` and feed the text on stdin, or add `--file <path>`.

The post is matched to a source by the handle in the URL or an @handle in the caption. No match means it is skipped, so add the brand first. The extractor reads dates, times and addresses by rule. Confidence is `confirmed` only with a dated, timed, street-addressed post. A date plus a time, address or venue gives `likely`. Anything vaguer, such as "this Saturday" with no place, is `unsure`. With `CLAUDE_API_KEY` set, a model helps with hard captions. Events from live sources not seen for 14 days lose one confidence step.

Only real, public posts. Nothing is invented.

## Where the data comes from

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

## Optional keys

Set as environment variables. All are optional; the site and ingest work without them.

| Variable | What it turns on |
|---|---|
| `CLAUDE_API_KEY` | Model help extracting dates and places from hard captions. |
| `MAPBOX_TOKEN` | Mapbox geocoding in place of Nominatim. |
| `INSTAGRAM_TOKEN` | Instagram Graph adapter (also reads `INSTAGRAM_USER_ID`). |
| `TIKTOK_KEY` | TikTok API adapter. |
| `INSTAGRAM_OEMBED_TOKEN` | Captions for pasted Instagram links. |

## Keep it fresh

The map keeps a watch list of accounts in `data/watchlist.json` (every Instagram handle in `data/sources.json`, 82 today, plus 22 candidates found by discovery; 104 accounts as of 2026-11-22).

- `npm run discover` finds new candidate accounts: @mentions in captions we already hold, Instagram hashtags (needs a token), Brave search (needs `BRAVE_API_KEY`), and public MATO and Luma pages. Add `-- --dry` to preview.
- `npm run watch` checks every account that is due (24, 72 or 168 hours apart) and writes new dates to the map. Flags: `-- --all`, `-- --handle <h>`, `-- --dry`, `-- --promote` (turns accounts with real hits into source records).
- Without any key, discover and watch still work: they read public MATO and Luma pages, the schedule pages of the brands that have one, and @mentions in text already held. They cannot see an Instagram or TikTok account, so a brand with no public schedule page stays a pin with no dates. `-- --promote` changes nothing unless an account has a real hit.
- Instagram runs only through Meta's official Graph API and stays off until `INSTAGRAM_TOKEN` and `INSTAGRAM_BUSINESS_ID` are in `.env`. Setup: `docs/INSTAGRAM-SETUP.md`. Copy `.env.example` to `.env`.
- `.github/workflows/watch.yml` runs discover, watch and ingest every 6 hours and commits the data. It only matters once the repo is on GitHub.

## Run it on a schedule

- `npm run loop`: discover, then watch, then ingest, at once and again every 6 hours while the terminal stays open. Each cycle prints one line with a timestamp, the result and time of each step, and the event counts. A step that fails is reported and the next one still runs. Ctrl+C stops it. `-- --every 2` changes the interval in hours.
- `npm run refresh`: the same three steps once. Exit code 1 only if a step crashed.
- Windows, without leaving a terminal open: `powershell -ExecutionPolicy Bypass -File toolswindows-task.ps1` registers a Task Scheduler job named "Matcha Map refresh" that runs `npm run refresh` in this folder every 6 hours as you, while you are signed in, and logs to `.cache/refresh.log`. Remove it with `-Remove`. The script is not run for you.
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
