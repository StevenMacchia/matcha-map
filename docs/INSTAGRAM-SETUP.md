# Instagram setup (one time)

The map reads Instagram only through Meta's official Graph API. It never logs in as you, never uses cookies, and never scrapes. Until you finish these steps the Instagram parts stay off and the map still works from websites, Luma, MATO and pasted posts.

Plan about 45 minutes. Meta changes its menus often, so names below may differ a little.

## What you need

- A Facebook account.
- A Facebook Page you manage (any Page; it can be empty).
- An Instagram professional account (business or creator) linked to that Page. This is the account the map asks questions "as". It does not need to post anything.

## Steps

1. Go to developers.facebook.com and log in. Click **Get Started** and finish the developer registration.
2. Click **Create App**. Pick the **Business** type (or "Other", then Business). Name it "Matcha Map". Add your email.
3. If your Instagram account is personal, open Instagram, then Settings, then **Account type and tools**, then **Switch to professional account**. Pick Business or Creator.
4. Link Instagram to your Facebook Page. In Instagram: Settings, **Account Center** (or "Linked accounts"), connect the Page. Or in Facebook Page settings: **Linked accounts**, then Instagram.
5. In your app dashboard, click **Add Product** and add **Instagram** (the Instagram API with Facebook Login, "Instagram Graph API").
6. Open **Tools**, then **Graph API Explorer**. In the right panel choose your app as "Meta App" and "User Token" as the token type.
7. Under Permissions add these, then click **Generate Access Token** and approve the dialog (pick your Page and Instagram account when asked):
   - `instagram_basic`
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_manage_insights` (Meta's Business Discovery page lists it as required, so add it.)
   Hashtag search also needs the **Instagram Public Content Access** feature. In App Review you can request it; in development mode with your own accounts it works for people with a role on the app.
8. Copy the short-lived token. It lasts about an hour.
9. Exchange it for a long-lived token (60 days). Open this address in a browser, with your values filled in:
   `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN`
   APP_ID and APP_SECRET are under **App settings, Basic**. The reply holds `access_token`. That is your long-lived token. Keep the app secret private.
10. Find your Page id. In Graph API Explorer, with the long-lived token, run `me/accounts`. Copy the `id` of your Page.
11. Find your Instagram id. Run `PAGE_ID?fields=instagram_business_account`. Copy the number inside `instagram_business_account`, the `id`.
12. Copy `.env.example` to `.env` in the repo and fill in:
    ```
    INSTAGRAM_TOKEN=the long-lived token
    INSTAGRAM_BUSINESS_ID=the instagram_business_account id
    ```
    `.env` is git-ignored. Never commit it. On GitHub, add the same two values as repository secrets of the same names (Settings, Secrets and variables, Actions).
13. Test it: `npm run watch -- --dry --handle rockysmatcha`. The "Instagram Graph: off" line should be gone.

## Refreshing the token

A long-lived token lasts 60 days and must be replaced before it expires. Generate a fresh short-lived token in the Explorer (steps 6 to 8) and repeat step 9. Put a reminder in your calendar for day 50. If it expires, redo steps 6 to 9. The map logs a Graph error and keeps running without Instagram.

## Limits, in plain words

- Business Discovery and hashtag search count against Meta's **platform rate limit**: about 200 calls per hour times the number of app users, counted per rolling hour (errors 4 and 17). The map keeps its own stricter counter of 200 calls per hour in `.cache/ig-rate.json` and stops early with a log line. One account check is one call. A watch run spends at most 180 calls (200 less 20 kept free, and less whatever the rolling hour already used): the hashtag harvest first (at most 90), then due accounts by priority (accounts with a hit, then watching, then candidates, oldest check first). Accounts past the budget stay due and are not marked checked; a Meta rate limit ends the Graph reads with one line, "N accounts wait for the next hour".
- Hashtag search allows **30 unique hashtags per 7 days** per Instagram account. `data/hashtags.json` keeps an `active` list in priority order (the harvest stops where the weekly budget is full), a `rotation` (next week swaps new city tags in for the lowest-yield ones, by `stats`), cached hashtag `ids` (so a tag costs 1 call per page, not 2) and the yield per tag per run.
- Hashtag `recent_media` only returns posts from the **last 24 hours**, up to 50 per page. The API does not return the poster's username on hashtag results. The harvest (`ingest/lib/hashtags.js`, the first step of `npm run watch`) turns each post into an event only when the caption gives a brand (an @mention, a brand-looking hashtag, or a name before "pop-up"), a date today or later and a US place. The brand's handle joins the watch list, so Business Discovery reads it the next hour. A tag is re-read every 6 hours: up to 3 pages of `recent_media`, and `top_media` once a day.
- Pictures: Meta's `media_url` and `thumbnail_url` expire after some days and `scontent*.cdninstagram.com` is closed to our downloader by robots.txt, so the url is stored as `image_url`, refreshed on every read, and the site shows it directly (and the drawn card when it fails).
- Account facts: each Business Discovery read also stores the account's name, website, profile picture and follower count on the watch list. A handle-shaped brand gets an `auto_name` in `data/sources.json` (never an overwritten `brand`). An account Graph answers with an error (personal, deleted, renamed) is skipped for 7 days; a candidate with no matcha in its last 25 posts is dropped.
- Business Discovery reads only **public business or creator** accounts. Age-gated accounts return nothing.

## What the API cannot do

- Read private accounts.
- Read personal (non-professional) accounts.
- Read stories.
- Read other people's comments or followers. The map stores none of that anyway.
- Post, like, follow or message. The map is read-only.

## TikTok

The map does not scrape TikTok either.

- The **Display API** needs an approved app and shows only the videos of the account that authorizes it. It cannot read other brands.
- The **Research API** is for approved researchers.
- So TikTok here is limited to search snippets and TikTok's open oEmbed. `ingest/lib/sites/social-search.js` asks the Tavily search API (`TAVILY_API_KEY`, free tier about 1,000 credits a month; local caps in `data/tavily-budget.json`: 120 per run, 900 per month) for matcha pop-up posts on tiktok.com and instagram.com, then sends each TikTok video URL to `https://www.tiktok.com/oembed` (1 request per second) for the caption, creator and thumbnail. No tiktok.com or instagram.com page is ever opened.
- Every TikTok creator seen in a matcha pop-up result joins the watch list as a candidate (`platform: tiktok`, `found_via: search`, `found_from: tavily`). When one is due on the watch cadence, `npm run watch` re-checks it with a Tavily query `"<handle>" matcha` limited to tiktok.com (1 credit), never by touching tiktok.com.

## Brave Search key (optional)

Discovery can also search the open web for `site:instagram.com "matcha pop up" <city>`. Get a free key at api.search.brave.com, put it in `.env` as `BRAVE_API_KEY`. The free plan allows 1 request per second. The map runs 10 cities per run, rotating, and waits between calls.
