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

## Landings

(Each rung adds its own section below with the numbers after it.)
