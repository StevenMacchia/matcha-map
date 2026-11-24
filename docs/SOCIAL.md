# Daily Instagram posts (@matchamap.app)

Steven, 2026-11-23: two to three posts and two to three stories every day, repeatable, tagging the brands. This is the machine that makes them. It never posts on its own.

## What runs every day

`npm run social` (`tools/social/outbox.js`) plans tomorrow's posts from the data and draws them. Run with `--date YYYY-MM-DD` for another day; `--force` redraws a day whose plan has not changed. The daily GitHub job (`.github/workflows/daily.yml`) runs it after the data refresh and commits the result with the other generated files. The Windows task (`npm run daily`, `ingest/daily.js`) does not run it yet; until a `social` step is added there, run `npm run social` by hand after the daily run.

1. **Plan** (`tools/social/plan.js`). For the posting day it picks, in this order:
   - the day's pop-ups in the city with the most of them ("Today in Brooklyn");
   - on Thursday and Friday, "This weekend in <City>" for the city with the most pop-ups that weekend;
   - a new shop: one first read in the last 7 days (one we can tag first), else the one with the most matcha drinks that has never been featured;
   - a series reminder: the next weekly pop-up within a week ("Every Tuesday");
   - then other cities' pop-ups that day, as extra stories;
   - the Triangle's week (Steven, 2026-11-23: "1-2 a week from NC triangle area too"): when the last six days had no feed post from Raleigh, Durham, Chapel Hill, Cary, Apex or their neighbours (`REGIONS` in plan.js), the second feed post of the day is one of theirs, and a story slot too when the week had no story: today's pop-ups there, else the coming weekend there, else a shop there never featured (Little Foot, Heirloom, the "matcha on the menu" cafes once those rows land), else the next pop-up there within two weeks ("Coming up in Raleigh"), else a weekly one. The history entry records the region's feed and story counts.

   The first three become feed posts (10:00, 13:00, 17:00 Eastern). Stories are grouped by place (Steven, 2026-11-24: "stories should be categorized based on locations"): every story candidate is filed under its city, or under its state when the city has only one story, or under its region (the Triangle); the biggest groups go first, three at most. Each group opens with a title story ("Today in Brooklyn", "New in the Triangle", "This weekend in California") and then up to two of its stories; a city with a single story gets one more from a shop there that pours matcha, if there is one, and nothing is made up to fill a group. A group's stories go out together: 08:00 to 09:00, 11:30 to 12:30, 15:30 to 16:30. `INDEX.md` ends with a "Stories by place" list in posting order. Only pop-ups marked matcha and not "unsure" are used. No brand appears again within 7 days (`tools/brand/outbox/history.json`). A re-run of the same date gives the same plan.
   - **What they pour.** A shop story or feed post, and a single pop-up story or feed post, carries a block of up to five drinks (three in a feed post): one row per visibly different drawing, the drink's cartoon from the repo's drink illustration engine (`tools/illustrate/drink.js`, docs/ART.md: a name in `data/drinks.json` is drawn from its parts, any other menu name is parsed from its words) beside the name as the shop's own menu gives it, and "+ N more drinks" when there are more. A name whose words parse to nothing gets the engine's plain matcha drawing (no hand-made icons; `plainReport` in `tools/social/drinks.js` lists them so the parser can be taught: on 2026-11-24, 37 of 6,457 drink lines, 28 distinct names). The rows come from the shop's `menu_matcha` (a pop-up uses its own `menu` lines first, then the `menu_matcha` of the brand's own shop row). Without drinks the card is the old one. `data/drink-types.json` holds only the clean-up rules: which menu lines are not drinks (merch, powders, page furniture), price tails, the longest name.
