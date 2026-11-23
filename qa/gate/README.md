# Gate, 2026-11-23 (N9)

Headless Chrome through the DevTools protocol, scale 0.5, against `npm run dev` on the N9 worktree after the final ingest. Dark uses the site's own key (`localStorage matchamap.theme = dark`); chips use `matchamap.filter`. Every screenshot was looked at (as 4-up sheets per route). PNGs are palette-quantised to stay under 150 KB.

| route | 390 light | 390 dark | 1440 light | 1440 dark | verdict |
|---|---|---|---|---|---|
| / | [png](home-390-light.png) | [png](home-390-dark.png) | [png](home-1440-light.png) | [png](home-1440-dark.png) | ok |
| / (Today chip) | [png](chip-today-390-light.png) | [png](chip-today-390-dark.png) | [png](chip-today-1440-light.png) | [png](chip-today-1440-dark.png) | ok |
| / (This weekend) | [png](chip-weekend-390-light.png) | [png](chip-weekend-390-dark.png) | [png](chip-weekend-1440-light.png) | [png](chip-weekend-1440-dark.png) | ok |
| / (Next 7 days) | [png](chip-week-390-light.png) | [png](chip-week-390-dark.png) | [png](chip-week-1440-light.png) | [png](chip-week-1440-dark.png) | ok |
| / (Any date) | [png](chip-any-390-light.png) | [png](chip-any-390-dark.png) | [png](chip-any-1440-light.png) | [png](chip-any-1440-dark.png) | ok |
| / (Sat) | [png](chip-sat-390-light.png) | [png](chip-sat-390-dark.png) | [png](chip-sat-1440-light.png) | [png](chip-sat-1440-dark.png) | ok; at 1440 Sat and Sun fold into This weekend by design |
| / (Sun) | [png](chip-sun-390-light.png) | [png](chip-sun-390-dark.png) | [png](chip-sun-1440-light.png) | [png](chip-sun-1440-dark.png) | ok; same as Sat |
| /?city=new-york-ny | [png](city-ny-390-light.png) | [png](city-ny-390-dark.png) | [png](city-ny-1440-light.png) | [png](city-ny-1440-dark.png) | ok after fix (see Blockers: was a load-error toast) |
| /?q=ube | [png](q-ube-390-light.png) | [png](q-ube-390-dark.png) | [png](q-ube-1440-light.png) | [png](q-ube-1440-dark.png) | ok; ?q takes a zip or city, so a word like ube leaves the box empty by design |
| /?q=78701 | [png](q-zip-390-light.png) | [png](q-zip-390-dark.png) | [png](q-zip-1440-light.png) | [png](q-zip-1440-dark.png) | ok |
| /?event=01bf0a830454 | [png](event-390-light.png) | [png](event-390-dark.png) | [png](event-1440-light.png) | [png](event-1440-dark.png) | ok; at 390 the install nudge pill sits over the card's lower edge |
| /?brand=isshikimatcha | [png](brand-390-light.png) | [png](brand-390-dark.png) | [png](brand-1440-light.png) | [png](brand-1440-dark.png) | ok; at 1440 the 'Next: Today from 11am' line is clipped with an ellipsis |
| / (list open) | [png](list-open-390-light.png) | [png](list-open-390-dark.png) | [png](list-open-1440-light.png) | [png](list-open-1440-dark.png) | ok; at 390 the install nudge overlaps the last visible row |
| /weekend/ | [png](weekend-390-light.png) | [png](weekend-390-dark.png) | [png](weekend-1440-light.png) | [png](weekend-1440-dark.png) | ok |
| /add/ | [png](add-390-light.png) | [png](add-390-dark.png) | [png](add-1440-light.png) | [png](add-1440-dark.png) | ok |
| /e/01bf0a830454/ | [png](e-page-390-light.png) | [png](e-page-390-dark.png) | [png](e-page-1440-light.png) | [png](e-page-1440-dark.png) | ok |
| /city/ny/new-york/ | [png](city-page-390-light.png) | [png](city-page-390-dark.png) | [png](city-page-1440-light.png) | [png](city-page-1440-dark.png) | ok |
| /brand/isshikimatcha/ | [png](brand-page-390-light.png) | [png](brand-page-390-dark.png) | [png](brand-page-1440-light.png) | [png](brand-page-1440-dark.png) | ok; a menu item named 'sando' has no drawing (bare label) |
| /art/gallery.html | [png](art-gallery-390-light.png) | [png](art-gallery-390-dark.png) | [png](art-gallery-1440-light.png) | [png](art-gallery-1440-dark.png) | ok; page has its own Light/Dark switch and ignores the site theme |

## Blockers

None open. One was found and fixed in this rung: `/?city=<slug>` (the link every static city page's Open the map button uses) threw in `placeYou` because the deep link lands while the page still holds the pre-map stand-in (`TypeError: t._getUIString is not a function`), which showed the toast "Could not load pop-ups" and left the map on the whole US. Fix in `site/app.js`: add the you-marker once the real map fires `load` (immediately if it already exists). `?q=78701` and `?event=` were not affected. Re-shot city-ny and q-zip after the fix; tests 399 pass, smoke 16 of 16.

## Smoke

- Local build (N9 worktree): `npm run smoke` passed, all 16 checks.
- Live main deploy, `node tools/smoke.js --url https://matchamap-cu7.pages.dev`: passed, all 16 checks (0 uncaught errors on all eight routes at 1440 and 390).

## Minor, not blocking

- Install nudge pill overlaps the bottom of the open card and list sheet at 390.
- Brand popup "Next: ..." line ellipsised at 1440.
- Brand page: menu item "sando" has no illustration.
