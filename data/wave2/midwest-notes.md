# Midwest and Mountain-Plains seed notes (wave 2, 2026-11-22)

20 new sources in `midwest.json`; the target of 30 was not reached. Validated with a node script (required keys, no extras, enums, state and handle patterns, URLs, unique ids, no clash with wave 1).

## Searches run (about 55, standard mode)
"matcha pop up <city>" for Chicago, Detroit, Columbus, Minneapolis/St. Paul, Indianapolis, St. Louis, Kansas City, Ann Arbor/Grand Rapids, Cleveland/Cincinnati, Milwaukee/Madison, Pittsburgh, Omaha/Des Moines/Lincoln, Wichita, Fargo/Sioux Falls, Dayton/Toledo/Fort Wayne, Cedar Rapids/Iowa City, Naperville/Evanston/Schaumburg. Also: best pop-ups lists, matcha cart or farmers market, site: ma.to, luma.com, partiful, tiktok and instagram phrasing, Reddit phrasing, local outlets (Eater, Block Club, Sahan Journal, Heavy Table, Isthmus, Urban Milwaukee, Axios locals), Pilates/boutique collab phrasing. Fetched about 45 pages: articles, MATO city pages (`/events/<city>`: Chicago, Detroit, Columbus, Minneapolis, Kansas City, Pittsburgh showed no upcoming matcha events on 2026-11-22), Marketspread vendor profiles, Crowdwork, Eventbrite.

The search tool returns the same ~15 pages for every Midwest query (Axios Austin, the All Things Matcha Eventbrite, Uber Eats category pages). Instagram and TikTok were never opened, so most small pop-ups that only live there could not be seen. Some fetches returned 403/429 (Indianapolis Monthly, Star Tribune, Axios Des Moines, Cincinnati Magazine/CinSei article), so Lucky Maeve's rests on search snippets from Indianapolis Monthly plus a second snippet naming the Westfield Farmers Market.

## Count per metro
- Chicago metro: 7 (Homebody, Matcha Moo Tea, But First Matcha, Hawa Cafe, Chicago Matcha Club in Chicago; Fein Matcha, Northbrook, pops up in Evanston). Target 6 met.
- Detroit and Ann Arbor: 1 (Sml Wrld Cafe, covers both). Target 4 missed.
- Columbus: 2. Target 4 missed.
- Minneapolis and St. Paul: 1 (Ratio Matcha). Target 4 missed.
- Indianapolis: 1 (Lucky Maeve's, based in Noblesville). Target 4 missed.
- St. Louis: 2 (Junbi St. Louis, Amaretto STL). Target 4 missed.
- Kansas City: 1 (HerCafe). Target 4 missed.
- Cincinnati: 2 (CinSei, Little Matcha, the latter Covington KY).
- Milwaukee: 1 (Rodeo Matcha).
- Pittsburgh: 1 (Mandarine Matcha).
- Des Moines: 2 (Cozy, Pls; Matcha LUV).

## Metros with none found
Madison, Grand Rapids, Cleveland, Omaha, Lincoln, Wichita, Fargo, Sioux Falls, Dayton, Toledo, Fort Wayne, Cedar Rapids, Iowa City, Naperville, Schaumburg. Searches returned only delivery-app listings, permanent cafes and one-off workshops. Cleveland: Verbena (non-alcoholic bar) began as a pop-up but is a fixed bar now. Madison: Teasider and Macha Tea Company are shops.

## Handles and schedules
10 of 20 have a confirmed Instagram handle (seen on a fetched page, `verified` = 2026-11-22): homebody.chi, feinmatcha, matchamootea, smlwrldcafe, dailydosacafe, chroma_matcha, junbistlouis, hercafekc, cozypls, matchaluv.dsm. 10 have `instagram: null` and `verified: null`. TikTok is null everywhere. 7 have a non-manual schedule: But First Matcha (MATO host-venue page cafilmlab), Chicago Matcha Club (Crowdwork shows page), Amaretto STL, Rodeo Matcha, Cozy Pls, Matcha LUV (Marketspread vendor profiles, which show no dates themselves) and Mandarine Matcha (MATO venue page; it returned "temporarily unavailable" when fetched, slug taken from search results). Adapter "mato" is used for the two MATO pages; "website" for the rest.

## Weaker inclusions (flag for review)
- Amaretto STL: matcha is one of several drinks plus arepas.
- Little Matcha: pop-up history is confirmed, now a shop; current pop-ups unconfirmed.
- CinSei: permanent now; kept because it runs dated events and began as a pop-up.
- Chicago Matcha Club: ticketed tastings, not a booth; page showed one event (Sept 2025).
- Hawa Cafe, But First Matcha: seen in one Time Out or MATO listing each.
- Junbi St. Louis: local arm of a multi-city brand; STLPR says it has moved toward a fixed shop.
- Homebody/Fein/Moo: 2025 Tribune data; activity in 2026 not rechecked.

## Rejected
- Nichi Matcha (Chicago): Friday pop-up, closed Oct 30 per Spoon University.
- MATCH | A (Chicago): already wave 1 (`match-a-chicago`). Matcha Cita, Kyo Matcha (Chicago, Champaign, Pittsburgh), Mosaic Leaf, Teasider, Matcha Me, Recess (Indianapolis), Honey Coffee & Matcha, ASTROLAB: permanent cafes with no dated pop-ups found.
- MatchaFest Chicago: one festival; All Things Matcha (Center of Order and Experimentation, Chicago, Dec 6 2025): one-off event, vendors Yujo Matcha, J.Studios, What Margie Made not confirmed as brands.
- Dear Society (Kansas City): boutique hosting a weekly Saturday matcha bar; a host, brand not named in the article.
- Hokori, Found Coffee (St. Louis): bakery/coffee with matcha products. Caphin (Minneapolis): Vietnamese coffee trailer. Cafecito House, Hello Sunshine, Road Runner, Coffee Catering Co: not matcha-focused.
- Nekohama (Uniqlo pop-up, Chicago): single collab, brand status unverified. Green Finds Cafe (Des Moines): Axios page 403, unclear if pop-up. River and Stone Tea (Minneapolis): matcha miller, listing shows no pop-ups. Rodeo Matcha is Milwaukee-area, not Madison.
- Hoshi Matcha, Matcha Muse: Marketspread vendors in El Paso/Manitoba, outside region.
