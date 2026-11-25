# Performance (phones first)

Owner: the perf lane (2026-11-25). Steven's ask: the site is responsive, lightweight and not laggy, for SEO.
Page weight before this lane is in docs/WEIGHT.md (2026-11-23); this file is the Lighthouse record and the gate.

## How it is measured

`node tools/perf-measure.js <url> [<url> ...]` runs Lighthouse 12 (via `npx lighthouse@12`), mobile form factor, mobile
screen emulation, simulated throttling (the Lighthouse default: 4x CPU slowdown, 1.6 Mbps, 150 ms RTT), categories
performance and SEO, headless Chrome, and prints one row per URL. `TOP=1` also lists the ten heaviest requests. The raw
JSON is written to `--out <dir>` (default a temp folder). The gate (`tools/perf-gate.js`, rung 5) reuses it.

Pages measured: the home page `/`, one city page `/city/nc/raleigh/`, one state hub `/state/nc/`, one brand page
`/brand/333.matcha/`. Lighthouse scores move a few points run to run; the command center's own run of the home page
read 55 and this lane's read 60.

## Baseline, live site, 2026-11-25 (before any change)

| Page | Perf | SEO | FCP | LCP | Speed index | TTI | TBT | CLS | Transferred |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| / | 60 | 100 | 3.6 s | 5.4 s | 23.7 s | 34.6 s | 194 ms | 0.000 | 17.47 MB |
| /city/nc/raleigh/ | 75 | 100 | 3.8 s | 4.5 s | 3.8 s | 4.6 s | 0 ms | 0.014 | 0.42 MB |
| /state/nc/ | 82 | 100 | 3.5 s | 3.6 s | 3.5 s | 3.6 s | 0 ms | 0.000 | 0.24 MB |
| /brand/333.matcha/ | 82 | 100 | 3.4 s | 3.7 s | 3.4 s | 3.7 s | 0 ms | 0.000 | 0.21 MB |

Command center's run of the home page the same hour: performance 55, FCP 3.6 s, LCP 8.3 s, speed index 21.4 s, TTI
31.8 s, TBT 210 ms, CLS 0.002, 17.9 MB, main-thread work 6.9 s.

### What the home page loads (Lighthouse network log, 159 requests)

| Kind | Transferred |
|---|--:|
| Images (third-party photos, own event photos, map sprite) | 13.3 MB |
| Fetch (map tiles 4.4 MB at the national view, shops.json 0.83 MB, events.json 0.19 MB, brands.json 0.14 MB) | 4.4 MB |
| Scripts (MapLibre from unpkg 212 KB, own scripts) | 0.42 MB |
| Stylesheets (Google Fonts css 91 KB, own css) | 0.14 MB |
| Fonts | 0.07 MB |

The ten largest requests were third-party photos at full size: bakedbykori.com 1.96 MB PNG, a Wix PNG 1.43 MB, six
Instagram CDN JPEGs of 0.6 to 1.1 MB, a Wix JPEG 0.63 MB, then `/data/shops.json` at 0.83 MB. Pins and list rows put
those photos on the page (40 to 68 px boxes) whether or not they are on screen.

Static pages (city, state, brand) are already light: the heaviest thing on them is the Google Fonts stylesheet
(91 KB for M PLUS Rounded 1c, which lists every Japanese subset) and its font files (22 to 36 KB each, five of them).

## What changed (rungs 2 to 5, 2026-11-25)

**Rung 2, pictures.** Brand and shop photos live on other sites at full size (0.2 to 2 MB each) and were fetched for every
pin and list row on the first view: 13.3 MB of the 17.5 MB home page. They can not be shrunk (no proxy, no copy on this
site), so `site/pics.js` decides when. A pin, a row or an avatar writes `<img data-pic="https://...">` over its drawn art;
the loader gives it a `src` only when it is on screen, after the first touch (six on a ten second fallback), three at a
time, nearest the middle of the screen first, 30 a visit, never under Save-Data. Pins now draw the art first and the photo
fades in over it. A picture on this site loads as before, except that pins and list rows use its 400 px copy
(`img/events/thumbs/`, 103 made with `npm run images`; the full file is the error fallback). A card the visitor opens loads its
own photo straight away. The photo addresses of the shop pins are not in the first-paint data any more either (rung 3).

