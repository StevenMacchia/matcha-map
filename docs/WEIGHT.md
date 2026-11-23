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
