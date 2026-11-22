# Wave 2, the West (2026-11-22)

33 new sources in `west.json` (target was 40). Validated with a node script: required keys, no extra keys, schedule_kind enum, state pattern, handle pattern, unique ids, no clash with wave 1.

## Why short of 40
The WebSearch budget (200 per turn, shared across all agents) ran out partway through. Roughly 75 searches were mine before it stopped. Planned but never run: per-metro MATO sweeps for LA, SF Bay, Seattle, Denver and Phoenix with "hojicha" and "latte" phrasing, the MarketSpread matcha-vendor sweep for AZ/CA/OR/CO, and Pasadena, Orange County, Long Beach and Inland Empire follow-ups. A second pass is the most likely way to get LA, SF Bay, Denver and Phoenix to 5.

## Searches run (standard mode)
- "matcha pop up <city>" for LA, SF Bay, Seattle, San Diego, Portland, Denver/Boulder, Phoenix/Scottsdale/Tempe, San Jose, Sacramento, Las Vegas, Salt Lake City, Honolulu, Tucson, Boise, Albuquerque/Santa Fe, Anchorage, Tacoma/Spokane/Bellevue, Reno/Fresno/Colorado Springs.
- Roundups: LA (LAmag, LAist, Time Out), Bay Area (KQED, Infatuation, 7x7, Eater map), East Bay (Edible, Richmondside), Seattle (Let It Simmer newsletter, Seattle Met, Secret Seattle), Denver (303 Magazine, Westword).
- Domain-restricted: ma.to per metro (best yield), eventbrite.com, luma.com/lu.ma, marketspread.com. site:partiful.com returned nothing usable (the operator did not restrict to the domain). I never opened instagram.com or tiktok.com; one Instagram-mirror fetch (imginn) was blocked by the permission layer and not retried.

## What worked
MATO event and venue pages (ma.to) were the best source. A venue slug is the brand's Instagram handle when the brand has its own page, and a fetched venue page showing the handle counts as `verified`. Brands that only appear as a guest on another venue's event page have no handle on MATO. MarketSpread vendor profiles confirm market-circuit vendors but show no handle.

## Per-metro counts (new)
Seattle 7, Los Angeles 4, San Diego 5, Sacramento 3, Portland 3, San Francisco 2, Denver 2, Phoenix 2, Salt Lake City 2, Tucson 1, Honolulu 1, Colorado Springs 1 (outside the metro list, kept as a Front Range lead).
Wave 1 brands already in these metros: Seattle (Vale, Cafe Revy, Nicho's, Howdy Y'all), LA (Rocky's, Unlabeled, Daylight, More Than Matcha), Honolulu (Yonsei, Yame, Green Times, Oishii excluded), San Diego (Prosperitea, Matcha Cafe Maiko excluded), Oakland (For the Love of Matcha), Bay Area (Stonemill, Chalant, Bychae).
The ADDVentures "Matcha + Meetup" entry (home LA) also covers San Diego, Phoenix and Las Vegas listings; it is a social meetup series, flagged low priority in its notes.

## Confirmed handles
13 entries have an Instagram handle; 11 are `verified: 2026-11-22` (handle on a fetched page: grean, mud, caffeine-depot, labora, mizuba, tea-loft, matcha-sanya, wanyen, matcha-pop, mellobun, the-point). Cafe 86 (`cafe86_wa`) and Nakama (`nakamamatchaco`, from an Instagram-mirror URL in a snippet) came from snippets only, so `verified` is null. 9 entries have a non-manual schedule (eight MATO venue pages plus the ADDVentures Eventbrite organizer).

## Metros with none (nothing confirmed)
Boulder, Tacoma, Spokane, Boise, Albuquerque, Anchorage, Fresno, Reno, Las Vegas (only the ADDVentures series and a mobile cafe, Cafe Calavera LV, where matcha is one item), Pasadena, Orange County, Long Beach, Inland Empire, Oakland/East Bay beyond wave 1's For the Love of Matcha, San Jose/South Bay beyond Caffeine Depot's stops.

## Rejected or held (reasons)
- Permanent cafes with no dated pop-ups seen: Nekohama, Nana's Green Tea, Matcha Cafe Maiko, Holy Matcha, Mako Matcha Mill (began as pop-up, now fixed), Project Matcha, Matcha Mood, Yunomi, Third Culture, Forest Tea Bar (Three Tea Bowls pop-up was past), Matsu Matcha, Jin Jin Matcha (Tacoma), Matcha Magic (Seattle, Bellevue, Tempe), Leev Matcha Atelier, Urban Matcha, Matcha Cafe Kyoto, BrewCHA (food truck turned lounge).
- Single snippet only, held: Whisk & Bloom (Portland, cease-and-desist story), One of One (San Diego), Bent Coffee (LA; MATO page returned 404), Jiaren Cafe (Santa Clara), Yumi's Coffee (Phoenix; Phoenix New Times 403, now permanent), Tadaima (SF), Matcha Dachi (SLC; only named on WanYen's page), Matcha Club AZ (Phoenix; named once), Haus of Aloha, Takagi Coffee (Honolulu), Pop Cafe (Las Vegas), Roots & Craft and Tea and Pots (Oakland; matcha focus unconfirmed), Tea For Us, Tano SF.
- Catering-only carts with no public pop-ups seen: The Art of Roam, Cartero Coffee, Aura Verde, Laleh Coffee, Arroyo Coffee.
- Hosts, venues and events, not brands: KOLLAB, Seoul Bowl (host venue for Cafe 86, Moonbee, Tsukime, Nicho's), Newell Vintage, THE BLOCK, Matcha-Con, MatchaFest PHX, SF Matcha Fest, KQED Matcha Showdown, Home Ec, CinKuni, Art on 30th, Point Creative Supplies, Strapping Store.
- Not matcha-focused: Cafe Calavera LV, Sun House Cafe (Sacramento, permanent now), Kaisu Bakehouse (San Diego), Open Air Coffee (Richmond).
- Brands outside the region that surfaced: Celeste, After School Coffee House, Rocky's DC (DC); Hoshi Matcha is kept (Colorado Springs).

## Caveats
- Midori Matcha rests on two search snippets (Secret Los Angeles, The Outer Haven); neither page was fetched.
- Muni Cafe, The Matcha Box and Tata Matcha come from one fetched newsletter (Let It Simmer, March 2026) plus other snippets; Instagram links there were post URLs, not profiles.
- Milk and Maple: Tucson.com snippets only (same article repeated); wave 1 could not fetch it either.
- Nakama Matcha: no fetched page; Denver truck described in snippets.
- Most MATO pages showed no upcoming dates on 2026-11-22 except Caffeine Depot and Mellobun.
