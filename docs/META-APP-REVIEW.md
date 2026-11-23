# Meta App Review checklist: "Matcha Map"

Needed to move the app out of development mode so Instagram data from accounts without a role on the app can be read. Setup steps are in `docs/INSTAGRAM-SETUP.md`.

## Permissions and features the app actually uses

From INSTAGRAM-SETUP.md: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `instagram_manage_insights` (Meta's Business Discovery page lists it as required), plus the **Instagram Public Content Access** feature for hashtag search. Request only these. If review says one is unused, drop it and keep `instagram_basic` and Business Discovery.

## Before you apply

- [ ] App icon (1024x1024) and the display name "Matcha Map".
- [ ] **Privacy policy URL:** `https://matchamap.app/privacy/` (replace `STEVEN_EMAIL_HERE` on that page and on `/data-deletion/` first; use the final domain once it exists).
- [ ] **Data deletion instructions URL:** `https://matchamap.app/data-deletion/`.
- [ ] App category (Utilities or Lifestyle) and a contact email on the app.
- [ ] Business verification, if Meta asks for it.
- [ ] A **test user** or reviewer access: add the reviewer under Roles, and make sure the connected Instagram account is a professional account linked to a Page. Give the reviewer a short note on where to click.
- [ ] A public, working site the reviewer can open without logging in.

## Screencast (1 to 2 minutes per permission, English captions, no cuts)

1. Show the live map and a pop-up card with its link back to the original Instagram post.
2. Show where the data is read: run `npm run watch` in a terminal (token hidden) and show a hashtag or Business Discovery line in the log, then the resulting card on the map.
3. Show the privacy page and the data deletion page.
4. Say clearly: the app reads only public posts of professional accounts and public hashtags, shows a link back, stores no personal profile data, and never posts.

## Use-case text (paste into each permission)

> Matcha Map is a free, non-commercial map of matcha pop-ups. It uses the Instagram Graph API to find public posts by business and creator accounts that announce a pop-up: the caption, date, location text, post link and image. We read public posts through Business Discovery and public hashtag search, extract the event date and place, and show the pop-up on a map with a link back to the original post. We do not post, message, or access private data, we do not store personal profile information beyond the public handle, and we do not sell data. Removal is on request (data deletion page).

## After approval

- [ ] Switch the app to **Live** mode and generate a long-lived token (60 days; note the renewal date).
- [ ] Put `INSTAGRAM_TOKEN` and `INSTAGRAM_BUSINESS_ID` in GitHub secrets (see `docs/INTAKE.md`).
- [ ] Re-check the platform rate limits in INSTAGRAM-SETUP.md.
