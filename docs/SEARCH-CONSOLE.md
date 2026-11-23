# Search Console, step by step

Site: https://matchamap.app/ (the custom domain on the Pages project since 2026-11-23; the old pages.dev host answers every path with a 301 to it). Steven does these by hand; nothing here can be scripted from the repo.

1. Open https://search.google.com/search-console and sign in with the Google account that should own the site.
2. Add property, choose **Domain** (not URL prefix), enter `matchamap.app`. A Domain property covers https, http, www and every subdomain at once, so www never needs its own property.
3. Search Console shows a TXT record value that starts with `google-site-verification=`. In the Cloudflare dashboard: the matchamap.app zone, **DNS**, **Add record**: type `TXT`, name `@`, content the value shown, TTL auto. Save.
4. Back in Search Console press **Verify**. Cloudflare DNS is fast; if it fails, wait a minute and press Verify again. Keep the TXT record forever (Google re-checks it). No tag goes into `site/index.html` for a Domain property.
5. Sitemaps (left menu), add `sitemap.xml` (full address `https://matchamap.app/sitemap.xml`) and submit. Status should read Success within a day; the daily run keeps it current.
6. URL inspection (top bar): paste the home page and one city page, e.g. `https://matchamap.app/city/nc/raleigh/`, press **Request indexing** for each. Do this once; do not request indexing in bulk.

## First week

- Day 1 to 2: Sitemaps shows the discovered URL count (about 1,500). Pages shows "Discovered, not indexed" for most; that is normal.
- Pages (Indexing): watch Indexed climb. Look at "Why pages aren't indexed" and open any "Duplicate", "Crawled, not indexed" or "Soft 404" group; sample two URLs in each with URL inspection. The old pages.dev URLs show up as "Page with redirect": correct.
- Enhancements: **Events** (the city and event pages) and **Breadcrumbs**. Any "Invalid items" are errors to fix; "Missing field" warnings on `performer` are expected (see below).
- Performance (data starts after a few days): top queries and pages, and whether city pages (not the home page) are the ones showing up.
- Settings, Crawl stats: response codes should be almost all 200, with no spike in 5xx.

Note on `performer`: the Event structured data omits it on purpose. Google lists it as recommended, and the pop-ups are by brands (the organizer), not named acts.

What the repo guards: `test/search-console.test.js` fails if `site/index.html` ever carries a verification meta tag with a placeholder value; `tools/check-jsonld.js` (`npm run check:jsonld`) validates every page's structured data; the old host `matchamap-cu7.pages.dev` remains only inside ICS UIDs (identities, never changed) and as a 301 source in `site/_redirects`.
