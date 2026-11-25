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

## The whole of North Carolina (2026-11-24)

4,554 candidates with a website, 66 new serves rows (NC on the map 71 -> 104 in the landing that merged it with chunk 3). Held, counted: fewer than three matcha drinks 2,469; own site not readable 1,144; menu is pictures only 403; menu is a PDF 167; Toast bot check 128 (and 18 robots disallow, 10 unchallenged pages without matcha); Square lists no matcha product 81, rate limited 11, no sitemap 7, retail items only 1; own site rate limited 49. Toast reads nothing anywhere; PDF and picture menus are the next largest unread class (570 in NC alone) and would need image or PDF reading, which this pipeline does not do.

## PDF menus are read now (2026-11-25, third Population window)

Code: `ingest/lib/shops/pdf-menus.js` (`menuPdfLinks`, `pdfLines`, `readMenuPdfs`, `createPdfGetter`), called from `hostedMenu` when `confirmCandidate` is given a `getPdf` (the Overture run always gives one; `--no-pdf` turns it off). Tests: `test/pdf-menus.test.js` (a PDF built by hand in the test). Library: `pdfjs-dist` (pure JS, legacy build).

What it does: the pages already read from a cafe's own site (`/`, `/menu`, `/locations`, `/contact`, `/about`) are searched for links to a `.pdf` whose link text says "menu" or whose address has "menu" in it (at most three). Each PDF is downloaded once through the shared fetcher's rules (robots.txt, one request a second to a host, 6 MB cap, must start `%PDF`), its text layer is read page by page (12 pages at most; items on one baseline make a line, a wide gap starts a new line so a two-column menu does not merge), and the lines go through the same drink counter as an HTML menu with two extra rules for PDF text: a drink name is letters only (no digit, slash, bar or bullet), not a heading or a flavour list ("MATCHA AND TEA", "Matcha, Chai, Honey Lavender"), and a price or separator left on the end of the line is cut off. Three distinct matcha drinks make a serves row whose `menu_url` is the PDF. A PDF with no text layer is not read and is counted "pdf: scanned, no text layer" (no OCR). Held reasons now say which: `pdf: no matcha drinks`, `pdf: scanned, no text layer`, `pdf: not readable (<why>)`.

How it was run nationally without crawling 154,000 sites again: the previous window's fetch cache (373,000 pages) holds every page the loop read, so `node ingest/shops-overture.js --menus --all --cache-dir <that .cache> --shard i/14 --held-out ...` ran `confirmCandidate` over every candidate from the cache (no site request) and downloaded only the PDFs. `--ids file.json` restricts a run to listed candidates; `--held-out` writes every held candidate with its reason (that is where the picture counts below come from).

Result, all 153,911 candidates (the 150,225 held plus the rows):

| PDF menus | Count |
|---|---:|
| Read, three or more matcha drinks, new row | 37 |
| Read, matcha on it but fewer than three clean drinks | 22 |
| Read, no matcha drinks | 1,523 |
| Scanned, no text layer | 348 |
| Link points at a host that does not resolve (dead domain, an archive.org wrapper) | 1,653 |
| Larger than 6 MB | 189 |
| 404, not a PDF, robots, TLS or broken file | 83 |

The 37 new rows by state: CA 11, PA 4, TX 3, IL 3, GA 3, WA 2, MA 2, CO 2, AZ 1, FL 1, HI 1, NJ 1, NY 1, OH 1, OR 1. The Triangle gains nothing: its 24 held PDF menus are 6 with no matcha drink on them, 3 scanned, 1 too big and 14 links to hosts that no longer exist (Raleigh 6, Cary 4, Durham 2, Apex 1, Chapel Hill 1). A re-run of the dead links at lower concurrency gave the same answer, so they are real. The reader works, but PDF menus are mostly old or retail: the yield is small and the next unread class is pictures.

## Picture-only menus per metro (counted, not read; for the OCR decision)

"menu is pictures only" = a `/menu` page with two or more images, no price in its text and little text. 11,086 of the 153,911 candidates nationally (7%), counted from the same cache pass as above. No OCR was run. Counts are candidates (cafes, tea rooms, bakeries, dessert and juice places with a website), not matcha menus: a share of them will not sell matcha at all (the loop turned about 1.5% of all candidates into serves rows, so reading all of them would give on the order of 150 rows if the same share holds; that is a guess, not a measurement).

Per metro (suburbs rolled in): New York 259, Houston 225, Dallas-Fort Worth 175, Phoenix 166, Los Angeles 148, San Antonio 87, Chicago 85, Orlando 84, San Francisco Bay 74, Las Vegas 72, New Orleans 69, Washington DC 64, Denver 61, Miami 58, San Diego 57, Austin 57, Charlotte 51, Seattle 49, Atlanta 47, Tampa 43, Philadelphia 43, Baton Rouge 42, Boston 42, Portland 39, Jacksonville 38. The Triangle: Raleigh 29, Durham 15, Cary 11, Wake Forest 5, Chapel Hill 3, Morrisville 3, Garner 3, Apex 2 (North Carolina 404 in all, matching the state pass's 403).

By state: TX 1,213, CA 1,118, FL 860, NY 710, NC 404, GA 395, OH 360, IL 357, PA 352, NJ 345, LA 298, AZ 284, CO 273, TN 255, WA 246, MI 237, VA 222, IN 213, MO 211, MD 203, MA 191, OR 180, SC 165, WI 150, UT 142, AL 133, CT 130, MN 124, KY 121, AR 107, OK 106, IA 104, NV 93, MS 93, KS 83, NM 72, ID 68, ME 57, NE 46, HI 45, NH 44, DC 41, WV 34, MT 32, AK 31, VT 27, DE 27, RI 25, ND 21, SD 19, WY 19.

Decision for the next window: local OCR (tesseract) over the 11,086 images' pages is a download of the images (one to several per cafe) and a recogniser run per image; the first 1,000 (the top 20 metros above, about 2,000 cafes in all) would be the sample to run before committing to the rest. Only the images a cafe's own `/menu` page shows would be read; no image is stored.

Other held counts from this pass (nationally): fewer than three matcha drinks 72,191; own site not readable 54,939; Square lists no matcha product 2,732 (no sitemap 306, retail only 23); Toast bot check 2,722 (plus 1,546 Toast pages not in the cache, 492 robots disallow, 179 unchallenged without matcha); own site rate limited (429) 195.
