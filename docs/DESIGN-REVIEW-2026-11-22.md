# Matcha Map: design review, 2026-11-22 (rung 35)

Reviewed cold, from renders of the local build at 1440x900 and 390x844 (headless Chrome, light and dark, motion on and reduced): the opening, the national view, Atlanta, New York and Los Angeles, an event card with a photo, one without, an approximate event, a brand, a shop, the list, the filters, the Show popover, the Zip-or-city box with a bad entry, About, Billings (59101) on This weekend and on Any date, the static Atlanta city page and the Sabz Matcha brand page. Contrast was measured for every text pair that looked weak: all body and label text passes 4.5:1 in both themes (lowest: deep green on foam, 5.4:1); the misses are non-text, the dashed ring (2.8:1 against the map, less at low zoom) and the chip outlines (2.1:1), both of which carry no meaning on their own.

## Verdict

The character work is the best thing here and it is genuinely distinctive: Mattie, the dango clusters, the drawn cards and the pour read as one house, and nothing in the palette is generic. What lets it down is everything around the cast. The phone opens on a clipped, tiny continent; the first thing a visitor reads in any list is the word "unsure" and "Place not posted yet · 0 mi" on half the rows; the card on a phone shows a photo and hides the name, time and place below the fold; the national map is confetti of five marker species; the filter bar is nine equal buttons and a raw date field; and quiet places end in a dead end. The honesty is right, but it is shaped as noise rather than as information. Fix the opening, the list, the card's first screen and the filters, and this goes from a charming prototype to something that feels made.

## Findings, worst first

★ = done tonight.

| # | Where (screen, size) | What is wrong | Fix |
|---|---|---|---|
| 1 ★ | Opening, phone 390 | The whole-country view is narrower than minZoom allows, so the West Coast is cut off and every pin is a speck. | Open on the remembered zip, else the busiest region at a readable zoom, with one quiet line saying so. |
| 2 ★ | List, both sizes | 60% of rows carry an "unsure" pill and 59% say "Place not posted yet · Atlanta, GA · 0 mi", sorted first because 0 mi is "nearest". | In a metro, gather city-only pop-ups under one dashed "Place not posted yet" heading after the placed ones, drop the false distance, and say "date unconfirmed" in quiet text instead of a pill. |
| 3 ★ | Card, phone sheet | At the half-open snap the sheet shows only the photo or drawn card; name, time and place are below the fold. | On the phone, facts and actions come first and the photo follows. |
| 4 ★ | Card, both | Five equal pill links wrap to three rows (Open in Google Maps, Directions, Post, Instagram, TikTok) and there is no way to send it to a friend. | One primary action and Share, then a single quiet row of text links. |
| 5 ★ | National view, both | Pins, dango clusters, dashed ghost rings, brand mochi and storefronts all draw at zoom 4 and overlap into confetti. | Below zoom 6 draw pop-ups only, with the city-only ones counted in the same clusters; brands and storefronts arrive from zoom 6. |
| 6 ★ | First visit, both | Once the service worker installs it takes over the page, which fires a controller change, and pwa.js answers every controller change with a reload, so a first visit reloads itself a second or two in, mid-opening. | Reload only when a worker that was already in charge is replaced (the update bar). |
| 7 ★ | Empty, Billings | Any date says "Nothing in this part of the map. Zoom out or pan."; This weekend offers "See next 7 days", which is empty too. | Name the nearest pop-up and how far it is, with one button that goes there. |
| 8 ★ | Filters, phone | Two rows cost 115 px at the top, "Any date" is clipped off the right edge, and the date chips are out of thumb reach. | Date chips (Today, Sat, Sun, Week, Any) move to a bar at the bottom; the top keeps Show, Near me and the place box in one row. |
| 9 ★ | Filters, desktop | Nine controls of equal weight in one line, ending in a raw "mm/dd/yyyy" field. | The day picker becomes a chip that shows the chosen day, and the place controls sit apart on the right. |
| 10 ★ | Date filters, both | On Today the map is mostly brand mochi that have no dates at all. | Hide no-date brands while a date filter is on. |
| 11 ★ | Card, no photo | The drawn card repeats the name, date, city and menu printed right under it; "Save card" sits between the art and the title. | Keep the art as the picture, move Save card into the link row. |
| 12 ★ | Brand and shop cards | The brand name appears three times (drawn art, heading, brand row) and the art says "No dates posted here yet" twice. | Drop the drawn art on brand and shop cards; the brand row already carries the picture. |
| 13 ★ | Near row, both | "Near Atlanta, GA · Clear" spends a full-width 60 px strip repeating what the box already says. | Remove the strip; a clear button sits inside the place box. |
| 14 ★ | Dates, both | Monospaced dates ("Sun Nov 22 · all day") and "No dates posted here yet" read like a terminal, not like the flyers. | Dates in the house rounded face with tabular figures; drop the second web font. |
| 15 ★ | Shop card | Hours print as raw OpenStreetMap syntax: "Mo-Th 10:00-19:00; Fr 10:00-20:00;…". | Read the common forms into "Open today 10am to 7pm"; the full string stays in the tooltip. |
| 16 ★ | Show popover, both | Fourteen switches in one unlabelled column. | Three labelled groups (On the map, Kinds, Drinks) and a Reset. |
| 17 ★ | About | Seven equal paragraphs, and the sources line is stale ("Instagram and TikTok are not scraped, so some brands show a pin with no dates"). | Four short lines with today's sources, credits folded under. |
| 18 ★ | Hawaii button, both | It shows in Brooklyn, Atlanta and Billings, where it means nothing. | Show it only over the whole mainland, or as "Mainland" when in Hawaii. |
| 19 ★ | Pins, every zoom | The pink dot sits on every upcoming pin, so it says nothing. | The dot marks pop-ups on today only. |
| 20 ★ | Dates far out | "Wed Mar 3" is 2027 but shows no year. | Add the year when it is not this year. |
| 21 ★ | Kind line | "class", "tea brand" are lowercase under the name while "Shop" is capitalised. | Sentence case for every kind word. |
| 22 ★ | Place box, desktop | "Los Angeles, (" is cut off at 140 px. | Widen the box to fit a city and state. |
| 23 ★ | You-are-here, metro | Chasen stands on top of the city's dashed ring and hides the city label. | Draw the you-are-here marker under the pins. |
| 24 ★ | Attribution, phone | The attribution bar opens expanded across the whole bottom of a 390 screen. | Start it collapsed to the (i) button on phones. |
| 25 ★ | Load failure | "Could not load pop-ups. Try again in a moment." has no way to try again. | Add a Try again button. |
| 26 ★ | Flyers vs site | The flyers' signature is azuki ink outlines and chunky pills with a hard offset shadow; the site is all pale 1 px lines, so the two do not feel like one brand. | Give the primary actions and the active chip the flyers' ink outline and hard shadow, nothing else. |
| 27 ★ | Dark theme | The dashed approximate ring is dark green on a dark map and nearly disappears. | A lighter ring and a cream badge in dark. |
| 28 | Data showing through, both | Handles as names ("cube.tea.studio.o", venue "@olastudionyc"), "momokomart" and "Momokomart" as two rows, a TikTok snippet as a description. | Belongs to the extractor in ingest/, not the site; flagged for the next ingest rung. |
| 29 | Static city and brand pages | They look like a plainer, different product (no photos, brown headings, no Mattie) and bake "Today, Sunday, Nov 22" into HTML that is wrong after midnight. | Template change in tools/gen-pages.js: weekday dates without "Today", the photo and drawn card per pop-up. Not tonight (generated pages are out of scope). |
| 30 | List thumbnails, no photo | The drawn thumbnail leads with a capital letter, which reads as an avatar fallback. | Drop the initial and let Mattie and the palette carry it. |
| 31 | Header, desktop | Chasen floats loose beside the wordmark and the middle of the bar is empty. | Lock Chasen into the wordmark or give the bar the next weekend's count. |

