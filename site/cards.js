// Rich cards for Matcha Map: one module renders the pop-up card (sheet or popup), the compact list row, the brand
// card and the same card as a string for the static /e/<id>/ pages. ES module, no dependencies, no DOM needed for the
// string forms (Node runs cardHtml in tools/gen-event-pages.js and test/cards.test.js).
//
//   cardHtml(event, ctx)               -> HTML string, the full card (top to bottom: verdict, hero, brand, drinks, facts,
//                                         place and actions, source posts, brand story, also nearby, report link)
//   renderCard(event, ctx)             -> HTMLElement (cardHtml + wired share button and image fallbacks)
//   rowHtml / renderRow(event, ctx)    -> the compact list row (a <button data-key="e:<id>">, or <a> with ctx.rowTag "a")
//   brandCardHtml / renderBrandCard(brand, events, ctx)
//   wire(root, ctx)                    -> attach share and image-error handlers to markup made by the string forms
//   verdict(event, ctx)                -> { kind, day, time, where, text }: "Today 1pm to 5pm, 1.2 mi", "Sat Dec 6, Brooklyn"
//   drinkArt(item, art)                -> art/drinks/<slug>.svg path for a menu item, by slug or catalogue alias, or ""
//   alsoNearby(event, ctx)             -> up to three other upcoming events within 10 km, soonest first
//
// ctx (every field optional): { now: Date, here: {lat,lng} | [lat,lng] | null, brands (brands.json: {brands:[]}, an array
// or a map by handle), sources (sources.json array or map by id), places (places.json), art (site/art/index.json),
// events (all events, for also-nearby), cityOf(e) -> string, distanceKm(a,b) with a,b = [lat,lng], base ("" in the app,
// "/" on static pages: prefix for site paths), eventHref(id) (default "?event=<id>", "/e/<id>/" on static pages),
// absolute: true (dates, never "Today", for pages built ahead), drawn (window.Drawn, for the drawn hero when there is no photo or event art), page: true (two-column page layout on wide
// screens), document (for render* outside a browser), fmt: { miles(mi) -> string } }
//
// Dates are venue-local ISO strings with an offset; day and time are read from the string, never converted.

