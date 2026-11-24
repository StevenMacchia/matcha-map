// Market vendor rosters: the public vendor / maker / food pages of the big recurring and seasonal markets. A vendor line with a
// matcha word on a page that also lists market dates becomes an event for each listed date (the market's hours as time when the
// line says them, the market address as venue). A matcha vendor on a roster with no dates becomes a watch-list candidate only:
// no dates, no event.
//
// How a page is read (the shared fetcher: robots.txt, 1 request per second per host, 6-hour cache, cap 6 pages per market):
//   1. the market's start pages, then up to 4 same-host links whose address names vendors, makers, food, eat, shop, exhibitors,
//      artists or a directory;
//   2. JSON-LD Events on a page give dates (and times) directly;
//   3. otherwise the date lines of the page: a line with an explicit month and day, a year-less date inside 180 days, and one of
//      the words open, hours, dates, market, weekend, every, season ("Open Fri-Sun 11am-8pm, Nov 21 - Dec 24");
//   4. roster lines: short lines (2 to 7 words, no final period, not a list of food categories) with a matcha word.
// Checked 2026-11-22 (HTTP 200, robots.txt allows the pages; vendor lists are mostly rendered by script, so most return no
// roster in the HTML): smorgasburg.com (Framer, no vendor pages), urbanspacenyc.com (Vanderbilt Market only now; the holiday
// markets moved to hfbrandsandmarkets.com and bryantpark.org), hesterstreetfair.com, artistsandfleas.com, renegadecraft.com,
// uniquemarkets.com, patchworkshow.com, randolphstreetmarket.com, dallasfarmersmarket.org, poncecitymarket.com, wharfdc.com,
// lincolnroadmiami.com (empty page without script). Not reachable from here: grandbazaarnyc.com, oddmarket.la, tifsf.com.
// MarketSpread-style directories are read by ingest/adapters/marketspread.js (another rung), not here.
import { decode, htmlToLines } from "../html.js";
import { findDates, findTime } from "../extract.js";
import { zonedIso, tzFor } from "../tz.js";
import { ldEvents, ldToRaw, siteBudget, gate, finish, skipped, CAP, hasMatcha, slugify, candidateFor } from "./common.js";
import { readEvents } from "../write.js";
import { tagKinds } from "./textfind.js";

export const name = "markets";
export const host = "smorgasburg.com";

