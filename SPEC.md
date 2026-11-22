# Matcha Map: spec

Verdict: a quiet static map of matcha pop-ups in the US. Find one near you on a given day. Data comes from a small pipeline plus manual paste. No scraping of Instagram or TikTok.

## 1. What it does

The site shows where and when matcha pop-ups happen across America. It is for people who want to find one near them today, this weekend or next week. Each pin is one dated event with a place, a time and a link to the source post.

It is not a review site. It is not a store finder for permanent cafes. Pop-ups and limited-run events only. A permanent shop appears only when it hosts a dated event.

## 2. Source record

`data/sources.json` is an array of sources. A source is a brand we follow. Schema: `data/schema/source.schema.json`.

| Field | Meaning |
|---|---|
| id | Slug, unique. |
| brand | Display name. |
| kind | `popup`, `cafe`, `venue`, `tea-brand`, `organizer` or `festival`. What sort of source it is; definitions in `data/KINDS.md`. The site shows every kind of matcha event by default; Show can narrow to `popup`. |
| category | `matcha`, `coffee`, `boba`, `bakery`, `dessert` or `other`. What the brand mainly serves; `matcha` for everything today, the rest are for later expansion. |
| kind_note | One short line on why, for anything that is not `popup`; null otherwise. |
| home_city, home_state | Where the brand is based. State is two letters. |
| website | Brand site, or null. |
| instagram | Handle without `@`, or null. |
| tiktok | Handle without `@`, or null. |
| schedule_url | Linktree, Eventbrite organizer, Partiful, Shopify or Squarespace events page, or null. |
| schedule_kind | `website`, `eventbrite`, `partiful`, `linktree`, `ics`, `rss`, `manual`, `none`. |
| adapter | Name of the ingest adapter that reads it. |
| active | Bool. Inactive sources are skipped. |
| notes | Free text. |
| added | Date added. |
| verified | Date a human last checked the handles. |

Example:

```json
{
  "id": "example-matcha-co",
  "brand": "Example Matcha Co",
  "kind": "popup",
  "category": "matcha",
  "kind_note": null,
  "home_city": "Los Angeles",
  "home_state": "CA",
  "website": "https://example.com",
  "instagram": "examplematcha",
  "tiktok": null,
  "schedule_url": "https://example.com/events",
  "schedule_kind": "website",
  "adapter": "website",
  "active": true,
  "notes": "Posts pop-ups two weeks ahead.",
  "added": "2026-11-22",
  "verified": "2026-11-22"
}
```

## 3. Event record

`data/events.json` is `{generated, events: [...]}`. Schema: `data/schema/event.schema.json`.

| Field | Meaning |
|---|---|
| id | Stable. Hash of source id + start + venue. |
| brand, source_id, handle | Who. Handle is the social handle the event was seen on, or null. |
| source_url | The post or page the event came from. |
| title | Short event name. |
| start | ISO 8601 with offset, local to the venue. |
| end | ISO 8601 or null. |
| tz | IANA zone. |
| all_day | Bool. |
| venue, address, city, state, zip | Where. Address is the street. State two letters. Zip or null. |
| lat, lng | Coordinates, or null if not geocoded. |
| geocode_source | `nominatim`, `mapbox`, `manual`, `none`. |
| confidence | `confirmed`, `likely`, `unsure` (below). |
| status | `upcoming`, `past`, `cancelled`. |
| first_seen, last_seen | ISO timestamps. |
| extracted_by | `rule`, `llm`, `manual`. |
| image | `{url, local, credit, width, height}` or null. The post or page photo: `url` is the remote image, `local` the downloaded copy under `site/img/events/` (null if the download failed), `credit` the brand handle or source host, size read from the file header. |
| posts | `{instagram, tiktok, other}`, each a URL or null. Instagram `/p/` and `/reel/` links and TikTok video links go in their own key; the source page goes in `other`. |
| menu | Array of up to 8 short strings (40 chars or fewer, lowercase): flavors and items the source names, such as `strawberry matcha`, `ube latte`, `hojicha`. `[]` when unknown. |
| price | String or null, as stated: `$7–9`, `from $6`, `free`. |
| description | String or null, up to 200 chars: a cleaned first line of the caption or event description (no URLs, hashtags, mentions or emoji). Only from the brand's own words, never a scraped date line. |
| links | `{website, instagram, tiktok}` of the brand (profile URLs), copied from the source record. |

All six new fields are required keys and nullable. A field is filled only when the source really gives it. Existing events are migrated on load (`migrateEvent` in `ingest/lib/write.js`): image null, posts from `source_url` when it is an Instagram or TikTok post, menu `[]`, price and description null, links from the source.

Images are the brands' own public promo photos, shown with credit and a link back to the post. Each is downloaded once to `site/img/events/<event id>.<ext>` (jpg, png or webp, 2 MB or less, at most 2 redirects, robots.txt honored, 1 request per second per host) because Instagram CDN links expire. The remote URL is kept as the fallback; the site prefers the local copy.

Confidence:

