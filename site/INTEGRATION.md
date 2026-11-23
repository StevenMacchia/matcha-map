
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

## N6: rich cards (site/cards.js, cards.css, cards-app.js)

`site/cards.js` draws the pop-up card, the list row and the brand card. `site/cards-app.js` is a small bridge that
fills the `window.MatchaCards` hook `renderCard()` in app.js already reads, fetches the data the cards need and
handles Share, picture fallbacks and also-nearby links with delegated listeners. No app.js change is needed for the
card itself; two lines in index.html turn it on. Look first at `cards-demo.html` (12 sample cards and rows).

### 1. index.html (two lines)

In `<head>`, after `style.css` (and after `motion.css` if it styles `.card`):

```html
<link rel="stylesheet" href="cards.css">
```

At the end of `<body>`, after `app.js` (a module runs after classic scripts, so `window.__matcha` and `window.Drawn`
exist by then):

```html
<script type="module" src="cards-app.js"></script>
```

The CSP needs nothing new: scripts are `'self'`, the drink and event art is `art/*.svg` on the same origin, and
photos are the hosts already allowed for `img-src`. `sw.js` already lists `/cards.js` and `/cards.css`; add
`/cards-app.js` there too.

### 2. The three call sites in app.js

| Today | Replace with | Notes |
|---|---|---|
| `renderCard(item, ctx)` (l.~626), called from `showCard(key, focusIt)` (l.~683): `C.render(item, ctx)` | nothing to change | `MatchaCards.render` returns the card HTML for kind `e` (`eventCard`) and `b` (`brandCard`), and `null` for shops, so `shopCard` stays the fallback. It is a string, so `body.innerHTML = html` and `setDOMContent(box)` keep working. |
| `rowHTML(it)` (l.~862), event branch (`it.kind === "e"`) | `var r = window.MatchaCards && window.MatchaCards.row && window.MatchaCards.row(it, { events: state.events }); if (r) return r;` at the top of that branch | Returns `<button type="button" class="mm-row ..." data-key="e:<id>">`, so the `#list` click handler (`button[data-key]` -> `flyTo`) and `cardOpener` focus return work unchanged. Distance comes from `state.userLoc` through `window.__matcha.state`. Keep the shop and brand rows as they are. |
| `photoHTML(e)` / `eventCard(e)` / `brandCard(b)` | keep as the fallback | Used when cards.js has not loaded (old browser, offline before the module is cached) or throws. |

Optional: set `window.MatchaCards.open = function (key) { flyTo(key); }` after `flyTo` is defined, so an "Also nearby"
mini row opens that pop-up in place instead of following its `?event=<id>` link.

The card announces nothing itself; `announce("card", { root, ... })` and the motion choreography keep working on its
sections: `.mm-top` (verdict), `.mm-media` (hero), `.mm-main` (brand row, description, `.mm-menu` chips, `.mm-facts`,
`.mm-place` with `.mm-acts`), `.mm-more` (`.mm-posts`, `.mm-story`, `.mm-nearby`, `.mm-report`). The photo is
`.mm-hero-img` over a blurred copy (`.mm-hero-blur`) over the event art, so the washi-tape frame can target
`.mm-hero-photo`. `fillChars(body)` is harmless (cards.js uses no `data-char`).

### 3. Data files

`cards-app.js` loads, once, on its own: `art/index.json` (282 KB, drink and event art lookup), `data/brands.json`
(picture, bio, followers, recent posts), `data/sources.json` (handle and TikTok fallback), `data/places.json`
(reserved). Events come from the `ctx.events` app.js already passes (`state.events` items), and "you are here" from
`window.__matcha.state.userLoc`. brands.json and places.json are fetched twice (once by `loadExtras`); both are
small and cached for 10 minutes by `_headers`, so leave it unless it shows up in a profile.

### 4. Direct use (other pages)

```js
import { cardHtml, rowHtml, brandCardHtml, renderCard, renderRow, renderBrandCard, wire, verdict } from "./cards.js";
const ctx = { now: new Date(), here: [lat, lng] /* or {lat,lng} or null */, art, brands, sources, events,
  drawn: window.Drawn, base: "" /* "/" on pages below the root */, eventHref: (id) => "?event=" + id,
  page: false /* true: two columns from 900 px */, absolute: false /* true: dates, never "Today" */ };
el.appendChild(renderCard(event, ctx));   // or el.innerHTML = cardHtml(event, ctx); wire(el);
```

`tools/gen-event-pages.js` uses `cardHtml` with `{ base: "/", page: true, absolute: true, eventHref: (id) => "/e/" + id + "/" }`
and `site/cards-page.js` wires the static pages.
