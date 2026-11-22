(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var wide = window.matchMedia("(min-width: 900px)");
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = { chip: "any", day: "", recent: false, userLoc: null, events: [], brands: [], view: "map" };
  var markers = {};   // key -> { marker, item }
  var openKey = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- dates (venue-local, read straight from the ISO string) ----------
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], key: m[1] + "-" + m[2] + "-" + m[3] };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); }
  function addDays(dt, n) { var x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); return x; }
  function clock(p) {
    var h = p.h % 12 || 12, ap = p.h < 12 ? "am" : "pm";
    return h + (p.mi ? ":" + pad(p.mi) : "") + ap;
  }
  function whenText(e) {
    var s = parts(e.start);
    if (!s) return "";
    var wd = DAYS[new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay()];
    var day = wd + " " + MONTHS[s.mo - 1] + " " + s.d;
    if (e.all_day) return day + " · all day";
    var en = parts(e.end);
    var t = clock(s);
    if (en && en.key === s.key) {
      var a = clock(s), b = clock(en);
      // 11am–3pm (drop the first am/pm when both match)
      t = (a.slice(-2) === b.slice(-2) ? a.slice(0, -2) : a) + "–" + b;
    }
    return day + " · " + t;
  }

  function matchesChip(e) {
    var s = parts(e.start);
    if (!s) return false;
    var now = new Date(), today = dateKey(now);
    if (state.day) return s.key === state.day;
    switch (state.chip) {
      case "today": return s.key === today;
      case "week": return s.key >= today && s.key <= dateKey(addDays(now, 6));
      case "weekend": {
            var dow = now.getDay(), sat = addDays(now, dow === 0 ? -1 : 6 - dow), sun = addDays(sat, 1);
        if (s.key === dateKey(sat) || s.key === dateKey(sun)) return s.key >= today;
        var fri = addDays(sat, -1);
        return s.key === dateKey(fri) && s.h >= 17 && s.key >= today;
      }
      default: return s.key >= today || e.status === "upcoming";
    }
  }

  // ---------- geo ----------
  function miles(a, b) {
    var R = 3958.8, r = Math.PI / 180;
    var dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- map ----------
  var map = L.map("map", { zoomControl: true, minZoom: 3, maxZoom: 19, doubleClickZoom: true, touchZoom: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> contributors"
  }).addTo(map);
  map.fitBounds([[24.5, -125], [49.5, -66.5]]);
  // Brand dots get eyes and blush from zoom 9 up (class z9 on the map container).
  function syncZoomFace() { map.getContainer().classList.toggle("z9", map.getZoom() >= 9); }
  map.on("zoomend", syncZoomFace);
  syncZoomFace();

  // No inline style attributes (CSP): sizes go through iconSize.
  var NUDGE = 14; // px: brand pins sit down-right of their spot so an event pin on top does not hide them
  function anchor(size, brand) { var a = size / 2 - (brand ? NUDGE : 0); return [a, a]; }
  function mkCluster(cls, base) {
    return L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (c) {
        var n = c.getChildCount(), size = base + (n > 24 ? 12 : n > 9 ? 6 : 0);
        var el = document.createElement("span");
        el.className = "cl " + cls + (n > 24 ? " cl-l" : n > 9 ? " cl-m" : "");
        el.textContent = n;
        el.setAttribute("aria-label", n + " pins, zoom in");
        return L.divIcon({ html: el, className: "pinwrap", iconSize: [size, size], iconAnchor: anchor(size, cls === "cl-br") });
      }
    });
  }
  var brandGroup = mkCluster("cl-br", 28).addTo(map);
  var eventGroup = mkCluster("cl-ev", 36).addTo(map);
  var youMarker = null;

  // Event pin: Mattie's face in a cup (symbol m-face in index.html), with a pink dot when upcoming.
  var FACE = "<svg viewBox=\"0 0 64 64\" width=\"38\" height=\"38\" aria-hidden=\"true\" focusable=\"false\"><use href=\"#m-face\"/>";
  function pinIcon(kind, past) {
    var el = document.createElement("span");
    el.className = "pin " + (kind === "e" ? "pin-ev" : "pin-br") + (past ? " past" : "");
    if (kind === "e") el.innerHTML = FACE + (past ? "" : "<circle class=\"dot-new\" cx=\"54\" cy=\"10\" r=\"7\"/>") + "</svg>";
    var sz = kind === "e" ? 38 : 28;
    return L.divIcon({ html: el, className: "pinwrap", iconSize: [sz, sz], iconAnchor: anchor(sz, kind !== "e") });
  }

  // ---------- cards ----------
  // Only http(s) links are ever put in an href.
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : ""; }
  function imgSrc(e) { var im = e.image; return im ? (im.local || safeUrl(im.url)) : ""; }
  function postUrl(e) {
    var p = e.posts || {};
    return safeUrl(p.instagram) || safeUrl(p.tiktok) || safeUrl(p.other) || safeUrl(e.source_url);
  }
  function menuOf(e) { return Array.isArray(e.menu) ? e.menu : []; }
  var FACE_BLOCK = "<svg class=\"ph-face\" width=\"44\" height=\"44\" viewBox=\"0 0 64 64\" aria-hidden=\"true\" focusable=\"false\"><use href=\"#m-face\"/></svg>";
  var SMALL_FACE = "<svg class=\"sheet-face\" width=\"24\" height=\"24\" viewBox=\"0 0 64 64\" aria-hidden=\"true\" focusable=\"false\"><use href=\"#m-face\"/></svg>";
  var THUMB_FACE = "<svg width=\"32\" height=\"32\" viewBox=\"0 0 64 64\" aria-hidden=\"true\" focusable=\"false\"><use href=\"#m-face\"/></svg>";
  function photoHTML(e) {
    var src = imgSrc(e);
    if (!src) return "<div class=\"ph ph-empty\">" + FACE_BLOCK + "</div>";
    var credit = e.image.credit ? "<span class=\"ph-credit\">Photo: " + esc(e.image.credit) + "</span>" : "";
    return "<div class=\"ph\"><img src=\"" + esc(src) + "\" alt=\"" + esc(e.brand) + " pop-up post photo\" loading=\"lazy\" decoding=\"async\"" +
      (e.image.local && safeUrl(e.image.url) ? " data-remote=\"" + esc(e.image.url) + "\"" : "") + ">" + credit + "</div>";
  }
  // Broken image: try the remote copy once, then the foam block with Mattie.
  function imgFallback(root) {
    root.addEventListener("error", function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== "IMG") return;
      var remote = img.getAttribute("data-remote");
      if (remote) { img.removeAttribute("data-remote"); img.src = remote; return; }
      var box = img.closest(".ph, .th");
      if (!box) return;
      if (box.classList.contains("th")) box.innerHTML = THUMB_FACE;
      else { box.className = "ph ph-empty"; box.innerHTML = FACE_BLOCK; }
    }, true);
  }
  function menuHTML(e) {
    var m = menuOf(e), price = e.price ? "<span class=\"price\">" + esc(e.price) + "</span>" : "";
    if (!m.length && !price) return "";
    var pills = m.slice(0, 6).map(function (x) { return "<span class=\"pill\">" + esc(x) + "</span>"; }).join("");
    if (m.length > 6) pills += "<span class=\"pill more\">+" + (m.length - 6) + " more</span>";
    return "<div class=\"menu\">" + (m.length ? "<span class=\"menu-label\">Menu</span>" : "") + pills + price + "</div>";
  }
  function eventCard(e) {
    var line2 = [e.venue, e.address, [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    var tag = e.confidence && e.confidence !== "confirmed" ? " <span class=\"tag\">" + esc(e.confidence) + "</span>" : "";
    var links = [], post = postUrl(e), L = e.links || {};
    if (post) links.push(["Post", post]);
    if (safeUrl(L.instagram)) links.push(["Instagram", L.instagram]);
    if (safeUrl(L.tiktok)) links.push(["TikTok", L.tiktok]);
    links.push(["Directions", "https://www.google.com/maps/dir/?api=1&destination=" + e.lat + "," + e.lng]);
    return "<div class=\"card ecard\">" + photoHTML(e) + "<h3>" + SMALL_FACE + esc(e.brand) + tag + "</h3>" +
      "<p>" + esc(whenText(e)) + (e.status === "past" ? " <span class=\"muted\">(past)</span>" : "") + "</p>" +
      "<p class=\"muted\">" + esc(line2) + "</p>" + menuHTML(e) +
      (e.description ? "<p class=\"desc muted\">" + esc(e.description) + "</p>" : "") +
      "<div class=\"links\">" + links.map(function (l) {
        return "<a href=\"" + esc(l[1]) + "\" target=\"_blank\" rel=\"noopener\">" + l[0] + "</a>";
      }).join("") + "</div></div>";
  }
  function brandCard(b) {
    var links = [];
    if (b.website) links.push(["Website", b.website]);
    if (b.instagram) links.push(["Instagram", "https://www.instagram.com/" + b.instagram + "/"]);
    if (b.tiktok) links.push(["TikTok", "https://www.tiktok.com/@" + b.tiktok]);
    if (b.schedule_url && b.schedule_url !== b.website) links.push(["Schedule", b.schedule_url]);
    return "<div class=\"card\"><h3>" + esc(b.brand) + "</h3>" +
      "<p class=\"muted\">" + esc(b.home_city + ", " + b.home_state) + "</p>" +
      "<p>No dates posted here yet</p><div class=\"links\">" +
      links.map(function (l) { return "<a href=\"" + esc(l[1]) + "\" target=\"_blank\" rel=\"noopener\">" + l[0] + "</a>"; }).join("") +
      "</div></div>";
  }
  function cardHTML(item) { return item.kind === "e" ? eventCard(item.data) : brandCard(item.data); }

  function closeCard() {
    openKey = null;
    $("sheet").hidden = true;
    map.closePopup();
  }
  function showCard(key) {
    var rec = markers[key];
    if (!rec) return;
    openKey = key;
    var html = cardHTML(rec.item);
    if (wide.matches) {
      $("sheet").hidden = true;
      L.popup({ offset: [0, -10], autoPanPadding: [30, 30], maxWidth: 320, minWidth: 260 }).setLatLng(rec.item.ll).setContent(html).openOn(map);
    } else {
      map.closePopup();
      $("sheet-body").innerHTML = html;
      var h3 = $("sheet-body").querySelector("h3");
      if (h3 && !h3.querySelector(".sheet-face")) h3.insertAdjacentHTML("afterbegin", SMALL_FACE);
      $("sheet").scrollTop = 0;
      $("sheet").hidden = false;
    }
  }
  imgFallback(document);
  $("sheet-close").addEventListener("click", closeCard);
  map.on("click", function () { if (!wide.matches) closeCard(); });

  function flyTo(key) {
    var rec = markers[key];
    if (!rec) return;
    if (state.view === "list") setView("map");
    var group = rec.item.kind === "e" ? eventGroup : brandGroup;
    map.invalidateSize();
    if (map.getZoom() < 9) map.setView(rec.item.ll, 11, { animate: false });
    group.zoomToShowLayer(rec.marker, function () { showCard(key); });
  }

  // ---------- layers ----------
  function addMarker(item, group) {
    var m = L.marker(item.ll, {
      icon: pinIcon(item.kind, item.past), keyboard: true,
      title: item.kind === "e" ? item.data.brand + ", " + whenText(item.data) : item.data.brand + ", " + item.data.home_city,
      alt: item.data.brand, zIndexOffset: item.kind === "e" ? 1000 : 0, riseOnHover: true
    });
    m.on("click", function () { showCard(item.key); });
    markers[item.key] = { marker: m, item: item };
    return m;
  }

  function buildBrands(sources) {
    var byCity = {};
    sources.forEach(function (s) {
      if (s.active === false) return;
      var k = s.home_city + "|" + s.home_state;
      if (CITIES[k]) (byCity[k] = byCity[k] || []).push(s);
    });
    var out = [];
    Object.keys(byCity).forEach(function (k) {
      var list = byCity[k].sort(function (a, b) { return a.id < b.id ? -1 : 1; }), c = CITIES[k], n = list.length;
      list.forEach(function (s, i) {
        var ll = c;
        if (n > 1) { // deterministic ring around the centroid, ~1.5 mi radius
          var a = (2 * Math.PI * i) / n, r = 0.022;
          ll = [c[0] + r * Math.sin(a), c[1] + (r * Math.cos(a)) / Math.cos(c[0] * Math.PI / 180)];
        }
        out.push({ kind: "b", key: "b:" + s.id, ll: ll, data: s, name: s.brand });
      });
    });
    state.brands = out;
    brandGroup.addLayers(out.map(function (it) { return addMarker(it, brandGroup); }));
  }

  function visibleEvents() {
    return state.events.filter(function (it) {
      var e = it.data;
      if (e.status === "cancelled") return false;
      if (e.status === "past") {
        if (!state.recent) return false;
        var p = parts(e.start);
        return state.day ? !!p && p.key === state.day : state.chip === "any"; // Recent follows the date filter
      }
      return matchesChip(e);
    });
  }

  function refreshEvents() {
    eventGroup.clearLayers();
    var vis = visibleEvents();
    vis.forEach(function (it) { eventGroup.addLayer(addMarker(it, eventGroup)); });
    renderList();
  }

  // ---------- list ----------
  function inView(ll) { return map.getBounds().contains(ll); }
  function distOf(it) { return state.userLoc ? miles(state.userLoc, it.ll) : null; }

  function rowHTML(it) {
    var d = distOf(it), dist = d != null ? "<span>" + Math.round(d) + " mi</span>" : "";
    if (it.kind === "e") {
      var e = it.data, tag = e.confidence && e.confidence !== "confirmed" ? "<em class=\"tag\">" + esc(e.confidence) + "</em>" : "";
      var src = imgSrc(e), m = menuOf(e).slice(0, 3).join(" · ");
      var thumb = src
        ? "<span class=\"th\"><img src=\"" + esc(src) + "\" alt=\"\" width=\"48\" height=\"48\" loading=\"lazy\" decoding=\"async\"" + (e.image.local && safeUrl(e.image.url) ? " data-remote=\"" + esc(e.image.url) + "\"" : "") + "></span>"
        : "<span class=\"th th-face\">" + THUMB_FACE + "</span>";
      return "<button type=\"button\" class=\"row erow" + (e.status === "past" ? " past" : "") + "\" data-key=\"" + esc(it.key) + "\">" + thumb + "<span class=\"rt\"><strong>" + esc(e.brand) + tag + "</strong><span>" +
        esc(whenText(e)) + "</span><span>" + esc([e.venue, e.city + ", " + e.state].filter(Boolean).join(" · ")) + "</span>" +
        (m ? "<span class=\"menu-prev\">" + esc(m) + "</span>" : "") + dist + "</span></button>";
    }
    return "<button type=\"button\" class=\"row brandrow\" data-key=\"" + esc(it.key) + "\"><strong>" + esc(it.data.brand) + "</strong><span>" +
      esc(it.data.home_city + ", " + it.data.home_state) + " · No dates posted here yet</span>" + dist + "</button>";
  }

  function renderList() {
    var evs = visibleEvents().filter(function (it) { return inView(it.ll); });
    var up = evs.filter(function (it) { return it.data.status !== "past"; });
    var past = evs.filter(function (it) { return it.data.status === "past"; });
    var byStart = function (a, b) { return a.data.start < b.data.start ? -1 : 1; };
    var cmp = state.userLoc ? function (a, b) { return distOf(a) - distOf(b); } : byStart;
    up.sort(cmp);
    past.sort(state.userLoc ? cmp : function (a, b) { return -byStart(a, b); });
    var brands = state.brands.filter(function (it) { return inView(it.ll); });
    brands.sort(state.userLoc ? cmp : function (a, b) { return a.name.localeCompare(b.name); });

    var anyMatch = visibleEvents().length > 0;
    $("empty").hidden = anyMatch || (state.chip === "any" && !state.day);
    var html = "";
    if (up.length) html += "<li class=\"head\">Pop-ups</li>" + up.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    if (past.length) html += "<li class=\"head\">Recent</li>" + past.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    if (brands.length) html += "<li class=\"head\">Brands</li>" + brands.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    if (!html) html = "<li class=\"head\">Nothing in this part of the map. Zoom out or pan.</li>";
    $("list").innerHTML = html;
  }
  $("list").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-key]");
    if (b) flyTo(b.getAttribute("data-key"));
  });
  var moveT;
  map.on("moveend", function () { clearTimeout(moveT); moveT = setTimeout(renderList, 80); });

  // ---------- filters ----------
  function saveChip() {
    try { localStorage.setItem("matchamap.filter", JSON.stringify({ chip: state.chip })); } catch (e) { /* ignore */ }
  }
  function syncChips() {
    document.querySelectorAll("[data-chip]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(!state.day && b.getAttribute("data-chip") === state.chip));
    });
    $("recent").setAttribute("aria-pressed", String(state.recent));
    $("day").value = state.day;
    $("day-clear").hidden = !state.day;
  }
  function applyFilters() { syncChips(); saveChip(); closeCard(); refreshEvents(); }
  document.querySelectorAll("[data-chip]").forEach(function (b) {
    b.addEventListener("click", function () { state.chip = b.getAttribute("data-chip"); state.day = ""; applyFilters(); });
  });
  $("recent").addEventListener("click", function () { state.recent = !state.recent; applyFilters(); });
  $("day").addEventListener("change", function () { state.day = $("day").value; applyFilters(); });
  $("day-clear").addEventListener("click", function () { state.chip = "any"; state.day = ""; applyFilters(); $("day").focus(); });
  $("empty-any").addEventListener("click", function () { state.chip = "any"; state.day = ""; applyFilters(); });

  // ---------- Hawaii ----------
  // The first view fits the contiguous US; one quiet button jumps to Honolulu and back.
  var HOME = [[24.5, -125], [49.5, -66.5]], HI = [21.4, -157.95], inHawaii = false;
  function setupHawaii() {
    var has = state.brands.some(function (b) { return b.data.home_state === "HI"; }) ||
      state.events.some(function (e) { return e.data.state === "HI"; });
    var btn = $("hawaii");
    btn.hidden = !has;
    btn.addEventListener("click", function () {
      closeCard();
      inHawaii = !inHawaii;
      if (inHawaii) map.setView(HI, 9); else map.fitBounds(HOME);
      btn.textContent = inHawaii ? "Mainland" : "Hawaii";
    });
    map.on("moveend", function () {
      var c = map.getCenter(), now = c.lng < -140 && c.lat < 30;
      if (now !== inHawaii) { inHawaii = now; btn.textContent = now ? "Mainland" : "Hawaii"; }
    });
  }

  // ---------- view toggle ----------
  function setView(v) {
    state.view = v;
    document.body.classList.toggle("show-list", v === "list");
    var t = $("view-toggle");
    t.textContent = v === "list" ? "Map" : "List";
    t.setAttribute("aria-pressed", String(v === "list"));
    if (v === "map") setTimeout(function () { map.invalidateSize(); }, 0);
  }
  $("view-toggle").addEventListener("click", function () { setView(state.view === "list" ? "map" : "list"); });
  wide.addEventListener("change", function () { closeCard(); setView("map"); });

  // Status line with Mattie looking surprised, for errors and denied location.
  function oops(text) {
    var note = $("note");
    note.innerHTML = "<svg class=\"oops\" width=\"24\" height=\"24\" viewBox=\"0 0 64 64\" aria-hidden=\"true\" focusable=\"false\"><use href=\"#m-oops\"/></svg>";
    note.appendChild(document.createTextNode(text));
    note.hidden = false;
  }

  // ---------- near me ----------
  $("near").addEventListener("click", function () {
    var note = $("note");
    if (!navigator.geolocation) { oops("Location is off. Pan the map instead."); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      note.hidden = true;
      state.userLoc = [pos.coords.latitude, pos.coords.longitude];
      if (youMarker) youMarker.remove();
      var el = document.createElement("span"); el.className = "you";
      youMarker = L.marker(state.userLoc, { icon: L.divIcon({ html: el, className: "pinwrap", iconSize: [24, 24] }), interactive: false, keyboard: false }).addTo(map);
      if (state.view === "list") setView("map");
      map.setView(state.userLoc, 10);
      renderList();
    }, function () {
      oops("Location is off. Pan the map instead.");
    }, { timeout: 10000, maximumAge: 300000 });
  });

  // ---------- about ----------
  var about = $("about"), aboutOpener = null;
  $("about-btn").addEventListener("click", function () { aboutOpener = document.activeElement; about.showModal(); $("about-close").focus(); });
  $("about-close").addEventListener("click", function () { about.close(); });
  about.addEventListener("click", function (e) { if (e.target === about) about.close(); });
  about.addEventListener("close", function () { if (aboutOpener) aboutOpener.focus(); });
  // Native <dialog> modal keeps focus inside and makes the page inert; Tab wraps within it.

  // ---------- load ----------
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }

  try {
    var saved = JSON.parse(localStorage.getItem("matchamap.filter") || "null");
    if (saved && ["today", "weekend", "week", "any"].indexOf(saved.chip) >= 0) state.chip = saved.chip;
  } catch (e) { /* ignore */ }
  syncChips();

  Promise.all([getJSON("data/events.json"), getJSON("data/sources.json").catch(function () { return []; })]).then(function (res) {
    var data = res[0];
    if (data.generated) {
      var g = new Date(data.generated);
      $("updated").textContent = "Last updated " + MONTHS[g.getMonth()] + " " + g.getDate() + ", " + g.getFullYear() + ".";
    }
    state.events = (data.events || []).filter(function (e) { return e.lat != null && e.lng != null; }).map(function (e) {
      return { kind: "e", key: "e:" + e.id, ll: [e.lat, e.lng], data: e, past: e.status === "past", name: e.brand };
    });
    buildBrands(res[1] || []);
    setupHawaii();
    refreshEvents();
  }).catch(function () {
    oops("Could not load pop-ups. Try again in a moment.");
  }).then(function () { $("loading").hidden = true; });

  // Exposed for tests only.
  window.__matcha = { state: state, matchesChip: matchesChip, whenText: whenText, map: map };
})();
