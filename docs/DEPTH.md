# Depth on upcoming events

`npm run enrich` (ingest/enrich.js, ingest/lib/enrich-events.js) reads each upcoming event's own public page and fills what is empty. `-- --dry` reports without writing; `-- --pages` regenerates the pages after.

## What it reads

Only pages that are one event each: Eventbrite, MATO, Allevents, Luma, Meetup, HappeningNext (robots respected, one request a second a host, cached 6 hours). Never a newsletter or a guide (they describe many events), never Instagram or TikTok (login wall), never a shop or brand page for these fields (menus of storefronts are `npm run menus`).

## What it fills, and only when empty

- price: JSON-LD offers (Free, $12, $10 to $25; USD only), else a price printed in the event's own description.
- description, menu, hours, pay: from the page's Event description with the same extractors the crawlers use (`descriptionFromText`, `menuFromText` 60-term vocabulary, `hoursFromText` only when the text labels hours, `payFromText`).
- poster: JSON-LD image or og:image, credited to the host; downloaded and shrunk by the images step.
- time: a stored all-day (local midnight) start whose page prints a time on the same day gets that time in the event's own zone (`timeFix`). Allevents prints local time with a +00:00 label, so page offsets are never used, only the wall clock.

A value already on the event is never replaced. Nothing is guessed: no price from a ticket-tier name, no hours from a start and end.

## Time zones and all-day

`test/enrich-events.test.js` checks every event on file: its `tz` equals the zone of its place (`tzForPlace`: state, split states by pin or city centre: El Paso Mountain, Boise Mountain, Honolulu, Phoenix), its start's offset equals that zone's offset on that date, an all-day event starts at local midnight with no end, and no timed event starts at local midnight. A page whose start date is on another day than the stored one (Allevents series pages, an old Luma page) is reported, not changed.
