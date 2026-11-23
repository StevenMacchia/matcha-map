# Matcha Map design audit, 2026-11-23

Shots: `qa/design/2026-11-23/<screen>-<width>-<theme>.png` (before, 28 files: home, card, brand, promote, claim, share, add at 390 and 1440, light and dark), `after/` (re-shot after the fixes). Script: `tools/design-shots.js`. Brand page is `/brand/4bidden4ruit/`, event is `ea06c1e9874b`.
Kind: **polish** = fixed here; **mock-only** = changes the look of the whole screen.

| # | Screen, size, theme | What is wrong | Fix | Kind | Status |
|---|---|---|---|---|---|
| 1 | Card, 390 and 1440, both | The "Keep Matcha Map on your home screen" bar sits on top of the open card's photo and text. | Hide the bar while a card is open. | polish | fixed (pwa.css) |
| 2 | Card, 1440, both | The quote's fourth line peeks out under the three-line clamp, so text looks cut in half. | Pad with a transparent border (outside the clip), move the quote mark. | polish | fixed (cards.css) |
| 3 | Brand, 390, both | The "See ... on the map" button has a huge gap between its lines (inherits the 2.1 line height of the links row). | Line height 1.3, centred text. | polish | fixed (pages.css) |
| 4 | Promote, claim, add, 1440, both | The form column (528 px, centred) does not line up with the header (760 px); the page looks off-centre. | Same 760 column, content left-aligned to the header. | polish | fixed (add.css, promote.css) |
| 5 | Claim, add, promote, dark | Placeholders are hard to read and field borders are a loud bright green. | Placeholder in the muted colour; softer border, full green only on focus. | polish | fixed (add.css) |
| 6 | Promote, add, claim, 390 | The title wraps to two lines next to a 72 px Mattie, leaving the lead line stranded. | Smaller mascot and fluid title size on phones. | polish | fixed (add.css) |
| 7 | Promote, 390 and 1440 | The share link breaks mid-parameter (`?event` / `=ea06...`) and is large. | Break anywhere, 14.5 px, taller tap area. | polish | fixed (promote.css) |
| 8 | Home, 390, light | The sheet grip and the card grip are almost invisible on the cream panel (the colour is the border colour). | Use the muted ink at 40 percent. | polish | fixed (shell.css, style.css) |
| 9 | Brand and city pages, 390 | The breadcrumb link is a 14 px tap target. | 44 px tall hit area without moving the text. | polish | fixed (pages.css) |
| 10 | Page buttons and form buttons | No press feedback, unlike the app's buttons. | 0.96 squeeze on press, same as the app. | polish | fixed (pages.css, add.css) |
| 11 | Card, 1440, both | The popup is taller than the space under its pin: the Map, Calendar and Share labels are clipped at the bottom of the window. | Open the popup toward the free side, or cap its height to what fits. Needs app.js or cards.js. | polish (JS) | left, off limits this rung |
| 12 | Home, 1440, both | Cluster counts sit on top of the pin faces and map place names ("37" over "Seattle"); pins in a city overlap into a pile. | Count in a cream chip beside the stack; spread overlapping pins. Art plus app.js. | polish (art) | left |
| 13 | Home, 390, light | Three floating things crowd the bottom: Weekend tour pill, the "Starting where it is busiest" note, the sheet peek. | One note at a time; the pill moves into the filter row. | look-changing | left |
| 14 | Claim, add, 390 and 1440 | Brand and email fields have no placeholder while the others do. | Add placeholders in site/claim/index.html. | polish (markup) | left, outside the allowed files |
| 15 | Share and card, both | The "UNSURE" badge says nothing to a visitor. | Say "Date not confirmed". | polish (copy, data) | left |
| 16 | Card, dark | The menu chips keep a hard dark-brown underline that reads muddy on the dark panel. | A lighter edge in dark. | polish | left |
| 17 | **Card, 390 and 1440, both** | The card is a long scroll of seven stacked blocks (photo, brand, quote, menu, hours/price, place, actions). The one thing a visitor wants, when and where, is under the photo and quote, and the action row is last. | New card shape: facts first, actions pinned. | **look-changing, mocked** | see MOCKS.md |
| 18 | Home, 1440 | The list rows carry up to four text styles (time, name, dot, tag, chips); the whole row is a lot for scanning. | Two-line rows. | look-changing | left |
| 19 | Sub-pages | Brand, city, promote, claim have no map or colour at the top; they look plain next to the app. | A Mattie header band. | look-changing | left |
