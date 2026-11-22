# Wave 3, the Carolinas, Virginia and the Southeast (2026-11-22)

17 new sources in `southeast.json` (target was 45+; the region did not support it). Validated: required keys, enums, state pattern, handle pattern, unique ids, no clash with data/sources.json. 6 have `verified` set (handle read from a fetched page); 10 have a non-manual schedule (MarketSpread vendor pages, MATO venue page, SweatPals event page); 7 are `manual`. Instagram and TikTok were never opened. The search tool ignored `site:` filters, so no instagram.com or tiktok.com snippets came back at all: evidence class (b) never occurred; one brand (Bru) is class (c).

## Searches (about 75)
"matcha pop up" for Raleigh, Durham, Chapel Hill/Carrboro, Cary/Morrisville/Apex, Wake Forest and other Triangle towns, Charlotte (plus Lake Norman area), Greensboro/Winston-Salem, Asheville, Wilmington, Charleston (twice), Greenville/Columbia/Myrtle Beach, Richmond (twice), Hampton Roads, Fredericksburg/Williamsburg/Roanoke, Atlanta (three passes), Athens/Savannah, Nashville (twice), Knoxville/Chattanooga/Birmingham, Tampa/St. Pete (twice), Orlando/Winter Park (twice), Jacksonville/Gainesville/Tallahassee. Platform queries: site:instagram.com, site:tiktok.com, site:ma.to, site:luma.com, site:eventbrite.com, MarketSpread (NC, then SC/VA/GA/TN/FL), Eventeny. Market and venue queries: Durham Central Park, Carrboro, Optimist Hall, Camp North End, 7th Street, Boxyard RTP, Durham Food Hall, Morgan Street, Transfer Co, Savannah Forsyth, Knoxville Market Square, Greenville TD Saturday Market, Riverside Arts Market, St. Pete Saturday Morning Market, Armature Works. Press: Axios Raleigh/Charlotte, AJC, Rough Draft, Nashville Scene, Raleigh Magazine, Indy Week, Charleston City Paper, Richmond Magazine, Weekly Specials CHS. Reddit queries returned no threads.
Fetched about 40 pages: MarketSpread vendor pages (Matcha Mamas, Matcha Valley, Sip & Sparkle, Gemora, Min's, Uma, NOK108, Momatcha), MATO venue pages (amato, Gelatina's Juanita, Coffee & Matcha, Caffeto, Mott Cha, Eat Bubbles), SweatPals (Matcha MayFest), Downtown Raleigh (Frame x Iris), UNCG, Raleigh Magazine, Rough Draft Atlanta (two), AJC (two), Nashville Scene, Axios Charlotte roundup (403), Crema, Eventbrite, Luma, Cavalier Daily, Weekly Specials CHS, Indy Week. 6amcity newsletters returned 503.

## Count per metro (new)
Raleigh 5 (Littlefoot, HabibTea, Little House Lattes, BalancedAF Wellness, Iris Coffee Lab); Greensboro 2 (Matcha Mamas, Mood Up); Charlotte 1 (Bru); Charlottesville 2 (NOK108, Gemora); Atlanta 1 (The Matcha Market); Charleston 1 (Holy City Matcha); Greer/Greenville SC 1 (Sip & Sparkle); Nashville 1 (Eat Bubbles); Tampa 1 (Blind Tiger Ybor) plus St. Pete/Largo 2 (Uma, Min's). Total 17.

## Metros with none
Durham, Chapel Hill/Carrboro, Cary/Apex (only amato, already in), Winston-Salem, Asheville (Sip & Sparkle is a Greer vendor at an Asheville event; Matcha Nude is a Western NC brand with no pop-up evidence), Wilmington NC (Uji is a cafe not yet open), Columbia SC, Myrtle Beach, Virginia Beach/Norfolk, Richmond (only The Exit Plan, already in), Athens GA, Savannah, Knoxville, Chattanooga, Birmingham, Jacksonville (Cafecito Jax already in; Norikase is the host venue), Orlando, Gainesville, Tallahassee. Short of target everywhere: the Triangle (target 10, got 5 in Raleigh and 0 in Durham), Charlotte (target 8, got 1).

## Why Charlotte and the Triangle are thin
Charlotte brands are already in (Saint Matcha Cafe, Jyuuni, Gotcha-style cafes rejected as permanent). Durham matcha search results were delivery listings, a 2019 tea popup and Sangha Teahouse. Instagram-only pop-ups cannot be found without opening Instagram; the search tool returned no instagram.com or tiktok.com results for any query.

## Marginal inclusions (flag for review)
Iris Coffee Lab, Blind Tiger, Eat Bubbles (venues or shops that host matcha events); BalancedAF Wellness (organizer, not a brand); Gemora and Min's (packaged brands listed on MarketSpread); Uma Matcha (city guessed from Pinellas County); Mood Up and Bru (carts, snippet-level evidence); Holy City Matcha (one dated class, no handle).

## Rejections
- Revival Coffee & Ice Cream (Charlotte): a search summary called it a mobile matcha bar, but the Axios roundup entry for the matcha bar is a different, unnamed business; Revival is a coffee and ice cream truck.
- Black Cat Coffee, Matcha Mantra Mondays (Charlotte): espresso carts with matcha as a side item, rejected in wave 2; kept out.
- Sangha Teahouse (Durham): mobile tea, matcha on menu, but only undated or 2017 coverage; no current evidence.
- Matcha Nude (Western NC) and Chachi Matcha (Burlington): wholesale or online matcha brands, no pop-up or market evidence.
- Gotcha Matcha, Littlefoot-style fixed cafes, Mott Cha, Coffee & Matcha (Charlotte), Caffeto NoDa, Saiko, Uji (Wilmington), Taiyo, Karma Cream, DI Coffee Bar, Say Coffee House, Matcha Made in Heaven, Idle Hour, Sweet Thyme, 42 & Lawrence, Lucky Tree: permanent venues with no dated pop-ups.
- Fujissa (Duluth): food-court stall. Wave 3 Matcha (Atlanta): wholesaler.
- Cafe Haus x Gelatina's Juanita (Raleigh): one MATO collab snippet, no matcha brand named on the fetched venue page.
- N&N Collective, Memi's brunch (Richmond): single dated one-offs from one snippet.
- Matcha + Meetup (Cafe of the Day), MatchaFest, Mats & Matcha, Moves & Matcha, Matcha Night Run, Matcha Move Fest: event series or festivals, not local brands (the organizer of Matcha MayFest and Move Fest is kept).
- Wrong place: Mami Matcha (Richmond, California), Dov & Co and Cha Lab (Northern Virginia), Folake Fredericksburg event (Folake already in), Stem & Chasen (Birmingham UK).
- Already in sources.json (skipped): amato-raleigh, frame-matcha, jyuuni-matcha, mazay-ka-matcha, saint-matcha-cafe, hami-cafe, matcha-valley, ceremony-nashville, shogun, notcha, oohmami, muracha, bearly-awake-cafe, exit-plan-matcha, cafecito-jax, ritual-grounds, earth-grounds, peko-peko, matchamamiii (Tampa).
