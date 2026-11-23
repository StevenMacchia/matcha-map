
## N8: search, weekend pages, brand extras, city cards, sitemap

### Search (site/search.js, site/search.css)
1. `index.html`: in the filter bar (or the header) add `<div id="search-slot"></div>` and `<link rel="stylesheet" href="/search.css">`. The box is 100% wide up to 560 px; the results panel is absolutely positioned under it (z-index 40), so the slot's parent must not have `overflow: hidden`.
2. app.js is a classic IIFE; load the module with a dynamic import (works from a classic script):
```js
import("/search.js").then(function (S) {
  window.mmSearch = S.mountSearch(document.getElementById("search-slot"), {
    events: EVENTS,                 // the events.json array
    sources: SOURCES,               // sources.json array
    art: ART_INDEX,                 // fetch("/art/index.json") (drinks, catalog); null is fine, drinks then have no thumbnails
    cities: window.CITY_LIST,       // optional rows [name, ST, lat, lng, pop]
    onPick: function (p) {          // p = { type, id }
      if (p.type === "event") openEvent(p.id);                       // same as ?event=<id>
      else if (p.type === "city") flyToCity(p.id);                   // id is "<slug>-<st>", use MatchaDeepLink.findCityBySlug
      else if (p.type === "brand") filterBrand(p.id);                // id is the handle slug, same as ?brand=
      else if (p.type === "drink") showOnly(S.filterByDrink(EVENTS, p.id, ART_INDEX));  // id is the art slug
    }
  });
});
```
   `S.filterByBrand(events, brandId)` and `S.filterByDrink(events, slug, art)` return the matching events (no DOM). Call `mmSearch.setData({events})` after a refresh, `mmSearch.clear()` when the user clears the filter.
3. Deep links: with `readUrl` (default on) the module reads `?q=` (prefills the box and opens results, no onPick) and `?drink=<slug>` (calls onPick once with `{type:"drink"}`) at mount. `?q=` is also the Zip-or-city box's param: if app.js already consumes `?q=` for that, pass `readUrl: false` and call `mmSearch.applyQuery(location.search)` only for `?drink=`. `applyQuery("?drink=ube-latte")` or `applyQuery({q, drink})` works at any time.
4. CSP for the home page must allow module scripts from `'self'` (they do: `script-src 'self'`). Precache for sw.js (not present in this worktree; add on merge): `/search.js`, `/search.css`, `/weekend.css`, `/weekend/`, `/brand-extras.js`.

### Weekend pages (tools/gen-weekend.js, `npm run weekend`, site/weekend.css)
Written to `site/weekend/<city>-<st>/index.html` plus `site/weekend/index.html`. Cards land in `site/og/weekend-<city>-<st>.png` and `site/og/city-<city>-<st>.png` (key = `<slug>-<st>`, same as `/feeds/<key>.ics` and `?city=`; the state is in the name because city slugs repeat across states). `npm run weekend -- --no-og` skips Chrome. `ingest/run.js` runs weekend, brand-extras and sitemap-extras after the feeds and event pages. Link to `/weekend/` from the footer or About if wanted.

### Brand pages: extras (tools/gen-brand-extras.js, site/brand-extras.js)
`npm run brand-extras` writes `site/brand/<handle>/extra.json` (next dates, drinks with art, price range, story) for brands with something to show. gen-pages.js has no hook for it; add this one line to the brand page body in `buildSite` (after the `pg-sub` paragraph, before the Upcoming section):
```js
body += `<div id="brand-extras" data-src="extra.json"></div><script src="/brand-extras.js" defer></script>\n`;
```
The script loads `/weekend.css` itself, builds DOM with textContent only, and renders nothing when `extra.json` is missing. The brand-page CSP already allows `script-src 'self'`.

### City pages: per-city OG image (gen-pages.js)
`npm run weekend` renders `site/og/city-<slug>-<st>.png` for every city with an upcoming pop-up. In `shell()` pass an `image` option and use it for `og:image` and `twitter:image` instead of the fixed `${SITE_URL}/og.png`:
```js
// shell({ title, desc, canonical, ld, body, image })   image defaults to `${SITE_URL}/og.png`
// in the city loop: image: fs.existsSync(path.join(ROOT, "site/og", `city-${c.slug}-${c.state.toLowerCase()}.png`)) ? `${SITE_URL}/og/city-${c.slug}-${c.state.toLowerCase()}.png` : undefined
```
Cards are generated after pages in ingest, so a city's card is picked up from the next run (or run `npm run weekend` once, then `npm run pages`).

### Sitemap (tools/gen-sitemap-extras.js)
Re-reads `site/sitemap.xml`, replaces everything under `/weekend/`, `/e/` and `/feeds/` (city and all `.ics`, not the per-event ones) from what is on disk, and re-writes it. Idempotent; runs last in ingest.
