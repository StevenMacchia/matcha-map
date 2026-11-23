// The opened storefront card (kind "s" in app.js): name and address, hours today, Directions with the shop's website or
// Instagram and Share, the shop's own menu, then the shop's picture when it has one. ES module, no dependencies,
// no DOM needed (Node runs it in test/shopcard.test.js). Imported by cards-app.js; styles in shopcard.css.
//
//   shopCardHtml(shop, ctx)       -> the card as an HTML string (root .mm-card.mm-shop)
//   menuSectionHtml(menu, ctx)    -> the Menu section alone (the brand card calls it too)
//   hoursTodayHtml(shop, now)     -> "Open now, until 5 pm" / "Closed, opens 7 am", the raw hours when they do not parse, or ""
//   parseHours(str)               -> [7 arrays of [startMin, endMin]] (Sunday first; endMin may pass 1440) or null
//   menuForBrand(brand, menus)    -> the menu in data/menus.json for the brand's website host, or null
//
// ctx (every field optional): { now: Date, base: "" (prefix for site paths), shareHref(shop) -> the link Share copies }.
// Every section renders only when its data exists: no placeholders.
import { esc, safeUrl } from "./cards.js";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_WORD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MENU_LINES = 8;

const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:-]+$/, "") + "…" : s; };
const hostOf = (u) => { const m = /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(u || ""); return m ? m[1].toLowerCase() : ""; };
const I = (d) => `<svg class="mm-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  go: I('<path d="M12 2.8l9.2 9.2-9.2 9.2L2.8 12z"/><path d="M9 13.5v-2a1.5 1.5 0 0 1 1.5-1.5H15M13 7.8 15.2 10 13 12.2"/>'),
  web: I('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>'),
  ig: I('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor"/>'),
  share: I('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v6.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2V12"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  out: I('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
};

// ---- hours -----------------------------------------------------------------------------------------------------
// Only the simple OpenStreetMap forms: "Mo-Fr 07:00-17:00; Sa-Su 08:00-16:00", "Sa, Su 09:00-19:30", "We-Mo ...",
// "12:00-22:30" (every day), "24/7", "Su off", several spans "11:00-14:00,17:00-21:00", a close at or past midnight.
// Anything else (PH, months, weeks, "sunset", "+") returns null and the card shows the string as written.
function minutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m || +m[1] > 48 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
export function parseHours(str) {
  let s = String(str || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s === "24/7") return DAYS.map(() => [[0, 1440]]);
  // a comma after a time starts a new rule; a comma between day names is a list
  s = s.replace(/(\d)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, "$1;").replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, "$1,");
  const week = DAYS.map(() => null);
  let any = false;
  for (const raw of s.split(";")) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const days = [];
    if (m[1]) for (const span of m[1].split(",")) {
      const [a, b] = span.split("-").map((d) => DAYS.indexOf(d));
      for (let d = a, n = 0; n < 7; d = (d + 1) % 7, n++) { days.push(d); if (d === (b == null ? a : b)) break; }
    } else for (let d = 0; d < 7; d++) days.push(d);
    const t = m[2].trim();
    if (/^(off|closed)$/i.test(t)) { days.forEach((d) => { week[d] = []; }); any = true; continue; }
    if (!t) return null;
    const spans = [];
    for (const part of t.split(",")) {
      const ab = part.split("-");
      if (ab.length !== 2) return null;
      const a = minutes(ab[0]); let b = minutes(ab[1]);
      if (a == null || b == null) return null;
      if (b <= a) b += 1440; // closes after midnight ("18:00-02:00", "11:00-00:00")
      spans.push([a, b]);
    }
    days.forEach((d) => { week[d] = spans.slice(); });
    any = true;
  }
  return any ? week.map((d) => d || []) : null;
}
// The shop's own clock. Shops carry a state, not a zone: the zone most of the state keeps.
const ZONE = {
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York", IN: "America/New_York",
  KY: "America/New_York", MA: "America/New_York", MD: "America/New_York", ME: "America/New_York", MI: "America/New_York", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", OH: "America/New_York", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", VA: "America/New_York", VT: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago",
  MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago", ND: "America/Chicago", NE: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};
function localNow(now, state) {
  const zone = ZONE[String(state || "").toUpperCase()];
  if (zone) {
    try {
      const o = {};
      new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now).forEach((p) => { o[p.type] = p.value; });
      const day = DAY_WORD.indexOf(o.weekday);
      if (day >= 0) return { day, min: (+o.hour % 24) * 60 + +o.minute };
    } catch { /* no Intl zones: this machine's clock */ }
  }
  return { day: now.getDay(), min: now.getHours() * 60 + now.getMinutes() };
}
function clockWord(min) {
  min = ((min % 1440) + 1440) % 1440;
  if (min === 0) return "midnight";
  if (min === 720) return "noon";
  const h = Math.floor(min / 60), mi = min % 60;
  return (h % 12 || 12) + (mi ? ":" + String(mi).padStart(2, "0") : "") + (h < 12 ? " am" : " pm");
}
// { open: bool, text } for a parsed week at a local { day, min }.
export function hoursState(week, at) {
  const { day, min } = at;
  const yest = week[(day + 6) % 7].find(([, b]) => b > 1440 && min < b - 1440);
  if (yest) return { open: true, text: "Open now, until " + clockWord(yest[1]) };
  const now = week[day].find(([a, b]) => min >= a && min < b);
  if (now) {
    if (now[1] - now[0] >= 1440) return { open: true, text: "Open 24 hours" };
    return { open: true, text: "Open now, until " + clockWord(now[1]) };
  }
  const later = week[day].filter(([a]) => a > min).sort((x, y) => x[0] - y[0])[0];
  if (later) return { open: false, text: "Closed, opens " + clockWord(later[0]) };
  for (let k = 1; k <= 7; k++) {
    const d = (day + k) % 7, first = week[d].slice().sort((x, y) => x[0] - y[0])[0];
    if (first) return { open: false, text: "Closed, opens " + clockWord(first[0]) + " " + (k === 1 ? "tomorrow" : DAY_WORD[d]) };
  }
  return null;
}
export function hoursTodayHtml(shop, now = new Date()) {
  const raw = shop && typeof shop.opening_hours === "string" ? shop.opening_hours.replace(/\s+/g, " ").trim() : "";
  if (!raw) return "";
  const week = parseHours(raw), st = week && hoursState(week, localNow(now, shop.state));
  if (!st) return `<div class="mm-shop-hours mm-shop-raw">${ICON.clock}<div><p class="mm-shop-hlabel">Hours</p><p class="mm-shop-htext">${esc(cut(raw, 160))}</p></div></div>`;
  return `<div class="mm-shop-hours ${st.open ? "mm-shop-open" : "mm-shop-shut"}">${ICON.clock}<p class="mm-shop-htext">${esc(st.text)}</p></div>`;
}

// ---- menu ------------------------------------------------------------------------------------------------------
function readWord(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "";
}
const goodItem = (x) => x && typeof x.name === "string" && x.name.trim();
export function menuSectionHtml(menu, ctx = {}) {
  if (!menu || !Array.isArray(menu.items)) return "";
  const items = menu.items.filter(goodItem);
  if (!items.length) return "";
  const src = safeUrl(menu.source_url), host = hostOf(src), read = readWord(menu.read);
  const shown = items.slice(0, MENU_LINES);
  const lines = shown.map((x) => {
    const price = typeof x.price === "string" && x.price.trim() ? `<span class="mm-menu-price">${esc(cut(x.price, 40))}</span>` : "";
    const note = typeof x.note === "string" && x.note.trim() ? `<span class="mm-menu-desc">${esc(cut(x.note, 110))}</span>` : "";
    return `<li class="mm-menu-item"><span class="mm-menu-name">${esc(cut(x.name, 70))}</span>${price}${note}</li>`;
  }).join("");
  const label = items.length > shown.length ? `First ${shown.length} of ${items.length} menu items` : "Menu items";
  const count = items.length > shown.length ? `<span class="mm-menu-count">${items.length} items</span>` : "";
  const more = src ? `<a class="mm-menu-full" href="${esc(src)}" target="_blank" rel="noopener"><span>See the full menu</span>${ICON.out}</a>` : "";
  const owner = menu.kind === "owner";
  const credit = owner ? `<p class="mm-menu-credit">From the owner${host ? ", menu at " + esc(host) : ""}${read ? ", sent " + esc(read) : ""}</p>`
    : host ? `<p class="mm-menu-credit">From ${esc(host)}${read ? ", read " + esc(read) : ""}</p>` : "";
  const noteText = typeof menu.note === "string" && menu.note.trim() && !(owner && /^from the owner$/i.test(menu.note.trim())) ? menu.note : "";
  return `<section class="mm-sec mm-menu-sec" aria-label="Menu"><div class="mm-menu-top"><h4 class="mm-h">Menu</h4>${count}</div>` +
    (noteText ? `<p class="mm-menu-note">${esc(cut(noteText, 160))}</p>` : "") +
    `<ul class="mm-menu-list" tabindex="0" aria-label="${esc(label)}">${lines}</ul>` +
    (more || credit ? `<div class="mm-menu-foot">${more}${credit}</div>` : "") + `</section>`;
}
// An owner's menu (sent through the claim form, approved on the review page, served by GET /api/menus) for a shop id or
// a brand handle: from ctx.ownerMenus ({ get(key) }) in tests, else window.MatchaOwnerMenus (site/ownermenus.js) in the app.
export function ownerMenuFor(key, ctx) {
  if (!key) return null;
  const src = (ctx && ctx.ownerMenus) || (typeof window !== "undefined" ? window.MatchaOwnerMenus : null);
  if (!src || typeof src.get !== "function") return null;
  let m = null;
  try { m = src.get(String(key)); } catch (e) { m = null; }
  return m && Array.isArray(m.items) && m.items.length ? { ...m, kind: "owner" } : null;
}
// A brand's menu from data/menus.json ({ menus: { "<host without www>": menu } }), matched on the brand's website.
export function menuForBrand(brand, menus) {
  const host = hostOf(safeUrl(brand && brand.website));
  const map = menus && menus.menus ? menus.menus : menus;
  if (!host || !map || typeof map !== "object") return null;
  const m = Object.prototype.hasOwnProperty.call(map, host) ? map[host] : null;
  return m && Array.isArray(m.items) && m.items.length ? m : null;
}

// ---- card ------------------------------------------------------------------------------------------------------
// Street, then "City, ST". Ten shops have no city on record: the nearest listed city to the pin stands in (within 25 miles,
// same state), from ctx.cityList or window.CITY_LIST (rows [name, ST, lat, lng, population]).
function nearestCity(s, ctx) {
  const list = (ctx && ctx.cityList) || (typeof window !== "undefined" && window.CITY_LIST) || null;
  if (!Array.isArray(list) || !isFinite(s.lat) || !isFinite(s.lng)) return "";
  const k = Math.cos(s.lat * Math.PI / 180);
  let best = null, bd = Infinity;
  for (const c of list) {
    if (!c || (s.state && c[1] !== s.state)) continue;
    const d = Math.hypot(c[2] - s.lat, (c[3] - s.lng) * k);
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd * 69 <= 25 ? best[0] : "";
}
export function addressLine(s, ctx) {
  const city = s.city || nearestCity(s, ctx);
  const tail = [city, s.state].filter(Boolean).join(", ");
  return [s.address, tail].filter(Boolean).join(", ");
}
// A picture the shop's record carries (the same { local, url, credit } shape events use). None do today.
function photoHtml(s, ctx) {
  const im = s.image || {};
  const src = im.local && /^img\/[A-Za-z0-9._/-]+$/.test(im.local) ? (ctx.base || "") + im.local : safeUrl(im.url);
  if (!src) return "";
  const credit = im.credit ? `<span class="mm-shop-credit">${esc(cut(im.credit, 40))}</span>` : "";
  return `<div class="mm-shop-photo"><img src="${esc(src)}" alt="${esc("Photo of " + s.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${credit}</div>`;
}
const isNum = (x) => typeof x === "number" && isFinite(x);
export function shopCardHtml(s, ctx = {}) {
  if (!s || !s.name) return "";
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const name = String(s.name), addr = addressLine(s, ctx);
  const head = `<div class="mm-shop-head"><span class="mm-shop-art" data-char="s-shop" aria-hidden="true"></span><div class="mm-shop-id">` +
    `<h3 class="mm-shop-name">${esc(cut(name, 80))}</h3><p class="mm-shop-kind">Matcha shop</p></div></div>` +
    (addr ? `<p class="mm-shop-addr">${esc(cut(addr, 140))}</p>` : "");
  const acts = [];
  if (isNum(s.lat) && isNum(s.lng)) acts.push(`<a class="mm-shop-go" href="https://www.google.com/maps/dir/?api=1&amp;destination=${s.lat},${s.lng}" target="_blank" rel="noopener">${ICON.go}<span>Directions</span></a>`);
  const web = safeUrl(s.website), ig = typeof s.instagram === "string" ? s.instagram.replace(/^@/, "").trim() : "";
  if (web) acts.push(`<a class="mm-shop-pill" href="${esc(web)}" target="_blank" rel="noopener" aria-label="Website">${ICON.web}<span>Website</span></a>`);
  else if (/^[A-Za-z0-9._]{1,30}$/.test(ig)) acts.push(`<a class="mm-shop-pill" href="https://www.instagram.com/${encodeURIComponent(ig)}/" target="_blank" rel="noopener" aria-label="Instagram">${ICON.ig}<span>Instagram</span></a>`);
  const share = typeof ctx.shareHref === "function" ? ctx.shareHref(s) : (ctx.base || "") + "?shop=" + encodeURIComponent(String(s.id || ""));
  if (s.id) acts.push(`<a class="mm-shop-pill mm-shop-share" href="${esc(share)}" data-mm-share data-title="${esc(name + ", matcha shop")}" aria-label="Share">${ICON.share}<span>Share</span></a>`);
  const credit = s.source === "osm" && safeUrl(s.osm_url) ? `<p class="mm-shop-data">Shop details: <a href="${esc(s.osm_url)}" target="_blank" rel="noopener">OpenStreetMap</a></p>` : "";
  // Directions sits right under the hours: the phone sheet opens at half height with the rest a drag away, and a
  // 66-line menu above it would push it out of that first view.
  return `<article class="mm-card mm-shop" aria-label="${esc(name)}">${head}${hoursTodayHtml(s, now)}` +
    (acts.length ? `<div class="mm-shop-acts">${acts.join("")}</div>` : "") + `${menuSectionHtml(s.menu || ownerMenuFor(s.id, ctx), ctx)}${photoHtml(s, ctx)}${credit}</article>`;
}
