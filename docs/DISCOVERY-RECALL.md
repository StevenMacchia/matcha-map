# Discovery recall (Population lane, 2026-11-23)

Steven's question: how many independent matcha pop-ups does the map miss, how were they announced, and what do we build to find them? This is the first measurement. Everything here comes from `data/recall/*.json` (three files, 30 brands, 44 dated pop-ups); the sample is hand-built from public pages, not from our own data, and it is biased in ways stated below. Read the number as a ceiling.

## 1. Case study: Saikō Matcha House, Raleigh (Nov 27 and 28, 2026, The Village District)

Steven named the brand; our pipeline had never heard of it. Where its pop-ups were announced, and what we can read without a login:

| Place | Carried | Readable by us | Note |
|---|---|---|---|
| Its own website, saikomatchahouse.com ("Upcoming Events" block) | Nov 27 10-2 at MODE, Nov 28 11-3 at Maeve | yes, plain text | The only public page with the two dates; it produced the find. The domain was found by a name search, not by any crawler. |
| The host's web calendar, shopvillagedistrict.com/events | Earlier autumn: Aug 29-30 and a series "every other weekend Sept 12 to Nov 1" (last item Oct 24) | yes | Not Nov 27 or 28. A host-calendar adapter would have caught the autumn series for free. |
| Saikō's Instagram posts and stories | almost certainly the first announcement | no (login wall); the Graph API cannot read the account ("Invalid user id": not a business or creator account) | The channel that announced first is the one we cannot read. |
| The host shops' Instagram (MODE, Maeve) | probably tagged | no; they are not in our watch list | |
| Instagram hashtags | unknown | the Graph hashtag cap (30 unique tags per rolling 7 days) is full until about Nov 29 | |
| Do919, Eventbrite, Partiful, Luma, local press, Google Business, TikTok | nothing found for these dates | | |

## 2. Recall study

Method. Three workers, two metros each, five independent matcha pop-up brands per metro (the Triangle, Austin, Denver, Seattle, Atlanta, Phoenix), each with a dated pop-up on a public page. Brands were found from the open web (web search, local press, host calendars, ma.to, newsletters), not from our data; only afterwards did each worker check `data/events.json`, `data/sources.json` and `data/watchlist.json`. Instagram and TikTok pages were never fetched, so Instagram evidence is links printed on other pages or search snippets ("partial" readability by rule). Reddit could not be searched.

### Headline

| Measure | Result |
|---|---|
| Brands sampled | 30 in 6 metros |
| Brands with at least one dated pop-up on any public page | 22 of 30 (73%) |
| Brands with no dated page we could find (schedule lives on Instagram) | 8 of 30 (27%): Mazay ka Matcha, Mori Matcha, The Sen (Denver), Notcha Matcha, Stroll, Yumi's, Soundtrack, plus Nakama Matcha Co, whose only pop-up has no exact date |
| Brands already in `data/sources.json` | 20 of 30 (67%); on the watch list 11 of 30 (37%) |
| Dated pop-ups collected | 44 |
| of which already in our data | 13 (30%) |
| of which inside our data's window (events start 2026-10-24) | 18 |
| inside the window and found | 13 of 18 (72%); without amatō's six recurring dates 7 of 12 (58%) |

The 26 pop-ups before 2026-10-24 say nothing about discovery (the events file does not go back that far), so the in-window figure is the fair one, and the 18 pop-ups in it are few. The honest range is 58 to 72 percent for brands that announce on a public page, and unknown (probably low) for the 27 percent that announce only on Instagram.

Per metro (pop-ups found / in our data; in window found / in window):

