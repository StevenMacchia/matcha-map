# City pages for every US city: the SEO rung (spec, 2026-11-23)

Steven, 2026-11-23: "we need to dominate SEO in every city in america. i.e; 'Matcha popup (x)'". This is the spec. Build starts after the weekly reset (Friday 2026-11-28, 09:00Z) with a budget check first; nothing here is built yet. The generated pages are the data session's (`tools/gen-pages.js`, `tools/gen-sitemap-extras.js`, `tools/check-jsonld.js`, tests); the templates, shell and the search-engine side are the SEO lane's (site session). Section 9 is the handoff.

## 1. Queries and the page that answers each

| Query shape | Page | What on the page answers it |
|---|---|---|
| "matcha pop up <city>", "matcha popups <city>" | `/city/<st>/<slug>/` | title, H1, intro numbers, upcoming list with Event schema |
| "matcha pop-ups in <city> this weekend" | same page, "This weekend" block first when the city has one, linking `/weekend/<slug>-<st>/` | the block names the weekend's dates and count |
| "matcha near me" (city intent) | same page via the Nearby section | pop-ups within 40 miles with distance |
| "matcha cafe <city>", "matcha shop <city>" | same page, "Matcha cafes and shops in <City>" | verified shops with hours when known, LocalBusiness schema |
| "matcha pop ups <state>" | `/state/<st>/` | every city in the state with its counts |

One page per city, never one per query: the variants are headings and copy on the same URL.

## 2. Which pages exist

- **City pages**: every city in `data/cities.json` (2,410: top 50 per state plus DC, the same list `site/cities.js` is generated from) plus every brand home city that is not in it (the extra centroids `site/cities.js` already carries). Today `gen-pages.js` (L292-304) gates city pages to the top 100 plus cities with events, brand pop-ups or a verified shop within 25 km, which gives 477. The gate goes; the choice becomes "index or noindex" (section 4).
- **State hubs**: `/state/<st>/` for the 50 states and DC. Title "Matcha pop-ups in <State>: cities, this weekend and upcoming". Three lists: cities with upcoming pop-ups (count and next date), cities with matcha shops (count), every other city in plain links. Breadcrumb Home > State. Indexable when the state has any upcoming pop-up or verified shop; `noindex,follow` otherwise.
- URL shape stays `city/<st>/<slug>/` from `cityPath(c)`; DC stays `washington-dc`. No URL changes, so nothing already indexed moves.
- Size: about 2,460 city pages, 51 state pages, 483 brand pages, 350 event pages, 45 weekend pages, about 3,400 files against the 20,000-file limit. Bytes: 477 city pages plus brands weigh 5.66 MB today; a full city set lands near 20 MB against `LIMITS.bytes` of 15 MB (`gen-pages.js` L11). Measure on the first build and raise the limit to what the measured set needs plus half (Cloudflare Pages has no total-size limit; the guard exists to catch runaway output). Thin noindex pages must stay under 6 KB.

## 3. Anatomy of a city page

In order. Every number is computed from `data/events.json`, `site/data/shops.json`, `data/sources.json` and the watch list at build time; no copy states a number it did not count.

1. **Head**: title `Matcha pop-ups in <City>, <ST>: this weekend and upcoming` (the same for empty cities, so the title is stable); meta description from the intro's first sentence, at most 158 characters; canonical; Open Graph and Twitter as today; `robots` meta from section 4; `lastmod` as section 6.
2. **Breadcrumb**: Home > <State> > <City>, with BreadcrumbList (three items; the state item is new).
3. **H1**: the title text without the suffix: `Matcha pop-ups in <City>, <ST>`.
4. **Intro** (`pg-lead`), one data-built paragraph. With content: "<N> upcoming matcha pop-ups in <City>, <M> matcha shops and <K> brands based here, updated <date>." Empty city: "No matcha pop-up is listed in <City> right now. The nearest is in <Other City>, <D> miles away (<brand>, <date>)." When nothing is within 40 miles: "No matcha pop-up is listed within 40 miles of <City> right now. <M> matcha shops / No matcha shop is listed either." Zero never prints as "0 upcoming pop-ups" in prose.
5. **This weekend** (only when the city has a pop-up in the rolling weekend window `gen-weekend.js` already computes): dates, count, the first three, link to `/weekend/<slug>-<st>/`.
6. **Upcoming pop-ups**: as today, grouped by day in the event's time zone, each card linking `/e/<id>/` and the brand; one Event JSON-LD per pop-up plus the ItemList (as today).
7. **Matcha cafes and shops in <City>**: verified shops within 25 km (today's rule), name, address, miles, hours when `opening_hours` is set, website. New: one `LocalBusiness` JSON-LD per shop, `@type` `CafeOrCoffeeShop`, with `name`, `address` (PostalAddress from the row), `geo`, `url` (the shop's site), `sameAs` (Instagram when known), `openingHoursSpecification` only when `opening_hours` parses (OSM syntax, the plain `Mo-Fr 08:00-17:00; Sa 09:00-15:00` forms; anything else prints as text and gets no schema). Never a rating, never a Yelp field (docs/YELP-TERMS.md).
8. **Brands based in <City>**: as today, linking brand pages.
9. **Nearby**: pop-ups within 40 miles (64 km, a new `NEARBY_KM`), outside the city's own 25 km match, by distance, at most 12, each with city and miles. This is what keeps a thin city honest and useful.
10. **FAQ**: four questions built from data, plain `<details>` blocks with FAQPage JSON-LD. "Is there a matcha pop-up in <City> this weekend?" answered yes with the count and first name, or no with the nearest. "How many matcha shops are in <City>?" "How do I get alerts for <City>?" "How do I list my pop-up in <City>?" Google shows FAQ rich results only for government and health sites since 2023; the markup is still valid and the answers are the page's own copy, so it costs nothing.
11. **Calls to action**: "Get alerts for <City>" to `/alerts/?city=<slug>-<st>` and "Add your pop-up" to `/add/`. The alerts form today offers only the 120 biggest cities in its select (`site/add/add.js` L22-30), so `?city=` for the others selects nothing; section 9 asks the site session to accept any listed slug.
12. **Nearby cities**: the three nearest cities with a page (any city, since every city has one), plus the state hub link. Today it lists six from the chosen pool; three keeps the footprint small on 2,460 pages.
13. **Footer**: as today, with the map deep link `/?city=<slug>-<st>`.

