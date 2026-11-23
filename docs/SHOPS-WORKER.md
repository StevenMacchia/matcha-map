# Storefront research worker brief (Population lane, P2)

Goal: a real matcha shop layer for every city on the top-50-per-state list (`data/cities.json`, 2,410 cities), worked in population order. A worker takes a list of cities, finds the permanent matcha shops in each, confirms every one on its own public page, and writes rows to its own file `data/shops-<region>-<part>.json`. The pipeline reads those files (`ingest/lib/shops/curated.js`), geocodes each street address through the committed Nominatim cache, and merges them with the OpenStreetMap and brand rows (`npm run shops -- --no-osm`).

## What counts as a shop

A permanent place that sells matcha drinks as a core offer: a matcha cafe or bar, a Japanese tea house or kissaten whose menu leads with matcha, a matcha bar inside a bakery, market hall or bookshop, and the matcha chains (Cha Cha Matcha, Matcha Cafe Maiko, Nana's Green Tea, Kettl, Matchaful, Setsugekka, Stonemill, Isshiki, Sorate, Chalait, Kissaten and any chain you find). Not every coffee shop that has a matcha latte on the menu. Test: the shop's own site or menu says matcha in its name, tagline or a dedicated section, or matcha drinks are most of what it sells. Not shops: pop-ups and carts (they are events), tea-only retailers with no cafe counter, a class studio, a brand with no storefront, a place that has closed.

## How to find them (public pages only, read-only)

1. Food press lists, read as lists, never copied: "best matcha in <city>", "best Japanese tea house <city>", Eater, The Infatuation, Time Out, local alt-weeklies and blogs. A press line gives a name and a city; it is never enough on its own.
2. Chain location pages (the chain's own store list).
3. The brands in `data/sources.json` with `kind` cafe (their own address pages).
4. Search by city name plus matcha. Never open instagram.com or tiktok.com pages (no login-wall scraping); a handle seen on the shop's own site is enough.

## How to confirm one (required for `verified`)

Run `node tools/shop-read.js <shop website> --paths home,/contact,/locations,/visit,/about,/menu` (Git Bash rewrites a bare `/`, so write `home`). It respects robots.txt, reads the shop's own pages and prints address, phone, hours in OpenStreetMap syntax, Instagram handle, menu link, photo and the count of "matcha". Use what it prints. A field it prints as null stays null: never fill an address, hour or phone from memory, never guess. If the site is down or blocks robots, leave `confirmed_via` out of the row (it is then held, not shown) and list the shop in your report. Hours go in `opening_hours` exactly as the tool prints them ("Mo-Fr 08:00-17:00; Sa-Su 09:00-15:00").

## The row

```json
{
  "name": "Isshiki Matcha",
  "address": "183 Grand Street",
  "city": "New York", "state": "NY", "zip": "10013",
  "website": "https://isshikimatcha.com",
  "instagram": "isshikimatcha",
  "phone": null,
  "opening_hours": "Mo-Su 08:00-18:00",
  "menu_url": "https://isshikimatcha.com/pages/cafe-menu",
  "image_url": null,
  "image_credit": null,
  "source_url": "https://isshikimatcha.com/pages/locations",
  "read": "2026-11-23",
  "confirmed_via": "own-site",
  "notes": "optional, plain words"
}
```

- Required: name, address (starts with the street number), city, two-letter state, source_url (the public page where the address and the shop can be seen), read (the date you read it). `confirmed_via` is `own-site`, `instagram-bio` (a handle seen on its own site) or `press+site` (a press list plus the shop's own page). A row without `confirmed_via` is kept but not shown on the map.
- `image_url`: the shop's own og:image or hero photo URL from its own site, with `image_credit` "Photo: <shop name> website". Null if the site has none; never take a photo from a press site, Google, Yelp or an Instagram/Facebook CDN (those links expire and are not ours to serve).
- No coordinates in the file. The pipeline geocodes the address.
- One row per location. A chain gets one row per store you can confirm on its own location page.
- File shape: `{ "generated": "<ISO time>", "group": "<region>-<part>", "shops": [ ... ] }`. Write your own file only; never edit another file, `data/shops.json`, `site/` or `ingest/`.

## Rules

Public pages and official APIs only, robots.txt respected (the tools do it), 1 request a second per host; no login walls, no cookies, no bot-check evasion, no Instagram or TikTok page fetches. Never invent a shop or an address. Drop a shop you cannot confirm and list it in your report under "not confirmed" with why. Do not message anyone and do not ask Steven anything.

## Report

Per city: shops found, confirmed, rows written, not confirmed (name and why). Fields filled across the file (address, hours, phone, instagram, menu_url, image_url: a count of each). Sources that refused (robots, blocked, down) by host.
