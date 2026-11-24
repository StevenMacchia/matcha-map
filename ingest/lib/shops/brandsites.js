// Our own cafe-kind brands: find a street address on the brand's site (JSON-LD first, then a footer
// pattern), geocode it, and make a shop record. No address found = no point (never invented).
import { jsonLd, htmlToLines } from "../html.js";

const ST = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ").join("|");

function fromLd(html) {
  const one = (x) => {
    const a = x && typeof x === "object" ? x.address : null;
    if (a && typeof a === "object" && a.streetAddress) {
      return { address: String(a.streetAddress).trim(), city: a.addressLocality || null, state: a.addressRegion || null, zip: a.postalCode || null,
        hours: Array.isArray(x.openingHours) ? x.openingHours.join(", ") : x.openingHours || null, phone: x.telephone || null };
    }
    return null;
  };
  for (const x of jsonLd(html)) {
    if (!x || typeof x !== "object") continue; // a JSON-LD array can hold null
    const r = one(x) || (Array.isArray(x.location) ? x.location.map(one).find(Boolean) : one(x.location));
    if (r) return r;
  }
  return null;
}

// "123 Main St, Brooklyn, NY 11211" on one line of page text.
const LINE = new RegExp(
  "(\\d{1,6}\\s+[A-Za-z0-9.'\\u2019 -]{3,40}?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Pl|Place|Hwy|Highway|Pkwy|Parkway|Ct|Court|Sq|Square)\\b\\.?(?:\\s*(?:#|Suite|Ste\\.?|Unit)\\s*\\w+)?)" +
  "\\s*,?\\s*([A-Za-z.' -]{2,30}?)\\s*,?\\s*(" + ST + ")\\b\\.?\\s*(\\d{5})?");
function fromText(html) {
  for (const line of htmlToLines(html)) {
    const m = LINE.exec(line);
    if (m) return { address: m[1].trim(), city: m[2].trim().replace(/^[,\s]+/, ""), state: m[3], zip: m[4] || null, hours: null, phone: null };
  }
  return null;
}

export function extractAddress(html) { return fromLd(html) || fromText(html); }

// Pages tried per brand: the home page plus common contact and location paths.
export const PAGES = ["/", "/contact", "/locations", "/visit", "/about"];

export async function findAddress(fetcher, website) {
  let base;
  try { base = new URL(website); } catch { return null; }
  if (/linktr\.ee|instagram\.com|facebook\.com/i.test(base.host)) return null;
  for (const p of PAGES) {
    let r;
    try { r = await fetcher.get(new URL(p, base).href); } catch { continue; }
    if (r.blocked) return null;
    if (!r.ok) continue;
    const a = extractAddress(r.text);
    if (a) return a;
  }
  return null;
}