// id, market name, city/state, the street address of the market, and the pages to start from.
export const MARKETS = [
  { id: "smorgasburg", name: "Smorgasburg", city: "Brooklyn", state: "NY", address: "Brooklyn Bridge Park, Brooklyn, NY", pages: ["https://www.smorgasburg.com/"] },
  { id: "vanderbilt", name: "Urbanspace Vanderbilt", city: "New York", state: "NY", address: "230 Park Ave, New York, NY 10169", pages: ["https://www.urbanspacenyc.com/"] },
  { id: "union-square-holiday", name: "Union Square Holiday Market", city: "New York", state: "NY", address: "E 14th St & Union Sq W, New York, NY 10003", pages: ["https://www.urbanspacenyc.com/union-square-holiday-market"] },
  { id: "bryant-park", name: "Bank of America Winter Village at Bryant Park", city: "New York", state: "NY", address: "1065 6th Ave, New York, NY 10018", pages: ["https://bryantpark.org/", "https://bryantpark.org/plan-your-visit/winter-village"] },
  { id: "columbus-circle", name: "Columbus Circle Holiday Market", city: "New York", state: "NY", address: "Columbus Cir, New York, NY 10019", pages: ["https://www.urbanspacenyc.com/columbus-circle-holiday-market"] },
  { id: "hester-street", name: "Hester Street Fair", city: "New York", state: "NY", address: "129 Essex St, New York, NY 10002", pages: ["https://hesterstreetfair.com/"] },
  { id: "artists-fleas", name: "Artists & Fleas", city: "Brooklyn", state: "NY", address: "70 N 7th St, Brooklyn, NY 11249", pages: ["https://www.artistsandfleas.com/"] },
  { id: "grand-bazaar", name: "Grand Bazaar NYC", city: "New York", state: "NY", address: "100 W 77th St, New York, NY 10024", pages: ["https://www.grandbazaarnyc.com/"] },
  { id: "renegade", name: "Renegade Craft Fair", city: "Chicago", state: "IL", address: "", pages: ["https://www.renegadecraft.com/"] },
  { id: "unique-markets", name: "Unique Markets", city: "Chicago", state: "IL", address: "", pages: ["https://www.uniquemarkets.com/"] },
  { id: "smorgasburg-la", name: "Smorgasburg LA", city: "Los Angeles", state: "CA", address: "787 S Alameda St, Los Angeles, CA 90021", pages: ["https://www.smorgasburgla.com/"] },
  { id: "odd-market", name: "Odd Market", city: "Los Angeles", state: "CA", address: "", pages: ["https://oddmarket.la/"] },
  { id: "patchwork", name: "Patchwork Show", city: "Los Angeles", state: "CA", address: "", pages: ["https://patchworkshow.com/"] },
  { id: "treasure-island", name: "Treasure Island Flea", city: "San Francisco", state: "CA", address: "Avenue of the Palms, San Francisco, CA 94130", pages: ["https://www.tifsf.com/"] },
  { id: "fremont", name: "Fremont Sunday Market", city: "Seattle", state: "WA", address: "N 34th St & Evanston Ave N, Seattle, WA 98103", pages: ["https://www.fremontmarket.com/"] },
  { id: "randolph-street", name: "Randolph Street Market", city: "Chicago", state: "IL", address: "1340 W Washington Blvd, Chicago, IL 60607", pages: ["https://www.randolphstreetmarket.com/"] },
  { id: "dallas-farmers", name: "Dallas Farmers Market", city: "Dallas", state: "TX", address: "920 S Harwood St, Dallas, TX 75201", pages: ["https://www.dallasfarmersmarket.org/"] },
  { id: "rice-village", name: "Rice Village", city: "Houston", state: "TX", address: "Rice Village, Houston, TX 77005", pages: ["https://www.ricevillage.com/"] },
  { id: "ponce-city", name: "Ponce City Market", city: "Atlanta", state: "GA", address: "675 Ponce De Leon Ave NE, Atlanta, GA 30308", pages: ["https://poncecitymarket.com/"] },
  { id: "wharf-dc", name: "The Wharf", city: "Washington", state: "DC", address: "760 Maine Ave SW, Washington, DC 20024", pages: ["https://www.wharfdc.com/"] },
  { id: "lincoln-road", name: "Lincoln Road", city: "Miami", state: "FL", address: "Lincoln Rd, Miami Beach, FL 33139", pages: ["https://lincolnroadmiami.com/"] },
  // Host venues (2026-11-24, second Population window): the market, district and landlord pages our own events already name as the place of a
  // pop-up (SoWa Boston, Texas Farmers' Market at Mueller, The Village District, Downtown Raleigh Partnership, RiNo Art District, the Pearl District
  // and Temescal farmers markets, Grant Park Market). Their home pages carried no "matcha" and no JSON-LD events when read on that day; they are listed
  // so a vendor roster or a dated event page that names matcha is picked up the day it appears.
  { id: "sowa", name: "SoWa Winter Farmers Market and Holiday Market", city: "Boston", state: "MA", address: "550 Harrison Ave, Boston, MA 02118", pages: ["https://www.sowaboston.com/"] },
  { id: "texas-farmers-mueller", name: "Texas Farmers' Market at Mueller", city: "Austin", state: "TX", address: "2006 Philomena St, Austin, TX 78723", pages: ["https://texasfarmersmarket.org/"] },
  { id: "village-district", name: "The Village District", city: "Raleigh", state: "NC", address: "2068 Clark Ave, Raleigh, NC 27605", pages: ["https://www.shopvillagedistrict.com/"] },
  { id: "downtown-raleigh", name: "Downtown Raleigh Partnership", city: "Raleigh", state: "NC", address: "", pages: ["https://www.downtownraleigh.org/events"] },
  { id: "rino", name: "RiNo Art District", city: "Denver", state: "CO", address: "", pages: ["https://rinoartdistrict.org/events/"] },
  { id: "pearl-farmers", name: "Portland Farmers Market at the Pearl District", city: "Portland", state: "OR", address: "327 NW 10th Ave, Portland, OR 97209", pages: ["https://www.portlandfarmersmarket.org/"] },
  { id: "temescal-farmers", name: "Temescal Farmers Market", city: "Oakland", state: "CA", address: "5300 Claremont Ave, Oakland, CA 94618", pages: ["https://www.agriculturalinstitute.org/"] },
  { id: "grant-park-market", name: "Grant Park Market", city: "Atlanta", state: "GA", address: "", pages: ["https://www.grantparkmarket.org/"] },
];

