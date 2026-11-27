// The city page's look (rung 1 of the city-page redesign, 2026-11-27): a hero with a drawn skyline and Mattie, event cards with their
// drawn scene, shop cards with drink cartoons, a drawn mini-map of the city's pins, compact rows, collapsible questions. Everything
// here is layout and art: every word, link and structured-data block a search engine reads is produced by gen-pages.js from the same
// data as before and is frozen by test/city-page-seo-freeze.test.js. Styles: site/city.css. No photos, no map library, no new hosts.
import { drinkSlug } from "../site/cards.js";

const hashStr = (s) => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; };
const rngOf = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const f1 = (n) => Math.round(n * 10) / 10;
const initials = (name) => { const w = String(name).replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : "")).toUpperCase(); };

// Skylines: 24 shared drawings (small town, mid-size, big city; eight each), picked by a hash of the city's name, so they cache across pages
// instead of weighing every page. Pure drawing, no data claims. Mattie stands on top of the picture in the page itself.
export const SKY_KEYS = ["s", "m", "l"].flatMap((k) => Array.from({ length: 8 }, (_, i) => k + i));
export const skyKeyOf = (name, pop) => (pop > 400000 ? "l" : pop > 90000 ? "m" : "s") + (hashStr(name) % 8);
export function skylineFile(key) {
  const R = rngOf(hashStr("sky" + key)), big = key[0] === "l", mid = key[0] === "m";
  const W = 360, H = 150, ground = 118, pal = ["#DCEBC9", "#B5D39F", "#C9D8BC", "#E6F2DC"];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><circle cx="${f1(60 + R() * 60)}" cy="38" r="22" fill="#F6B7C7" opacity=".9"/><ellipse cx="250" cy="30" rx="26" ry="8" fill="#fff" opacity=".7"/><ellipse cx="280" cy="38" rx="18" ry="6" fill="#fff" opacity=".6"/>`;
  let x = 6;
  while (x < W - 70) {
    const w = f1((big ? 22 : mid ? 26 : 30) + R() * (big ? 16 : 14)), h = f1(big ? 40 + R() * 62 : mid ? 26 + R() * 40 : 16 + R() * 20), fill = pal[Math.floor(R() * pal.length)];
    if (!big && !mid && R() < 0.4) { s += `<rect x="${f1(x + w / 2 - 2)}" y="${ground - 22}" width="4" height="22" fill="#6E9A5E"/><circle cx="${f1(x + w / 2)}" cy="${ground - 28}" r="${f1(12 + R() * 6)}" fill="#8CBF7A" stroke="#6E9A5E" stroke-width="2"/>`; x += w * 0.8; continue; }
    s += `<rect x="${f1(x)}" y="${f1(ground - h)}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="#6E9A5E" stroke-width="2"/>`;
    if (!big && !mid) s += `<path d="M${f1(x - 3)} ${f1(ground - h)}L${f1(x + w / 2)} ${f1(ground - h - 14)}L${f1(x + w + 3)} ${f1(ground - h)}Z" fill="#F6B7C7" stroke="#D98CA2" stroke-width="2" stroke-linejoin="round"/>`;
    const rows = Math.max(1, Math.floor(h / 16)), cols = Math.max(1, Math.floor(w / 12));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (R() < 0.6) s += `<rect x="${f1(x + 4 + c * 11)}" y="${f1(ground - h + 6 + r * 14)}" width="5" height="6" rx="1" fill="#FFFDF7"/>`;
    x += w + f1(3 + R() * 5);
  }
  return s + `<rect x="0" y="${ground}" width="${W}" height="${H - ground}" fill="#8CBF7A"/><rect x="0" y="${ground}" width="${W}" height="3" fill="#6E9A5E"/></svg>`;
}
export const skylineHtml = (name, pop) => `<img class="cv-sky" src="/art/sky/${skyKeyOf(name, pop)}.svg" alt="" width="360" height="150" decoding="async"><svg class="cv-mattie" viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-wave"/></svg>`;

