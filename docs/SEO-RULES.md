# SEO rules

Steven, 2026-11-23: "Make sure that the SEO is always up to date and we dont fuck up our SEO at all by flooding things etc. we need organic searchers to do well". Nine rules, each a piece of code that runs on every daily run. `tools/seo-gate.js` (`npm run gate:seo`) checks all nine over the generated `site/` tree and refuses the deploy when one fails: the daily run's `seo-gate` step sits right after `pages` and before `smoke`, and `commit`, `push` and `deploy` need both the smoke and the gate to have passed (`docs/DAILY-RUN.md`).

## The gate

```
node tools/seo-gate.js              the daily run's call: checks, and on a pass moves the state forward
node tools/seo-gate.js --baseline   record today's set as the state; rule 9 does not fail (once, by hand)
node tools/seo-gate.js --dry        print only, write no state
```

It prints one line per rule, then a summary:

```
rule 1 earned index: ok (2,420 city pages, 522 earned an index, 1,898 noindex)
rule 5 thin content: FAIL (2: city/ar/marion: 134 words outside the boilerplate, need 150 | ...)
seo gate: 9 rules, 1 failed; indexable 1441, noindex 1960, lastmod moved 0
```

A failing line carries the number of problems and up to five examples. Exit code 1 on any failure. The daily run never passes `--baseline`.

**The state file**, `data/seo-state.json`, has one owner per key: `registry` and `gone` belong to the generators (rule 3), `indexable` and `pages` to the gate. `pages` is a copy of `data/pages-lastmod.json` as of the last passing run (per page: content hash, lastmod, the six section hashes of a city page), and `indexable` is the sitemap's evergreen set (every URL but event pages and feeds). The gate moves the state forward only on a passing run, so a failure repeats every day until it is fixed (or, for rule 9, until a person raises the limit or records a new baseline). `data/pages-lastmod.json` is the generators' own store and is not served.

First run, by hand: `node tools/seo-gate.js --baseline`. Without a state the gate fails rule 9 with "no previous state".

## Rule 1: indexable only when earned

**Rule.** A city page is indexable when it has at least one upcoming pop-up matched to the city, OR at least one verified shop within 25 km, OR at least two brands based there that have a picture, OR pop-ups within 64 km (40 miles) in at least three distinct other cities. Everything else is `noindex,follow` and out of the sitemap. A state hub is indexable with at least one pop-up or verified shop in the state and at least 5 cities with a page (a hub of one or two cities, DC and Hawaii, only repeats its city pages).

**Enforced.** `cityIndexable()` and `stateIndexable()` in `tools/gen-pages.js` decide when the pages are built. Each page carries its own counts in a tiny attribute on `<html>`: `data-seo="u0 s0 b1 n2"` (city: pop-ups, shops, brands with a picture, other cities with a nearby pop-up) or `data-seo="u12 s30 c50"` (state hub: pop-ups, shops, cities). The gate re-derives the rule from that attribute with the same functions and checks every page's robots meta and its sitemap entry against it (rules 1 and 8). A city page that has earned its index but waits in the pace queue (rule 9) carries ` q` after its counts (`data-seo="u0 s1 b0 n0 q"`) and is noindex and out of the sitemap for now; the gate counts it as earned and waiting, and fails a ` q` on a page whose counts do not earn an index.

**Fails as.** `city/nc/x: counts u0 s0 b0 n3 say indexable, the page is noindex`, `... say in the sitemap, it is out`, `no data-seo summary`.

## Rule 2: no fake freshness

**Rule.** `lastmod` and the "Updated" line change only when the rendered content minus dates changed. The "Updated" line prints the page's own lastmod, never the data date. The rolling weekend window ("Nov 27 to Nov 29") is a date too and is left out of the hash.

**Enforced.** `buildSite()` in `tools/gen-pages.js` stamps every city page, state hub, brand page and the /state/ index, and `tools/gen-event-pages.js` every event page, in `data/pages-lastmod.json`: `[hash, lastmod, section hashes]`. The hash is taken with the Updated date and the weekend window replaced by tokens (`hashInput()` in `tools/seo-lib.js`); lastmod moves only when the hash does, to the newest day the page's pop-ups were seen. A city page's six sections (intro, events, shops, brands, nearby, FAQ) are hashed apart so the gate can say why a page moved. Weekend pages, feeds and the home page keep the data date (they are not stamped).

