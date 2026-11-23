# Search Console, step by step

Site: https://matchamap-cu7.pages.dev/ (the pages.dev address; move to a custom domain later and repeat this once).

1. Open https://search.google.com/search-console and sign in with the Google account that should own the site.
2. Add property, choose **URL prefix** (not Domain), enter `https://matchamap-cu7.pages.dev/` exactly, with the trailing slash.
3. Pick the **HTML tag** verification method. Google shows `<meta name="google-site-verification" content="XXXX">`.
4. Put that one line in `site/index.html`, inside `<head>`, right after the `<meta name="mm-app" content="1">` line. No other page needs it. Commit and deploy, then press **Verify**.
   Do not commit a placeholder value: `test/search-console.test.js` fails if the tag has an empty or placeholder content. Only the real token goes in.
5. Sitemaps (left menu), add `sitemap.xml` (full address `https://matchamap-cu7.pages.dev/sitemap.xml`) and submit. Status should read Success within a day; the daily run keeps it current.
6. URL inspection (top bar): paste the home page and one city page, e.g. `https://matchamap-cu7.pages.dev/city/nc/raleigh/`, press **Request indexing** for each. Do this once; do not request indexing in bulk.

## First week

- Day 1 to 2: Sitemaps shows the discovered URL count (about 1,500). Pages shows "Discovered, not indexed" for most; that is normal.
- Pages (Indexing): watch Indexed climb. Look at "Why pages aren't indexed" and open any "Duplicate", "Crawled, not indexed" or "Soft 404" group; sample two URLs in each with URL inspection.
- Enhancements: **Events** (the city and event pages) and **Breadcrumbs**. Any "Invalid items" are errors to fix; "Missing field" warnings on `performer` are expected (see below).
- Performance (data starts after a few days): top queries and pages, and whether city pages (not the home page) are the ones showing up.
- Settings, Crawl stats: response codes should be almost all 200, with no spike in 5xx.

Note on `performer`: the Event structured data omits it on purpose. Google lists it as recommended, and the pop-ups are by brands (the organizer), not named acts.