const KIND = { popup: "pop-up", cafe: "cafe", organizer: "class", festival: "festival", venue: "host", "tea-brand": "tea brand" };
export const CONFIDENCE = {
  confirmed: ["Confirmed", "Date, time and address come straight from the host."],
  likely: ["Likely", "The date is posted. A detail or two is missing or read between the lines."],
  unsure: ["Unsure", "We could not confirm every detail. Check the post before you go."],
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NEAR_KM = 10, FAR_KM = 160, ID_RE = /^[a-z0-9]{6,32}$/i;

// ---- small helpers -------------------------------------------------------------------------------------------
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]);
}
// Only http(s) links ever reach an href or src.
export function safeUrl(u) { return typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : ""; }
const safeId = (id) => (typeof id === "string" && ID_RE.test(id) ? id : "");
const pad = (n) => (n < 10 ? "0" : "") + n;
export function slugify(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
function titleCase(s) { return String(s).replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function hash(s) { let h = 5381; s = String(s || ""); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
function cut(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:-]+$/, "") + "…" : s; }
function domainOf(u) { const m = /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(u || ""); return m ? m[1].toLowerCase() : ""; }
const join = (a, sep = " · ") => a.filter(Boolean).join(sep);

// ---- time ----------------------------------------------------------------------------------------------------
export function parts(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?\s*(Z|[+-]\d\d:?\d\d)?)?/.exec(String(iso || ""));
  if (!m) return null;
  let off = null;
  if (m[6]) off = m[6] === "Z" ? 0 : (m[6][0] === "-" ? -1 : 1) * (+m[6].slice(1, 3) * 60 + +m[6].slice(-2));
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, timed: !!m[4], off, key: `${m[1]}-${m[2]}-${m[3]}` };
}
const dayNum = (p) => Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 864e5);
// Today's date where the event is: from the offset in its start string, else its IANA zone, else this machine's clock.
function todayAt(e, now, s) {
  if (s && s.off != null) { const t = new Date(now.getTime() + s.off * 60000); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  if (e.tz) {
    try {
      const o = {};
      new Intl.DateTimeFormat("en-US", { timeZone: e.tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now).forEach((x) => { o[x.type] = x.value; });
      return { y: +o.year, mo: +o.month, d: +o.day };
    } catch { /* unknown zone: fall through */ }
  }
  return { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() };
}
export function clock(p) { const h = p.h % 12 || 12; return h + (p.mi ? ":" + pad(p.mi) : "") + (p.h < 12 ? "am" : "pm"); }
export function timeRange(e) {
  const s = parts(e.start);
  if (!s || e.all_day || !s.timed) return "";
  const en = parts(e.end);
  if (en && en.timed && en.key === s.key && (en.h * 60 + en.mi) > (s.h * 60 + s.mi)) return `${clock(s)} to ${clock(en)}`;
  return `from ${clock(s)}`;
}
function endMs(e) {
  const st = Date.parse(e.start), en = e.end ? Date.parse(e.end) : NaN;
  return !isNaN(en) && en > st ? en : st + (e.all_day ? 864e5 : 3 * 36e5);
}
export function dateLabel(s) { return `${DAYS[new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay()]} ${MONTHS[s.mo - 1]} ${s.d}`; }
// The day word: now, today, tomorrow, this weekend, a weekday this week, a date, or past. absolute: always the date
// (static pages are built once and read for days, so "Today" would go stale).
export function dayWord(e, now = new Date(), absolute = false) {
  const s = parts(e.start);
  if (!s) return { kind: "unknown", word: "Date to come" };
  const t = now.getTime(), st = Date.parse(e.start), en = endMs(e);
  if (e.status === "cancelled") return { kind: "cancelled", word: "Cancelled, " + dateLabel(s) };
  if (!isNaN(st) && en < t) return { kind: "past", word: "Was " + dateLabel(s) };
  if (absolute) return { kind: "date", word: dateLabel(s) };
  if (!isNaN(st) && st <= t && !e.all_day) return { kind: "now", word: "Open now" };
  const dd = dayNum(s) - dayNum(todayAt(e, now, s));
  if (dd <= 0) return { kind: "today", word: "Today" };
  if (dd === 1) return { kind: "tomorrow", word: "Tomorrow" };
  const wd = new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay();
  if (dd <= 6 && (wd === 0 || wd === 6)) return { kind: "weekend", word: "This " + DAYS_LONG[wd] };
  if (dd <= 6) return { kind: "week", word: DAYS_LONG[wd] };
  return { kind: "date", word: dateLabel(s) };
}

// ---- place and distance --------------------------------------------------------------------------------------
export function isApprox(e) { return e.approx === true || (e.geocode_source === "none" && !e.address); }
const hasLL = (e) => typeof e.lat === "number" && typeof e.lng === "number" && isFinite(e.lat) && isFinite(e.lng);
function hereLL(h) {
  if (!h) return null;
  if (Array.isArray(h)) return h.length >= 2 && isFinite(h[0]) && isFinite(h[1]) ? [+h[0], +h[1]] : null;
  return isFinite(h.lat) && isFinite(h.lng) && h.lat != null && h.lng != null ? [+h.lat, +h.lng] : null;
}
export function haversineKm(a, b) {
  const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const kmOf = (ctx, a, b) => (typeof ctx.distanceKm === "function" ? ctx.distanceKm(a, b) : haversineKm(a, b));
function milesText(km, ctx) {
  const mi = km * 0.621371;
  if (ctx.fmt && typeof ctx.fmt.miles === "function") return ctx.fmt.miles(mi);
  return (mi < 0.1 ? "0.1" : mi < 10 ? String(Math.round(mi * 10) / 10) : String(Math.round(mi))) + " mi";
}
function cityOf(e, ctx) { return (typeof ctx.cityOf === "function" && ctx.cityOf(e)) || e.city || ""; }
const cityState = (e) => join([e.city, e.state], ", ");
function distanceText(e, ctx) {
  const h = hereLL(ctx.here);
  if (!h || !hasLL(e)) return "";
  const km = kmOf(ctx, h, [e.lat, e.lng]);
  if (!(km <= FAR_KM)) return ""; // far away: the city says more than "1371 mi"
  const t = milesText(km, ctx);
  return isApprox(e) ? "about " + t : t;
}

// The first line of every card and row.
export function verdict(e, ctx = {}) {
  const now = ctx.now || new Date(), dw = dayWord(e, now, !!ctx.absolute);
  let time = "";
  if (dw.kind === "now") { const en = parts(e.end); time = en && en.timed && e.end && Date.parse(e.end) > now.getTime() ? "until " + clock(en) : ""; }
  else if (dw.kind !== "cancelled") time = timeRange(e) || (e.all_day && e.hours ? cut(e.hours, 24) : "");
  const where = distanceText(e, ctx) || cityOf(e, ctx);
  const head = join([dw.word, time], " ");
  return { kind: dw.kind, day: dw.word, time, where, text: join([head, where], ", ") };
}

// ---- data lookups --------------------------------------------------------------------------------------------
const mapCache = new WeakMap();
function byKey(src, key, field) {
  if (!src || typeof src !== "object") return null;
  let m = mapCache.get(src);
  if (!m) {
    m = new Map();
    const list = Array.isArray(src) ? src : Array.isArray(src.brands) ? src.brands : Array.isArray(src.places) ? src.places : Array.isArray(src.sources) ? src.sources : null;
    if (list) list.forEach((r) => { if (r && r[field] != null) m.set(String(r[field]).toLowerCase(), r); });
    else Object.keys(src).forEach((k) => { if (src[k] && typeof src[k] === "object") m.set(k.toLowerCase(), src[k]); });
    mapCache.set(src, m);
  }
  return key ? m.get(String(key).toLowerCase()) || null : null;
}
const sourceOf = (e, ctx) => byKey(ctx.sources, e.source_id, "id");
export function handleOf(e, ctx = {}) {
  let h = e.handle || "";
  if (!h) { const m = /instagram\.com\/([A-Za-z0-9._]+)/.exec((e.links && e.links.instagram) || ""); if (m) h = m[1]; }
  if (!h) { const s = sourceOf(e, ctx); if (s && s.instagram) h = s.instagram; }
  return String(h).replace(/^@/, "").toLowerCase();
}
const brandOf = (e, ctx) => byKey(ctx.brands, handleOf(e, ctx), "handle");

// Drink art for a menu item: its slug, a catalogue alias, then the "<item> matcha" / "<item> latte" drinks.
const aliasCache = new WeakMap();
function aliases(art) {
  let m = aliasCache.get(art);
  if (m) return m;
  m = new Map();
  const add = (list) => (Array.isArray(list) ? list : []).forEach((c) => {
    if (!c || !c.slug) return;
    [c.name, ...(c.aliases || [])].forEach((a) => { const k = slugify(a); if (k && !m.has(k)) m.set(k, c.slug); });
  });
  add(art.catalog);
  if (art.families && typeof art.families === "object") Object.values(art.families).forEach(add);
  Object.keys(art.drinks || {}).forEach((slug) => { const t = art.drinks[slug] && art.drinks[slug].text; if (t && !m.has(slugify(t))) m.set(slugify(t), slug); });
  aliasCache.set(art, m);
  return m;
}
export function drinkSlug(item, art) {
  if (!art || !art.drinks) return "";
  const d = art.drinks, s = slugify(item);
  if (!s) return "";
  const ok = (k) => (k && d[k] && d[k].file ? k : "");
  return ok(s) || ok(aliases(art).get(s)) || ok(s + "-matcha") || ok(s + "-latte") || ok("matcha-" + s) || ok(s.replace(/s$/, "")) || "";
}
export function drinkArt(item, art, base = "") {
  const slug = drinkSlug(item, art);
  return slug ? base + "art/" + String(art.drinks[slug].file).replace(/^\/+/, "") : "";
}
function eventArt(e, ctx) {
  const a = ctx.art && ctx.art.events && safeId(e.id) && ctx.art.events[e.id];
  return a && a.file ? (ctx.base || "") + "art/" + String(a.file).replace(/^\/+/, "") : "";
}
function photoOf(e, ctx) {
  const im = e.image || {};
  if (im.local && /^img\/[A-Za-z0-9._/-]+$/.test(im.local)) return { src: (ctx.base || "") + im.local, remote: safeUrl(im.url) };
  const u = safeUrl(im.url) || safeUrl(e.image_url);
  return u ? { src: u, remote: "" } : null;
}

// ---- icons (inline, currentColor) ----------------------------------------------------------------------------
const I = (d, extra = "") => `<svg class="mm-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extra}>${d}</svg>`;
const ICON = {
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  tag: I('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.6"/>'),
  wallet: I('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>'),
  pin: I('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  go: I('<path d="M12 2.8l9.2 9.2-9.2 9.2L2.8 12z"/><path d="M9 13.5v-2a1.5 1.5 0 0 1 1.5-1.5H15M13 7.8 15.2 10 13 12.2"/>'),
  map: I('<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>'),
  cal: I('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13.5v4M10 15.5h4"/>'),
  share: I('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v6.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2V12"/>'),
  going: I('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5 11 15l4.5-5.5"/>'),
  invite: I('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M17.5 8v6M14.5 11h6"/>'),
  flag: I('<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>'),
  ig: I('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor"/>'),
  tt: I('<path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8"/><path d="M14 3.5a5 5 0 0 0 5 4.6"/>'),
  eb: I('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5h7a3.5 3.5 0 1 0-1 2.6"/>'),
  link: I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>'),
  web: I('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>'),
  heart: I('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
};
// A small cup for menu items with no drawing yet.
const CUP = (tint) => `<svg class="mm-cup" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M10 13h20l-2.2 19a3 3 0 0 1-3 2.6h-9.6a3 3 0 0 1-3-2.6z" fill="#FFFDF7" stroke="#4B3426" stroke-width="2.4" stroke-linejoin="round"/><path d="M11.2 20h17.6l-1.2 11.6a2.4 2.4 0 0 1-2.4 2.1h-10.4a2.4 2.4 0 0 1-2.4-2.1z" fill="${tint}"/><path d="M8.5 13h23" stroke="#4B3426" stroke-width="2.6" stroke-linecap="round"/><path d="M23 13l3-8" stroke="#F6B7C7" stroke-width="3" stroke-linecap="round"/><circle cx="17" cy="26" r="1.1" fill="#4B3426"/><circle cx="23" cy="26" r="1.1" fill="#4B3426"/><path d="M18.6 28.4q1.4 1.2 2.8 0" fill="none" stroke="#4B3426" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const TINTS = ["#9CCB7E", "#F4A9BD", "#F6C49A"];

function postKind(u) {
  const d = domainOf(u);
  if (/(^|\.)instagram\.com$/.test(d)) return ["ig", /\/(reel|reels)\//.test(u) ? "Instagram reel" : "Instagram post"];
  if (/(^|\.)tiktok\.com$/.test(d)) return ["tt", "TikTok"];
  if (/(^|\.)eventbrite\./.test(d)) return ["eb", "Eventbrite"];
  if (/(^|\.)(lu\.ma|luma\.com)$/.test(d)) return ["link", "Luma"];
  if (/(^|\.)meetup\.com$/.test(d)) return ["link", "Meetup"];
  return ["link", d || "Event page"];
}

// ---- sections ------------------------------------------------------------------------------------------------
function confBadge(c) {
  const k = CONFIDENCE[c] ? c : "unsure", [word, tip] = CONFIDENCE[k];
  return `<span class="mm-conf mm-conf-${k}" title="${esc(tip)}" aria-label="${esc(word + ": " + tip)}" tabindex="0" role="note">${esc(word)}</span>`;
}
function drinkThumb(item, i, ctx, cls = "mm-chip-art") {
  const src = drinkArt(item, ctx.art, ctx.base || "");
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" width="40" height="48" loading="lazy" decoding="async">` : CUP(TINTS[(hash(item) + i) % 3]);
}
function heroHtml(e, ctx, v, name) {
  const art = eventArt(e, ctx), photo = photoOf(e, ctx);
  let under = "";
  if (art) under = `<img class="mm-hero-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">`;
  else if (ctx.drawn && typeof ctx.drawn.card === "function") {
    let svg = "";
    try { svg = ctx.drawn.card(e, { mode: "card", when: v.day }); } catch { svg = ""; }
    if (svg) under = `<div class="mm-hero-drawn">${svg}</div>`;
  }
  if (!under) {
    const menu = (Array.isArray(e.menu) ? e.menu : []).slice(0, 3), items = menu.length ? menu : ["matcha latte"];
    under = `<div class="mm-hero-collage mm-t${hash(e.brand || e.id) % 3}"><span class="mm-cups">${items.map((m, i) => `<span class="mm-cupbox">${drinkThumb(m, i, ctx, "mm-cup-art")}</span>`).join("")}</span><span class="mm-sticker">${esc(cut(name, 28))}</span></div>`;
  }
  if (!photo) return `<div class="mm-hero mm-hero-${art ? "art" : "drawn"}" role="img" aria-label="${esc("Drawing for " + name)}">${under}</div>`;
  const remote = photo.remote ? ` data-remote="${esc(photo.remote)}"` : "";
  const credit = e.image && e.image.credit ? `<span class="mm-credit">${esc(cut(e.image.credit, 40))}</span>` : "";
  return `<div class="mm-hero mm-hero-photo" role="img" aria-label="${esc("Photo from " + name + "'s post")}">${under}` +
    `<img class="mm-hero-blur" src="${esc(photo.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"${remote}>` +
    `<img class="mm-hero-img" src="${esc(photo.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"${remote}>${credit}</div>`;
}
function avatarHtml(name, pic, cls = "mm-avatar") {
  const ch = (String(name || "M").match(/[A-Za-z0-9]/) || ["M"])[0].toUpperCase();
  return `<span class="${cls} mm-t${hash(name) % 3}" aria-hidden="true"><span class="mm-initial">${esc(ch)}</span>${pic ? `<img src="${esc(pic)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
}
function brandRow(e, ctx, name, b) {
  const h = handleOf(e, ctx), kind = KIND[e.kind] || "";
  const meta = join([h ? `<a href="https://www.instagram.com/${encodeURIComponent(h)}/" target="_blank" rel="noopener">@${esc(h)}</a>` : "", kind ? `<span class="mm-kind">${esc(kind)}</span>` : ""]);
  return `<div class="mm-brandrow">${avatarHtml(name, b && safeUrl(b.picture))}<div class="mm-btxt"><h3 class="mm-bname">${esc(name)}</h3>${meta ? `<p class="mm-bmeta">${meta}</p>` : ""}</div>${confBadge(e.confidence)}</div>`;
}
function chipsHtml(e, ctx) {
  const menu = (Array.isArray(e.menu) ? e.menu : []).filter((m) => typeof m === "string" && m.trim()).slice(0, 8);
  if (!menu.length) return "";
  return `<section class="mm-sec mm-menu" aria-label="On the menu"><h4 class="mm-h">On the menu</h4><ul class="mm-chips">${menu.map((m, i) =>
    `<li class="mm-chip mm-t${(hash(m) + i) % 3}">${drinkThumb(m, i, ctx)}<span>${esc(titleCase(cut(m, 40)))}</span></li>`).join("")}</ul></section>`;
}
function factsHtml(e) {
  // an all-day flag alone gets no box: the verdict already carries the day, and most such flags are ingest fallbacks
  const hours = (e.hours && cut(e.hours, 48)) || timeRange(e).replace(/^from /, "From ");
  const f = [];
  if (hours) f.push(["clock", "Hours", hours]);
  if (e.price) f.push(["tag", "Price", cut(e.price, 32)]);
  if (e.pay) f.push(["wallet", "Pay with", cut(e.pay, 48)]);
  if (!f.length) return "";
  return `<dl class="mm-facts">${f.map(([i, k, v]) => `<div class="mm-fact">${ICON[i]}<dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}
function mapsSearch(e) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(join([e.venue, e.address, e.city, e.state], ", ")); }
function placeHtml(e, ctx, name) {
  const approx = isApprox(e), city = cityState(e), base = ctx.base || "", id = safeId(e.id);
  let lines;
  if (approx) lines = `<p class="mm-pname">${esc(e.venue && !/^(tbd|tba)$/i.test(e.venue) ? e.venue : "Near " + (cityOf(e, ctx) || "town"))}</p><p class="mm-paddr">${esc(city)}</p><p class="mm-approx">Exact spot not posted yet. The pin sits near the middle of ${esc(cityOf(e, ctx) || "town")}.</p>`;
  else lines = `<p class="mm-pname">${esc(e.venue || e.address || city || "Place to come")}</p>${e.venue && e.address ? `<p class="mm-paddr">${esc(e.address)}</p>` : ""}${city && (e.venue || e.address) ? `<p class="mm-paddr">${esc(join([e.city, join([e.state, e.zip], " ")], ", "))}</p>` : ""}`;
  const acts = [];
  if (!approx && hasLL(e)) acts.push(`<a class="mm-act mm-act-go" href="https://www.google.com/maps/dir/?api=1&amp;destination=${e.lat},${e.lng}" target="_blank" rel="noopener">${ICON.go}<span>Directions</span></a>`);
  if (e.venue || e.address || e.city) acts.push(`<a class="mm-act" href="${esc(mapsSearch(e))}" target="_blank" rel="noopener">${ICON.map}<span>Map</span></a>`);
  const live = !/^(past|cancelled)$/.test(dayWord(e, ctx.now || new Date()).kind);
  if (id && live) acts.push(`<a class="mm-act" href="${esc(base)}feeds/events/${id}.ics">${ICON.cal}<span>Calendar</span></a>`);
  if (id) acts.push(`<a class="mm-act" href="${esc(base)}e/${id}/" data-mm-share data-title="${esc(name + " matcha pop-up")}">${ICON.share}<span>Share</span></a>`);
  return `<section class="mm-sec mm-place"><div class="mm-pwrap">${ICON.pin}<div>${lines}</div></div>${acts.length ? `<div class="mm-acts">${acts.join("")}</div>` : ""}</section>`;
}
function postsHtml(e, ctx, b) {
  const P = e.posts || {}, seen = new Set(), list = [];
  const photo = photoOf(e, ctx), recent = new Map(((b && b.recent) || []).filter((r) => safeUrl(r.permalink) && safeUrl(r.image_url)).map((r) => [r.permalink, r.image_url]));
  [P.instagram, P.tiktok, P.other, e.source_url, ...(Array.isArray(e.evidence) ? e.evidence : [])].forEach((u) => {
    u = safeUrl(u);
    const k = u.replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (u && !seen.has(k)) { seen.add(k); list.push(u); }
  });
  if (!list.length) return "";
  const firstSocial = list.find((u) => /instagram\.com|tiktok\.com/.test(u));
  return `<section class="mm-sec mm-posts"><h4 class="mm-h">Where we saw it</h4><ul class="mm-plist">${list.slice(0, ctx.compact ? 2 : 4).map((u) => {
    const [ic, label] = postKind(u), th = recent.get(u) || (u === firstSocial && photo ? photo.src : "");
    return `<li><a class="mm-post mm-post-${ic}" href="${esc(u)}" target="_blank" rel="noopener">${th ? `<span class="mm-pthumb"><img src="${esc(th)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>` : ""}<span class="mm-picon">${ICON[ic]}</span><span>${esc(label)}</span></a></li>`;
  }).join("")}</ul></section>`;
}
function followers(n) {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return "";
  return n >= 1e6 ? Math.round(n / 1e5) / 10 + "M followers" : n >= 1000 ? Math.round(n / 100) / 10 + "k followers" : n + " followers";
}
function storyHtml(e, ctx, name, b) {
  const s = sourceOf(e, ctx) || {}, L = e.links || {};
  const text = cut((b && b.bio) || s.about || s.bio || "", ctx.compact ? 140 : 240);
  const home = join([(b && b.home_city) || s.home_city, (b && b.home_state) || s.home_state], ", ");
  const meta = join([home ? "Based in " + home : "", followers(b && b.followers)]);
  const links = [];
  const web = safeUrl((b && b.website) || L.website || s.website), h = handleOf(e, ctx), tt = safeUrl(L.tiktok) || (s.tiktok ? "https://www.tiktok.com/@" + encodeURIComponent(String(s.tiktok).replace(/^@/, "")) : "");
  if (h) links.push(`<a href="https://www.instagram.com/${encodeURIComponent(h)}/" target="_blank" rel="noopener">${ICON.ig}<span>Instagram</span></a>`);
  if (tt) links.push(`<a href="${esc(tt)}" target="_blank" rel="noopener">${ICON.tt}<span>TikTok</span></a>`);
  if (web) links.push(`<a href="${esc(web)}" target="_blank" rel="noopener">${ICON.web}<span>${esc(domainOf(web))}</span></a>`);
  if (!text && !meta && !links.length) return "";
  return `<section class="mm-sec mm-story"><h4 class="mm-h">About ${esc(cut(name, 40))}</h4>${text ? `<p class="mm-bio">${esc(text)}</p>` : ""}${meta ? `<p class="mm-smeta">${esc(meta)}</p>` : ""}${links.length ? `<p class="mm-slinks">${links.join("")}</p>` : ""}</section>`;
}
export function alsoNearby(e, ctx = {}) {
  if (!hasLL(e) || !Array.isArray(ctx.events)) return [];
  const now = ctx.now || new Date();
  return ctx.events.filter((o) => o && o !== e && o.id !== e.id && hasLL(o) && o.status !== "cancelled" && !/^(past|cancelled)$/.test(dayWord(o, now).kind))
    .map((o) => ({ o, km: kmOf(ctx, [e.lat, e.lng], [o.lat, o.lng]) }))
    .filter((x) => x.km <= NEAR_KM)
    .sort((a, b) => (a.o.start < b.o.start ? -1 : a.o.start > b.o.start ? 1 : a.km - b.km))
    .slice(0, 3).map((x) => x.o);
}
function nearbyHtml(e, ctx) {
  const near = alsoNearby(e, ctx).slice(0, ctx.compact ? 2 : 3);
  if (!near.length) return "";
  return `<section class="mm-sec mm-nearby"><h4 class="mm-h">Also nearby</h4><ul class="mm-nlist">${near.map((o) => `<li>${rowHtml(o, { ...ctx, rowTag: "a", mini: true })}</li>`).join("")}</ul></section>`;
}
const nameOf = (e, b) => cut(e.brand || (b && b.name) || "Matcha pop-up", 60);

// The going strip (social wave, S1 and S2): "I'm going" with the live count, and "Invite a friend". Rendered hidden;
// site/rsvp.js shows it once the API answers, so a page without the API has no half-working button. Not on static
// pages (their CSP has no connect-src) and not on past or cancelled pop-ups.
function goHtml(e, ctx, v, name, live) {
  const id = safeId(e.id);
  if (!id || !live || ctx.page) return "";
  const where = e.venue && !/^(tbd|tba)$/i.test(e.venue) ? e.venue : cityOf(e, ctx);
  const text = cut(join([name, join([v.day, v.time], " "), where], ", "), 160) + ". Come with me:";
  return `<div class="mm-go" data-mm-go="${id}" hidden><button type="button" class="mm-going" data-mm-going="${id}" aria-pressed="false">${ICON.going}<span>I'm going</span></button><span class="mm-gcount" aria-live="polite"></span>` +
    `<a class="mm-invite" href="${esc(ctx.base || "")}?event=${id}&amp;via=friend" data-mm-share data-title="${esc(name + " matcha pop-up")}" data-text="${esc(text)}">${ICON.invite}<span>Invite a friend</span></a></div>`;
}

// ---- the card ------------------------------------------------------------------------------------------------
export function cardHtml(e, ctx = {}) {
  e = e || {};
  // The desktop map's pop-up (ctx.phone false, not a page) is the compact card: on a tall window the full card ran past
  // the screen and the map panned itself to the Arctic to make room (Steven, 2026-11-23). Same frames, less of each.
  const compact = ctx.compact === true || (!ctx.page && ctx.phone === false);
  ctx = { ...ctx, compact };
  const v = verdict(e, ctx), b = brandOf(e, ctx), name = nameOf(e, b), id = safeId(e.id);
  const plain = String(e.description || "").replace(/[*_`#>]+/g, " ").replace(/\s+/g, " ").trim();
  const desc = plain ? `<p class="mm-desc">${esc(cut(plain, 200))}</p>` : "";
  const report = id ? `<a class="mm-report" href="${esc(ctx.base || "")}report/?event=${id}">${ICON.flag}<span>Report a problem</span></a>` : "";
  const live = !/^(past|cancelled)$/.test(dayWord(e, ctx.now || new Date()).kind);
  return `<article class="mm-card${ctx.page ? " mm-page" : ""}${compact ? " mm-compact" : ""} mm-v-${v.kind}"${id ? ` data-id="${id}"` : ""}>` +
    `<header class="mm-top"><p class="mm-verdict"><span class="mm-vday">${esc(v.day)}</span>${v.time ? ` <span class="mm-vtime">${esc(v.time)}</span>` : ""}${v.where ? `<span class="mm-vwhere">${esc(v.where)}</span>` : ""}</p></header>` +
    `<div class="mm-media">${heroHtml(e, ctx, v, name)}</div>` +
    `<div class="mm-main">${brandRow(e, ctx, name, b)}${goHtml(e, ctx, v, name, live)}${desc}${chipsHtml(e, ctx)}${factsHtml(e)}${placeHtml(e, ctx, name)}</div>` +
    `<div class="mm-more">${postsHtml(e, ctx, b)}${storyHtml(e, ctx, name, b)}${nearbyHtml(e, ctx)}${report}</div>` +
    `</article>`;
}

// ---- the list row --------------------------------------------------------------------------------------------
function thumbHtml(e, ctx, name) {
  const photo = photoOf(e, ctx), art = eventArt(e, ctx);
  const under = art ? `<img class="mm-th-art" src="${esc(art)}" alt="" loading="lazy" decoding="async">` : `<span class="mm-th-cup mm-t${hash(e.brand || e.id) % 3}">${drinkThumb((e.menu && e.menu[0]) || "matcha latte", 0, ctx, "mm-cup-art")}</span>`;
  const img = photo ? `<img class="mm-th-img" src="${esc(photo.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"${photo.remote ? ` data-remote="${esc(photo.remote)}"` : ""}>` : "";
  return `<span class="mm-th" aria-hidden="true">${under}${img}</span>`;
}
export function rowHtml(e, ctx = {}) {
  e = e || {};
  const id = safeId(e.id), b = brandOf(e, ctx), name = nameOf(e, b), v = verdict(e, { ...ctx, here: null });
  const dist = distanceText(e, ctx), approx = isApprox(e);
  const place = approx ? "Near " + (cityOf(e, ctx) || "town") : join([e.venue, cityOf(e, ctx)]);
  const menu = (Array.isArray(e.menu) ? e.menu : []).slice(0, 3);
  const kind = KIND[e.kind] && e.kind !== "popup" ? `<span class="mm-kind">${esc(KIND[e.kind])}</span>` : "";
  const conf = e.confidence === "confirmed" ? `<span class="mm-dot mm-conf-confirmed" title="${esc(CONFIDENCE.confirmed[1])}"></span>` : e.confidence === "unsure" ? `<span class="mm-dot mm-conf-unsure" title="${esc(CONFIDENCE.unsure[1])}"></span>` : "";
  const inner = thumbHtml(e, ctx, name) +
    `<span class="mm-rt"><span class="mm-rv">${esc(join([v.day, v.time], " "))}</span><span class="mm-rn"><span class="mm-rname">${esc(name)}</span>${conf}${kind}</span>` +
    (place ? `<span class="mm-rp">${esc(place)}</span>` : "") +
    (menu.length && !ctx.mini ? `<span class="mm-rm">${menu.map((m) => `<span>${esc(titleCase(cut(m, 24)))}</span>`).join("")}</span>` : "") + `</span>` +
    (dist ? `<span class="mm-rd">${esc(dist)}</span>` : "");
  const cls = `mm-row${ctx.mini ? " mm-mini" : ""} mm-v-${v.kind}`;
  if (ctx.rowTag === "a") {
    const href = id ? (typeof ctx.eventHref === "function" ? ctx.eventHref(id) : "?event=" + id) : "#";
    return `<a class="${cls}" href="${esc(href)}"${id ? ` data-event="${id}"` : ""}>${inner}</a>`;
  }
  return `<button type="button" class="${cls}"${id ? ` data-key="e:${id}" data-event="${id}"` : ""}>${inner}</button>`;
}

// ---- the brand card ------------------------------------------------------------------------------------------
// brand: a brands.json record ({handle, name, picture, bio, followers, website, home_city, home_state, kind, recent}) or a
// sources.json record ({brand, instagram, tiktok, website, home_city, home_state, kind}); events: that brand's events.
export function brandCardHtml(brand, events = [], ctx = {}) {
  brand = brand || {};
  const h = String(brand.handle || brand.instagram || "").replace(/^@/, "").toLowerCase();
  const b = (h && byKey(ctx.brands, h, "handle")) || (brand.picture || brand.bio ? brand : null);
  const name = cut((b && b.name) || brand.name || brand.brand || h || "Matcha brand", 60);
  const now = ctx.now || new Date();
  const up = (Array.isArray(events) ? events : []).filter((e) => e && !/^(past|cancelled)$/.test(dayWord(e, now).kind)).sort((x, y) => (x.start < y.start ? -1 : 1));
  const kind = KIND[brand.kind || (b && b.kind)] || "";
  const home = join([brand.home_city || (b && b.home_city), brand.home_state || (b && b.home_state)], ", ");
  const next = up[0] ? verdict(up[0], ctx) : null;
  const pic = b && safeUrl(b.picture);
  const meta = join([h ? `<a href="https://www.instagram.com/${encodeURIComponent(h)}/" target="_blank" rel="noopener">@${esc(h)}</a>` : "", kind ? `<span class="mm-kind">${esc(kind)}</span>` : ""]);
  const stats = [home ? `${ICON.pin}<span>${esc(home)}</span>` : "", followers(b && b.followers) ? `${ICON.heart}<span>${esc(followers(b.followers))}</span>` : ""].filter(Boolean);
  const web = safeUrl(brand.website || (b && b.website)), tt = brand.tiktok ? "https://www.tiktok.com/@" + encodeURIComponent(String(brand.tiktok).replace(/^@/, "")) : "";
  const links = [h ? `<a class="mm-act" href="https://www.instagram.com/${encodeURIComponent(h)}/" target="_blank" rel="noopener">${ICON.ig}<span>Instagram</span></a>` : "",
    tt ? `<a class="mm-act" href="${esc(tt)}" target="_blank" rel="noopener">${ICON.tt}<span>TikTok</span></a>` : "",
    web ? `<a class="mm-act" href="${esc(web)}" target="_blank" rel="noopener">${ICON.web}<span>Website</span></a>` : ""].filter(Boolean);
  const recent = ((b && b.recent) || []).filter((r) => safeUrl(r.permalink) && safeUrl(r.image_url)).slice(0, 3);
  return `<article class="mm-brand"${h ? ` data-handle="${esc(h)}"` : ""}>` +
    `<header class="mm-top"><p class="mm-verdict">${next ? `<span class="mm-vday">Next: ${esc(next.day)}</span>${next.time ? ` <span class="mm-vtime">${esc(next.time)}</span>` : ""}${next.where ? `<span class="mm-vwhere">${esc(next.where)}</span>` : ""}` : `<span class="mm-vday">No dates posted yet</span>`}</p></header>` +
    `<div class="mm-bhero mm-t${hash(name) % 3}">${avatarHtml(name, pic, "mm-avatar mm-avatar-xl")}</div>` +
    `<div class="mm-brandrow mm-brandrow-c"><div class="mm-btxt"><h3 class="mm-bname">${esc(name)}</h3>${meta ? `<p class="mm-bmeta">${meta}</p>` : ""}</div></div>` +
    (stats.length ? `<p class="mm-stats">${stats.map((s) => `<span>${s}</span>`).join("")}</p>` : "") +
    (b && b.bio ? `<p class="mm-bio">${esc(cut(b.bio, 240))}</p>` : "") +
    (up.length ? `<section class="mm-sec"><h4 class="mm-h">Coming up</h4><ul class="mm-nlist">${up.slice(0, 5).map((e) => `<li>${rowHtml(e, { ...ctx, rowTag: "a", mini: true })}</li>`).join("")}</ul></section>` : "") +
    (recent.length ? `<section class="mm-sec"><h4 class="mm-h">Latest posts</h4><div class="mm-grid">${recent.map((r) => `<a href="${esc(r.permalink)}" target="_blank" rel="noopener" aria-label="${esc(cut(r.caption || "Recent post", 80))}"><img src="${esc(r.image_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`).join("")}</div></section>` : "") +
    (links.length ? `<div class="mm-acts">${links.join("")}</div>` : "") + `</article>`;
}

// ---- DOM forms -----------------------------------------------------------------------------------------------
function toEl(html, ctx) {
  const doc = ctx.document || (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("cards.js: render* needs a document (pass ctx.document outside a browser)");
  const box = doc.createElement("div");
  box.innerHTML = html;
  return wire(box.firstElementChild, ctx);
}
export const renderCard = (e, ctx = {}) => toEl(cardHtml(e, ctx), ctx);
export const renderRow = (e, ctx = {}) => toEl(rowHtml(e, ctx), ctx);
export const renderBrandCard = (brand, events, ctx = {}) => toEl(brandCardHtml(brand, events, ctx), ctx);

// Share (navigator.share, else copy the link) and image fallbacks: a photo that fails tries its remote copy once, then
// steps aside so the art underneath shows; a missing avatar leaves its initial; a missing drink drawing leaves a cup.
// Last-resort copy for pages without the async clipboard (plain http, old browsers): a hidden field and execCommand.
function legacyCopy(url, a, done, loc) {
  let ok = false;
  try {
    const d = a.ownerDocument, t = d.createElement("textarea");
    t.value = url; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    d.body.appendChild(t); t.select(); ok = !!d.execCommand("copy"); t.remove();
  } catch { ok = false; }
  if (ok) done("Link copied"); else if (loc) loc.href = url;
  return ok;
}
export function wire(root, ctx = {}) {
  if (!root || typeof root.addEventListener !== "function" || root.__mmWired) return root;
  root.__mmWired = true;
  root.addEventListener("click", (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest("[data-mm-share]");
    if (!a) return;
    const loc = typeof location !== "undefined" ? location : null;
    const url = loc ? new URL(a.getAttribute("href"), loc.href).href : a.getAttribute("href");
    const nav = typeof navigator !== "undefined" ? navigator : {};
    ev.preventDefault();
    const label = a.querySelector("span");
    const done = (t) => { if (label) { const was = label.textContent; label.textContent = t; setTimeout(() => { label.textContent = was; }, 1800); } };
    // data-text (the invite) goes with the link: the share sheet gets it as text, the clipboard gets "text link"
    const text = a.getAttribute("data-text") || "", copy = text ? text + " " + url : url;
    if (nav.share) nav.share(text ? { title: a.getAttribute("data-title") || "Matcha pop-up", text, url } : { title: a.getAttribute("data-title") || "Matcha pop-up", url }).catch(() => {});
    else if (nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(copy).then(() => done(text ? "Copied" : "Link copied"), () => legacyCopy(copy, a, done, loc));
    else if (legacyCopy(copy, a, done, null)) { /* copied */ }
    else if (loc) loc.href = url;
  });
  root.addEventListener("error", (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== "IMG" || !img.closest(".mm-card, .mm-row, .mm-brand")) return;
    const remote = img.getAttribute("data-remote");
    if (remote) { img.removeAttribute("data-remote"); img.src = remote; return; }
    const hero = img.closest(".mm-hero-photo");
    if (hero) { hero.querySelectorAll(".mm-hero-img, .mm-hero-blur, .mm-credit").forEach((x) => x.remove()); hero.classList.remove("mm-hero-photo"); hero.classList.add("mm-hero-art"); return; }
    if (img.matches(".mm-chip-art, .mm-cup-art")) { const s = img.ownerDocument.createElement("span"); s.innerHTML = CUP(TINTS[1]); img.replaceWith(s.firstChild); return; }
    const pt = img.closest(".mm-pthumb");
    if (pt) { pt.remove(); return; }
    img.remove();
  }, true);
  return root;
}
