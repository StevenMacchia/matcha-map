# QA: gallery group

Rendered with headless Chrome over CDP (device metrics 390x844 and 1440x900, scale 0.5); dark mode via `data-theme="dark"` on `<html>`. `scrollWidth` measured at 390 and 1440: equal to the viewport everywhere (no horizontal scroll).

| route | 390 light | 390 dark | 1440 light | 1440 dark | findings | fixed in |
|---|---|---|---|---|---|---|
| /art/gallery.html (top, grid) | gallery-390-light.png | gallery-390-dark.png | gallery-1440-light.png | gallery-1440-dark.png | Clean. 167 unique images all 200; 0 broken `<use>`; no text under 4.5:1 contrast in either theme; only console noise is /favicon.ico 404 | none needed |
| /art/gallery.html (Try a drink, typed "iced ube latte with cold foam") | gallery-try-390-light.png | gallery-try-390-dark.png | gallery-try-1440-light.png | gallery-try-1440-dark.png | Clean | none needed |
| /art/gallery.html (event scenes) | gallery-events-390-light.png | gallery-events-390-dark.png | gallery-events-1440-light.png | gallery-events-1440-dark.png | Clean | none needed |
| /search-demo.html (ube, rocky, brooklyn, zzz) | search-ube-390-light.png | search-ube-390-dark.png | search-ube-1440-light.png | search-ube-1440-dark.png | Dropdown 16..374 px at 390 (inside viewport), no clipped rows, arrows/Enter/Escape work, "zzz" shows "Nothing matches ... Try a brand, a drink or a city." (same pattern for rocky, brooklyn, zzz files) | none needed |

## Feeds (structure only)
all.ics (269 events), 77 city .ics, 269 event .ics, new.xml (269 items, balanced), index.json (74 cities): CRLF, wrappers, UIDs unique, required fields present, no "undefined"/"NaN".

## Handed off
- `tools/gen-feeds.js`: event 834a539a877b ("December 2026 Spicy Sculpt with Goldies x Energi", also in all.ics and cleveland-oh.ics) emits `DTSTART:20261205T173000Z` with `DTEND:20261205T000000Z`, an end before the start. The source data has a timed start and a date-only end (`2026-12-05`). Fix: when end is date-only and start is timed, drop DTEND (or use start + 2 h); optionally fix the data in ingest/lib/quality.js.
- site/favicon.ico 404 on the dev server (every page).