**Gate.** For every stamped page in the sitemap: the page's own hash must equal the stored one (so the date it prints is the stored lastmod and nobody edited it after the store was written); the sitemap's lastmod must equal the stored one; and against the previous state, lastmod must not have moved while the hash held. It counts the pages whose lastmod moved and prints the top reasons (new or removed event, event changed, shops changed, brands changed, nearby changed, faq changed, intro changed, template or copy change), derived from which section's sub-hash moved.

**Fails as.** `city/nc/x: lastmod moved 2026-11-20 to 2026-11-23 with no change in content`, `Updated line prints Nov 23, 2026, its lastmod is 2026-11-20`, `the page changed after data/pages-lastmod.json was written (run npm run pages)`, `sitemap lastmod ... is not the stored ...`.

## Rule 3: stable URLs

**Rule.** A slug never changes once published. A city that drops to empty keeps its page, noindex, and is never missing. An event or brand page that is no longer generated keeps its address with a 301.

**Enforced.** `tools/gen-pages.js` (brands) and `tools/gen-event-pages.js` (events) keep a registry of the ids and slugs they published, in `data/seo-state.json` (`registry`), with the city each belonged to. When one is no longer generated, `updateRegistry()` in `tools/seo-lib.js` adds a line to `gone`, and `site/_redirects` is rewritten from it: `/e/<id>/ /city/<st>/<slug>/ 301` to the event's city page when known, else `/ 301`; `/brand/<slug>/` the same. A page that comes back loses its line (a redirect on a live path would hide it). The generators own `site/_redirects` entirely; its header comment says so. On the first run, pages already on disk count as published. Cloudflare Pages allows 2,000 static redirects, so `REDIRECT_CAP` is 1,900 and the oldest event lines are dropped first (brand lines last).

**Gate.** Every page in the previous state's snapshot must still exist as a file; a missing `city/` or `state/` page always fails, a missing `e/` or `brand/` page fails unless `site/_redirects` has a line for it. A 301 line whose source is a live page also fails.

**Fails as.** `/city/nc/x/: a published city page is missing (it must keep its page, noindex if empty)`, `/e/<id>/: published before, missing now, and no 301 in site/_redirects`, `/city/nc/x/: a 301 line on a path that is a live page hides it`.

## Rule 4: no duplicates

**Rule.** Titles are unique across all generated pages, meta descriptions are unique, and every page has exactly one canonical equal to its own URL under `https://matchamap.app`.

**Enforced.** Where two pages could collide the generators separate them: two listed cities with one name in one state get a word of their slug in the label (`labelOf()` in `gen-pages.js`); empty-city leads and descriptions carry the city name and state; two brands with one name get their handle; two event pages with one title or description get the venue, the time, or the id's last six letters (`buildEventPages()`).

**Fails as.** `title "..." on 2 pages: city/..., city/...`, `description "..." on 2 pages`, `city/nc/x: 2 canonical links`, `canonical <url>, expected <url>`.

## Rule 5: thin content

**Rule.** An indexable city or state page has at least 150 words outside the boilerplate. No FAQ answer string appears on more than 5% of the indexable city pages.

**Boilerplate** is template text: the head, scripts, header, footer, `nav`, every `h2` and `summary`, and any element marked `data-boiler` (the "Updated" and map-button line, the "Dates come from each brand's own posts" line, the calls to action, the "Nothing listed yet" line, the "How this map works" section). The marker is explicit in the markup, so the gate does not guess.

**Enforced.** FAQ answers in `cityFaq()` all embed the city's own name and numbers; an indexable page answers a fifth question ("Where else can I look near X?") from its own geography; state hubs carry a data-built summary (`stateAbout()`); the Nearby cities list counts as content because the names differ per page. A noindex page keeps only four questions, no FAQPage markup, and three nearby pop-ups, which keeps it under 6 KB.

**Not gated.** Brand pages and event pages are tiny by nature and are in the sitemap as they were; the gate prints how many are under 150 words as information only.

**Fails as.** `city/nc/x: 134 words outside the boilerplate, need 150`, `FAQ answer on 40 of 520 indexable city pages (limit 26): "..."`.

## Rule 6: sitemap hygiene

