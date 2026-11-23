// Instant search for the map: pop-ups, brands, drinks and cities. ES module, no dependencies, no DOM at import time
// (the pure parts are also used by tools/gen-weekend.js and the tests).
//   mountSearch(slot, { events, sources, art, cities, onPick, artBase, readUrl }) -> { applyQuery, setData, focus, clear, destroy }
//   onPick({ type: "event" | "brand" | "drink" | "city", id })
//     event: event id; brand: handle slug (?brand=); drink: art slug (?drink=); city: "<slug>-<st>" (?city=)
export const GROUPS = [
  { type: "event", label: "Pop-ups", max: 4 },
  { type: "brand", label: "Brands", max: 4 },
  { type: "drink", label: "Drinks", max: 4 },
  { type: "city", label: "Cities", max: 3 },
];

export function normalize(s) {
  return String(s == null ? "" : s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/@/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
export function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
export const handleSlug = (h, fallback) => String(h || "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "") || String(fallback || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");

// ---- drinks: menu text -> art slug ----
// Map of normalized name or alias -> slug, from the catalogue and the drawn drinks.
export function drinkLookup(art) {
  const m = new Map();
  if (!art) return m;
  for (const [slug, d] of Object.entries(art.drinks || {})) { m.set(normalize(d.text || slug), slug); m.set(normalize(slug), slug); }
  for (const c of art.catalog || []) {
    if (!c || !c.slug) continue;
    m.set(normalize(c.name), c.slug); m.set(normalize(c.slug), c.slug);
    for (const a of c.aliases || []) if (!m.has(normalize(a))) m.set(normalize(a), c.slug);
  }
  return m;
}
// "himori cafe - matcha" keeps the part after the dash. Returns a slug (known to the art index when possible).
export function drinkSlug(item, lookup) {
  const t = String(item || "").split(/\s[—–-]\s/).pop();
  const n = normalize(t);
  if (!n) return "";
  if (lookup && lookup.has(n)) return lookup.get(n);
  return slugify(n);
}
export function drinkName(slug, art) {
  const c = ((art && art.catalog) || []).find((x) => x.slug === slug);
  if (c) return c.name;
  const d = art && art.drinks && art.drinks[slug];
  const t = d ? (d.spec && d.spec.label) || d.text : String(slug).replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---- filters (return the matching events) ----
export function filterByDrink(events, drinkSlugValue, art) {
  const want = slugify(drinkSlugValue);
  if (!want) return [];
  const lk = art ? drinkLookup(art) : null;
  return (events || []).filter((e) => (e.menu || []).some((m) => drinkSlug(m, lk) === want || slugify(m) === want));
}
export function filterByBrand(events, brandId) {
  const want = String(brandId || "").replace(/^@/, "").toLowerCase();
  if (!want) return [];
  return (events || []).filter((e) => handleSlug(e.handle) === want || String(e.source_id || "").toLowerCase() === want || slugify(e.brand) === want);
}

// ---- query string: ?q= and ?drink= (the map's other params live in deeplink.js) ----
export function parseQuery(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const q = (p.get("q") || "").trim().slice(0, 80);
  const dr = slugify((p.get("drink") || "").slice(0, 80));
  return { q, drink: dr };
}

// ---- index and matching ----
const eventLive = (e, nowMs) => {
  if (!e || e.status === "cancelled") return false;
  const st = Date.parse(e.start);
  if (isNaN(st)) return false;
  const en = e.end && !isNaN(Date.parse(e.end)) ? Date.parse(e.end) : st + (e.all_day ? 864e5 : 3 * 36e5);
  return en >= nowMs;
};
const whenText = (e) => {
  const st = Date.parse(e.start);
  if (isNaN(st)) return "";
  try { return new Intl.DateTimeFormat("en-US", { timeZone: e.tz || "UTC", weekday: "short", month: "short", day: "numeric" }).format(st); } catch { return ""; }
};
const plural = (n) => n + (n === 1 ? " pop-up" : " pop-ups");

export function buildIndex({ events = [], sources = [], art = null, cities = [], now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const lk = drinkLookup(art);
  const up = events.filter((e) => eventLive(e, nowMs));
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const items = { event: [], brand: [], drink: [], city: [] };

  for (const e of up) {
    const s = srcById.get(e.source_id) || {};
    const brand = e.brand || s.brand || "";
    const where = [e.city, e.state].filter(Boolean).join(", ");
    items.event.push({ type: "event", id: e.id, title: brand || e.title || "Pop-up", sub: [whenText(e), e.venue, where].filter(Boolean).join(" · "),
      keys: [brand, e.title, e.handle, e.venue, e.city, ...(e.menu || [])], when: Date.parse(e.start) });
  }

  const brands = new Map();
  const addBrand = (slug, name, handle, city) => {
    if (!slug || !name) return null;
    if (!brands.has(slug)) brands.set(slug, { id: slug, title: name, handle: handle || "", city: city || "", n: 0 });
    return brands.get(slug);
  };
  for (const s of sources) if (s.active !== false) addBrand(handleSlug(s.instagram, s.id), s.brand, s.instagram ? handleSlug(s.instagram) : "", [s.home_city, s.home_state].filter(Boolean).join(", "));
  for (const e of up) {
    const s = srcById.get(e.source_id) || {};
    const slug = handleSlug(e.handle || s.instagram, e.source_id);
    const b = addBrand(slug, e.brand || s.brand, handleSlug(e.handle || s.instagram), "");
    if (b) b.n++;
  }
  for (const b of brands.values()) items.brand.push({ type: "brand", id: b.id, title: b.title, sub: [b.handle ? "@" + b.handle : "", b.n ? plural(b.n) : b.city].filter(Boolean).join(" · "), keys: [b.title, b.handle, b.id], n: b.n });

  const dn = new Map();
  for (const e of up) { const seen = new Set(); for (const m of e.menu || []) { const sl = drinkSlug(m, lk); if (sl && !seen.has(sl)) { seen.add(sl); dn.set(sl, (dn.get(sl) || 0) + 1); } } }
  const drinkSet = new Map();
  for (const c of (art && art.catalog) || []) if (c.slug) drinkSet.set(c.slug, { name: c.name, aliases: c.aliases || [] });
  for (const [slug, d] of Object.entries((art && art.drinks) || {})) if (!drinkSet.has(slug)) drinkSet.set(slug, { name: drinkName(slug, art), aliases: [d.text] });
  for (const slug of dn.keys()) if (!drinkSet.has(slug)) drinkSet.set(slug, { name: drinkName(slug, art), aliases: [] });
  for (const [slug, d] of drinkSet) {
    const n = dn.get(slug) || 0;
    const hasArt = !!(art && art.drinks && art.drinks[slug]);
    items.drink.push({ type: "drink", id: slug, title: d.name, sub: n ? plural(n) : "No pop-ups right now", keys: [d.name, ...d.aliases, slug.replace(/-/g, " ")], n, art: hasArt ? slug : "" });
  }

  const cityMap = new Map();
  const addCity = (name, st, n, pop) => {
    if (!name || !st) return;
    const id = `${slugify(name)}-${String(st).toLowerCase()}`;
    const c = cityMap.get(id) || { id, title: `${name}, ${st}`, name, n: 0, pop: 0 };
    c.n += n; if (pop) c.pop = pop; cityMap.set(id, c);
  };
  for (const row of cities) addCity(row[0], row[1], 0, row[4]);
  for (const e of up) addCity(e.city, e.state, 1, 0);
  for (const c of cityMap.values()) items.city.push({ type: "city", id: c.id, title: c.title, sub: c.n ? plural(c.n) : "", keys: [c.name, c.title], n: c.n, pop: c.pop });

  for (const list of Object.values(items)) for (const it of list) it.hay = it.keys.filter(Boolean).map(normalize).filter(Boolean);
  return items;
}

// Score one item for the query tokens: 0 = no match. Every token must start a word (or, at 4+ letters, appear inside one).
export function score(item, tokens, whole) {
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    for (const h of item.hay) {
      let s = 0;
      if (h === t) s = 100;
      else if (h.startsWith(t)) s = 80;
      else if (h.split(" ").some((w) => w.startsWith(t))) s = 60;
      else if (t.length >= 4 && h.includes(t)) s = 30;
      if (s > best) best = s;
    }
    if (!best) return 0;
    total += best;
  }
  if (item.hay[0] && item.hay[0].startsWith(whole)) total += 20;
  return total / tokens.length;
}

// -> [{ type, label, items }], only non-empty groups, in GROUPS order.
export function search(index, q, { limits = {} } = {}) {
  const whole = normalize(q);
  const tokens = whole.split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const g of GROUPS) {
    const hits = (index[g.type] || []).map((it) => ({ it, s: score(it, tokens, whole) })).filter((x) => x.s > 0);
    hits.sort((a, b) => b.s - a.s || (b.it.n || 0) - (a.it.n || 0) || (a.it.when || 0) - (b.it.when || 0) || (b.it.pop || 0) - (a.it.pop || 0) || (a.it.title < b.it.title ? -1 : 1));
    if (hits.length) out.push({ type: g.type, label: g.label, items: hits.slice(0, limits[g.type] || g.max).map((x) => x.it) });
  }
  return out;
}

// ---- the widget ----
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
let uid = 0;

export function mountSearch(slot, opts = {}) {
  const o = { artBase: "/art/", readUrl: true, onPick() {}, ...opts };
  const id = "srch" + ++uid;
  let index = buildIndex(o);
  let flat = [], active = -1;

  const root = el("div", "srch");
  const input = el("input", "srch-in");
  input.type = "search"; input.id = id + "-in"; input.placeholder = "Search brands, drinks, cities";
  input.setAttribute("role", "combobox"); input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-controls", id + "-list");
  input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-label", "Search pop-ups, brands, drinks and cities");
  input.autocomplete = "off"; input.autocapitalize = "off"; input.spellcheck = false; input.enterKeyHint = "search";
  const pop = el("div", "srch-pop"); pop.id = id + "-list"; pop.setAttribute("role", "listbox"); pop.hidden = true;
  const live = el("p", "srch-live"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
  root.append(input, pop, live);
  slot.appendChild(root);

  function thumb(it) {
    if (it.type === "drink" && it.art) { const im = el("img", "srch-th"); im.alt = ""; im.loading = "lazy"; im.width = 40; im.height = 48; im.src = `${o.artBase}drinks/${it.art}.svg`; return im; }
    const s = el("span", "srch-ic srch-ic-" + it.type); s.setAttribute("aria-hidden", "true");
    s.textContent = it.type === "event" ? "★" : it.type === "brand" ? "❀" : it.type === "city" ? "●" : "☕";
    return s;
  }
  function setActive(i) {
    const rows = pop.querySelectorAll(".srch-row");
    if (active >= 0 && rows[active]) { rows[active].classList.remove("on"); rows[active].setAttribute("aria-selected", "false"); }
    active = i;
    if (i >= 0 && rows[i]) { rows[i].classList.add("on"); rows[i].setAttribute("aria-selected", "true"); input.setAttribute("aria-activedescendant", rows[i].id); rows[i].scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }
  function close() { pop.hidden = true; input.setAttribute("aria-expanded", "false"); setActive(-1); }
  function pick(it) {
    close();
    input.value = it.title;
    try { o.onPick({ type: it.type, id: it.id }); } catch (e) { /* the host handles its own errors */ }
  }
  function render() {
    pop.textContent = ""; flat = []; active = -1;
    const q = input.value;
    if (!normalize(q)) { close(); live.textContent = ""; return; }
    const groups = search(index, q);
    if (!groups.length) pop.appendChild(el("p", "srch-none", "Nothing matches “" + q.trim() + "”. Try a brand, a drink or a city."));
    for (const g of groups) {
      const sec = el("div", "srch-grp"); sec.setAttribute("role", "group");
      const h = el("p", "srch-h", g.label); h.id = id + "-g-" + g.type; sec.setAttribute("aria-labelledby", h.id); sec.appendChild(h);
      for (const it of g.items) {
        const row = el("div", "srch-row"); row.id = id + "-r" + flat.length; row.setAttribute("role", "option"); row.setAttribute("aria-selected", "false");
        const txt = el("span", "srch-tx"); txt.append(el("span", "srch-t", it.title)); if (it.sub) txt.append(el("span", "srch-s", it.sub));
        row.append(thumb(it), txt);
        const idx = flat.length;
        row.addEventListener("pointerdown", (ev) => ev.preventDefault());
        row.addEventListener("click", () => pick(it));
        row.addEventListener("pointermove", () => { if (active !== idx) setActive(idx); });
        flat.push(it); sec.appendChild(row);
      }
      pop.appendChild(sec);
    }
    pop.hidden = false; input.setAttribute("aria-expanded", "true");
    live.textContent = flat.length ? flat.length + (flat.length === 1 ? " result" : " results") : "No results";
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", () => { if (normalize(input.value)) render(); });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (pop.hidden) render(); if (flat.length) setActive((active + 1) % flat.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (flat.length) setActive(active <= 0 ? flat.length - 1 : active - 1); }
    else if (ev.key === "Home" && active >= 0) { ev.preventDefault(); setActive(0); }
    else if (ev.key === "End" && active >= 0) { ev.preventDefault(); setActive(flat.length - 1); }
    else if (ev.key === "Enter") { if (flat.length) { ev.preventDefault(); pick(flat[active >= 0 ? active : 0]); } }
    else if (ev.key === "Escape") { if (!pop.hidden) { ev.preventDefault(); close(); } else if (input.value) input.value = ""; }
  });
  const away = (ev) => { if (!root.contains(ev.target)) close(); };
  document.addEventListener("pointerdown", away);

  // params: "?q=matcha&drink=ube-latte" or { q, drink }. q fills the box and shows results; drink fires onPick.
  function applyQuery(params) {
    const p = typeof params === "string" ? parseQuery(params) : { q: String((params && params.q) || "").trim().slice(0, 80), drink: slugify((params && params.drink) || "") };
    if (p.drink) {
      const known = index.drink.find((d) => d.id === p.drink);
      input.value = known ? known.title : drinkName(p.drink, o.art);
      close();
      try { o.onPick({ type: "drink", id: p.drink }); } catch (e) { /* ignore */ }
      return p;
    }
    if (p.q) { input.value = p.q; render(); }
    return p;
  }

  const api = {
    applyQuery,
    setData(d) { o.events = d.events || o.events; o.sources = d.sources || o.sources; o.art = d.art || o.art; o.cities = d.cities || o.cities; index = buildIndex(o); if (!pop.hidden) render(); },
    focus() { input.focus(); },
    clear() { input.value = ""; close(); live.textContent = ""; },
    destroy() { document.removeEventListener("pointerdown", away); root.remove(); },
    get index() { return index; },
  };
  if (o.readUrl && typeof location !== "undefined") { const p = parseQuery(location.search); if (p.q || p.drink) applyQuery(p); }
  return api;
}