- confirmed: date, time and address all read from the source.
- likely: one field inferred, for example the time is missing.
- unsure: extracted by a model, or from a caption with ambiguity.

Example:

```json
{
  "id": "a1b2c3d4e5f6",
  "brand": "Example Matcha Co",
  "source_id": "example-matcha-co",
  "handle": "examplematcha",
  "source_url": "https://example.com/events/spring-popup",
  "title": "Spring pop-up at Sunny Books",
  "start": "2026-12-06T11:00:00-08:00",
  "end": "2026-12-06T15:00:00-08:00",
  "tz": "America/Los_Angeles",
  "all_day": false,
  "venue": "Sunny Books",
  "address": "123 Main St",
  "city": "Los Angeles",
  "state": "CA",
  "zip": "90012",
  "lat": 34.0522,
  "lng": -118.2437,
  "geocode_source": "nominatim",
  "confidence": "confirmed",
  "status": "upcoming",
  "last_seen": "2026-11-22T18:00:00Z",
  "first_seen": "2026-11-20T09:00:00Z",
  "extracted_by": "rule",
  "image": { "url": "https://cdn.example.com/spring.jpg", "local": "img/events/a1b2c3d4e5f6.jpg", "credit": "@examplematcha", "width": 1080, "height": 1350 },
  "posts": { "instagram": "https://www.instagram.com/p/AbC123/", "tiktok": null, "other": "https://example.com/events/spring-popup" },
  "menu": ["strawberry matcha", "ube latte", "hojicha"],
  "price": "$7–9",
  "description": "Our spring pop-up is back at Sunny Books.",
  "links": { "website": "https://example.com", "instagram": "https://www.instagram.com/examplematcha/", "tiktok": null }
}
```

Rules:

- Times are local to the venue.
- If only a date is known, `all_day` is true and start is 00:00 local.
- Events are deduped by id.
- An event not seen in 14 days from a live source is kept, and its confidence drops one step.
- Past events are kept 30 days, then dropped from the site file.

## 4. Adapters

Each adapter is a module at `ingest/adapters/<name>.js`:

```js
export default {
  name: "eventbrite",
  matches(source) { /* true if this adapter reads this source */ },
  async fetch(source, ctx) { /* returns RawItem[] */ },
};
// RawItem = { source_url, text, html?, published_at?, hints?: { start?, venue?, address? },
//   image_url?, posts?: { instagram?, tiktok? }, description?, price_hint? }  (all optional; set only when the source gives them)
```

### Event sites (crawlers)