2. **Draw** (`tools/social/render.js`, templates in `tools/social/templates/`). Feed 1080x1350, story 1080x1920, cream ground, the drawn card from `site/drawn.js` (or the shop drawing, or the brand-initial mochi in a list), Mattie, the brand, the time in words, the venue and city, "matchamap.app". Every text is at least 36px on the 1080 canvas so it reads on a phone; each render measures that, plus anything cut short, off the canvas or overlapping, and the run prints a line for any problem.
3. **Outbox** in `tools/brand/outbox/<date>/`:
   - `INDEX.md`: one line per post: time, type, file, caption, tags and where to paste it;
   - one folder per post (`02-feed-today-brooklyn/`): `image.png`, `caption.txt`, `tags.json` (user tags, mentions, hashtags, location, image URL);
   - `plan.json` (what `publish.js` reads) and, once anything is published, `published.json`.

   Each image is also copied to `site/social/<date>/` so it has a public address (`https://matchamap.app/social/<date>/<name>.png`) after the next deploy; folders older than 14 days are removed.

## How Steven posts today (by hand)

1. Open `tools/brand/outbox/<date>/INDEX.md` and pick the posts to use. Skip any you do not like; nothing else happens to them.
2. Check the brand's own post still shows that date and place.
3. Meta Business Suite, Planner:
   - **Feed post**: Create post, upload `image.png`, paste `caption.txt`, Add location (the city in the index), Tag people (the handles in the index), schedule for the listed time.
   - **Story**: Create story, upload `image.png`, add a link sticker to the city page and a mention sticker for each handle listed, schedule.

## How publishing turns on later

`npm run social:publish -- --date <date> --pick 02,04` (`tools/social/publish.js`) posts through the Instagram Content Publishing API: for a feed post `POST /{ig-user-id}/media` with `image_url`, `caption` and `user_tags`, then `POST /{ig-user-id}/media_publish`; for a story the same with `media_type=STORIES`. It logs each post to `published.json` and never posts an item twice.

- Until `SOCIAL_PUBLISH=1` it is a dry run: it prints every request it would make (token hidden) and makes none. `--dry-run` forces that at any time.
- `--live` (or `SOCIAL_PUBLISH=1`) refuses unless `SOCIAL_PUBLISH=1`, `IG_ACCESS_TOKEN` and `IG_USER_ID` are all set, and refuses without `--pick`.
- `IG_ACCESS_TOKEN` and `IG_USER_ID` live in `.env` or the environment, never in git. `IG_USER_ID` is the Instagram professional account id (the same value as `INSTAGRAM_BUSINESS_ID`); the token must carry `instagram_content_publish`.
- Turn it on only after the Meta app review grants `instagram_content_publish` (`docs/META-APP-REVIEW.md`), and only for posts Steven picked. The image URL must answer before a publish: deploy first.
- The API cannot add a location; a post that needs one is still made by hand.

## Rules

- **Steven's pick.** Nothing is posted to the account without it. The outbox is a proposal; the API step takes only the items named with `--pick`.
- **No reposts without permission.** No brand's own photo is used: every image is drawn art in the house style. That changes only when the host flow has a permission flag for photos (there is none yet).
- **Tags only from our data.** A handle is tagged or written only when our data has it: the event's own handle or Instagram link, `data/sources.json`, `site/data/brands.json`, or the shop row for the venue. Nothing is guessed; a brand without a handle is credited by name.
- **Words.** Plain, specific, no hype. The words kawaii, uwu, cute, cutesy and girly are never used (the plan refuses a caption that has one, and leaves out a brand whose name does). Captions stay under Instagram's 2,200 characters, with 5 to 8 hashtags from `tools/social/hashtags.json`.

## Tests

`node --test test/social-daily.test.js`: the plan (no brand twice in 7 days over three weeks, handles only from data, banned words absent, caption length, same date gives the same plan, weekend roundup on Thursday and Friday), the drawings (PNG sizes, the 36px floor, nothing cut or overlapping) and publish (a dry run makes no network call, a live run refuses without the flag, token and pick, a fake Graph API sees only the pick with its user tags).

`node --test test/social-drinks.test.js`: non-drinks and prices are dropped, each row is drawn by the engine, unreadable names get the plain matcha drawing, no printed name is made up, and under 2% of real drink lines fall to plain. `node --test test/social-gate.test.js` is the overlap and overflow gate: it renders every template (shop, pop-up, list, location title; feed and story) with the longest real brands, venues, cities, shops and drink lists in the data and fails on text under 36px, text off the canvas or out of its own box, a cut-short line, a column past its space, or any two boxes (rows, pills, the pour block, Mattie, the foot) that intersect; a second test proves the gate catches both faults.
