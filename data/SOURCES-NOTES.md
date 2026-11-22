# Sources notes (2026-11-22)

37 sources in `sources.json`. Validated by hand against `schema/source.schema.json` (required keys, enums, handle and state patterns).

## What I searched
Web searches: "matcha pop up" plus city (NYC, LA, Austin/Houston/Dallas, Seattle/Portland/Denver, Chicago/Atlanta/Miami, DC/Philadelphia/Boston, Phoenix/San Diego/Honolulu, Bay Area), "matcha pop up eventbrite organizer", "matcha pop up schedule cities tour". Then fetched the brand page, MATO (ma.to) venue page, Luma calendar, or a local news article for each candidate.

Best finding: **MATO (ma.to)** is a public event directory with per-venue pages (handle, link, upcoming/past dates). Many pop-up vendors have one, so `schedule_url` for 13 sources points there with adapter `website`. It covers some cities well (NYC, DC, Honolulu, LA) and others thinly. Luma calendars (luma.com/...) are also public; they are not in the schedule_kind enum, so those use `website` with adapter `luma` (a new adapter name rung 3 must handle or remap).

## Verification
- `verified: 2026-11-22` (31 records) means the handle was shown on a page I fetched (brand site, MATO page, article with the Instagram link). Handles were not checked on instagram.com or tiktok.com.
- `verified: null` (6 records): Mori Matcha, Koicha, Nicho's Matcha Cafe, Chalant Matcha, Mono Matcha, Wild Orchard. Brand existence is confirmed from a fetched page, but no handle appeared, so instagram is null.
- TikTok is only set for Rocky's Matcha and Gishiki (seen on their pages). Others are null because I did not see a TikTok link.
- Caveats: `geummy` (ONDO) is the account shown on MATO under the brand's venue page, probably the founder's; confirm. Enso's events page content looked stale (Apr-May 2026). Matcha Fest is a festival, not a pop-up vendor; its home city (Miami) is just the next stop. Prosperitea's info is from a Sept 2025 article.
- Several search-result facts (e.g. Bonsai's monthly Instagram schedule, Cafe 86's @cafe86_wa, Honey Veil @honeyveilco as pop-up origin) came from search snippets only; fetches of those articles were blocked, so those brands were not included, except Honey Veil which I fetched (see below).
- Most MATO pages showed no upcoming dates on 2026-11-22. The sources are real accounts; most have quiet periods or post only on Instagram.

## Not found / gaps
- Philadelphia, Portland, Phoenix: no pop-up brand confirmed. Philly only turned up fixed cafes (Matcha Cafe Maiko, Kyo) and tea-ceremony events. Portland: Whisk & Bloom, Matchafe, Mako Matcha Mill came up in search snippets only. Phoenix: Milk and Maple is in Tucson (AZ), tucson.com returned 429 on fetch.
- Thin: Denver (1), San Diego (1), Chicago (1), Miami (1 festival), SF Bay (3).
- Eventbrite and Partiful: no organizer page for a recurring matcha pop-up series turned up. Eventbrite hits were one-offs (All Things Matcha, Chicago Dec 2025, by The Center of Order and Experimentation; Matcha + Meetup Dallas by ADDVentures, ended). MATCH | A and More Than Matcha use Partiful per their pages but no organizer URL was visible.

## Rejected
- Cha Cha Matcha: permanent chain, activations at its own stores (MALK collab), no pop-ups elsewhere.
- Honey Veil (Miami): began as mobile pop-ups, now fixed shops; site has no events page.
- Matcha Cafe Maiko (Philadelphia, San Diego, Boston, Tempe): permanent cafes, no pop-ups seen.
- Crumb Basket Bakehouse (Oakland): bakery, matcha is not the focus.
- KOLLAB LA, F R I D A (Seattle), Honey Moon Spirit Lounge (Austin), CinKuni (San Diego), Newbery Street Coffee Roasters: venues or hosts, not matcha pop-up brands. (Matcha Me, the brand at CinKuni, had no handle on the page.)
- Oishii Hawaii: food influencer account that lists events.
- Jade Leaf: national packaged brand; the 2026 NYC tour was one-off.
- Spill the Matcha NYC, Matcha-Con, Let's Have Tea!: single events.
- The Bright Side Pop-Ups (luma.com/sipbrighter): matcha pop-up calendar, but no city or handle on the page.
- Milk and Maple (Tucson), Howdy-style hotel collabs: see gaps above; Yoka (Seattle) and Kyo, byChae-like brands that moved to permanent cafes (byChae kept as it still runs mobile pop-ups).
