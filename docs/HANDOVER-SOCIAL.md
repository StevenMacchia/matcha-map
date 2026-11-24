# Handover: daily social graphics (2026-11-24)

Where things stand after the social-gfx lane. Full behaviour is in `docs/SOCIAL.md`; this is what to know to pick it up.

## The split

- **Feed (1 to 2 a day, 10:00 and 13:00 Eastern): featured pieces only.**
  - Featured shop: the richest shop with 3 to 5 distinct engine-drawn drinks. Core tier first, then most distinct drinks drawn, most menu drinks, has a handle. Not featured in the last 60 days; the metro rotates (never yesterday's); a region owed its weekly feed post (the Triangle) gets its own pick first.
  - Featured pop-up: only when no shop qualifies; today's pop-up with 3 or more drinks.
  - Weekend roundup: Thursday and Friday, "This weekend in <City>".
  - City feature: a metro that gained 3 or more shops in the last 7 days, not repeated for 14 days.
  - `INDEX.md` Type column names the reason (`feed (featured shop)`, `weekend roundup`, `city feature`, `featured pop-up`).
- **Stories: everything routine.** Today's pop-ups, new-on-the-map shop, series reminder, a region's own. Grouped by place (city, else state, else region), each group opens with a title story. Up to 2 groups, 2 content stories per group, so at most 6 stories a day. Times 08:00-09:00 and 11:30-12:30.
- Drawn art only, nothing invented (a drink or fact appears only if our data holds it), 36px text floor, no overflow or overlap.

## The one knob

`MAX_GROUPS` in `tools/social/plan.js` (now 2). `GROUP_CONTENT` (2) is the stories per group. A region owed its weekly story keeps its group even when bigger groups exist.

## Featured history fields

`tools/brand/outbox/history.json`, per date: `brands`, `shops` (every shop featured or storied; a shop never repeats as a new-on-the-map story), `regions` ({feed, story} counts) and `feat` = `{ shop, metro, city }`: the featured shop id, its metro key (`ST/slug`) and the city-feature metro. `feat.shop` drives the 60-day rule, `feat.metro` of the latest earlier date drives the rotation, `feat.city` the 14-day rule. History written before 2026-11-24 has no `feat`, so the first run treats every shop as eligible and has no yesterday to rotate from.

## Drink art

`What they pour` rows are drawn by the repo's drink engine (`tools/illustrate/drink.js`, `docs/ART.md`) through `tools/social/drinks.js`; `data/drink-types.json` holds only the clean-up rules (skip list for merch and page furniture, price and "NEW/Seasonal" strip rules, max name length). `plainReport(shops)` in `drinks.js` lists names the engine could not read (drawn as its plain matcha drawing).

On 2026-11-24, 37 of 6,457 drink lines (0.6%) fell to plain; 28 distinct names to teach the parser (count where more than 1): Matchacha 4, New Matchas 3, Cereal Matchas 2, Fall Matchas 2, Meet Matchagato 2, Matchalicious 2, Matchador, Matchata (and MATCHATA), Toasted Matchamallow, Matchagato, Matchaffogato, Caramelhojichateaki, Hojichavanillasweetcream, Lavendermatcha, Matchachaisweetcream, Matchacheesecream, Matchatini, Matchacano, Matchaccino, Matchado, Matchai, MATCHAWARE (merch), Jadematcha, Packaged Matchas (merch), Matchanana, El Banamatcha, @yfmatchahouse (a handle, not a drink). Suggested parser fix: read "matcha" fused inside a word (matcha+X, X+matcha) as matcha plus X, and "Matchas" as matcha. `data/drinks.json` was not edited (editing it redraws all of `site/art` on the next ingest). A test keeps the plain share under 2%.

## Unclosed nit

A location title story with one row and no drinks (for example a lone pop-up with no menu) still leaves empty space under the row; the picture is capped at 460px rather than padded with anything invented. Fix if wanted: a second line of real facts for that row (venue, address), or merging single-row groups into the state group.

## Re-render a sample day

```bash
npm run social -- --date 2026-11-24 --sample --force
```

Writes `tools/brand/outbox/sample-<date>/` (gitignored) with `INDEX.md`, `plan.json` and one folder per image; it touches neither `history.json` nor `site/social/`. A sample uses an empty history, so featured shops repeat across sample days. Gate: `node --test test/social-gate.test.js` (every template with the longest real names). All social tests: `node --test test/social-daily.test.js test/social-gate.test.js test/social-drinks.test.js test/social.test.js test/social-search.test.js`.