// The pins on a plain shape: positions from lat and lng (equirectangular), no tiles. Shops are round, pop-ups are diamonds.
export function miniMapSvg(c, shops, popups, key, H) {
  const kmTo = (p) => Math.hypot((p.lat - c.lat) * 111, (p.lng - c.lng) * 111 * Math.cos((c.lat * Math.PI) / 180));
  const every = [...shops.map((s) => ({ lat: s.lat, lng: s.lng, k: "s" })), ...popups.map((p) => ({ lat: p.lat, lng: p.lng, k: "p" }))].filter((p) => isFinite(p.lat) && isFinite(p.lng));
  let pts = every.filter((p) => kmTo(p) <= 14); // one far-off pin would shrink the city to a dot: the map covers the town itself
  if (pts.length < 3) pts = every.filter((p) => kmTo(p) <= 26); // a small town has few pins: take every shop of the city
  if (!pts.length) return null;
  const all = [...pts, { lat: c.lat, lng: c.lng }], kx = Math.cos((c.lat * Math.PI) / 180);
  let la0 = Math.min(...all.map((p) => p.lat)), la1 = Math.max(...all.map((p) => p.lat)), lo0 = Math.min(...all.map((p) => p.lng)), lo1 = Math.max(...all.map((p) => p.lng));
  const spanLa = Math.max(la1 - la0, 0.06), spanLo = Math.max(lo1 - lo0, 0.06 / kx), W = 360, Ht = 220, m = 30;
  const sc = Math.min((W - 2 * m) / (spanLo * kx), (Ht - 2 * m) / spanLa), cx = (lo0 + lo1) / 2, cy = (la0 + la1) / 2;
  const X = (lng) => f1(W / 2 + (lng - cx) * kx * sc), Y = (lat) => f1(Ht / 2 - (lat - cy) * sc);
  const R = rngOf(hashStr(key));
  let s = `<svg class="cv-mapsvg" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${H.esc(`Map of the matcha near ${c.name}: ${H.plural(shops.length, "shop")} and ${H.plural(popups.length, "pop-up")}`)}"><rect width="${W}" height="${Ht}" rx="22" fill="#EEF6E4"/>`;
  for (let i = 0; i < 3; i++) s += `<path d="M${f1(R() * 60)} ${f1(30 + R() * 160)}C${f1(100 + R() * 60)} ${f1(R() * 220)} ${f1(200 + R() * 60)} ${f1(R() * 220)} ${W} ${f1(30 + R() * 160)}" fill="none" stroke="#FFFDF7" stroke-width="${6 + i * 3}" stroke-linecap="round"/>`;
  s += `<path d="M-10 ${f1(150 + R() * 40)}C80 ${f1(110 + R() * 30)} 200 ${f1(190 + R() * 30)} ${W + 10} ${f1(140 + R() * 30)}" fill="none" stroke="#E2F1F3" stroke-width="14"/>`;
  s += `<g><circle cx="${X(c.lng)}" cy="${Y(c.lat)}" r="11" fill="none" stroke="#3E6B33" stroke-width="2" stroke-dasharray="3 3"/></g>`;
  for (const p of pts) {
    const px = X(p.lng), py = Y(p.lat);
    s += p.k === "s" ? `<g transform="translate(${px} ${py})"><circle r="8" fill="#8CBF7A" stroke="#3E6B33" stroke-width="2.5"/><circle r="2.6" fill="#FFFDF7"/></g>` : `<g transform="translate(${px} ${py}) rotate(45)"><rect x="-6" y="-6" width="12" height="12" rx="3" fill="#F6B7C7" stroke="#D98CA2" stroke-width="2.5"/></g>`;
  }
  // the city's name last, on a pill above everything, nudged inside the picture
  const lw = f1(c.name.length * 7.4 + 16), lx = Math.max(lw / 2 + 4, Math.min(W - lw / 2 - 4, X(c.lng))), ly = Math.max(20, Math.min(Ht - 8, Y(c.lat) - 22));
  s += `<g><rect x="${f1(lx - lw / 2)}" y="${f1(ly - 13)}" width="${lw}" height="22" rx="11" fill="#FFFDF7" stroke="#3E6B33" stroke-width="2"/><text x="${f1(lx)}" y="${f1(ly + 2)}" text-anchor="middle" font-size="12.5" font-weight="800" fill="#3B2E27">${H.esc(c.name)}</text></g>`;
  return { svg: s + `</svg>`, far: every.length - pts.length };
}

const day2 = (H, e, tz) => { const k = H.shortDayOf(e, tz); return k; };

