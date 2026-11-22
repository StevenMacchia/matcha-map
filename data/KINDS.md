# Source kinds

Every source in `data/sources.json` and `data/wave3/*.json` has a `kind` and a `category` (see SPEC.md section 2). Nothing is deleted for being the wrong kind; the filter does the hiding.

**Rule: the site shows category `matcha` with every kind on by default; the kind word on each card tells them apart. "Pop-up brands only" under Show narrows to kind `popup`.**

## kind

| kind | Meaning | Examples |
|---|---|---|
| popup | A brand whose thing is matcha pop-ups, carts, stands, market booths or takeovers. Strict: when unsure between popup and cafe, it is cafe. | `333-matcha` (weekend cart), `caffeine-depot` (farmers markets) |
| cafe | A permanent matcha-focused shop that also runs or hosts dated pop-ups or events. | `labora`, `tea-loft` |
| venue | A host (market, bookstore, studio, coffee shop) where matcha brands appear; matcha is not its own thing. | `iris-coffee-lab`, `they-say-that` |
| tea-brand | A tea or matcha product company that does occasional activations; matcha is one line of several. | `mizuba-tea-co`, `wakari-tea` |
| organizer | An events or community group that runs matcha-themed meetups, tastings or classes. | `dallas-matcha-club`, `whisk-and-bloom` |
| festival | A dated festival or fair. | `matcha-fest` |

## What the site calls them

The Show control in the filter row (SPEC.md section 8). Default: every kind on, category Matcha only. A first switch, "Pop-up brands only" (off), keeps kind popup only and greys out the kind checkboxes.

| kind | Checkbox label | Tiny word on cards |
|---|---|---|
| popup | Pop-ups | none |
| cafe | Cafes that pop up | cafe |
| organizer | Classes and meetups | class |
| festival | Festivals | festival |
| venue | Hosts and venues | host |
| tea-brand | Tea brands | tea brand |

Categories: Matcha (on), Coffee, Boba, Bakery, Dessert, Other. An event copies its source's `kind` and `category`; events found on MATO under a `mato:<slug>` pseudo-source, and from MATO sources promoted to a real record, are `popup` / `matcha` (the slug is nearly always the brand's own handle), and `organizer` only when the event title says class, workshop, meetup, tasting, 101 or club.

## category

`matcha` (default today), `coffee`, `boba`, `bakery`, `dessert`, `other`. These are for later expansion ("start with matcha and move to other things later"). A brand that is plainly another category and only occasionally does matcha gets that category, with the reason in `kind_note` or `notes`.

## kind_note

One short line on why, for anything that is not `popup`; null for `popup`.
