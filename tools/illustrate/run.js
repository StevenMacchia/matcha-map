// npm run art: draw a cartoon for every drink on a menu that has no art yet, and a 16:10 scene for every
// event without a downloaded photo. Writes site/art/drinks/<slug>.svg, site/art/events/<event id>.svg and
// site/art/index.json (slug -> file, spec, source text, generator version). Skips anything already drawn by
// the same generator version from the same text, prunes files nothing references, and refreshes site/art.js
// (the browser copy of drink.js). Free, offline, deterministic. Flags: --force (redraw all), --image-api
// (let a keyed image API draw PNGs too; off unless OPENAI_API_KEY or STABILITY_API_KEY is set), --quiet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION, hash, specFromText, drawDrink, drawEventArt, eventDrinks, parseSymbols, slugify, TEST_DRINKS, useCatalog, catalogEntries } from "./drink.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAX_BYTES = 30 * 1024;
// Generator version: the drawing code version plus a hash of drink.js (line endings normalised), so any change
// to the drawing code redraws everything once and an unchanged run touches nothing.
// data/drinks.json (the researched top-50 catalogue) joins in too: editing it redraws.
export function generatorVersion(root = ROOT) {
  const read = (p) => { try { return fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } };
  const cat = read("data/drinks.json");
  return `${VERSION}.${hash(read("tools/illustrate/drink.js")).toString(36)}${cat ? "." + hash(cat).toString(36) : ""}`;
}
// Register data/drinks.json (when present) with the drawing code. -> {file: entries or null, count}
export function loadCatalog(root = ROOT) {
  const raw = readJson(path.join(root, "data/drinks.json"), null);
  const file = raw ? (Array.isArray(raw) ? raw : raw.drinks || null) : null;
  const order = raw && raw.vocabulary && Array.isArray(raw.vocabulary.families) ? raw.vocabulary.families : null;
  return { file, order, count: useCatalog(file || []) };
}
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

// The browser copy is the same file byte for byte (test/illustrate.test.js checks).
export function syncBrowserCopy(root = ROOT) {
  const src = fs.readFileSync(path.join(root, "tools/illustrate/drink.js"), "utf8"), dst = path.join(root, "site/art.js");
  if (fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === src) return false;
  fs.writeFileSync(dst, src); return true;
}

// Events that need a drawn scene: no downloaded photo (a remote-only image can expire or be blocked).
export const needsArt = (e) => !(e.image && e.image.local);

