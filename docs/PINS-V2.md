# Pin rules v2 (2026-11-27)

Steven, 2026-11-27: "I still don't like how clustered everything is." The map held 3,893 places and the old rules (city pins to zoom 6, serves pins folded into grey city groups) read as clusters. He saw the mocks and said "Yes, ship v2".

v2 is the default. `?pins=v1` keeps the old rules as a fallback until about 2026-12-04; after that delete the v1 branches (`V2` in `site/app.js`, `tiers()`, `ntColl0`).

## Rules

- Every pop-up with a place is its own pin at every zoom and never folds into a city pin. Pins merge only on the same pixel (`EV_SAME_PX`, 4 px) below zoom 9; from zoom 9 events merge with events within `MERGE_V2` (12 px). City-only events stay rings, merged on the same pixel (MapLibre cluster radius 1).
- Core matcha shops leave city pins at `SHOP_SPLIT_Z` (4; the brief said about 4.5, but the map pane is 1040 px wide beside the list, so the zoom-4 view would still have shown folded shops).
- "Matcha on the menu" (tier serves) draws as soft green dots up to zoom 8.6, one GL circle layer (`svd-dots`, no DOM markers), fading out by 9.4 as their lighter pin arrives from zoom 9. The dots are not tappable.
- Merging is by overlap only, 12 px, same tier only (events, core shops, serves, brands each on their own). A merged group is a stack that fans on tap; below zoom 9 a small merged pin zooms in 2.5 on tap.
- Brands (no place of their own) stay city pins below zoom 9.
- Name labels from zoom 12 for events and core shops (`LABEL_Z_V2`); serves carry none.

## Gate

`tools/map-gate.js` in v2: two single pins of one tier at least 12 px apart (events 4 px below zoom 9; 3 px tolerance for a pill or cup), no label touching another label or a pin, no label off the clear map, and at the opening view every place is held by a pin (`ntStats.covered >= places`) with at least 100 markers drawn. The v1 rule "a stack's box may not be covered by more than 12 px" is v1 only: v2 groups by overlap at 12 px, so same-tier boxes overlap by design.
