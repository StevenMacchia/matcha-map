# Overture Maps places: the open source for "every matcha place near me" (spec, Population lane)

Written 2026-11-23 for the first rung after the usage reset (Friday 2026-11-28 09:00Z). This is a spec only: no worker was spent and no data was pulled. Items marked CHECK were not verified when this was written and must be confirmed against the current Overture docs before the run.

## Why

Steven, shown a Google Maps search for "matcha" in Durham with eight rated places: the map must show where the matcha places are, where they pop up, and shop info for people looking for shops. Google Places content cannot be shown on a non-Google map and Yelp content cannot be stored (Yelp API terms 5(a) and 5(b); `docs/YELP-TERMS.md`). Overture's places theme is an open dataset that can be stored and redistributed, so it is the backbone for the permanent-place layer, while workers and the brands' own sites supply the facts Overture lacks (menus, hours, pop-ups).

## What Overture gives us, and what to check first

- Open data, no key: Parquet files on S3 (`s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/`; CHECK the current release name and path on docs.overturemaps.org) queried with DuckDB (httpfs plus spatial), filtered by bounding box or US country so only the needed rows download.
- License: the Places Guide says the theme is published under CDLA Permissive 2.0 and Apache 2.0 and carries no OpenStreetMap share-alike obligation; the September 2025 release notes say places is now multi-license, each place's license set by its source property (Foursquare-sourced rows are Apache 2.0, for example). So the run must keep each row's `sources` (dataset, record id, license) and not assume one license for the whole file. Overture does not require on-map text attribution, but its attribution page suggests citing "Overture Maps Foundation, overturemaps.org" with the access date, and some sources carry their own requirements (CHECK `docs.overturemaps.org/attribution`). Ask the site session for one credits line.
- Schema change: the places guide says the old `categories` property is replaced by `basic_category` and `taxonomy`. The category filter below is written in both forms; CHECK which the current release has before writing the query.
- Fields to read (CHECK names against the current schema reference): `id` (the stable Overture id), `names.primary`, the category fields, `addresses`, `websites`, `socials`, `phones`, `brand`, `confidence`, the operating-status field if present, `sources[]`, `geometry`.

## What to pull

US only. Keep a place when ANY of:
1. its name contains `matcha` or `抹茶` (any case, diacritics folded); or
2. its category is cafe, coffee shop, tea room, bubble tea shop, dessert shop or Japanese restaurant (current taxonomy names; the older ones were `coffee_shop`, `cafe`, `tea_room`, `bubble_tea_shop`, `dessert_shop`, `japanese_restaurant`) AND it has a website; skip rows with a low `confidence` (start at 0.6) or a closed or permanently-closed status.

Write the raw pull to a gitignored folder (`.cache/overture/<release>/places-us-filtered.parquet`), never into the repo; only rows that become shops are written to `data/` (below), with the Overture id and sources.

## What becomes a row

All through the existing shop pipeline (`ingest/lib/shops/curated.js`, ids `brand:...` for the `?shop=` deep link), written by a new `ingest/shops-overture.js` to `data/shops-overture.json` in the researched-row shape.

1. **Core shop rows (matcha in the name, or a known matcha chain):** a row per place, tier `shop`, shown on the map with `confirmed_via: "overture"` and `verified: false` until the shop's own site confirms (the existing `confirmCandidate` in `ingest/lib/shops/providers.js` is the check: same street number or zip on the site, matcha on the site). Same shown-but-unverified behaviour as `public-page` rows. Keep the Matcha Cafe Maiko stores held (the 20 held rows stay held; an Overture row for a Maiko location is also held until a dated post shows activity after Nov 8).
2. **Serves candidates (cafes, tea rooms, bubble tea, dessert, Japanese with a website):** not shown. Each is run through the menu reader (`confirmCandidate`; its `matchaDrinks` finds at least three distinct matcha drinks on the shop's own menu page) and becomes a tier `serves` row only when it passes. The reader costs about 5 page fetches per site at one request a second per host, so the run is capped (see Volume).
3. **Instagram handles (from `socials`)** of every place that becomes a row, and of every cafe or tea room with a handle, go to the watch list as host-venue candidates (`found_via: overture`, status `candidate`), so the host-venue pop-up discovery (`docs/DISCOVERY-RECALL.md`, adapter 2) can read the places that host pop-ups. The Graph reads only business or creator accounts; others are marked unreadable like today.
4. **Yelp leads reconcile with Overture rows.** The daily Yelp lead run (leads live only in the 24-hour cache) first matches each lead to an Overture row by normalized name and distance (150 m); a match uses the Overture row's website for the own-site check, so most leads no longer need a worker. Nothing from Yelp is stored: the match result is not saved, only the resulting own-site confirmation on the Overture-based row.

## Volume and pacing

Order of work: (a) the matcha-named places (hundreds nationally): one run; (b) Japanese restaurants, tea rooms and bubble tea shops with a website (thousands): menu reader, 1,500 sites a day; (c) cafes and coffee shops with a website in the 2,410 top-50-per-state cities, thin cities first (tens of thousands: weeks, capped at 1,500 sites a day, no worker). Reads respect robots.txt and the shared fetcher's 1 request per second per host, 6 hour cache. Toast, Square and other ordering hosts that bot-challenge are skipped, never worked around.

## Proof and reporting

- Per state before and after: shops shown, serves rows, cities with at least one shop.
- First proof against the recall sample (`data/recall/`): how many of the 30 sampled brands, and of the 8 brands without a dated page, exist as Overture rows (by name or Instagram handle); how many of their host venues are Overture places with a website or handle. Independent pop-ups with no storefront will mostly NOT be in Overture; the dataset is for shops, hosts and venues, not for the pop-ups themselves.
- The Triangle, Austin, Denver, Seattle, Atlanta and Phoenix first, as the command center asked.

## Dependencies and risks

- DuckDB: the `duckdb` Node package or the CLI; CHECK that a Windows prebuilt installs without a compiler and add it as a dev dependency only if so (otherwise run the CLI from a script).
- Overture rows can be stale or wrong (closed places, moved shops, misread websites): hence unverified until the own-site check, `confidence` and status filters, and no pin for a serves candidate without a menu proof.
- Multi-license: store `sources[]` with each row; do not strip source or license fields.
- No person's data: businesses only; drop any place whose category is a home or a private person.

## Acceptance

`npm run shops:overture` (to be added) pulls and filters in under 30 minutes on the first run, writes `data/shops-overture.json` only for rows that pass the rules above, does nothing and says so without DuckDB or network, and has fixture tests for the filter, the row mapping, the Maiko hold and the Yelp reconciliation; tests green, smoke green, per-state table reported to the command center.