Besides per-source adapters, `npm run discover` runs one crawler per public event site: `ingest/lib/sites/<name>.js` exports `{ name, host, discover(ctx) -> { items, candidates, leads?, stats } }`. Sites, in order (the order is also the duplicate priority, real sources first): `mato` (ingest/lib/mato-city.js), `luma` (discover places + paging API), `eventbrite` (city search pages + event pages JSON-LD), `dostuff` (16 city sites with a matcha search page), `meetup` (public search, Apollo state in the page), `linktree` (bio and link titles of known brands on linktr.ee or beacons.ai; linktr.ee's robots.txt disallows us, so only Beacons pages are read), `allevents` (city pages, JSON-LD, FAQ times). Flags `--no-<name>` and `--only <name>`.

Rules for every crawler: robots.txt first (skip on 401/403/429 or a Disallow of /), project User-Agent, 1 request per second per host, the 6-hour cache, 300 network fetches per site per run, stop for the run on HTTP 429 or 403, prefer sitemaps, JSON-LD and embedded page JSON, no endpoint that needs a login, never instagram.com, tiktok.com or facebook.com, matcha events only. A RawItem carries `source_hint`: the source it belongs to. Events from a site that no source reads get the pseudo-source `<site>:<organizer slug>` (kind popup, or organizer by the title rule; category matcha; brand = organizer; handle and `links.instagram` only when the page gives an Instagram handle). A new organizer becomes a watchlist candidate with `found_via: search`, `found_from: <site>` and a note `site=<name>; org=<slug>; home=City, ST; brand=...`. The same title on the same day from two sites keeps the better-ranked one; Allevents events are never "confirmed". Linktree schedule links go to `data/discover-leads.json` under their source id. Eventbrite organizer pages are also an adapter (`ingest/adapters/eventbrite.js`, embedded `upcomingEvents`). Checked and skipped: Yelp (robots disallows all), Posh, Partiful, Resident Advisor; TikTok, Instagram and Facebook are never crawled.

Pipeline: adapters return RawItems. A shared extractor turns each into event candidates (rules first, optional LLM step). The geocoder fills lat/lng. The writer dedupes and writes `data/events.json`. Adapters never touch the map. An Instagram or TikTok adapter drops in later with the same shape.

## 5. Instagram and TikTok: the honest rules

We do not scrape those apps behind their login walls or around their bot checks. It breaks their terms and gets blocked. So:

- No scraping with logged-in cookies.
- No headless-browser evasion.
- No bypassing bot detection.

What we do instead:

- Instagram Graph API: needs a connected Instagram business or creator account and a Meta app. Wired as an adapter, off until keys exist.
- TikTok Display API or Research API: needs an approved app. Wired as an adapter, off until keys exist.
- oEmbed: only for a single public post URL a human pasted. Instagram oEmbed needs a Meta app token. TikTok oEmbed (`https://www.tiktok.com/oembed`) is open and returns title and author for a public video URL.
- Manual paste (section 6) is the main way the map stays fresh while coverage grows.

The watch list. `data/watchlist.json` holds every account the map watches: handle, status (candidate, watching, quiet, dropped), when it was last checked, hits and a cadence. Watching accounts with a pop-up in the last 30 days are checked every 24 hours, other watching accounts every 72, quiet ones every 168. An account goes quiet after 90 days without a dated pop-up, and a candidate with none in 60 days is dropped. A candidate becomes watching on its first dated pop-up. `npm run watch` does the checking through the shared pipeline; `--promote` turns watching accounts with hits into records in `sources.json` for a human to finish.

Discovery. `npm run discover` adds candidates from: @mentions and collabs next to pop-up words in captions the pipeline holds (inbox, cache, Graph results), Instagram hashtag search through the Graph API, the Brave Search API for `site:instagram.com` queries (key needed), and the public MATO and Luma listing pages within robots.txt. Every source is official or open. Nothing logs in, and nothing evades a check.

For brand websites and schedule pages:

- Respect robots.txt and rate limits.
- Identify with a plain User-Agent that names the project and a contact.
- Cache fetches.
- Never store personal data about commenters or followers. Store only the brand's public event facts.

## 6. Manual intake

Run `npm run ingest -- --paste`, or drop a file in `data/inbox/*.txt`. Steven pastes a post URL and/or caption.

The extractor reads, by rules: date words ("this Saturday", "Dec 6"), times ("11am-3pm"), street-address patterns, and "@venue". It asks nothing. It writes a candidate with confidence `unsure` or `likely`.

If env `CLAUDE_API_KEY` is set, an optional Claude step (model `claude-sonnet-5-5`) improves the candidate. It must work without the key.

## 7. Geocoding

- Nominatim (OpenStreetMap), with a required User-Agent, at most one request per second.
- Disk cache at `data/geocache.json`, keyed by the normalized address.
- Mapbox instead, if `MAPBOX_TOKEN` is set.
- Manual lat/lng overrides go in `data/overrides.json`, and win over any geocoder.

## 8. The site

A static page in `site/`. Plain HTML, CSS and JS. No build step to run it. MapLibre GL JS from a pinned CDN version over OpenFreeMap vector tiles, with the required OpenStreetMap attribution. It reads `site/data/events.json`, copied from `data/events.json` by the ingest step.

Phone first at 390px, then 1440px.

Features:

- Clustered pins.
- Date picker.
- Filters: Today, This weekend, Next 7 days.
- "Near me" through browser geolocation. Asked only on tap, never on load.
- A list view that mirrors the map.
- A card per event: brand, when, address, a link to the source post. Few words.
- Confidence shown as one small word, only when it is not confirmed.
- What counts (see data/KINDS.md): every event carries `kind` and `category` copied from its source. The map, list and brand layer show category `matcha` with every kind on by default. One "Show" pill in the filter row, after the date chips, opens a small popover (a positioned panel, not a dialog; closes on outside tap and Escape). It holds a first switch, "Pop-up brands only" (off; when on it keeps kind `popup` and greys out the kind boxes), then checkboxes for kinds, all on by default (Pop-ups, Cafes that pop up, Classes and meetups, Festivals, Hosts and venues, Tea brands) and, under a thin rule, categories (Matcha on; Coffee, Boba, Bakery, Dessert, Other off). A count badge ("Show · 3") counts the choices that differ from the default. On phones (640px and under) the date chips keep their sideways-scrolling row and Show, Near me and the zip box sit in a second, non-scrolling row. The choice is kept in localStorage. Cards and rows show the kind as a tiny muted word only when it is not a pop-up.
- Zip search: a zip field and Go button next to "Near me". The first use loads `site/data/zips.json` (GeoNames centroids, CC BY 4.0), flies to the zip at zoom 10, drops Chasen there, sorts the list by distance and keeps the zip in localStorage. A "Near 27601 · Clear" row sits under the chips. An unknown zip shakes the field and says "No such zip" for 3 seconds. Near me and a zip clear each other.

Look: quiet. No dashboards, no gamified chrome, no gradients for their own sake.

## 9. Non-goals for v1, open questions

Non-goals:

- Accounts, saved lists, notifications.
- Reviews, ratings, menus, prices, ticketing.
- Outside the US.
- Any scraping of Instagram or TikTok.
- A backend. The site is static files.

Open questions:

- Who reviews `unsure` events before they show?
- Do we ask brands to submit events directly?
- Does the Graph API route get used, or does paste stay the whole story?
- When does the pipeline run: by hand, or on a schedule?