| Metro | Brands | With a dated pop-up | Pop-ups | In our data | In window (found) |
|---|---|---|---|---|---|
| Triangle | 5 | 4 | 9 | 6 | 6 of 6 (amatō, via ma.to) |
| Austin | 5 | 4 | 4 | 1 | 1 of 1 |
| Seattle | 5 | 5 | 13 | 4 | 4 of 6 (two Oct 31 pop-ups announced in an older Let It Simmer issue were missed) |
| Denver | 5 | 3 | 6 | 0 | 0 of 0 (all six before the window; Nakama's event is stored under the wrong year, 2027-07-13) |
| Atlanta | 5 | 4 | 9 | 1 | 1 of 3 (Ponder Coffee Cart's Nov 21 and 28 missed) |
| Phoenix | 5 | 2 | 3 | 1 | 1 of 2 (Neighbor Matcha Nov 21 missed although we read that host's ma.to venue page: cause not determined) |

In-window misses and what would have caught them: three are local-press or newsletter items (the Oct 29 Let It Simmer issue for Nicho's and Standard Matcha, the AJC coffee roundups for Ponder), one is a ma.to listing we already crawl (a bug to find).

### Per-channel table (pop-ups carried, out of 44; one pop-up can use several channels)

| Channel | Pop-ups carried | Readable without a login | Our pipeline reads it today |
|---|---|---|---|
| Own Instagram post | 24 | partial: only as links on other pages; not testable by us | Graph business_discovery for business accounts on the watch list (about 180 of 1,100); personal-type accounts return "Invalid user id" (345 so marked) |
| Local press or newsletter | 22 | yes | partly: Let It Simmer (Seattle) and ma.to are ingested; older issues are not re-read; no other city has a reader (AJC, Rough Draft, Indy Week, Axios Local, Daily Texan, Denver Gazette were the carriers here) |
| ma.to, Sched and other event aggregators | 13 | yes | ma.to venue and city pages: yes; others no |
| Host-venue Instagram | 9 | partial | no (host accounts are not on the watch list) |
| Host-venue web calendar (Village District, Downtown Raleigh Partnership, RiNo Art District, Bella Cucina product pages) | 8 | yes | no generic reader; one-off sources only |
| Market organizer vendor list | 3 | yes (one partial) | only the vendor pages listed in `ingest/lib/sites/markets.js` |
| Own website | 2 | yes | brand pages with a schedule URL only (`website` adapter); the Saikō-style "Upcoming Events" block needs the brand to be in sources |
| Ticketing page (Eventbrite) | 1 | yes, but no date readable | city search crawlers (Eventbrite, Allevents, Meetup, Luma) |
| TikTok, Reddit, Linktree, Google Business, Partiful, Posh, own Instagram story | 0 observed | n/a | not measured (Reddit could not be searched; the rest simply did not carry a date) |

### What the sample can and cannot say

- By construction almost every sampled pop-up has a public non-Instagram page (43 of 44), so that number measures the sampling, not the world. The meaningful signal is the 8 of 30 brands (27%) for which no public dated page exists at all.
- The sample over-represents brands that ma.to or local press cover (three of the six metros leaned on ma.to or a newsletter we already ingest; Denver's sample is the reverse: no public Denver page carries dates outside Instagram). Real recall for the whole independent population is therefore below the 58 to 72 percent range.
- Sample size is small (22 brands with dates, 44 pop-ups, 18 in the window). Use it as a baseline for the weekly metric, not as a result.
- No Durham or Chapel Hill brand turned up in the open web at all.

## 3. Channels ranked by what carried the announcements and whether we can read them

1. **Instagram (own plus host), 33 of 44 pop-up-channel pairs: the biggest carrier and the one we cannot read.** The Graph business_discovery edge reads only business and creator accounts we already know; hashtag reads are capped at 30 tags a week; Meta App Review is the gate and only Steven can start it. Everything below is the readable remainder.
2. **Local press and newsletters, 22.** Readable and dated. This is the largest readable channel, ahead of host calendars.
3. **Event aggregators (ma.to and similar), 13.** Readable; ma.to alone carried the pop-up for 4 of the Triangle and Austin brands.
4. **Host-venue web calendars, 8.** Readable, structured, and the channel that carried Saikō's autumn series; one adapter covers many brands because the host is the key, not the brand.
5. **Market and district organizer vendor lists, 3.** Readable; small but exact.
6. **Own websites, 2; ticketing pages, 1.** Cheap per brand; ticketed pop-ups on Eventbrite, Partiful and Posh barely appeared among independents.

The expectation that host venues would carry most of the independents is only partly supported: host web calendars carried 8 pop-ups (18%) against 22 for local press (50%); host venues' Instagram posts carried 9 but are not readable.

## 4. Adapter order (from the table, not from opinion)

1. **Local newsletter and roundup reader, with back-issue crawl.** One adapter per recurring source: Let It Simmer (already read; add the Oct 29 style older issues, which caught two misses), AJC and Rough Draft (Atlanta), Indy Week (Triangle), Axios Local, Daily Texan, Denver Gazette. Each issue is a dated list; extraction exists. Biggest readable channel.
2. **Host-venue calendar adapter.** Seed it from the hosts our own events already name (shopping districts, business-improvement districts and arts districts: Village District, Downtown Raleigh Partnership, RiNo Art District; markets; breweries and cafes with a calendar page), read JSON-LD Event data or the calendar's text, and match matcha words. Catches independents by host, not by brand.
3. **ma.to completion.** We read ma.to venue pages for known brands; add every ma.to venue in a US city and fix the Neighbor Matcha miss (why a read venue page missed Nov 21).
4. **Own-site schedule reader for every brand in sources** that has a website (the Saikō "Upcoming Events" shape), and a name-and-city search to find more brand sites.
5. **"Report a pop-up we missed" on every city page** (last mile, specified below).
6. **Instagram, outside our control:** Meta App Review (Steven), follow the host business accounts that are readable, keep personal-type accounts as inbox candidates.

## 5. "Report a pop-up we missed" (spec for the site session)

On every city page and on the list view's empty state, one link: "Know a matcha pop-up we missed?" It opens the existing `/add/` form pre-filled with the city (`/add/?city=raleigh-nc`). Fields: brand name, Instagram or website, date and time, where, link to the post or flyer, optional photo; the existing `POST /api/submit` and review queue already store it (the data owner promotes by hand or the ingest reads approved submissions). Success copy: "Thanks. We read every one, and you'll see it on the map once we have checked it." Data shape unchanged; the site session owns the page and its design. Pair it with a one-line request to brands on the "Get on the map" page (`docs/GET-ON-THE-MAP-COPY.md`).

## 6. Weekly metric (for LADDER.md)

Recall sample: N brands with a dated pop-up on a public page, M dated pop-ups inside our data window, X found; reported as X/M, and separately the share of sampled brands with no public dated page. Baseline 2026-11-23: 22 brands, 18 in-window pop-ups, 13 found (72%; 58% without amatō), 8 of 30 sampled brands with no public dated page. Next: widen to 60 brands in 12 metros after the usage reset (Friday 2026-11-28 09:00Z), picking brands first and checking our data second, and store the sample under `data/recall/` so the weekly run can re-check the same pop-ups.