function eventCardV2(H, x, it, g) {
  const e = it.e, c = x.c;
  const place = H.isApprox(e) || !e.venue ? "Place not posted yet" : e.venue + (e.address ? ` · ${e.address}` : "");
  const menu = Array.isArray(e.menu) && e.menu.length ? `<p class="pg-menu">Menu: ${H.esc(e.menu.slice(0, 8).join(", "))}</p>` : "";
  const link = H.eventLink(e);
  const note = e.confidence === "unsure" ? `<p class="pg-note">Date read from a post and not confirmed. Check the post before you go.</p>` : "";
  const head = it.handle ? `<a href="/brand/${H.esc(it.handle)}/">${H.esc(it.brand)}</a>` : H.esc(it.brand);
  const art = x.eventArt && x.eventArt.get && x.eventArt.get(e.id);
  const pic = art ? `<img src="/art/events/${H.esc(e.id)}.svg" alt="" ${art.width ? `width="${art.width}" height="${art.height}"` : 'width="320" height="200"'} loading="lazy" decoding="async">` : `<svg viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-happy"/></svg>`;
  return `<li class="cv-ev">
<div class="cv-ev-art${art ? "" : " cv-ev-mattie"}">${pic}</div>
<div class="cv-ev-body"><span class="cv-pill">${H.esc(day2(H, e, c.tz))}</span>
<h3>${head}</h3>
<p class="pg-when">${H.esc(H.timeText(e, c.tz))}</p>
<p class="pg-where">${H.esc(place)}</p>
${menu}${note}
<p class="pg-links">${link ? `<a href="${H.esc(link)}" rel="noopener">See the post</a>` : ""}<a class="pg-btn" href="/?event=${encodeURIComponent(e.id)}">See on the map</a></p></div>
</li>`;
}

function shopCardV2(H, x, { s, km: dd }) {
  const w = H.safeUrl(s.website);
  const rules = H.parseOpeningHours(s.opening_hours);
  const hours = rules ? H.hoursText(rules) : String(s.opening_hours || "").trim().slice(0, 120);
  const items = (Array.isArray(s.menu_matcha) ? s.menu_matcha : []).filter((m) => m && typeof m.name === "string" && m.name.trim());
  // top three drinks, the ones with a drawing first
  const withArt = items.map((m) => ({ m, slug: x.art ? drinkSlug(m.name, x.art) : "" }));
  const pick = [...withArt.filter((i) => i.slug), ...withArt.filter((i) => !i.slug)].slice(0, 3);
  const pour = pick.length ? `<div class="cv-pour"><span class="cv-pour-h">What they pour</span><ul>${pick.map(({ m, slug }) => `<li>${slug ? `<img src="/art/${H.esc(x.art.drinks[slug].file)}" alt="" width="44" height="44" loading="lazy" decoding="async">` : `<svg viewBox="0 0 64 64" aria-hidden="true"><use href="/characters.svg#m-pour"/></svg>`}<span>${H.esc(m.name)}</span></li>`).join("")}</ul></div>` : "";
  const go = isFinite(s.lat) && isFinite(s.lng) ? `<a class="cv-go" href="https://www.google.com/maps/dir/?api=1&amp;destination=${s.lat},${s.lng}" rel="noopener">Directions</a>` : "";
  return `<li class="cv-shop">
<div class="cv-shop-head"><span class="cv-init cvt${hashStr(s.name) % 3}" aria-hidden="true">${H.esc(initials(s.name))}</span><div class="cv-shop-id"><strong>${w ? `<a href="${H.esc(w)}" rel="noopener">${H.esc(s.name)}</a>` : H.esc(s.name)}</strong> <span class="pg-dim">${Math.round(dd / H.KM_PER_MI)} mi</span><br>${H.esc(s.address || "")}</div></div>
${hours ? `<p class="cv-hours"><span class="pg-dim">Hours: ${H.esc(hours)}</span></p>` : ""}
${pour}${go ? `<p class="cv-acts">${go}</p>` : ""}
</li>`;
}