## 4. Index or noindex: no doorways

A city page is indexable when at least one holds: an upcoming pop-up matched to the city; an upcoming pop-up within 40 miles; a verified shop within 25 km; a brand based there. Otherwise the head carries `<meta name="robots" content="noindex,follow">`, the page is left out of `sitemap.xml`, and it still renders in full (intro, FAQ, calls to action, nearby cities, state link) so a visitor from a link or the map gets a real page. The rule is a pure function of the data, re-evaluated every run, so a city flips to indexable the day something appears within 40 miles. `shell()` (`gen-pages.js` L146) gains a `noindex` option; `gen-sitemap-extras.js` already skips noindex weekend pages and keeps doing so.

Expected on today's data: roughly 600 to 900 indexable city pages out of 2,460, the rest noindex. Report the real split on the first build.

## 5. Internal links

- Every event card already links its city page through `cityHref` (`site/cards-app.js` L22-36: `data/pages.json` by name and state, else the nearest page within 25 km). With every city paged, the fallback stops firing: every event lands on its own city's page. `data/pages.json` grows to 2,460 cities; check its size in the app's first paint (it is loaded by the live app).
- Every brand page links "More in <home city>" (today only when the home city is listed; with every city paged this is always).
- Every city page links its state hub and three nearby cities; every state hub links every city in the state.
- The home page links the 50 biggest cities. `site/index.html` is the site session's; `gen-pages.js` patches only the head block today. Proposal: the site session adds `<!-- cities:start -->` and `<!-- cities:end -->` markers in the home body where it wants the block, and `patchIndex` fills the 50 links between them the way it fills the head. No marker, no block, no error.
- `/state/` (an index of the 51 hubs) is one more small page, linked from the footer.

## 6. Freshness that is real

