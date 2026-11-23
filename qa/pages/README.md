# QA: weekend, city, brand pages, sitemap, robots (worker "pages")

Rendered with headless Chrome over CDP at 390x844 and 1440x900 (real device metrics), light and dark (the site's own localStorage key `matchamap.theme`), 2026-11-22. For each shot: scrollWidth equals the viewport width (no horizontal overflow), no failed requests, no console errors, no broken images. Screenshots are at scale 0.5, in this folder as `<route>-<width>-<light|dark>.png`.

| Route | 390 light | 390 dark | 1440 light | 1440 dark | Findings | Fixed in |
|---|---|---|---|---|---|---|
| /weekend/ | weekend-index-390-light.png | weekend-index-390-dark.png | weekend-index-1440-light.png | weekend-index-1440-dark.png | Clean. "Add a pop-up" button now says "Add your pop-up". No favicon link, so /favicon.ico 404'd. | tools/gen-weekend.js |
| /weekend/new-york-ny/ (8 events) | weekend-new-york-ny-390-light.png | weekend-new-york-ny-390-dark.png | weekend-new-york-ny-1440-light.png | weekend-new-york-ny-1440-dark.png | The card showed only the brand ("Cafe of the Day"), dropping the event title ("Matcha + Meetup: Manhattan"). | tools/gen-weekend.js, site/weekend.css (title line under the brand) |
| /weekend/seattle-wa/ (one-event city) | weekend-seattle-wa-390-light.png | weekend-seattle-wa-390-dark.png | weekend-seattle-wa-1440-light.png | weekend-seattle-wa-1440-dark.png | Clean. | n/a |
| /weekend/anaheim-ca/ (zero in window) | weekend-anaheim-ca-390-light.png | weekend-anaheim-ca-390-dark.png | weekend-anaheim-ca-1440-light.png | weekend-anaheim-ca-1440-dark.png | Was a 404 (no page for a city with pop-ups coming up but none Fri to Sun). Now a friendly noindex page: nothing posted yet, Add your pop-up, city calendar feed (when one exists), all upcoming, map. Kept out of the sitemap. | tools/gen-weekend.js, tools/gen-sitemap-extras.js |
| /city/ny/new-york/ (busy) | city-new-york-ny-390-light.png | city-new-york-ny-390-dark.png | city-new-york-ny-1440-light.png | city-new-york-ny-1440-dark.png | Clean. | n/a |
| /city/ca/anaheim/ (thin) | city-anaheim-ca-390-light.png | city-anaheim-ca-390-dark.png | city-anaheim-ca-1440-light.png | city-anaheim-ca-1440-dark.png | Clean. | n/a |
| /city/ky/elsmere/ (empty) | city-elsmere-ky-390-light.png | city-elsmere-ky-390-dark.png | city-elsmere-ky-1440-light.png | city-elsmere-ky-1440-dark.png | Reads friendly but has no "Add your pop-up" or feed link. See Handed off. | handed off |
| /brand/mellobunbakery/ (dates and extras) | brand-mellobunbakery-390-light.png | brand-mellobunbakery-390-dark.png | brand-mellobunbakery-1440-light.png | brand-mellobunbakery-1440-dark.png | The extras block (next dates, drinks, story, price) never rendered: the page CSP is `default-src 'none'` with no connect-src, so the fetch of extra.json was blocked (console error). Also duplicated the "Upcoming pop-ups" list. | site/brand-extras.js (loads extra.js as a script, skips "Next dates" when the page has its own cards), tools/gen-brand-extras.js (writes extra.js) |
| /brand/333.matcha/ (dates, no extras) | brand-333-matcha-390-light.png | brand-333-matcha-390-dark.png | brand-333-matcha-1440-light.png | brand-333-matcha-1440-dark.png | Console: extra.json 404 plus CSP error on every brand page. | same stub fix: every brand page gets an extra.js (`mmBrandExtra(null)`) |
| /brand/518muchomatcha/ (nothing upcoming) | brand-518muchomatcha-390-light.png | brand-518muchomatcha-390-dark.png | brand-518muchomatcha-1440-light.png | brand-518muchomatcha-1440-dark.png | Same console error; otherwise clean. | same |
| /sitemap.xml | n/a | n/a | n/a | n/a | Valid XML (921 urls, 921 url tags, no duplicates, one host, all lastmod ISO dates), every path exists on disk; 30 sampled over the dev server all 200. Empty weekend pages are excluded. | tools/gen-sitemap-extras.js |
| /robots.txt | n/a | n/a | n/a | n/a | `Allow: /` plus the sitemap line. Fine. | n/a |

## Handed off

- tools/gen-pages.js ~line 312 (empty city "Upcoming pop-ups" section, `Nothing is posted for ${esc(c.name)} yet...`): append `<p><a class="pg-btn" href="/add/">Add your pop-up</a> <a class="pg-btn" href="/feeds/all.ics">Calendar feed of every pop-up</a></p>` (use `/feeds/${slug}-${st}.ics` instead when that file exists; per-city feeds only exist for cities with events). The empty-city lead (line ~212) also stays as is.
- Optional hardening, tools/gen-pages.js line 131: adding `connect-src 'self'` to the page CSP would let a fetch() work again; not needed now that extras load as a script.

## Notes

- `npm test`: 398 of 398 pass.
- Weekend h1 can wrap at the hyphen ("pop-\nups") on a narrow screen; cosmetic, left.
