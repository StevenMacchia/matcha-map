# Host outreach kit (Population lane, rung P3, 2026-11-23)

The aim: brands post their own dates to Matcha Map, so the map stops depending on what the open web publishes (which is almost nothing; see `docs/DISCOVERY-YIELD.md`). Sending is Steven's, by hand, from his own accounts. Nothing here messages anyone, and nothing should be bulk-sent or automated.

## The data

`npm run outreach` (`tools/outreach.js`) writes two files in `data/outreach/` from `data/sources.json`, `data/events.json` and `data/watchlist.json`:

- `brands.csv`: every brand that has a brand page (482 today: the active sources plus the named, not-dropped Instagram accounts on the watch list). Columns: brand, handle, platform, city, state, kind, category, website, instagram_url, followers, watch_status, last_dated_post_seen, upcoming_events, city_upcoming (upcoming pop-ups in that city on the map), active, has_claim, claim_link, brand_page, score.
- `top100.csv`: the hundred most worth a first message: active (a dated post in the last 60 days, or a pop-up coming), not yet claimed, with a handle. Ranked by a score: active and dated first, a coming pop-up, thin metros (few upcoming in the city) before crowded ones, pop-up and organizer kinds before cafes, watched accounts, then reach. A brand with no known city sorts last.
- `has_claim` is read from the site's own claim queue (`GET /api/queue?kinds=claim`, the moderator token in `.env`); only the fact of a claim is used, never an email. Today the queue is empty, so no brand has claimed.
- `claim_link` is `/claim/?brand=<name>&handle=@<handle>`: the claim form fills its two fields from the link (site/add/add.js).
- `last_dated_post_seen` is the later of the watch list's `last_post_with_popup` and the latest event date we hold for the brand. It is a date we saw on a public post or page, not a promise that they post dates.

Re-run it any day; it never writes outside `data/outreach/`.

## Three drafts

Under 60 words each, plain, one link. Replace `{name}`, `{city}` and `{claim_link}` (the brand's own link from the CSV). Send a DM where the handle is an Instagram account; use the email only when the brand's website shows a public contact address.

**1. Pop-up brands (DM or email)**

> Hi {name}, I'm Steven. I built Matcha Map, a free map of matcha pop-ups across the US, and I list your events from your public posts. If you'd like to fix anything or post your dates yourself, you can claim your page here: {claim_link}. No cost, and I'll take it down if you ask.

**2. Cafes (DM or email)**

> Hi {name}, I'm Steven. Matcha Map is a free US map of matcha pop-ups and cafes, and {city} is thin right now. If you run events, you can claim your page and add your own dates here: {claim_link}. I'm happy to fix anything that's wrong.

**3. Market organizers (email, or a DM to the market's account)**

> Hi, I'm Steven. Matcha Map is a free US map that shows where matcha vendors are selling and when. If you send me your vendor list and dates, I'll put your market on it, or you can claim a page yourself: {claim_link}. No cost, and I'll fix anything that's wrong.

Email subject for any of them: `Your dates on Matcha Map`.

Rules for sending: one message per brand, no follow-up spam (one nudge after two weeks at most), never claim a brand's page for them, never message a personal account, and take a page down the same day when asked (`/data-deletion/`).
