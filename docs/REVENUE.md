# Revenue options (2026-11-23)

Goal: a first revenue path that does not cheapen the map. No ad scripts, no tracking beyond one anonymous page-view beacon, prices shown plainly.

## The numbers we can know today

From `site/data` on 2026-11-23:

- Events in the data: 717 (373 upcoming, 344 past).
- Cities with an upcoming pop-up: 105. The deepest are Boston 24, Seattle 23, New York 20, Austin 16, Los Angeles 15, Houston 13.
- Brands with a page: 371 (184 of them have something upcoming).
- Hosts who have claimed: not knowable from the repo. Claims sit in KV (`claim:<id>`), read through `GET /api/queue?kinds=claim`. Assume zero until Steven looks.
- RSVPs: zero. The feature went live today.
- Traffic: unknown. No analytics is installed. Installing the Cloudflare beacon in `docs/ANALYTICS.md` would give page views, referrers and top pages per day, with no cookies. It does not give uniques, clicks on outbound links or any per-host count, so a host report would need a small count of its own later.

Every revenue figure below uses an assumed 5,000 visits a month, with a 1,000 to 20,000 range. Treat it as a placeholder for the real count.

## Options

**1. Featured pop-up slots.** The free weekly slot stays (one pop-up per city per week, picked by hand). A paid option adds a second slot in a city or a longer run. Price: $25 for one week, $60 for four. Revenue at today's traffic: realistic conversion is a few hosts a month out of 184 active brands, so $0 to $150 a month, about $50 expected. Trust cost: low if the paid card is labeled "Featured" and the free pick stays editorial. It needs a request form, a moderator, and a payment link. Built in this rung up to the payment step.

**2. City sponsor line.** "Austin matcha, supported by <name>" on one city page. Price: $50 to $150 a month per city. Revenue: $0 to $300, but needs a buyer who trusts a small audience. Trust cost: low to medium; a line, never a banner, and no sponsor of a rival's pop-up. Needs a city with steady traffic, so wait for the beacon.

**3. Verified host badge and analytics.** A brand page badge plus views, RSVPs and direction taps. Price: $9 a month. Revenue: $0 to $100. Trust cost: medium, because a missing badge can read as "unverified" for everyone who did not pay. Needs the per-host counts we do not have. Not yet.

**4. Affiliate links on drinks and gear.** Matcha, whisks, bowls, only where we would say it unpaid. Revenue: $0 to $50 at this traffic. Trust cost: medium, since a map that sells things reads as a store. Needs an affiliate account and clear labeling. Low value now.

**5. Tip jar.** One "Buy Mattie a matcha" link. Revenue: $0 to $40. Trust cost: very low. Needs a Ko-fi or Stripe link only. Cheap, but it will not cover costs.

**6. Newsletter sponsorship.** One line in the weekly mail. Price: $50 to $200 an issue. Revenue: $0 until the mail exists and has a list. The alerts form collects emails, but double opt-in is not built and nothing sends. Not yet.

**7. Data or API tier for brands and press.** A city report or feed. Price: $100 to $500. Revenue: $0 to $200, lumpy. Trust cost: low if the data is already public. Needs a buyer, not code. A sales task, not a build.

## Ranking (revenue per month against trust cost)

1. Featured slots: about $50 expected, low trust cost, the form is cheap to build.
2. Tip jar: under $40, almost no trust cost, ten minutes of work.
3. City sponsor line: up to $300 but needs a buyer and traffic data.
4. Data or API tier: lumpy, needs sales.
5. Verified badge, affiliate links, newsletter: wait for analytics, or the mail, or skip.

Featured agrees with the expected answer, but not because the money is big: at 5,000 visits it is small everywhere. It wins because hosts already ask to be listed, the cost to build is one form, and the main output is a list of real host emails. The honest read is that revenue stays near zero until traffic is measured. Install the beacon first.

## Rules

- No ad scripts. The pages' Content-Security-Policy blocks them anyway.
- Paid cards are labeled "Featured". The free weekly pick is never hidden or demoted.
- No tracking beyond the beacon. Prices are plain numbers on the page.

## How Featured runs

1. **Request.** A host fills in `/featured/` (map link or pop-up id, brand, email, the day the week starts, free or paid). `POST /api/featured` stores `featured:<id>` for 90 days with `paid: false`; ten requests a day per IP.
2. **Approve.** Open `/add/review.html`, enter the token, and use the Featured requests panel. Approve moves the item to `featured-ok:<id>` with `approved_at`, `week`, `paid` and `until` (the end of the chosen week, UTC). Reject moves it to `featured-no:<id>` for 30 days. Both go through `POST /api/approve` with `kind: "featured"`. Nothing is shown to visitors before this step.
3. **Mark paid.** For a paid request, send the host the payment link by hand. When the Stripe payment arrives, press Mark paid on the approved item (`edit` with `patch: {paid: true}`, which stamps `paid_at`). Free requests need nothing.
4. **Show.** `GET /api/featured` returns `{picks: [{event, brand, until, paid}]}` for approved items whose `until` is still in the future (50 at most, no emails). `site/featured.js` fetches it once and adds a one-word "Featured" pill to those pop-ups in the list and on the opened card. Paid and free look the same. The pill disappears by itself when `until` passes; a worker keeps a 60 second copy, so a new approval can take about a minute to show.

Still manual: the Stripe step. There is no checkout and no webhook yet. The Pay button on `/featured/` stays disabled, and "Mark paid" is the stand-in for the webhook. When the webhook exists it should call the same `edit` path.
