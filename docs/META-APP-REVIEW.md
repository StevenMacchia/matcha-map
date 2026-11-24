# Meta App Review checklist: "Matcha Map"

Needed to move the app out of development mode so Instagram data from accounts without a role on the app can be read. Setup steps are in `docs/INSTAGRAM-SETUP.md`.

## Permissions and features the app actually uses

From INSTAGRAM-SETUP.md: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `instagram_manage_insights` (Meta's Business Discovery page lists it as required), plus the **Instagram Public Content Access** feature for hashtag search. Request only these. If review says one is unused, drop it and keep `instagram_basic` and Business Discovery.

To be added: **`instagram_content_publish`**, for posting the daily outbox to @matchamap.app (`docs/SOCIAL.md`, `tools/social/publish.js`). It needs `instagram_basic` and `pages_read_engagement`, which are already on the list.

## Before you apply

- [ ] App icon (1024x1024) and the display name "Matcha Map".
- [ ] **Privacy policy URL:** `https://matchamap.app/privacy/` (replace `STEVEN_EMAIL_HERE` on that page and on `/data-deletion/` first).
- [ ] **Data deletion instructions URL:** `https://matchamap.app/data-deletion/`.
- [ ] App category (Utilities or Lifestyle) and a contact email on the app.
- [ ] Business verification, if Meta asks for it.
- [ ] A **test user** or reviewer access: add the reviewer under Roles, and make sure the connected Instagram account is a professional account linked to a Page. Give the reviewer a short note on where to click.
- [ ] A public, working site the reviewer can open without logging in.

## Screencast (1 to 2 minutes per permission, English captions, no cuts)

1. Show the live map and a pop-up card with its link back to the original Instagram post.
2. Show where the data is read: run `npm run watch` in a terminal (token hidden) and show a hashtag or Business Discovery line in the log, then the resulting card on the map.
3. Show the privacy page and the data deletion page.
4. Say clearly: the app reads only public posts of professional accounts and public hashtags, shows a link back, and stores no personal profile data. (Posting is only the separate `instagram_content_publish` screencast below, to our own account.)

### Screencast for `instagram_content_publish` (one take, English captions)

Record with a reviewer-visible test day, for example `2026-11-24`, after `npm run social -- --date 2026-11-24` and a deploy so the images are live under `https://matchamap.app/social/2026-11-24/`.

1. Show the outbox: open `tools/brand/outbox/2026-11-24/INDEX.md` and one post folder (image, caption, tags). Say: the app drafts posts about other businesses' public pop-ups, in our own drawn art, and a person picks which to publish.
2. Show the pick: run `npm run social:publish -- --date 2026-11-24 --pick 02 --dry-run` and point at the requests it would make (`/media` with `image_url`, `caption` and `user_tags`, then `/media_publish`).
3. **Feed post with user tags**: with `SOCIAL_PUBLISH=1` and the token in `.env` (keep the terminal scrolled so the token is never on screen), run `npm run social:publish -- --date 2026-11-24 --pick 02 --live`. Open the permalink it prints in a browser: the post on @matchamap.app, the caption crediting the brand, and the tagged account shown on the image.
4. **Story**: run the same with the story's number (`--pick 01 --live`) and open @matchamap.app's story on a phone or in the browser.
5. Show `tools/brand/outbox/2026-11-24/published.json` (the log of what was posted) and run the feed command again to show it skips an item already published.
6. Say clearly: the app posts only to our own account, only posts a person picked, tags only accounts named in the public post it credits, and uses no one else's photos.

Use-case text for `instagram_content_publish`:

> Matcha Map publishes to its own Instagram professional account (@matchamap.app) a few posts and stories a day that list public matcha pop-ups from our map: the brand, day, time and place, drawn in our own illustration style, with a link to the city page on matchamap.app. Each post is drafted by our tool and published only after the account owner picks it. Posts credit and tag the business that announced the pop-up, using the public handle from its own post. We never post on behalf of other accounts and never reuse their photos.

## Use-case text (paste into each permission)

> Matcha Map is a free, non-commercial map of matcha pop-ups. It uses the Instagram Graph API to find public posts by business and creator accounts that announce a pop-up: the caption, date, location text, post link and image. We read public posts through Business Discovery and public hashtag search, extract the event date and place, and show the pop-up on a map with a link back to the original post. We do not post, message, or access private data, we do not store personal profile information beyond the public handle, and we do not sell data. Removal is on request (data deletion page).

## After approval

- [ ] Switch the app to **Live** mode and generate a long-lived token (60 days; note the renewal date).
- [ ] Put `INSTAGRAM_TOKEN` and `INSTAGRAM_BUSINESS_ID` in GitHub secrets (see `docs/INTAKE.md`).
- [ ] Re-check the platform rate limits in INSTAGRAM-SETUP.md.
- [ ] Once `instagram_content_publish` is granted: put `IG_ACCESS_TOKEN` (a token carrying that permission) and `IG_USER_ID` (the Instagram account id, same as `INSTAGRAM_BUSINESS_ID`) in `.env`, set `SOCIAL_PUBLISH=1` there, and publish only Steven's picks (`docs/SOCIAL.md`).