- `lastmod` per city page is the newest `last_seen` or `first_seen` day among the pop-ups on the page, including the Nearby section, capped at the data date (today's `newestDay`, widened to the nearby set). A page whose content did not change keeps yesterday's lastmod: `data/pages.json` stores a hash of each page's body with the "Updated" line removed, and lastmod moves only when the hash moves. A sitemap where every page is "modified today" every day is a signal search engines learn to ignore.
- The daily run (`ingest/run.js` L145-165, in order: art, pages, feeds, event pages, weekend, brand extras, sitemap extras) already rebuilds everything; state hubs go into `gen-pages.run()` after the city pages, and "this weekend in <City>" refreshes as the weekend window rolls (`gen-weekend.js` L18-37).

## 7. Tests and checks

Added to `test/pages.test.js`: every listed city gets a page; the index rule on the four cases and the noindex case (meta present, missing from the sitemap, page still complete); state hubs list every city of the state and carry the breadcrumb; intro numbers equal the counted lists; LocalBusiness only for verified shops with an address, `openingHoursSpecification` only when hours parse, never a rating field; FAQPage questions match the page's own answers; Nearby lists only pop-ups between 25 and 64 km; three nearby cities; the `lastmod` hash rule (same data twice gives the same lastmod; a new event moves it). `tools/check-jsonld.js` learns `site/state`, `LocalBusiness` (name, address, geo) and `FAQPage` (every Question has an acceptedAnswer with text). The home-head patch test covers the cities marker when present.

## 8. Report shape (to the command center on close)

Pages generated: city, state, brand, event, weekend. Indexable city pages and noindex city pages, with the top ten states by indexable count. JSON-LD self-check line (pages, blocks, Event, Organization, LocalBusiness, FAQPage, problems). Output size against the limit. Tests. The smoke and card gates as always. Then the weekly question: the per-city recall table (`tools/percity-table.cjs`, docs/DISCOVERY-YIELD.md) says which indexable-by-nearby cities have no pop-up of their own; those are the next host-venue adapter targets.

## 9. Handoff to the SEO lane (site session)

- Rich Results test on one city page of each kind (events, shops only, nearby only, noindex) and one state hub, before the deploy that ships them, and the Bing Webmaster submission alongside Search Console (docs/SEARCH-CONSOLE.md, now a Domain property on matchamap.app).
- Page weight: a city page with 20 pop-ups and 12 shops, measured with the shell CSS; target under 60 KB over the wire.
- `site/add/add.js`: let `?city=<slug>-<st>` select any city in `window.CITY_LIST`, not the first 120, or fall back to a text field holding the slug.
- The home-body markers for the 50 biggest cities (section 5), and a footer link to `/state/`.
- The weekend page `head()` and the city page `shell()` should share one head template once both carry robots, breadcrumbs and FAQ; that merge is the lane's call on timing.

## 10. Budget and order of work

Budget check first on Friday: both weekly windows must be under the ceiling after the reset before the build starts. The build is a Sonnet worker's from this spec (gen-pages changes, state hubs, LocalBusiness and FAQ builders, tests, check-jsonld), with Fable reading the diff, the first build's numbers and the report. Order: index rule and `noindex` option; all cities paged with size measured; Nearby and the intro; shops schema; FAQ; state hubs; lastmod hash; tests and check-jsonld; home marker patch last (depends on the site session's marker). Deploy only with the site session, after its template pass, through the usual ship path.

## Built 2026-11-23: deviations and numbers

- Pages: 2,420 city (2,410 listed plus 10 brand home cities from site/cities.js, via `loadCities()`, which gen-weekend now uses too so the two agree), 51 state hubs plus /state/, 483 brand. 966 city pages indexable, 1,454 noindex. Output 19.57 MB, so `LIMITS.bytes` is 30 MB (measured plus half).
- Nearby is "not this city's own pop-ups, within 64 km", so a pop-up under 25 km that belongs to a neighbouring city (a Cary event for Apex) shows too; read literally, "between 25 and 64 km" would leave such a city with nothing.
- The meta description is the whole lead (at most 158 characters), not only its first sentence: the empty-city lead is two sentences and the second is the useful one.
- The weekend window (`weekendWindow`, `inWindow`, `windowText`) moved from gen-weekend.js into gen-pages.js; gen-weekend re-exports it, so no circular import.
- Thin noindex pages keep one line instead of "How this map works", drop the calendar-feed button and the og:image size tags, and use short FAQ answers, to stay under 6 KB (largest 6,127 bytes). City pages no longer link /state/ (the state hub does); the footer link is the site session's.
- site/data/pages.json grew from 43 KB to 184 KB (2,420 cities; same fields as before). The {hash, lastmod} map lives in data/pages-lastmod.json, not served.
- Opening hours also accept `<day> off` rules; a day named in two rules, overnight ranges, 24/7, holidays and months are text only.
- A shop gets CafeOrCoffeeShop markup only with an address, a city and a state; at most 12 per page.

## Template pass 2026-11-23 (lane/seo-city): the approved mock

Built on main (2784a5b, the data session's commit), so the city list, hubs at `/state/<st>/` and the index rule are the
data session's. The page now follows `qa/mocks/2026-11-23/city` (lane/design-mocks2): H1 is the full title; a counts line
("2 this weekend, 2 in the next 30 days.", linking the weekend page); the intro paragraph from the counted lists; Get alerts,
Add your pop-up and Open on the map, each with `?city=<slug>-<st>` (`cityParam`, so DC is `washington-dc`); "Updated <date>.
State page: All of <State>"; pop-up cards with a day pill; "Matcha shops in <City>" with the shop and on-the-menu count, a
picture or the drawn storefront, kind, address (with the town when it is not the page's city) and hours or "Hours not
listed"; brand cards (picture or initial, followers from brands.json, @handle, most followed first, 24 cards then links);
"Nearby within 40 miles": the three nearest cities in reach with their own count or "nothing listed yet", how many lie
within 40 miles, then the pop-ups within 40 miles; three questions (next pop-up, where, alerts) as open `<details>`;
"Seen a pop-up we missed?" to `/add/?city=`; breadcrumbs Home > ST > City. Noindex pages show the questions but carry no
FAQPage block (largest thin page under 6 KB). The home page lists the 50 biggest cities and every state hub inside the
list panel, after the list. `site/add/add.js` turns `?city=raleigh-nc` into "Raleigh, NC" on the add form and adds any
listed city to the alerts picker.