// x: everything cityPage holds. Returns the page body (inside <main>). Text nodes and links match the plain template one for one.
export function cityBodyV2(H, x) {
  const { c, key, label, lead, intro, indexable, ups, groups, wk, sh, shown, home, nearby, near3, faqHtml, credited, crumb, mapLinkHtml, ctaHtml, weekendHtml, nearbyCitiesHtml, howHtml, nearbyN } = x;
  let b = `${crumb}\n<section class="cv-hero"><div class="cv-hero-text"><h1>Matcha pop-ups in ${H.esc(label)}</h1>\n<p class="pg-lead">${H.esc(lead)}</p>\n${intro ? `<p class="pg-intro">${H.esc(intro)}</p>\n` : ""}<p class="pg-sub" data-boiler>${indexable && !ups.length ? `Updated ${x.UPDATED}. ` : ""}${mapLinkHtml}</p>\n${!ups.length ? `<p class="pg-dim" data-boiler>Dates come from each brand's own posts, so check the post before you go.</p>\n` : ""}</div><div class="cv-hero-art">${skylineHtml(c.name, c.pop || 0)}</div></section>\n`;
  if (wk.length) b += weekendHtml;
  if (ups.length) {
    b += `<section class="cv-sec"><h2>Upcoming pop-ups</h2>\n<p class="pg-dim" data-boiler>Dates come from each brand's own posts, so check the post before you go.</p>\n`;
    for (const g of groups) b += `<h3 class="pg-day">${H.esc(g.label)}</h3>\n<ul class="cv-evs">\n${g.items.map((it) => eventCardV2(H, x, it, g)).join("\n")}\n</ul>\n`;
    b += `</section>\n`;
  }
  if (sh.length) {
    const tiers = [...new Set(shown.map(({ s }) => String(s.tier || "")))].sort((p, q) => (p === "") - (q === "") || p.localeCompare(q));
    b += `<section class="cv-sec"><h2>Matcha cafes and shops in ${H.esc(c.name)}</h2>\n${tiers.map((t) => `<h3 class="pg-day">${H.esc(t ? t.charAt(0).toUpperCase() + t.slice(1) : "Other")}</h3>\n<ul class="cv-shops">\n${shown.filter(({ s }) => String(s.tier || "") === t).map((r) => shopCardV2(H, x, r)).join("\n")}\n</ul>`).join("\n")}${sh.length > shown.length ? `<p class="pg-dim">The nearest ${shown.length} of ${sh.length}.</p>` : ""}</section>\n`;
  }
  const mm = miniMapSvg(c, shown.map((r) => r.s), ups.filter((it) => !H.isApprox(it.e)).map((it) => it.e).slice(0, 24), key, H);
  const map = mm && mm.svg;
  if (map) b += `<section class="cv-map"><a class="cv-map-a" href="/?city=${H.esc(key)}">${map}<span class="cv-map-cap"><span class="cv-key"><i class="cv-k-s"></i>shop <i class="cv-k-p"></i>pop-up${mm.far ? ` · ${mm.far} farther out` : ""}</span><span class="cv-map-go">Open ${H.esc(c.name)} on the live map</span></span></a></section>\n`;
  if (home.length) b += `<section class="cv-sec"><h2>Brands based in ${H.esc(c.name)}</h2>\n<ul class="pg-chips cv-brands">\n${home.map((h) => `<li><span class="cv-init cvt${hashStr(h.name) % 3}" aria-hidden="true">${H.esc(initials(h.name))}</span><a href="/brand/${H.esc(h.slug)}/">${H.esc(h.name)}</a>${h.instagram ? ` <a class="pg-dim" href="https://www.instagram.com/${H.esc(h.instagram)}/" rel="noopener">@${H.esc(h.instagram)}</a>` : ""}${H.followersText(h.followers) ? ` <span class="pg-dim">${H.followersText(h.followers)}</span>` : ""}</li>`).join("\n")}\n</ul></section>\n`;
  b += nearby.length
    ? `<section class="cv-sec"><h2>Pop-ups near ${H.esc(c.name)}</h2>\n<ul class="cv-rows">\n${nearby.map(({ it, km: dd }) => { const e = it.e, where = [e.city, e.state].filter(Boolean).join(", "); const href = H.eventPageId(e) ? `/e/${H.esc(e.id)}/` : `/?event=${encodeURIComponent(e.id)}`; return `<li><strong>${H.esc(it.brand)}</strong> <span class="pg-dim">${H.esc(H.shortDayOf(e, c.tz))} · ${H.esc(where)} · ${H.esc(H.miText(dd))}</span> <a href="${href}">Details</a></li>`; }).join("\n")}\n</ul></section>\n`
    : `<section class="cv-sec"><h2>Pop-ups near ${H.esc(c.name)}</h2><p data-boiler>Nothing listed yet within ${H.NEARBY_MI} miles.</p></section>\n`;
  b += faqHtml + ctaHtml + nearbyCitiesHtml + (indexable ? howHtml : "");
  b += `<a class="cv-sticky" href="/?city=${H.esc(key)}">Open the map</a>\n`;
  return b;
}
