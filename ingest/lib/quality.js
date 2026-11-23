// Quality rules for noisy event-site and web finds: a listing whose title is a hotel, a craft class or a generic place is not a
// matcha pop-up unless the title itself names matcha as the point. Rules are data (NOISE below, one entry per pattern) plus one
// check (matchaSignal). judge(e) -> {keep, reason, kind}: kind "organizer" for classes, tastings and workshops (the schema has no
// "class" kind; data/KINDS.md: organizer = classes and meetups, the site's kind word is "class").
import fs from "node:fs";
import { hasMatcha } from "../adapters/mato.js";

// Matcha as an object (a bowl, a whisk) is not matcha as the point of the event: "Matcha Bowl Pottery Class" is a pottery class.
export const MATCHA_OBJECT = /\bmatcha[\s-]+(?:bowls?|whisks?|chawan|tea ?sets?|sets?|cups?|mugs?|scoops?|ceramics?)\b|\bcomment\s+["“']?matcha["”']?/gi;
export const matchaSignal = (...parts) => hasMatcha(parts.filter(Boolean).join(" | ").replace(MATCHA_OBJECT, " "));

// One entry per kind of noise. `on` lists the fields the pattern is tried on; `titleOnly`: when the title itself is the hit (the listing is a hotel),
// only a title naming matcha saves it (a hotel page that mentions its lobby matcha bar is still a hotel page); otherwise running text
// naming matcha as the point (POINT) saves it too ("Kettl pop-up" at the Ace Hotel, described as a matcha pop-up).
export const NOISE = [
  { id: "hotel", why: "a hotel listing", titleOnly: true, on: ["title", "venue", "brand"], re: /\b(?:hilton|marriott|hyatt|sheraton|westin|doubletree|embassy suites|hampton inn|holiday inn|courtyard by|residence inn|four points|best western|ritz[- ]carlton|kimpton|aloft|tempo by|motel|inn (?:&|and) suites|hotel)\b/i },
  { id: "craft", why: "a craft class", on: ["title", "venue", "brand"], re: /\b(?:pottery|ceramics?|glaze|wheel[\s-]throwing|handbuilding|sip (?:and|&|n) paint|paint(?:ing)? (?:night|party|class)|candle[\s-]making|terrarium|crochet|knit(?:ting)?|embroidery|jewelry[\s-]making|flower arranging|floral (?:class|workshop))\b/i },
  { id: "fitness", why: "a fitness or wellness session", on: ["title"], re: /\b(?:yoga|pilates|sound bath|run club|running club|barre|spin class|hiit|bootcamp|meditation)\b/i },
  { id: "generic", why: "a generic place or listing name", titleOnly: true, on: ["title"], re: /^(?:downtown|online|virtual|tba|tbd|various locations?|private (?:event|location)|event space|community (?:center|room)|ballroom|conference room|banquet hall|[\w' ]+ (?:mall|plaza|center|centre))$/i },
  { id: "purpose", why: "a charity or social title with no matcha in it", on: ["title"], re: /\bwith a purpose\b|\bfundraiser\b|\bgala\b|\bnetworking\b|\bmixer\b|\bspeed dating\b|\btrivia\b/i },
];

// Matcha named as the point of the event in running text ("a matcha pop-up", "serving matcha lattes").
export const POINT = /\bmatcha[\s-]+(?:pop[\s-]?ups?|bar|cart|tasting|menu|drinks?|lattes?|stand|booth|party|social|ceremony|takeover|caf[eé]|truck|flight|service)\b|\b(?:serving|pouring|whisking)\s+(?:up\s+)?(?:\w+\s+)?matcha\b/i;

export const CLASS = /\b(?:class(?:es)?|workshop|tasting|ceremony|101|course|lesson|masterclass)\b/i;

// A brunch, bar-night or trivia listing from an event site that only borrows matcha for its title ("Matcha & Mimosa Sundays" is a brunch).
export const BRUNCH = /\b(?:brunch|omelet+es?|pancakes?|mimosas?|bottomless|burgers?|happy hour|trivia|bingo|drag)\b/i;
export const PSEUDO_ID = /^(?:eventbrite|allevents|meetup|mato):/;
// Two different brunch words ("brunch ... mimosas"), or one that no matcha meetup would use. A lone "brunch or coffee" is a meetup, not a brunch.
const HARD = /\b(?:trivia|bingo|drag|happy hour|bottomless|burgers?|omelet+es?)\b/i;
export function brunchy(d) {
  const t = String(d || "");
  const hits = new Set((t.match(new RegExp(BRUNCH.source, "gi")) || []).map((s) => s.toLowerCase().replace(/s$/, "")));
  return hits.size >= 2 || HARD.test(t);
}
const MATCHA_BRAND = /matcha|\btea\b|\bcha\b|cha$/i;

// e: {title, venue, brand, description, menu} -> {keep:true, kind} | {keep:false, reason}
export function judge(e) {
  const title = String(e.title || ""), f = { title, venue: String(e.venue || ""), brand: String(e.brand || "") };
  if (PSEUDO_ID.test(String(e.source_id || "")) && !MATCHA_BRAND.test(f.brand) && brunchy(e.description) && !matchaSignal(e.description, e.venue, (e.menu || []).join(" "))) return { keep: false, reason: "brunch", why: "a brunch or bar listing with matcha only in the title" };
  const hit = NOISE.find((n) => n.on.some((k) => n.re.test(f[k])));
  if (hit && !matchaSignal(title, f.brand) && ((hit.titleOnly && hit.re.test(title)) || !POINT.test(String(e.description || "").replace(MATCHA_OBJECT, " ")))) return { keep: false, reason: hit.id, why: hit.why };
  if (!matchaSignal(title, e.description, e.venue, e.brand, (e.menu || []).join(" "))) return { keep: false, reason: "no-matcha", why: "matcha only as an object or not at all" };
  return { keep: true, kind: CLASS.test(title) ? "organizer" : null };
}

// A matcha signal in running text: matcha, hojicha, usucha, koicha, ceremonial grade, or a drink named in data/drinks.json (aliases).
let ALIAS = null;
export function drinkAliases() {
  if (!ALIAS) {
    try { const d = JSON.parse(fs.readFileSync(new URL("../../data/drinks.json", import.meta.url), "utf8")); ALIAS = (d.drinks || []).flatMap((x) => [x.name, ...(x.aliases || [])]).map((s) => String(s).toLowerCase()).filter((s) => s.length > 5); }
    catch { ALIAS = []; }
  }
  return ALIAS;
}
export function hasSignal(...parts) {
  const t = parts.filter(Boolean).join(" | ");
  if (hasMatcha(t)) return true;
  const low = t.toLowerCase();
  return drinkAliases().some((a) => low.includes(a));
}
// Words of a brunch, bar-night or fitness listing (the audit prints these; the brunch rule in judge() uses BRUNCH).
export const OFFTOPIC = /\b(?:brunch|omelet+es?|pancakes?|mimosas?|burgers?|bottomless|trivia|bingo|drag|yoga|pilates|run club|happy hour)\b/i;
