// Matcha drink names from a menu's lines of text (an HTML page's lines, or a PDF's). Names only: a trailing price is split off.
import { htmlToLines } from "../html.js";

// A drink name, not a heading, a description or a sentence: at most 7 words, no closing period, and not "series", "menu", "flavors".
export const drinkLooksOk = (name) => {
  const n = String(name || "").trim();
  return n.length >= 5 && n.split(/\s+/).length <= 7 && !/[.!?]$/.test(n) && !/\b(series|menu|collection|flavou?rs?|options?|section|category|infused|topped|served|made with)\b|\bw\//i.test(n);
};

// Distinct matcha drink lines: short lines with "matcha". `bare` also reads a trailing price written without "$" ("Matcha Latte 6.50"), which PDF menus do.
export function matchaDrinksFromLines(lines, { bare = false } = {}) {
  const seen = new Set(), out = [];
  for (const line of lines) {
    if (line.length > 70 || line.length < 5 || !/matcha/i.test(line) || /[.!?]\s+[A-Z]/.test(line) || /\b(our|we|your|you|the best|shop|buy|order online|subscribe)\b/i.test(line)) continue;
    const m = (bare ? /^(.*?)(?:\s*[-–·:]?\s*(\$?\s?\d+(?:\.\d{2})?\+?))?$/ : /^(.*?)(?:\s*[-–·:]?\s*(\$\s?\d+(?:\.\d{2})?\+?))?$/).exec(line.trim());
    const name = (m?.[1] || line).replace(/\s+/g, " ").trim();
    if (!drinkLooksOk(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const price = m?.[2] ? (m[2].startsWith("$") ? m[2] : `$${m[2]}`) : null;
    out.push({ name, price });
  }
  return out;
}

export const matchaDrinks = (html) => matchaDrinksFromLines(htmlToLines(html));
