# Northeast and Mid-Atlantic seed notes (wave 2, 2026-11-22)

25 new sources in `northeast.json`. Target was 45; **missed**. The shared web-search budget ran out after about 30 of my searches (tool said "limit: 200 per turn, shared by every agent"), so the Instagram/TikTok/Reddit/Partiful snippet passes and most per-city repeats were never run. Fetches continued afterward. A follow-up with search budget should pick up the gaps below.

## Searches run
"matcha pop up" for NYC (best-of), Brooklyn, Queens/Bronx/Staten Island, Philadelphia, Boston/Cambridge/Somerville, DC, NJ (Jersey City/Hoboken/Newark), Long Island/Westchester/Hudson Valley, CT/RI, Baltimore/NoVA/Montgomery County, Buffalo/Rochester/Syracuse/Albany, Portland ME/Burlington/Wilmington/NH, NYC carts and markets, NYC neighborhoods, site:luma.com, site:ma.to, site:eventbrite.com, site:partiful.com (the site: operator is often ignored by the tool), matcha festivals, Philly neighborhoods, Boston markets, DC press, NoVA markets. Then fetched MATO city pages (NY, Philadelphia, Boston, Baltimore, Washington) and about 15 MATO venue pages, Luma calendars, Hoboken Girl, CTBites, Baltimore Banner, Union Market's Matcha World DC vendor page. Never opened instagram.com or tiktok.com (one WebFetch of an Instagram URL was attempted by mistake and blocked by the permission layer; nothing was read).

## Count per metro
- New York City: 7 (Staten Island 1: Project Latte; Brooklyn 1: They Say That; Manhattan/NYC 5: Matchaful, Plentea Matcha, Matcha Reserve, Matcha Beats Club, Aoko Matcha). Queens and Bronx: none found.
- Jersey City / Hoboken / North Jersey: 5 (Jane's Matcha, Duo Donuts and Matcha, La Donna Cafe, Just a Sip, Sunday Morning Matcha). Newark: none.
- Connecticut: 1 (Matcha Amor)
- Baltimore: 1 (Aura and Lattes)
- Washington DC / Northern Virginia / Montgomery MD: 9 (whisk'd, dimatchai, Monday is Fineday, BUJI Matcha, Kyru Matcha, Le Matcha, Mandarine Matcha, Filo Cafe, Dov and Company)
- Boston / Cambridge: 1 (Nomu)
- Albany: 1 (Mucho Matcha)
- Long Island, Westchester, Philadelphia, Providence, Hartford/New Haven, Buffalo, Rochester, Syracuse, Portland ME, Burlington VT, Wilmington DE: 0 (see below)

## Method that worked
MATO venue pages (ma.to/venue/<instagram-handle>) give handle, city and dated events and are fetchable. The Union Market "Matcha World DC" page lists 20 vendors, which gave the DC cluster. Hoboken Girl's coffee-cart guide gave NJ handles. Luma calendars for Project Latte and Matcha Beats Club are public.

## Caveats
- Matcha World DC vendors (BUJI, Kyru, Le Matcha, Mandarine, Monday is Fineday, dimatchai): existence confirmed from the vendor list only; home city and handles unconfirmed, some may be out of region. Their domains guessed from the brand name did not resolve. Treat as low confidence until a handle is found.
- whisk'd: DC-metro home city is MATO's grouping; its markets are Loudoun County, VA.
- Just a Sip and Sunday Morning Matcha: listed as matcha-serving carts in one article; city and matcha focus unconfirmed.
- Matcha Amor: city (Fairfield) inferred from the founder's storefront plan.
- Aoko, They Say That, Filo Cafe, Dov and Company are venues/cafes that host dated matcha pop-ups, kept under the "hosts dated matcha events" rule.
- Instagram handles are filled (and `verified` set) only when they appeared in a fetched page; 15 of 25.

## Metros where I found none (or only fixed cafes)
- Philadelphia: Kyo, Matcha Cafe Maiko, Matcha Panda, KYN, The Matcha Spot (Hatboro trailer; single snippet) are fixed. MATO Philadelphia page had no matcha. Not Philly: Equitea-style pop-up history is Baltimore.
- Queens, Bronx, Westchester, Long Island: Motel Matcha (Centereach mobile matcha bar) appeared only on gigsalad.com (403 on fetch), so not included.
- Providence, Hartford, New Haven: cafes only (Ceremony, BLISS).
- Buffalo: Matcha Hour at Seneca One (Serendipity Labs, 2026-06-17) one-off; fetched page did not mention it. Rochester, Syracuse: Uber Eats listings only.
- Portland ME (Matcha Mood is a cafe), Burlington VT, Wilmington DE, NH: nothing.

## Rejections
- Cha Cha Matcha, Jade Leaf: already rejected in wave 1 (chain; one-off tour).
- TIRTIR (skincare brand one-off at 45 Grand St), Milk Bar, PLANTA, KITH x Versace: brand activations, not matcha pop-up businesses.
- Spill the Matcha NYC, All Things Matcha, Matcha 101 Whisk & Sip (KinKa): single events or classes.
- Sunday Culture, Savour x MBC, Lips Cafe, Tingz, Harbour Kafe, Ola Studio: hosts or event organizers where matcha is incidental.
- Matcha + Meetup (ADDVentures, Ermantourage): social cafe meetups, not matcha pop-ups.
- Dream Tea NYC: tea company; no matcha-specific events on its Eventbrite page.
- Equitea (Baltimore): month-long pop-up in 2025, now a fixed cafe.
- Love, Makoto (DC): restaurant listed at Matcha World. Littlefoot Matcha: Matcha World vendor but North Carolina (other region).
- Abide (Harvard Square), Ooika Matcha (Jersey City), Wakari Tea (Smorgasburg), Thelis Coffee, The Ark Cafe, Unova Tea, Whisked Away Cafe (NoVA, no matcha confirmed), Matcha Mood: single-snippet or no matcha pop-up evidence; candidates for a follow-up search.
- Mamí Matcha, Daylight Matcha: surfaced on Luma but are California.
