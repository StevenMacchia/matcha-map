# Matcha Map

## What this is

A map of matcha pop-ups across America, by day, so you can find one near you when you are free. It is a plain HTML site on Leaflet and OpenStreetMap, fed by a small ingest script that writes `data/events.json`.

Coverage, as of 2026-11-22: 37 brands, 4 upcoming pop-ups. Most brands post dates on Instagram only, so the map is only as fresh as the hand-added posts.

## Run it

No `npm install` is needed. Node 20 or newer.

- `npm run dev` (or `npx serve site -l 8790`) serves `site/` at http://localhost:8790.
- `npm run ingest` reads every active source and rewrites `data/events.json`, then copies it and `data/sources.json` into `site/data/`. It takes about a minute on a cold cache and caches fetches and geocodes in `.cache/` and `data/geocache.json`.
- `npm test` runs the unit tests.

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

- MATO venue pages: event pages are read through their JSON-LD.
- Luma calendars: embedded page data, with the calendar's ICS feed as a fallback.
- Brand pages: schedule or events pages on a brand's own site, read by rule.
- The inbox: posts pasted by hand.

Not covered: Instagram and TikTok are not scraped. Their terms forbid it and the pages need a login, so this project does not try. Two adapters are wired but off:

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

## Deploy later

Nothing is deployed yet. The plan is Cloudflare Pages serving the `site/` folder, with `npm run ingest` run before each publish. The pages load Leaflet from unpkg with pinned versions and SRI hashes.

## Layout

- `site/`: the static site (`index.html`, `app.js`, `style.css`, `cities.js`, `data/`).
- `ingest/`: `run.js`, `adapters/` (one per source kind) and `lib/` (fetch, extract, geocode, write).
- `data/`: `sources.json`, `events.json`, `inbox/`, `schema/`, geocode cache and overrides.
- `test/`: unit tests.
- `SPEC.md`: the contract. `LADDER.md`: the build log.

## License

MIT. See `LICENSE`.
