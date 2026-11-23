# Drink art

Every drink gets a cartoon, whether or not anyone posted a photo. The drawing code is `tools/illustrate/drink.js`, with no dependencies. `site/art.js` is the same file for the browser.

## How a new drink gets art

There are two ways, and both are drawn by `npm run art`. `npm run ingest` also runs it after it writes the events; pass `--no-art` to skip it.

1. **Add it to `data/drinks.json`.** This is for a drink you want drawn exactly right. Give it a `name`, `aliases`, a `family`, a `popularity` from 1 to 5, and `components`, using only the words in the file's `vocabulary`:
   - `base`
   - `layers`: bottom to top, each with a `hex` colour
   - `top`: cloud foam, sweet cream, einspanner cream, whipped cream and so on
   - `toppings`
   - `serve`: iced tall glass, hot mug, bowl, can, bottle, cup with lid, soft-serve cone or dessert cup
   - `hot`
   - `garnish`

   Any menu line that matches the name or one of the aliases is drawn from these parts. The file's colours win over the built-in ones. Editing the file redraws everything on the next run.
2. **Do nothing.** A drink that only appears in a menu (`events.json` `menu`) is read from its words: cup, flavour layers, ice, foam, toppings, straw and garnish. Words the parser does not know get no art; `npm run art` prints how many. To teach it a new flavour, add a colour to `FLAVORS` in drink.js.

## Where the art goes

- `site/art/drinks/<slug>.svg`: one file per drink. A name and its aliases share a file.
- `site/art/events/<event id>.svg`: a 16:10 scene for each event without a downloaded photo.
- `site/art/index.json`: the file for each drink, its parts, the text it came from, its family and the generator version. A second run with the same code and text draws nothing.

## Reviewing the art

Open `/art/gallery.html`. It shows the drinks.json drinks first, grouped by family with their popularity, then the test menu, every menu drink and the event scenes. It has light, dark and side-by-side views, a phone-size view, and a live box where you can type any drink.

## Optional image API

PNGs from an image API (`npm run art -- --image-api` with `OPENAI_API_KEY` or `STABILITY_API_KEY` set) are off by default. The README lists the costs and where to get a key.
