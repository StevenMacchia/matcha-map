# Menus kept on a hosting platform (Toast, Square Online, PDFs, pictures)

Code: `ingest/lib/shops/hosted-menus.js`, called from `confirmCandidate` (`ingest/lib/shops/providers.js`) when a cafe's own pages give fewer than three matcha drinks. Tests: `test/hosted-menus.test.js`. Written 2026-11-24 (second Population window) after the Triangle pass showed why Durham and the other thin cities are thin.

## What each kind gives us

| Kind | What the page is | What we do | Result on 2026-11-24 |
|---|---|---|---|
| Square Online (`*.square.site`, or a custom domain whose page says `<meta name="generator" content="Square Online">`) | A script-drawn storefront: the HTML is the same shell for every path and holds only the category list. Each product has a public page named in the site's own `/sitemap.xml` (robots.txt points to it), and the product's name is in its URL. | One request per site: the sitemap. Matcha products become `menu_matcha` names (size prefixes "Lg"/"Rg" folded, retail items such as powder, tins, whisks, shirts dropped). Prices stay null (they load by script). The row's `menu_url` is the shop's Square storefront. | Works. 69 North Carolina Square sites: 7 list a matcha product, 2 list three or more (Narrow Gauge Coffee & Cafe in Newton: Affogato Matcha, Hot Matcha, Iced Matcha). The Triangle has none yet: 12 Square sites there list no matcha product. |
| Toast (`order.toasttab.com/online/<slug>`, `www.toasttab.com/<slug>/v3`) | Cloudflare's managed challenge ("Just a moment...", HTTP 403) answers every request, including robots.txt on `order.toasttab.com`. | Not read. It is a bot check; we do not get around it and there is no public, unchallenged data route (the page's own JSON comes from a private API). The reader recognises the challenge, counts the skip as "toast: bot check, not read", and after three challenges in a run stops asking. If a Toast page ever answers unchallenged, its schema.org `Menu`/`MenuItem` JSON-LD is read like any own-site menu (tested against a synthetic fixture only). | 0 Toast menus read. 65 of the 1,032 Triangle candidates link to Toast. |
| PDF | A link "menu" ending `.pdf` | Not read; counted "menu is a PDF". | 40 of 1,032 |
| Pictures | A `/menu` page with two or more images, no price in the text, little text | Not read; counted "menu is pictures only". | 92 of 1,032 |

Square asks for a 5 second Crawl-delay and answers a burst with HTTP 429, so every `*.square.site` request shares one gate, 5 seconds apart, and a 429 pauses the gate for 5 minutes; requests during a pause are not sent and count as "square: rate limited (429)" (the site is not retried in the same pass). A Square storefront's other paths (`/menu`, `/contact`) are not fetched: they return the same shell.

## The Triangle before and after (20 cities, 1,032 candidates with a website)

| | Before | After |
|---|---:|---:|
| Core (matcha shops) | 1 | 1 |
| Serves (matcha on the menu) | 50 | 54 |
| Raleigh | 17 serves | 18 |
| Durham | 4 | 7 |
| Cary | 12 | 12 |
| Apex, Chapel Hill | 4, 4 | 4, 4 |

Why the rest are held (counted per pass in the `--menus` log line): fewer than three matcha drinks on the menu page 569; own site not readable 195; menu is pictures only 92; Toast bot check 65; menu is a PDF 40; Square lists no matcha product 12; Toast robots disallow 8; rate limited (429) 14. Durham stays thin because most of its cafes put the menu in Toast, a PDF or a picture, not because we skipped them.

Command: `node ingest/shops-overture.js --menus --cities "raleigh,durham,..." --tag tri2 --out data/shops-zz-overture-nc.json` (a `--state NC --tag nc` run reads the whole state into the same file; `--tag` gives the pass its own cursor, so the national cursor is untouched).