const FOLLOW = /(vendor|maker|food|eat|shop|exhibitor|artist|directory|market-guide|holiday|events?|calendar|whats-on|happenings)/i;
const CATEGORY_LIST = /^(?:[a-z&' -]{2,18}\s*[|,/·•]\s*){2,}/i;
const DATE_LINE = /\b(open|hours|dates?|market|weekend|every|season|sat|sun|fri)\w*/i;
const DAY = 86400000;

// Page lines -> vendor names: short, name-like lines with a matcha word (the bare word, a category list, or a sentence is not a vendor).
export function rosterVendors(lines) {
  const out = [];
  for (const l of lines) {
    const t = l.replace(/\s+/g, " ").trim();
    if (!hasMatcha(t) || t.length < 6 || t.length > 70) continue;
    const words = t.split(" ");
    if (words.length < 2 || words.length > 7 || /[.!?]$/.test(t) || CATEGORY_LIST.test(t) || /\b(is|are|was|were|will|our|your|we|you|the best)\b/i.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// Page lines -> [{y, mo, d, time}] for the market's listed dates that fall from today on, within 180 days.
export function marketDates(lines, now = new Date()) {
  const out = [], seen = new Set();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const l of lines) {
    if (l.length > 160 || !DATE_LINE.test(l)) continue;
    const ref = { y: now.getUTCFullYear(), mo: now.getUTCMonth() + 1, d: now.getUTCDate() };
    for (const g of findDates(l, ref)) {
      if (["rel", "weekday", "weekend"].includes(g.kind)) continue;
      const time = findTime(l);
      for (const d of g.dates) {
        const ms = Date.UTC(d.y, d.mo - 1, d.d);
        const k = `${d.y}-${d.mo}-${d.d}`;
        if (ms < today || ms > today + 180 * DAY || seen.has(k)) continue;
        seen.add(k);
        out.push({ ...d, time: time || null });
      }
    }
  }
  return out;
}

const brandDay = (brand, day) => `${String(brand).toLowerCase().replace(/[^a-z0-9]+/g, "")}|${day}`;

// One market page -> {vendors, dates, lds}. Pure.
export function readMarketPage(html, url, market, now = new Date()) {
  const lines = htmlToLines(html);
  const cal = calendarCards(lines, now);
  // A calendar page (a list of event cards) pairs a matcha title only with the dates inside its own card: its roster and page-wide dates are not
  // used (every other event's date on the page would otherwise be given to the matcha vendor).
  return { vendors: cal.isCalendar ? [] : rosterVendors(lines), dates: cal.isCalendar ? [] : marketDates(lines, now), cards: cal.cards, events: ldEvents(html).map((ld) => ldToRaw(ld, url, { cityHint: { city: market.city, state: market.state } })).filter(Boolean) };
}

// ---- host-venue calendars: a district, landlord or market page that lists event cards ("EVENT / title / blurb / Friday, November 27th / Learn More") -----
const CARD_END = /^(learn more|read more|more info|more details|details|view event|get tickets|rsvp|register)$/i;
const CARD_START = /^(event|events?|upcoming)$/i;
// Page lines -> { isCalendar, cards: [{ title, dates: [{y, mo, d, time}] }] }: one card per matcha title line, with the explicit dates printed in that
// card (its blurb and its date line), from today to 180 days ahead. A card without an explicit month and day gives no event.
export function calendarCards(lines, now = new Date()) {
  const ends = lines.filter((l) => CARD_END.test(l)).length;
  const isCalendar = ends >= 2;
  if (!isCalendar) return { isCalendar, cards: [] };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ref = { y: now.getUTCFullYear(), mo: now.getUTCMonth() + 1, d: now.getUTCDate() };
  const cards = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (!hasMatcha(t) || t.length > 80 || t.length < 6 || /[.!?]$/.test(t)) continue;
    // the card runs from its title to the next end marker (at most 8 lines), and never past the next card's start
    let end = i + 1;
    while (end < lines.length && end < i + 8 && !CARD_END.test(lines[end]) && !CARD_START.test(lines[end])) end++;
    const dates = [], seen = new Set();
    for (let j = i; j <= end && j < lines.length; j++) {
      const l = lines[j];
      if (l.length > 400) continue;
      for (const g of findDates(l, ref)) {
        if (["rel", "weekday", "weekend"].includes(g.kind)) continue;
        const time = findTime(l);
        for (const d of g.dates) {
          const ms = Date.UTC(d.y, d.mo - 1, d.d), k = `${d.y}-${d.mo}-${d.d}`;
          if (ms < today || ms > today + 180 * DAY || seen.has(k)) continue;
          seen.add(k);
          dates.push({ ...d, time: time || null });
        }
      }
    }
    if (dates.length && !cards.some((c) => c.title.toLowerCase() === t.toLowerCase())) cards.push({ title: t.replace(/\s+/g, " "), dates });
  }
  return { isCalendar, cards };
}

// Does our own data already hold a pop-up by this brand (its first word, accents folded) in this city on this day?
const word0 = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/)[0] || "";
export function knownOnDay(existing, title, city, day) {
  const w = word0(title);
  return !!w && existing.some((e) => String(e.start).slice(0, 10) === day && String(e.city || "").toLowerCase() === String(city || "").toLowerCase() && word0(e.brand) === w);
}

// Vendors and dates -> RawItems, one per vendor per date. Time from the date line when it names one, else all-day.
export function vendorEvents(vendors, dates, market, url) {
  const tz = tzFor({ city: market.city, state: market.state }) || "America/New_York";
  const out = [];
  for (const v of vendors) {
    for (const d of dates) {
      const t = d.time;
      const hints = {
        title: `${v} at ${market.name}`, all_day: !t, venue: market.name, address: market.address || null, city: market.city, state: market.state,
        start: zonedIso(tz, d.y, d.mo, d.d, t ? t.start.h : 0, t ? t.start.mi : 0), end: t?.end ? zonedIso(tz, d.y, d.mo, d.d, t.end.h, t.end.mi) : null,
      };
      out.push({ source_url: url, text: `${v} at ${market.name}. Listed on the market's vendor page.`, description: `Listed on the ${market.name} vendor page.`, image_url: null, tags: null, hints, organizer: { name: v, url: null } });
    }
  }
  return out;
}

// ---- Renegade Craft Fair: one page per fair (/event/<slug>/) with dated rows, the venue, and a vendor grid ----------------------
// Page shape (read 2026-11-22): rows "11/20/2026 5:00 pm | 11/20/2026 8:00 pm | America/Los_Angeles" (one per fair day), a venue block
// "Hangar 30 @ Magnuson Park | 6310 NE 74th St. | Seattle, WA 98115", and <h4 class="artist-title"> per vendor. Every fair has its own
// city, so the city comes from the page and not from the market config.
export function parseRenegadeEvent(html) {
  const days = [...String(html).matchAll(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap]m)\s*(?:<[^>]*>|\s)*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap]m)/gi)].map((m) => {
    const h = (x, mer) => (+x % 12) + (/p/i.test(mer) ? 12 : 0);
    return { y: +m[3], mo: +m[1], d: +m[2], start: { h: h(m[4], m[6]), mi: +m[5] }, end: { h: h(m[10], m[12]), mi: +m[11] } };
  });
  const uniq = days.filter((d, i) => days.findIndex((x) => x.y === d.y && x.mo === d.mo && x.d === d.d) === i);
  const lines = htmlToLines(html);
  const i = lines.findIndex((l) => /,\s*[A-Z]{2}\s+\d{5}/.test(l));
  let venue = null, street = null, city = null, state = null, zip = null;
  if (i >= 0) {
    const t = /^(.*?),\s*([A-Z]{2})\s+(\d{5})/.exec(lines[i]);
    if (t) { city = t[1].trim(); state = t[2]; zip = t[3]; }
    street = (lines[i - 1] || "").replace(/,$/, "").trim();
    venue = (lines[i - 2] || "").replace(/,$/, "").replace(/^Renegade Craft @\s*/i, "").trim() || null;
  }
  const vendors = [...String(html).matchAll(/<h4 class="artist-title">([^<]+)<\/h4>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
  const title = decode(/<title>([^<]+)<\/title>/.exec(html)?.[1] || "").replace(/\s*[—–-]\s*/, " ").trim();
  return { title, days: uniq, venue, street, city, state, zip, vendors };
}

async function renegade(b, m, hostName, now, raws, have, stats) {
  const home = await b.get(m.pages[0]);
  if (!home.ok) return;
  const cityPages = [...new Set([...home.text.matchAll(/href="(https:\/\/www\.renegadecraft\.com\/city\/[a-z-]+\/)"/g)].map((x) => x[1]))].slice(0, 8);
  const events = new Set([...home.text.matchAll(/href="(https:\/\/www\.renegadecraft\.com\/event\/[a-z0-9-]+\/)"/g)].map((x) => x[1]));
  for (const cp of cityPages) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(cp);
    if (r.ok) for (const x of r.text.matchAll(/href="(https:\/\/www\.renegadecraft\.com\/event\/[a-z0-9-]+\/)"/g)) events.add(x[1]);
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const url of [...events].slice(0, 20)) {
    if (b.st.stopped || b.left() <= 0) break;
    const r = await b.get(url);
    if (!r.ok) continue;
    const p = parseRenegadeEvent(r.text);
    const days = p.days.filter((d) => Date.UTC(d.y, d.mo - 1, d.d) >= today);
    const mine = p.vendors.filter((v) => hasMatcha(v));
    stats.vendors += mine.length;
    if (!days.length || !p.city || !p.state || !mine.length) continue;
    const tz = tzFor({ city: p.city, state: p.state }) || "America/Los_Angeles";
    for (const v of mine) for (const d of days) {
      const k = brandDay(v, `${d.y}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`);
      if (have.has(k)) continue;
      have.add(k);
      raws.push({
        source_url: url, text: `${v} at ${p.title || "Renegade Craft Fair"}. Listed on the fair's vendor page.`, description: `Listed on the Renegade Craft Fair ${p.city} vendor page.`, image_url: null, tags: null,
        hints: { title: `${v} at Renegade Craft Fair ${p.city}`, all_day: false, venue: p.venue || "Renegade Craft Fair", address: p.street ? `${p.street}, ${p.city}, ${p.state} ${p.zip}` : null, city: p.city, state: p.state, start: zonedIso(tz, d.y, d.mo, d.d, d.start.h, d.start.mi), end: zonedIso(tz, d.y, d.mo, d.d, d.end.h, d.end.mi) },
        organizer: { name: v, url: null },
      });
    }
  }
}


