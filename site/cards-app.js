// The bridge between app.js (a classic script) and cards.js (an ES module). Load with
//   <script type="module" src="cards-app.js"></script>
// It sets window.MatchaCards = { render(item, ctx), row(item, ctx), ready } for app.js's renderCard hook:
// render returns the rich card's HTML for an event item ("e:<id>") or a brand item ("b:<source id>"), and null for
// anything else (shops), so app.js keeps its built-in card there. The data cards.js needs (art index, brands, sources,
// places) is fetched here once; until it lands the cards still render, with less on them.
// Share buttons, picture fallbacks and "Also nearby" links are handled by delegated listeners on the document, so the
// app does not need to call anything after it sets innerHTML. Set window.MatchaCards.open = function (key) {...} to
// open an also-nearby pop-up in place (key "e:<id>"); without it the link is a normal deep link (?event=<id>).
import { cardHtml, rowHtml, brandCardHtml, wire } from "./cards.js";
import { shopCardHtml } from "./shopcard.js"; // the storefront card ("s:<id>")

const data = { art: null, brands: null, sources: null, places: null };
let pages = null; // data/pages.json: which city and brand pages exist (written by npm run pages)
const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ready = Promise.all([get("art/index.json"), get("data/brands.json"), get("data/sources.json"), get("data/places.json"), get("data/pages.json")])
  .then(([art, brands, sources, places, idx]) => { Object.assign(data, { art, brands, sources, places }); pages = idx && Array.isArray(idx.cities) ? { cities: idx.cities, brands: new Set(idx.brands || []) } : null; });

// "More in <city>" and the brand name link only to a page that exists, by the same rules as tools/gen-pages.js: the city
// page by name and state, else the nearest one in the state within 25 km; the brand page by handle.
const norm = (x) => String(x || "").toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim();
function km(a, la, lo) {
  const rad = Math.PI / 180, dl = (a.la - la) * rad, dn = (a.lo - lo) * rad;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(la * rad) * Math.cos(a.la * rad) * Math.sin(dn / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export function cityHref(e) {
  if (!pages || !e) return "";
  const same = pages.cities.filter((c) => c.s === e.state);
  let hit = same.find((c) => norm(c.n) === norm(e.city));
  if (!hit && isFinite(e.lat) && isFinite(e.lng) && e.lat != null && e.lng != null) {
    let bd = 25;
    for (const c of same) { const d = km(c, e.lat, e.lng); if (d < bd) { bd = d; hit = c; } }
  }
  return hit ? { href: "/city/" + hit.p + "/", name: hit.n } : "";
}
export function brandHref(h) {
  const slug = String(h || "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return pages && slug && pages.brands.has(slug) ? "/brand/" + slug + "/" : "";
}

function hook() { return window.__matcha && window.__matcha.state ? window.__matcha.state : null; }
function context(ctx) {
  const st = hook();
  const items = (ctx && ctx.events) || (st && st.events) || [];
  return {
    now: new Date(),
    phone: !!(ctx && ctx.phone), // the desktop pop-up renders the compact card; the phone sheet the full one
    here: (st && st.userLoc) || null,
    events: items.map((it) => (it && it.data ? it.data : it)).filter(Boolean),
    drawn: window.Drawn || null,
    eventHref: (id) => "?event=" + id,
    cityHref,
    brandHref,
    ...data,
  };
}

function render(item, ctx) {
  if (!item || !item.data) return null;
  const c = context(ctx);
  if (item.kind === "e") return cardHtml(item.data, c);
  if (item.kind === "b") {
    const b = item.data;
    return brandCardHtml({ ...b, handle: b.instagram || b.handle }, c.events.filter((e) => e.source_id === b.id), c);
  }
  if (item.kind === "s") return shopCardHtml(item.data, c);
  return null;
}
function row(item, ctx) {
  if (!item || item.kind !== "e" || !item.data) return null;
  return rowHtml(item.data, context(ctx));
}

window.MatchaCards = Object.assign(window.MatchaCards || {}, { render, row, ready });
wire(document.documentElement);
document.addEventListener("click", (ev) => {
  const a = ev.target && ev.target.closest && ev.target.closest(".mm-card a[data-event], .mm-brand a[data-event]");
  const open = window.MatchaCards && window.MatchaCards.open;
  if (!a || typeof open !== "function" || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
  ev.preventDefault();
  open("e:" + a.getAttribute("data-event"));
});