**Rung 3, data.** `site/data/shops.json` was 5.2 MB (817 KB compressed) of which the map used a tenth. It is now the slim
list (id, name, lat, lng, city, state, tier, hours: 746 KB raw, 166 KB Brotli), same file name and key names, so a page
cached under the old app still draws its pins. A shop's card details come from one file per state
(`site/data/shops/<ST>.json`, 51 files, the largest CA at 75 KB compressed) fetched when the card opens, and the pins'
photo addresses from `site/data/shops-photos.json` (94 KB) once pictures may load. `overture_id`, `overture_sources`,
`fetched`, `source_url`, `read`, `confirmed_via`, `geocode_source`, the liveness fields, `cuisine` and `phone` are no longer
sent (the site never read them; they stay in `data/shops.json`). All of it is built from `data/shops.json` by
`ingest/lib/site-shops.js` (`node ingest/lib/site-shops.js` rebuilds; `npm run shops`, `shops:deepen` and `menus` call it).
Tools and tests that need every field call `readSiteShops()` (gen-pages, the shop gate, the social plan). One behaviour
note: the at-shop pairing (a pop-up at a shop's address) now pairs by position (within 40 m) at first paint; the street
address rule needs the address, which is in the details. On today's data both rules give the same 10 pairs.

**Rung 4, scripts, styles, fonts, requests.**
- MapLibre 4.7.1 is served from `/vendor/maplibre-gl-4.7.1/` (same bytes as unpkg, SRI hash unchanged: `sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj`), immutable-cached, precached by the service worker. The home page's CSP no longer names unpkg.
- M PLUS Rounded 1c (OFL) is served from `/fonts/` (Latin and Latin Extended, weights 500, 700, 800: 6 files) with `@font-face` at the top of `style.css`. The 91 KB Google Fonts stylesheet and its connection were what held the first paint of every city, state and brand page at 3.5 s. Japanese, Cyrillic, Greek, Hebrew and Vietnamese characters now use the system rounded font in `--font` instead of Google's subsets. The CSP of every page dropped `fonts.googleapis.com` and `fonts.gstatic.com`; city, state, brand, event and weekend pages preload the 500 and 700 Latin files.
- Honest lastmod: the head change is a template change, not content. `hashInput` in `tools/seo-lib.js` hashes a page as it read before it (stored hashes stay valid; running `npm run pages` after this change moved 0 lastmod values).
- One fetch per data file: `window.mmJSON` (theme.js) is shared by app.js, cards-app.js and pwa.js; `brands.json` was fetched twice (141 KB each).
- The 18 scripts were already `defer` (or a module) and the six stylesheets are small and same-origin; merging them was measured to save under 0.4 s and was left alone to keep one owner per file.

**Rung 5, the gate.** `npm run gate:perf` (`tools/perf-gate.js`) serves `site/` with `tools/perf-server.js` (Brotli, like Cloudflare), runs Lighthouse 12 mobile on the four page types and fails on a missed budget (a page that misses is measured once more; the better run counts). It runs in the daily run after the smoke as the soft step `perf-gate` (a miss shows in the report and the issue, and never blocks the commit, push or deploy: a Lighthouse flake must not stop the data). `test/perf-budget.test.js` holds the no-browser guards (no third-party script or font host, MapLibre and fonts local, scripts deferred, shared fetch, the slim list under 200 KB in `test/site-shops.test.js`).

### Budgets

| Page | Performance | Largest paint | Transferred | Also |
|---|--:|--:|--:|---|
| city, state, brand | at least 90 | at most 2.5 s | 0.6 / 0.4 / 0.4 MB | |
| home | at least 60 (ratchet) | at most 9.5 s (ratchet) | at most 5 MB | own origin at most 1.8 MB; other sites' pictures at most 600 KB; `data/shops.json` at most 200 KB |

The home page is held below the requested 85 / 2.5 s / 2 MB for two reasons that are not code size. Map tiles: the first view
at the national zoom is six OpenFreeMap tiles of 0.24 to 0.61 MB each (2.6 to 3.0 MB), served by a third party in the
format the style needs; MapLibre refuses a smaller `tileSize` for vector sources (tried: the map goes blank). Largest
paint: Lighthouse's simulated estimate is 7.8 s, but the same page in Chrome with a real 4x CPU slowdown paints its largest
element (the list count, "Pop-ups in view") at 0.7 s, the same moment as the first paint (`PerformanceObserver`, run with
`tools`-style CDP throttling on 2026-11-25); skipping the opening animation (`?at=`) or blocking every tile left the
estimate at 7.8 to 9.7 s, so it is not the animation and not the tiles. It is Lighthouse's model of a 5,000-node page with
about 1 s of script under 4x slowdown. Lower the home ratchet as those move; do not raise it.

### Results

Local build (Brotli, Lighthouse 12 mobile simulated), before this lane's change and after:

| Page | Perf before | after | LCP before | after | Transferred before | after |
|---|--:|--:|--:|--:|--:|--:|
| / | 60 | 62 | 5.4 s | 7.8 s | 17.47 MB | 4.15 MB |
| /city/nc/raleigh/ | 75 | 99 | 4.5 s | 1.9 s | 0.42 MB | 0.25 MB |
| /state/nc/ | 82 | 99 | 3.6 s | 1.8 s | 0.24 MB | 0.10 MB |
| /brand/333.matcha/ | 82 | 99 | 3.7 s | 1.8 s | 0.21 MB | 0.11 MB |

The home page score barely moves because its estimated largest paint and blocking time are about the script and the DOM
(app.js 52 KB Brotli, 5,000 DOM nodes at the national view), not the bytes; what moved is the weight: 13.3 MB of photos
to 0, shops.json 827 KB to 166 KB, unpkg connection gone, and speed index 23.7 s to 5.7 s, TTI 34.6 s to 8.5 s,
first paint 3.6 s to 1.7 to 2.2 s.

(Live numbers after the deploy are added below.)
