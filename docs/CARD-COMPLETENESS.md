# Card completeness

What share of the shops on the map carry each field a card shows. Tool: `node tools/card-completeness.mjs [--md] [--all] [--json]` (`npm run shops:completeness`), which reads `data/shops.json` and counts the rows the site draws (verified, or confirmed via public-page or overture, and not `status: "closed"`). A field counts when the row has it: website, phone, hours (`opening_hours`), menu link (`menu_url`), image (`image_url`, always from the shop's own site with a credit), Instagram handle, note. The note is a hand-written line ("Pop-up window at Maison Neue"), not a field a source can fill, so it stays low on purpose.

Reading 1 is the baseline taken 2026-11-24 before this pass (1,143 rows); reading 2 is the same day after it. Both are in this file; later readings go below.

## What the pass did (2026-11-24, second Population window)

`npm run shops:fill` (ingest/shops-fill.js) writes only to `data/shops-extra.json`, the overlay `attachExtras` applies on every `npm run shops` (only empty fields on a row are filled, so the cafe-menu loop that rewrites the serves file never loses them):

1. **Overture carry**: the Overture place behind each row (by `overture_id`; 21 hand-researched rows matched by the same name within 150 m): its own website (never a Yelp, Facebook, Instagram, TripAdvisor or ordering-site URL), an Instagram handle from its socials or an Instagram listing, and its phone. The rows already carried what Overture holds, so this found little: 3 Instagram handles, 7 phones, 0 websites. 72 of the 99 Overture core rows have a website, and the 27 without one have none in Overture either.
2. **Own-site read** (934 shops with a website and a blank field; 918 readable, 12 network errors, 2 404, 1 robots, 1 403): home, /contact, /hours, /locations, /visit, /about, /menu until the blanks are found. Hours from schema.org `openingHoursSpecification` / `openingHours`, or a plain hours block (`ingest/lib/shops/hours.js`: "Mon-Fri 7am-3pm" lines that start with day names and carry a clear time range, at least three days named, am/pm inferred only when the other end has it; event lines such as "Sat Nov 28 10am-4pm" and a lone market day do not match; every result is checked against the OpenStreetMap shape and dropped if it does not parse); phone from JSON-LD or a tel: link; the Instagram handle linked on the page; a menu link on the shop's own host (or its Toast, Square, Chownow or Clover order page); the og:image under the image rules in docs/SHOPS-WORKER.md (own site only, credit "Photo: <shop> website", never an Instagram, Facebook, Google or Yelp CDN).

Result: 279 rows gained at least one field.

## Reading 2 (after), 2026-11-24

### Fields gained across all 1,143 rows

| Field | Rows before | Rows after | Gained | Share before | Share after |
|---|---:|---:|---:|---:|---:|
| website | 1105 | 1105 | +0 | 97% | 97% |
| phone | 993 | 1001 | +8 | 87% | 88% |
| hours | 305 | 528 | +223 | 27% | 46% |
| menu | 952 | 995 | +43 | 83% | 87% |
| image | 679 | 714 | +35 | 59% | 62% |
| instagram | 897 | 936 | +39 | 78% | 82% |
| note | 39 | 39 | +0 | 3% | 3% |

### By tier
| Tier | Rows | Website | Phone | Hours | Menu link | Image | Instagram | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| serves (matcha on the menu) | 871 | 100% | 96% | 46% | 100% | 66% | 89% | 4% |
| shop (core) | 272 | 86% | 60% | 47% | 46% | 50% | 60% | 1% |
| **All** | 1143 | 97% | 88% | 46% | 87% | 62% | 82% | 3% |

### By state
| State | Rows | Website | Phone | Hours | Menu link | Image | Instagram | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| AL | 7 | 100% | 100% | 71% | 100% | 86% | 71% | 0% |
| AR | 1 | 100% | 100% | 100% | 100% | 100% | 0% | 0% |
| AZ | 21 | 95% | 86% | 38% | 90% | 71% | 76% | 0% |
| CA | 384 | 96% | 89% | 34% | 87% | 50% | 83% | 0% |
| CO | 22 | 100% | 100% | 55% | 100% | 86% | 86% | 0% |
| CT | 4 | 100% | 50% | 25% | 25% | 0% | 25% | 0% |
| DC | 9 | 100% | 100% | 0% | 89% | 56% | 56% | 0% |
| FL | 39 | 97% | 90% | 54% | 87% | 82% | 85% | 5% |
| GA | 27 | 96% | 81% | 59% | 96% | 74% | 93% | 0% |
| HI | 14 | 100% | 64% | 50% | 57% | 57% | 71% | 0% |
| IA | 3 | 100% | 100% | 100% | 100% | 67% | 33% | 0% |
| ID | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| IL | 47 | 100% | 89% | 53% | 94% | 74% | 85% | 0% |
| IN | 3 | 100% | 100% | 100% | 100% | 67% | 100% | 0% |
| KS | 3 | 100% | 67% | 67% | 67% | 67% | 33% | 0% |
| KY | 3 | 100% | 67% | 67% | 33% | 100% | 33% | 0% |
| LA | 4 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MA | 24 | 100% | 88% | 75% | 92% | 46% | 96% | 0% |
| MD | 14 | 100% | 93% | 21% | 93% | 21% | 93% | 0% |
| ME | 2 | 100% | 50% | 100% | 100% | 50% | 100% | 0% |
| MI | 10 | 100% | 100% | 50% | 100% | 80% | 60% | 0% |
| MN | 12 | 92% | 92% | 42% | 92% | 58% | 75% | 0% |
| MO | 2 | 100% | 0% | 50% | 100% | 100% | 100% | 0% |
| MS | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MT | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| NC | 65 | 100% | 97% | 57% | 97% | 74% | 89% | 55% |
| NE | 3 | 100% | 100% | 0% | 100% | 33% | 67% | 0% |
| NH | 2 | 100% | 100% | 0% | 50% | 50% | 50% | 0% |
| NJ | 21 | 95% | 90% | 43% | 81% | 71% | 57% | 0% |
| NM | 10 | 100% | 100% | 90% | 100% | 80% | 100% | 0% |
| NV | 22 | 91% | 86% | 55% | 82% | 73% | 68% | 0% |
| NY | 110 | 97% | 75% | 50% | 73% | 75% | 79% | 0% |
| OH | 12 | 100% | 100% | 42% | 75% | 75% | 67% | 0% |
| OK | 2 | 100% | 100% | 100% | 100% | 100% | 50% | 0% |
| OR | 17 | 94% | 94% | 35% | 88% | 59% | 94% | 0% |
| PA | 23 | 96% | 83% | 52% | 91% | 61% | 78% | 0% |
| SC | 5 | 100% | 100% | 0% | 100% | 80% | 100% | 0% |
| TN | 8 | 100% | 88% | 75% | 88% | 88% | 88% | 0% |
| TX | 88 | 88% | 85% | 50% | 84% | 58% | 80% | 0% |
| UT | 8 | 100% | 75% | 88% | 100% | 50% | 100% | 0% |
| VA | 30 | 100% | 90% | 43% | 100% | 63% | 97% | 0% |
| VT | 2 | 100% | 50% | 100% | 100% | 100% | 100% | 0% |
| WA | 46 | 98% | 91% | 50% | 87% | 72% | 83% | 0% |
| WI | 5 | 100% | 60% | 60% | 100% | 40% | 40% | 0% |
| WV | 1 | 100% | 100% | 0% | 100% | 0% | 0% | 0% |
| **All** | 1143 | 97% | 88% | 46% | 87% | 62% | 82% | 3% |

### By state and tier
| State and tier | Rows | Website | Phone | Hours | Menu link | Image | Instagram | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AK serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| AL serves | 7 | 100% | 100% | 71% | 100% | 86% | 71% | 0% |
| AR serves | 1 | 100% | 100% | 100% | 100% | 100% | 0% | 0% |
| AZ core | 4 | 75% | 50% | 0% | 50% | 75% | 75% | 0% |
| AZ serves | 17 | 100% | 94% | 47% | 100% | 71% | 76% | 0% |
| CA core | 80 | 83% | 61% | 41% | 36% | 39% | 53% | 1% |
| CA serves | 304 | 100% | 96% | 32% | 100% | 53% | 91% | 0% |
| CO core | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| CO serves | 20 | 100% | 100% | 50% | 100% | 85% | 85% | 0% |
| CT core | 4 | 100% | 50% | 25% | 25% | 0% | 25% | 0% |
| DC core | 4 | 100% | 100% | 0% | 75% | 0% | 0% | 0% |
| DC serves | 5 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| FL core | 9 | 89% | 56% | 44% | 44% | 67% | 67% | 11% |
| FL serves | 30 | 100% | 100% | 57% | 100% | 87% | 90% | 3% |
| GA core | 1 | 0% | 0% | 100% | 0% | 0% | 0% | 0% |
| GA serves | 26 | 100% | 85% | 58% | 100% | 77% | 96% | 0% |
| HI core | 10 | 100% | 50% | 60% | 40% | 50% | 60% | 0% |
| HI serves | 4 | 100% | 100% | 25% | 100% | 75% | 100% | 0% |
| IA serves | 3 | 100% | 100% | 100% | 100% | 67% | 33% | 0% |
| ID serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| IL core | 8 | 100% | 63% | 75% | 63% | 88% | 88% | 0% |
| IL serves | 39 | 100% | 95% | 49% | 100% | 72% | 85% | 0% |
| IN serves | 3 | 100% | 100% | 100% | 100% | 67% | 100% | 0% |
| KS core | 1 | 100% | 100% | 0% | 0% | 100% | 0% | 0% |
| KS serves | 2 | 100% | 50% | 100% | 100% | 50% | 50% | 0% |
| KY core | 2 | 100% | 50% | 50% | 0% | 100% | 0% | 0% |
| KY serves | 1 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| LA core | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| LA serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MA core | 7 | 100% | 57% | 57% | 71% | 43% | 100% | 0% |
| MA serves | 17 | 100% | 100% | 82% | 100% | 47% | 94% | 0% |
| MD core | 5 | 100% | 100% | 40% | 80% | 0% | 100% | 0% |
| MD serves | 9 | 100% | 89% | 11% | 100% | 33% | 89% | 0% |
| ME core | 1 | 100% | 0% | 100% | 100% | 100% | 100% | 0% |
| ME serves | 1 | 100% | 100% | 100% | 100% | 0% | 100% | 0% |
| MI serves | 10 | 100% | 100% | 50% | 100% | 80% | 60% | 0% |
| MN core | 5 | 80% | 80% | 0% | 80% | 20% | 60% | 0% |
| MN serves | 7 | 100% | 100% | 71% | 100% | 86% | 86% | 0% |
| MO core | 1 | 100% | 0% | 100% | 100% | 100% | 100% | 0% |
| MO serves | 1 | 100% | 0% | 0% | 100% | 100% | 100% | 0% |
| MS serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MT serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| NC core | 3 | 100% | 33% | 67% | 33% | 100% | 100% | 33% |
| NC serves | 62 | 100% | 100% | 56% | 100% | 73% | 89% | 56% |
| NE serves | 3 | 100% | 100% | 0% | 100% | 33% | 67% | 0% |
| NH core | 1 | 100% | 100% | 0% | 0% | 0% | 0% | 0% |
| NH serves | 1 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| NJ core | 4 | 75% | 75% | 25% | 0% | 25% | 25% | 0% |
| NJ serves | 17 | 100% | 94% | 47% | 100% | 82% | 65% | 0% |
| NM serves | 10 | 100% | 100% | 90% | 100% | 80% | 100% | 0% |
| NV core | 6 | 67% | 67% | 100% | 33% | 67% | 33% | 0% |
| NV serves | 16 | 100% | 94% | 38% | 100% | 75% | 81% | 0% |
| NY core | 47 | 94% | 49% | 49% | 36% | 60% | 55% | 0% |
| NY serves | 63 | 100% | 94% | 51% | 100% | 86% | 97% | 0% |
| OH core | 4 | 100% | 100% | 50% | 25% | 75% | 75% | 0% |
| OH serves | 8 | 100% | 100% | 38% | 100% | 75% | 63% | 0% |
| OK serves | 2 | 100% | 100% | 100% | 100% | 100% | 50% | 0% |
| OR core | 3 | 67% | 100% | 67% | 33% | 33% | 67% | 0% |
| OR serves | 14 | 100% | 93% | 29% | 100% | 64% | 100% | 0% |
| PA core | 7 | 86% | 43% | 43% | 71% | 14% | 71% | 0% |
| PA serves | 16 | 100% | 100% | 56% | 100% | 81% | 81% | 0% |
| SC serves | 5 | 100% | 100% | 0% | 100% | 80% | 100% | 0% |
| TN core | 1 | 100% | 0% | 100% | 0% | 100% | 100% | 0% |
| TN serves | 7 | 100% | 100% | 71% | 100% | 86% | 86% | 0% |
| TX core | 27 | 59% | 52% | 33% | 48% | 48% | 52% | 0% |
| TX serves | 61 | 100% | 100% | 57% | 100% | 62% | 92% | 0% |
| UT core | 3 | 100% | 33% | 100% | 100% | 33% | 100% | 0% |
| UT serves | 5 | 100% | 100% | 80% | 100% | 60% | 100% | 0% |
| VA core | 3 | 100% | 67% | 67% | 100% | 33% | 100% | 0% |
| VA serves | 27 | 100% | 93% | 41% | 100% | 67% | 96% | 0% |
| VT serves | 2 | 100% | 50% | 100% | 100% | 100% | 100% | 0% |
| WA core | 17 | 94% | 76% | 59% | 65% | 76% | 88% | 0% |
| WA serves | 29 | 100% | 100% | 45% | 100% | 69% | 79% | 0% |
| WI serves | 5 | 100% | 60% | 60% | 100% | 40% | 40% | 0% |
| WV serves | 1 | 100% | 100% | 0% | 100% | 0% | 0% | 0% |
| **All** | 1143 | 97% | 88% | 46% | 87% | 62% | 82% | 3% |

## Reading 1 (baseline), 2026-11-24

### By tier
| Tier | Rows | Website | Phone | Hours | Menu link | Image | Instagram | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| serves (matcha on the menu) | 871 | 100% | 96% | 22% | 100% | 66% | 89% | 4% |
| shop (core) | 272 | 86% | 57% | 41% | 30% | 38% | 46% | 1% |
| **All** | 1143 | 97% | 87% | 27% | 83% | 59% | 78% | 3% |

### By state
| State | Rows | Website | Phone | Hours | Menu link | Image | Instagram | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 2 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| AL | 7 | 100% | 100% | 57% | 100% | 86% | 71% | 0% |
| AR | 1 | 100% | 100% | 0% | 100% | 100% | 0% | 0% |
| AZ | 21 | 95% | 86% | 14% | 90% | 67% | 71% | 0% |
| CA | 384 | 96% | 89% | 16% | 83% | 47% | 80% | 0% |
| CO | 22 | 100% | 100% | 41% | 100% | 86% | 86% | 0% |
| CT | 4 | 100% | 50% | 25% | 25% | 0% | 25% | 0% |
| DC | 9 | 100% | 100% | 0% | 89% | 56% | 56% | 0% |
| FL | 39 | 97% | 90% | 38% | 87% | 79% | 82% | 5% |
| GA | 27 | 96% | 81% | 44% | 96% | 74% | 93% | 0% |
| HI | 14 | 100% | 64% | 50% | 57% | 50% | 57% | 0% |
| IA | 3 | 100% | 100% | 67% | 100% | 67% | 33% | 0% |
| ID | 2 | 100% | 100% | 50% | 100% | 100% | 100% | 0% |
| IL | 47 | 100% | 89% | 23% | 87% | 66% | 77% | 0% |
| IN | 3 | 100% | 100% | 67% | 100% | 67% | 100% | 0% |
| KS | 3 | 100% | 67% | 33% | 67% | 33% | 33% | 0% |
| KY | 3 | 100% | 67% | 67% | 33% | 67% | 33% | 0% |
| LA | 4 | 100% | 75% | 100% | 100% | 100% | 100% | 0% |
| MA | 24 | 100% | 79% | 33% | 88% | 42% | 92% | 0% |
| MD | 14 | 100% | 86% | 21% | 71% | 21% | 86% | 0% |
| ME | 2 | 100% | 50% | 0% | 50% | 0% | 50% | 0% |
| MI | 10 | 100% | 100% | 30% | 100% | 80% | 60% | 0% |
| MN | 12 | 92% | 92% | 33% | 67% | 58% | 50% | 0% |
| MO | 2 | 100% | 0% | 0% | 100% | 100% | 100% | 0% |
| MS | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MT | 2 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| NC | 65 | 100% | 97% | 18% | 95% | 72% | 89% | 55% |
| NE | 3 | 100% | 100% | 0% | 100% | 33% | 67% | 0% |
| NH | 2 | 100% | 100% | 0% | 50% | 50% | 50% | 0% |
| NJ | 21 | 95% | 90% | 33% | 81% | 71% | 57% | 0% |
| NM | 10 | 100% | 100% | 50% | 100% | 80% | 100% | 0% |
| NV | 22 | 91% | 86% | 32% | 82% | 73% | 68% | 0% |
| NY | 110 | 97% | 74% | 36% | 67% | 70% | 76% | 0% |
| OH | 12 | 100% | 100% | 25% | 67% | 58% | 58% | 0% |
| OK | 2 | 100% | 100% | 100% | 100% | 100% | 50% | 0% |
| OR | 17 | 94% | 94% | 24% | 88% | 59% | 94% | 0% |
| PA | 23 | 96% | 83% | 35% | 78% | 61% | 78% | 0% |
| SC | 5 | 100% | 100% | 0% | 100% | 80% | 100% | 0% |
| TN | 8 | 100% | 88% | 50% | 88% | 88% | 88% | 0% |
| TX | 88 | 88% | 84% | 34% | 81% | 56% | 76% | 0% |
| UT | 8 | 100% | 75% | 63% | 88% | 50% | 88% | 0% |
| VA | 30 | 100% | 87% | 23% | 93% | 63% | 93% | 0% |
| VT | 2 | 100% | 50% | 100% | 100% | 100% | 100% | 0% |
| WA | 46 | 98% | 89% | 30% | 83% | 67% | 78% | 0% |
| WI | 5 | 100% | 60% | 20% | 100% | 40% | 40% | 0% |
| WV | 1 | 100% | 100% | 0% | 100% | 0% | 0% | 0% |
| **All** | 1143 | 97% | 87% | 27% | 83% | 59% | 78% | 3% |

### By state and tier
| State and tier | Rows | Website | Phone | Hours | Menu link | Image | Instagram | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AK serves | 2 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| AL serves | 7 | 100% | 100% | 57% | 100% | 86% | 71% | 0% |
| AR serves | 1 | 100% | 100% | 0% | 100% | 100% | 0% | 0% |
| AZ core | 4 | 75% | 50% | 0% | 50% | 50% | 50% | 0% |
| AZ serves | 17 | 100% | 94% | 18% | 100% | 71% | 76% | 0% |
| CA core | 80 | 83% | 61% | 35% | 20% | 24% | 35% | 1% |
| CA serves | 304 | 100% | 96% | 11% | 100% | 53% | 91% | 0% |
| CO core | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| CO serves | 20 | 100% | 100% | 35% | 100% | 85% | 85% | 0% |
| CT core | 4 | 100% | 50% | 25% | 25% | 0% | 25% | 0% |
| DC core | 4 | 100% | 100% | 0% | 75% | 0% | 0% | 0% |
| DC serves | 5 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| FL core | 9 | 89% | 56% | 44% | 44% | 56% | 56% | 11% |
| FL serves | 30 | 100% | 100% | 37% | 100% | 87% | 90% | 3% |
| GA core | 1 | 0% | 0% | 100% | 0% | 0% | 0% | 0% |
| GA serves | 26 | 100% | 85% | 42% | 100% | 77% | 96% | 0% |
| HI core | 10 | 100% | 50% | 60% | 40% | 40% | 40% | 0% |
| HI serves | 4 | 100% | 100% | 25% | 100% | 75% | 100% | 0% |
| IA serves | 3 | 100% | 100% | 67% | 100% | 67% | 33% | 0% |
| ID serves | 2 | 100% | 100% | 50% | 100% | 100% | 100% | 0% |
| IL core | 8 | 100% | 63% | 13% | 25% | 38% | 38% | 0% |
| IL serves | 39 | 100% | 95% | 26% | 100% | 72% | 85% | 0% |
| IN serves | 3 | 100% | 100% | 67% | 100% | 67% | 100% | 0% |
| KS core | 1 | 100% | 100% | 0% | 0% | 0% | 0% | 0% |
| KS serves | 2 | 100% | 50% | 50% | 100% | 50% | 50% | 0% |
| KY core | 2 | 100% | 50% | 50% | 0% | 50% | 0% | 0% |
| KY serves | 1 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| LA core | 2 | 100% | 50% | 100% | 100% | 100% | 100% | 0% |
| LA serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MA core | 7 | 100% | 29% | 57% | 57% | 29% | 86% | 0% |
| MA serves | 17 | 100% | 100% | 24% | 100% | 47% | 94% | 0% |
| MD core | 5 | 100% | 80% | 40% | 20% | 0% | 80% | 0% |
| MD serves | 9 | 100% | 89% | 11% | 100% | 33% | 89% | 0% |
| ME core | 1 | 100% | 0% | 0% | 0% | 0% | 0% | 0% |
| ME serves | 1 | 100% | 100% | 0% | 100% | 0% | 100% | 0% |
| MI serves | 10 | 100% | 100% | 30% | 100% | 80% | 60% | 0% |
| MN core | 5 | 80% | 80% | 0% | 20% | 20% | 0% | 0% |
| MN serves | 7 | 100% | 100% | 57% | 100% | 86% | 86% | 0% |
| MO core | 1 | 100% | 0% | 0% | 100% | 100% | 100% | 0% |
| MO serves | 1 | 100% | 0% | 0% | 100% | 100% | 100% | 0% |
| MS serves | 2 | 100% | 100% | 100% | 100% | 100% | 100% | 0% |
| MT serves | 2 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| NC core | 3 | 100% | 33% | 67% | 0% | 67% | 100% | 33% |
| NC serves | 62 | 100% | 100% | 16% | 100% | 73% | 89% | 56% |
| NE serves | 3 | 100% | 100% | 0% | 100% | 33% | 67% | 0% |
| NH core | 1 | 100% | 100% | 0% | 0% | 0% | 0% | 0% |
| NH serves | 1 | 100% | 100% | 0% | 100% | 100% | 100% | 0% |
| NJ core | 4 | 75% | 75% | 25% | 0% | 25% | 25% | 0% |
| NJ serves | 17 | 100% | 94% | 35% | 100% | 82% | 65% | 0% |
| NM serves | 10 | 100% | 100% | 50% | 100% | 80% | 100% | 0% |
| NV core | 6 | 67% | 67% | 100% | 33% | 67% | 33% | 0% |
| NV serves | 16 | 100% | 94% | 6% | 100% | 75% | 81% | 0% |
| NY core | 47 | 94% | 47% | 47% | 23% | 53% | 49% | 0% |
| NY serves | 63 | 100% | 94% | 29% | 100% | 83% | 97% | 0% |
| OH core | 4 | 100% | 100% | 50% | 0% | 25% | 50% | 0% |
| OH serves | 8 | 100% | 100% | 13% | 100% | 75% | 63% | 0% |
| OK serves | 2 | 100% | 100% | 100% | 100% | 100% | 50% | 0% |
| OR core | 3 | 67% | 100% | 67% | 33% | 33% | 67% | 0% |
| OR serves | 14 | 100% | 93% | 14% | 100% | 64% | 100% | 0% |
| PA core | 7 | 86% | 43% | 43% | 29% | 14% | 71% | 0% |
| PA serves | 16 | 100% | 100% | 31% | 100% | 81% | 81% | 0% |
| SC serves | 5 | 100% | 100% | 0% | 100% | 80% | 100% | 0% |
| TN core | 1 | 100% | 0% | 100% | 0% | 100% | 100% | 0% |
| TN serves | 7 | 100% | 100% | 43% | 100% | 86% | 86% | 0% |
| TX core | 27 | 59% | 52% | 30% | 37% | 41% | 41% | 0% |
| TX serves | 61 | 100% | 98% | 36% | 100% | 62% | 92% | 0% |
| UT core | 3 | 100% | 33% | 67% | 67% | 33% | 67% | 0% |
| UT serves | 5 | 100% | 100% | 60% | 100% | 60% | 100% | 0% |
| VA core | 3 | 100% | 33% | 67% | 33% | 33% | 67% | 0% |
| VA serves | 27 | 100% | 93% | 19% | 100% | 67% | 96% | 0% |
| VT serves | 2 | 100% | 50% | 100% | 100% | 100% | 100% | 0% |
| WA core | 17 | 94% | 71% | 53% | 53% | 65% | 76% | 0% |
| WA serves | 29 | 100% | 100% | 17% | 100% | 69% | 79% | 0% |
| WI serves | 5 | 100% | 60% | 20% | 100% | 40% | 40% | 0% |
| WV serves | 1 | 100% | 100% | 0% | 100% | 0% | 0% | 0% |
| **All** | 1143 | 97% | 87% | 27% | 83% | 59% | 78% | 3% |

## What is still blank, and why

- **Hours (46%)**: the biggest gap. A shop's own site often shows hours only as an image, inside a Google/Instagram embed, or in a script-drawn widget; none of those is read. A shop that names only one or two days is left blank rather than guess. Hours in Overture are not in the cached extract.
- **Image (62%)**: shops whose site has no og:image or JSON-LD image; a photo is never taken from Instagram, Facebook, Google or Yelp.
- **Menu link (87%)**: core shops whose site has no /menu page or menu link (a one-page site). Serves rows are 100% by rule.
- **Note (3%)**: editorial. Left to a human (or to the shop-claim form).
- **Website (97%)**: the blanks are rows whose only listing was a Facebook, Instagram or ordering page; those are not stored as a website.