## What is built from the rung 32 backlog

- **Your region first on phones** (finding 1). No saved zip and no deep link: the phone opens on the pop-up with the most others within 60 miles, framed on the ones within 20 miles, at zoom 9 to 11. A first visit gets one dismissable line over the date bar: "Starting where it is busiest: New York. Enter your zip for yours." Desktop keeps the national view, which reads fine at 1440.
- **Clusters open outward.** When zooming in splits a cluster, each marker that replaces it starts at the cluster's screen spot and travels to its own (380 ms, transform and opacity). Measured: 28 markers bloomed on one zoom-in over Los Angeles, none in calm mode.
- **Share on the card** (events and brands; shops have no deep link). The share sheet where the browser has one; when it is refused for any reason other than the visitor closing it, the link is copied ("Copied", announced politely), and when the clipboard is closed too, the link appears selected under the button. Links use the existing ?event= and ?brand= deep links; the deep-link block was not touched.
- **Date chips at the bottom on phones** (finding 8): Today, Sat 28, Sun 29, Weekend, Week, Any date, Recent, Pick a day, in a frosted bar in thumb reach; it slides away while a card is open and is hidden from focus then. Near me is an icon on phones so the place box has room.
- **The header Mattie watches the selected pin** while its card is open, following it as the map moves; the pointer takes over again when the card closes.
- **Weekend tour.** A "Weekend tour 3" button on the map when two or more placed pop-ups fall on the coming weekend near you (within 60 miles of your place, else in view). One step at a time with Back, Next and an end button, each step the usual glide and card; on a Sunday night it tours the next Saturday and Sunday.

Also done while verifying: zips land with their town ("Billings, MT 59101"), and a long one-word name on a drawn card shrinks instead of splitting mid-word.

## Not done, and why

- 28 (data showing through) belongs to the extractor; patching names in the browser would hide the problem from the people who fix it.
- 29 (static pages) is a template and regeneration job in tools/gen-pages.js, outside tonight's scope.
- 30 and 31 are small and cosmetic; they lose to everything above.
- Clusters opening outward are not reversed on zoom-out (children flying back into the cluster): it needs the old markers kept alive through the zoom, which costs frames on a mid phone for little gain.
