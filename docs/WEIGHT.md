# Page weight

Measured 2026-11-23 against https://matchamap-cu7.pages.dev with `accept-encoding: br, gzip`
(`curl -s -o /dev/null -w '%{size_download}'`). "Transferred" is what the browser downloads (Cloudflare serves Brotli);
"On disk" is the raw file in `site/`.

| Resource | Transferred (bytes) | On disk (bytes) | Type |
|---|---:|---:|---|
| /data/events.json | 198,577 | 1,646,463 | json |
| /cities.js | 73,129 | 206,889 | js |
| /app.js | 41,601 | 133,021 | js |
| /data/brands.json | 90,895 | 249,281 | json |
| unpkg maplibre-gl@4.7.1 (js) | 211,126 | n/a | js |
| /style.css | 13,584 | 57,419 | css |
| /cards.css | 5,060 | 21,295 | css |
| / (index.html) | 4,309 | 14,626 | html |
| /drawn.js | 4,537 | 11,410 | js |
| /characters.svg | 4,355 | 36,041 | svg |
| /data/shops.json | 3,637 | 16,845 | json |
| maplibre-gl.css | 9,183 | n/a | css |

First ten event photos (`img/events/*.webp|jpg`, already WebP, not further compressible): 38,648 / 15,538 / 30,072 /
29,554 / 76,624 / 12,334 / 35,593 / 24,933 / 31,010 / 22,391 bytes = 316,697 bytes. Photos load lazily, so only the
ones in or near the viewport are fetched.

## What the 5.5 MB in the local Lighthouse run was

The local server (`tools/serve.js`) does not compress. Uncompressed, the start-up set is `events.json` 1.65 MB, the
MapLibre bundle about 0.8 MB (unpkg), `brands.json` 0.25 MB, `cities.js` 0.21 MB, `app.js` 0.13 MB, the CSS files
about 0.1 MB, plus map tiles, fonts and the first photos. On the live site the same documents transfer at roughly
0.6 MB of code and data before images, because Brotli takes the JSON to about 12 percent of its size. The local
figure overstates what a visitor downloads by about 3x.

## Cheap wins taken (no change to look or shell)

- Event pages: the hero image is the largest element above the fold, so on a page (`ctx.page`) it is fetched with
  `fetchpriority="high"` instead of `loading="lazy"`. Everywhere else (list, map pop-up, brand and city pages) it
  stays lazy.
- Hero photos carry `width`/`height` from the event's known image size, and list thumbnails carry `width="68"
  height="68"` (CSS already fixes both boxes, so there is no layout change, only less shift).
- Every other card and thumbnail image already had `loading="lazy" decoding="async"` (checked in `site/cards.js`).

## Left alone

Biggest remaining lever is `events.json` (198 KB compressed): a trimmed list payload with details fetched on open
would cut it, but that touches `site/app.js`. MapLibre (211 KB) is third party and out of scope.

## Rung 3: a slim list for the first paint (2026-11-23)

`tools/slim-events.js` writes `site/data/events-slim.json` (run by `npm run pages` and at the end of `npm run feeds`, the
daily step). It keeps what a list row and a pin read: id, brand, handle, start, end, all_day, venue, city, state, lat,
lng, status, confidence, kind, approx, series, menu names, the local photo path, plus tz, category, source_id, hours,
geocode_source, title and address (the "today" words, the filter chips, the brand fallback and the approximate-pin rule
need them). No description, posts, links, evidence, prices or remote photo URLs.

| File | Raw bytes | gzip -9 bytes |
|---|---:|---:|
| data/events.json | 1,536,294 | 208,220 |
| data/events-slim.json | 353,701 | 46,538 |

The blocking list/map fetch drops 78 percent (compressed 208 KB to 47 KB; Brotli on the live site is about 198 KB to
roughly 40 KB). `app.js` starts from the slim file and fetches the full `events.json` right after the first list; the
full records replace the slim ones in place by id, and a card that is opened before they land waits for them.

Lighthouse mobile, home page, local `tools/serve.js` (uncompressed, so the whole 1.5 MB shows as transferred in the
"before" run; two runs each):

| | Perf score | FCP | LCP | TBT |
|---|---:|---:|---:|---:|
| Before | 90 / 87 | 2.1 s | 2.1 s | 140 / 240 ms |
| After | 91 / 87 | 2.0 s | 2.0 s | 120 / 250 ms |

The run to run spread (TBT 120 to 250 ms) is larger than the difference: on this machine the gain is inside the noise,
and the byte saving is where the win is (most for a phone on a slow link). The full file still downloads, just after
the first paint.

## City pages in the mock's shape (2026-11-23, lane/seo-city)

Lighthouse mobile (simulated slow 4G), local build. `tools/serve.js` does not compress; `npx serve site` gzips, which is
closer to Cloudflare (Brotli). Seattle is the densest city page (66 pop-ups, 12 shops, 15 brands: 139 KB raw, 13.7 KB gzip).

| Page | Server | Perf | FCP | LCP | TBT | CLS |
|---|---|---:|---:|---:|---:|---:|
| /city/wa/seattle/ | serve.js, uncompressed | 91 | 2.8 s | 2.8 s | 0 ms | 0.045 |
| /city/wa/seattle/ | gzip, two runs | 97 / 97 | 2.0 s | 2.0 s | 0 ms | 0.034 / 0.045 |
| /city/nc/raleigh/ | gzip, font `display=swap` | 84 | 2.0 s | 2.0 s | 0 ms | 0.259 |
| /city/nc/raleigh/ | gzip, font `display=optional` | 97 | 2.0 s | 2.0 s | 0 ms | 0 |
| /city/wa/seattle/ | gzip, font `display=optional` | 97 | 2.0 s | 2.0 s | 0 ms | 0 |

The Raleigh shift was the web font swapping in under the intro and pushing the cards down. City and state pages
(`shell({ wide: true })`) now ask Google Fonts for `display=optional`: the font is used when it arrives in the first
100 ms (or from cache, which is every page after the first), otherwise the page keeps the fallback and never jumps.
Brand pages keep `swap`. What is left: `style.css` (the whole app's CSS, about 70 KB raw) blocks the first paint of
every static page; a pages-only stylesheet would cut that, but it is a split of the shell's CSS, not a template change.