export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP, markets = MARKETS } = ctx;
  const b = siteBudget(fetcher, name, cap);
  let existing = ctx.existing;
  if (!existing) { try { existing = readEvents(); } catch { existing = []; } }
  const have = new Set(existing.map((e) => brandDay(e.brand, String(e.start).slice(0, 10))));
  const stats = { markets: 0, skippedHosts: [], pages: 0, vendors: 0, cards: 0, cardsKnown: 0, rosterOnly: 0, fetches: 0 };
  const raws = [], rosterOnly = [];
  const okHost = new Map();
  for (const m of markets) {
    if (b.st.stopped || b.left() <= 0) break;
    let first;
    try { first = new URL(m.pages[0]); } catch { continue; }
    if (!okHost.has(first.host)) okHost.set(first.host, await gate(b, first.host));
    const g = okHost.get(first.host);
    if (!g.ok) { stats.skippedHosts.push(`${first.host}: ${g.reason}`); continue; }
    stats.markets++;
    if (m.id === "renegade") { await renegade(b, m, first.host, now, raws, have, stats); continue; }
    let todo = [...m.pages], done = 0;
    const seen = new Set();
    while (todo.length && done < 6 && !b.st.stopped && b.left() > 0) {
      const url = todo.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      const r = await b.get(url);
      if (!r.ok) continue;
      done++;
      const p = readMarketPage(r.text, url, m, now);
      for (const raw of p.events) if (hasMatcha(raw.text, raw.hints.title)) raws.push(raw);
      // Event cards of a host calendar: each matcha card gives its own dates only, minus the days our data already holds for that brand.
      for (const c of p.cards) {
        stats.cards++;
        const fresh = c.dates.filter((d) => !knownOnDay(existing, c.title, m.city, `${d.y}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`));
        stats.cardsKnown += c.dates.length - fresh.length;
        for (const raw of vendorEvents([c.title], fresh, m, url)) {
          const k = brandDay(raw.organizer.name, raw.hints.start.slice(0, 10));
          if (!have.has(k)) { have.add(k); raws.push(raw); }
        }
      }
      // Vendors and dates must come from the same page: a roster is never paired with dates found on another page.
      if (p.vendors.length) {
        stats.vendors += p.vendors.length;
        if (p.dates.length) {
          for (const raw of vendorEvents(p.vendors, p.dates, m, url)) {
            const k = brandDay(raw.organizer.name, raw.hints.start.slice(0, 10));
            if (!have.has(k)) { have.add(k); raws.push(raw); }
          }
        } else for (const v of p.vendors) rosterOnly.push({ vendor: v, market: m });
      }
      if (url === m.pages[0] || todo.length === 0) {
        for (const h of r.text.matchAll(/href="([^"#?]+)"/g)) {
          let u; try { u = new URL(decode(h[1]), url); } catch { continue; }
          if (u.host === first.host && FOLLOW.test(u.pathname) && !seen.has(u.href) && !todo.includes(u.href) && todo.length < 4) todo.push(u.href);
        }
      }
    }
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  // Roster vendors without dates: watch-list candidates, no event.
  const haveIds = new Set(sources.map((s) => s.id));
  for (const { vendor, market } of rosterOnly) {
    const src = { id: `${name}:${slugify(vendor)}`, brand: vendor, home_city: market.city, home_state: market.state };
    if (haveIds.has(src.id) || out.candidates.some((c) => c.evidence?.includes(`org=${slugify(vendor)};`))) continue;
    haveIds.add(src.id);
    out.candidates.push(candidateFor(name, { hints: { title: `${vendor} at ${market.name}` } }, src));
    stats.rosterOnly++;
  }
  return { ...out, stats: { ...stats, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

void skipped;
export default { name, host, discover };