**Rule.** The sitemap lists only indexable pages that exist as files, under 50,000 URLs per file. Past 45,000 URLs it splits into `sitemap-1.xml`, `sitemap-2.xml`... under an index at `sitemap.xml`. Every URL resolves to an existing `index.html` without noindex (feeds, the one non-page kind, to an existing file), lastmod is `YYYY-MM-DD`, and `robots.txt` names the sitemap.

**Enforced.** `sitemapFiles()` and `writeSitemaps()` in `tools/seo-lib.js`, used by `gen-pages.js` and `gen-sitemap-extras.js` (which reads an index back, adds the weekend, event and feed URLs, and writes the parts again; stale parts are removed). `SITEMAP_SPLIT` and `SITEMAP_CHUNK` are 45,000; tests force small ones.

**Fails as.** `/city/nc/x/: in the sitemap, no file`, `in the sitemap and noindex`, `listed twice`, `lastmod "..." is not YYYY-MM-DD`, `robots.txt does not name https://matchamap.app/sitemap.xml`, `N URLs in one file: past 45,000 it must be an index`, `sitemap-1.xml: N URLs, the limit is 50,000`.

## Rule 7: structured data

**Rule.** `npm run check:jsonld` finds no problem in any page's JSON-LD.

**Enforced.** `tools/check-jsonld.js` exits 1 on any problem, and now also when it finds no page at all (an empty site must not read as clean). The gate calls the same `checkSite()`.

**Fails as.** The checker's own lines, for example `city/nc/x/index.html#2.startDate: Event startDate missing or unparseable`.

**Event fields.** Every Event block (event pages, city and brand pages, the ItemList entries and the weekend pages) must also carry `eventStatus`, `description`, `image` and `performer`; the checker fails as `<page>#n: Event without performer` (or `eventStatus`, `description`, `image`). The generator (`eventLd()` in `gen-pages.js`) fills them from held data only: performer and organizer are the brand (its site, else its page here, else its Instagram); `endDate` is the held end, or the start date for an all-day pop-up, and is left off a timed pop-up with no end; `offers` appear only for a free pop-up (price 0, USD, InStock, the event page as url, `validFrom` the day we first saw it); the image is the drawn scene, else the event's own downloaded photo, else the site card.

## Rule 8: robots and meta never block what should rank

**Rule.** `robots.txt` has no `Disallow` that reaches `/`, `/city/`, `/state/`, `/weekend/`, `/e/` or `/brand/` (or a page inside any of them, wildcards included). The home page has no noindex. `site/_headers` sets no `X-Robots-Tag: noindex`. Every state hub that earned an index has no noindex and is in the sitemap.

**Enforced.** The gate; the robots file is `gen-pages.js`'s (`Allow: /`).

**Fails as.** `robots.txt: Disallow: /city blocks /city/`, `the home page carries noindex`, `site/_headers sets X-Robots-Tag noindex`, `state/nc: u2 s1 c6 says indexable, the page is noindex`.

## Rule 9: publishing pace

**Rule.** A pace breach never refuses a deploy. At most 100 city pages that newly earn an index become indexable per run (`SEO_PACE_LIMIT` changes the cap); the rest stay `noindex,follow` and out of the sitemap until a later run, richest first. Richness is compared position by position: upcoming pop-ups, then shops with opening hours or a menu, then shops, then brands with a picture, then population. A page the last passing run already indexed is never queued or demoted by this rule (only rule 1 can take an index away, when the data no longer earns it). State hubs, brand pages, weekend pages and event pages are not queued; they are few and the gate only counts them.

**Enforced.** `admitPace()` in `tools/gen-pages.js` when the pages are built, against the previous passing state's `indexable` set in `data/seo-state.json` (no state yet: everything earned is admitted and the run is the baseline). A queued page carries ` q` in `data-seo`. The generator writes the queue to the state file under `queue` (`cap`, `admitted`, `queued`, the next ten keys), which the daily report prints as `SEO pace queue: N newly indexable admitted, M earned and waiting (100 per run)`. The gate reports admitted, waiting, new event pages and no-longer-indexable counts, and its summary line ends with `pace queue M`.

**Fails as.** Only `N pages the last passing run indexed are waiting in the pace queue (the queue never demotes): city/..., ...`, which is a generator defect, not a pace breach.

Since 2026-11-24, before that the rule refused the deploy above 150 newly indexable pages (and 300 new event pages). The change came from the first real case: a shop import that earned an index for 209 pages at once, which should flow out over three runs rather than block the picture refresh and the day's events.