export async function renderAll({ events, sources, root = ROOT, force = false, imageApi = false, env = process.env, fetchFn, write = true } = {}) {
  const dir = path.join(root, "site/art");
  events = events || readJson(path.join(root, "data/events.json"), { events: [] }).events || [];
  sources = sources || readJson(path.join(root, "data/sources.json"), []);
  const symbols = parseSymbols(fs.readFileSync(path.join(root, "site/characters.svg"), "utf8"));
  const indexPath = path.join(dir, "index.json"), old = readJson(indexPath, { drinks: {}, events: {} });
  const catalog = loadCatalog(root);
  const GEN = generatorVersion(root), index = { generator: GEN, drinks: {}, events: {} };
  const brandOf = new Map(sources.map((s) => [s.id, s.brand]));
  const c = { drinks: 0, drinksSkipped: 0, events: 0, eventsSkipped: 0, notDrinks: 0, pruned: 0, png: 0, oversize: [] };
  if (write) for (const d of ["drinks", "events"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const put = (rel, svg) => {
    if (Buffer.byteLength(svg) > MAX_BYTES) c.oversize.push(rel);
    if (write) fs.writeFileSync(path.join(dir, rel), svg);
  };
  const fresh = (entry, text) => !force && entry && entry.v === GEN && entry.text === text && fs.existsSync(path.join(dir, entry.file));

  // 1. The drink catalogue (built-in top 50, plus data/drinks.json when present), the test menu, and every
  // distinct drink or sweet on a menu. A name and its aliases share one file.
  const texts = new Map(); // slug -> text (first spelling wins)
  const unknown = new Set();
  const add = (t) => { const spec = specFromText(t); if (!spec) { unknown.add(t); return; } const slug = slugify(spec.name); if (!texts.has(slug)) texts.set(slug, spec.name); };
  for (const e of catalogEntries()) add(e.name);
  for (const t of TEST_DRINKS) add(t);
  for (const e of events) for (const m of (Array.isArray(e.menu) ? e.menu : [])) add(m);
  c.notDrinks = unknown.size;
  for (const [slug, text] of texts) {
    const file = `drinks/${slug}.svg`, spec = specFromText(text), prev = old.drinks && old.drinks[slug];
    if (fresh(prev, text)) { index.drinks[slug] = prev; c.drinksSkipped++; continue; }
    put(file, drawDrink(spec, { symbols, uid: "d" + slug.replace(/-/g, "").slice(0, 10) }));
    index.drinks[slug] = { file, text, v: GEN, ...(spec.family ? { family: spec.family } : {}), spec };
    c.drinks++;
  }
  // Families in catalogue order, each with its drinks' slugs and aliases, for the gallery.
  index.families = {};
  const rank = (fam) => { const i = catalog.order ? catalog.order.indexOf(fam) : -1; return i < 0 ? 99 : i; };
  for (const e of catalogEntries().map((x, i) => [x, i]).sort((a, b) => rank(a[0].family) - rank(b[0].family) || a[1] - b[1]).map((x) => x[0])) {
    const slug = slugify(specFromText(e.name).name);
    (index.families[e.family] = index.families[e.family] || []).push({ slug, name: e.name, aliases: e.aliases });
  }
  if (catalog.file) index.catalog = catalog.file;

  // 2. A scene per event without a downloaded photo.
  for (const e of events) {
    if (!e.id || !needsArt(e)) continue;
    const brand = e.brand || brandOf.get(e.source_id) || "Matcha pop-up";
    const drinks = eventDrinks(e).map((s) => s.name), text = JSON.stringify({ brand, drinks });
    const file = `events/${e.id}.svg`, prev = old.events && old.events[e.id];
    if (fresh(prev, text)) { index.events[e.id] = prev; c.eventsSkipped++; continue; }
    put(file, drawEventArt({ ...e, brand }, { symbols }));
    index.events[e.id] = { file, text, v: GEN, brand, drinks: drinks.map(slugify) };
    c.events++;
  }

  // 3. Optional: a keyed image API draws a PNG beside the SVG (never by default, never in tests).
  if (imageApi) {
    const { imageProvider, renderImage, MAX_PER_RUN } = await import("./image-api.js");
    const prov = imageProvider(env);
    if (prov) {
      let budget = Number(env.IMAGE_API_MAX || MAX_PER_RUN);
      for (const [slug, entry] of Object.entries(index.drinks)) {
        if (budget <= 0) break;
        const prevPng = old.drinks && old.drinks[slug] && old.drinks[slug].png;
        if (prevPng && fs.existsSync(path.join(dir, prevPng.file)) && prevPng.text === entry.text) { entry.png = prevPng; continue; }
        try {
          const buf = await renderImage(entry.spec, { env, fetchFn });
          const file = `drinks/${slug}.png`;
          if (write) fs.writeFileSync(path.join(dir, file), buf);
          entry.png = { file, provider: prov.name, text: entry.text }; c.png++; budget--;
        } catch (err) { console.warn(`image api ${slug}: ${err.message}`); budget = 0; }
      }
    }
  } else for (const [slug, entry] of Object.entries(index.drinks)) {
    const prevPng = old.drinks && old.drinks[slug] && old.drinks[slug].png;
    if (prevPng && fs.existsSync(path.join(dir, prevPng.file))) entry.png = prevPng;
  }

  // 4. Index, prune, browser copy.
  index.drinks = sortObj(index.drinks); index.events = sortObj(index.events);
  if (write) {
    const keep = new Set([...Object.values(index.drinks).flatMap((d) => [d.file, d.png && d.png.file]), ...Object.values(index.events).map((d) => d.file)].filter(Boolean));
    for (const d of ["drinks", "events"]) for (const f of fs.readdirSync(path.join(dir, d))) {
      if (!/\.(svg|png)$/.test(f) || keep.has(`${d}/${f}`)) continue;
      fs.unlinkSync(path.join(dir, d, f)); c.pruned++;
    }
    const json = JSON.stringify(index, null, 1) + "\n";
    if (!fs.existsSync(indexPath) || fs.readFileSync(indexPath, "utf8") !== json) fs.writeFileSync(indexPath, json);
    c.copy = syncBrowserCopy(root);
  }
  c.totalDrinks = Object.keys(index.drinks).length; c.totalEvents = Object.keys(index.events).length;
  return { counts: c, index };
}

export function summary(c) {
  return `art: drinks ${c.drinks} drawn, ${c.drinksSkipped} unchanged (${c.totalDrinks} total, ${c.notDrinks} menu items not drawable); ` +
    `events ${c.events} drawn, ${c.eventsSkipped} unchanged (${c.totalEvents} total); ${c.pruned} pruned` +
    (c.png ? `; ${c.png} PNG from the image API` : "") + (c.oversize.length ? `; OVER 30 KB: ${c.oversize.join(", ")}` : "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flags = new Set(process.argv.slice(2));
  if (flags.has("--image-api")) await import("../../ingest/lib/env.js");
  const t0 = Date.now();
  const { counts } = await renderAll({ force: flags.has("--force"), imageApi: flags.has("--image-api") });
  console.log(`${summary(counts)} in ${Date.now() - t0} ms`);
}
