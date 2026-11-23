(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg";
  var wide = window.matchMedia("(min-width: 900px)");
  var motionQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  var fineQ = window.matchMedia("(hover: hover) and (pointer: fine)");
  var params = new URLSearchParams(location.search);
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = { chip: "any", day: "", recent: false, userLoc: null, zip: "", events: [], brands: [], shops: [], view: "map" };
  var items = {};     // key -> item { kind, key, ll:[lat,lng], data, past, name }
  var live = {};      // marker id -> { marker, el, kind, key, count }
  var openKey = null;

  // ---------- motion ----------
  // ?motion=reduce forces the calm mode for testing; the media query is the real switch.
  function calm() { return params.get("motion") === "reduce" || motionQ.matches; }
  function syncMotion() { document.documentElement.classList.toggle("rm", calm()); }
  syncMotion();
  motionQ.addEventListener("change", syncMotion);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- characters ----------
  // characters.svg holds the model sheet as <symbol>s. Each use copies a symbol's parts into a
  // live inline <svg>, so CSS can blink the eyes, swing the arms and ripple the foam.
  var SYM = {};
  var charsReady = fetch("characters.svg").then(function (r) { if (!r.ok) throw new Error("characters"); return r.text(); }).then(function (t) {
    var doc = new DOMParser().parseFromString(t, "image/svg+xml");
    doc.querySelectorAll("symbol").forEach(function (s) { SYM[s.id] = s; });
    if (window.Drawn) window.Drawn.init(SYM);
  }).catch(function () { /* characters are decoration; the page works without them */ });

  function drawChar(name, cls) {
    var svg = document.createElementNS(NS, "svg"), s = SYM[name];
    svg.setAttribute("class", "ch ch-" + name + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (!s) return svg;
    svg.setAttribute("viewBox", s.getAttribute("viewBox"));
    for (var n = s.firstElementChild; n; n = n.nextElementSibling) svg.appendChild(document.importNode(n, true));
    return svg;
  }
  function fillChars(root) {
    (root || document).querySelectorAll("[data-char]").forEach(function (el) {
      if (el.querySelector("svg")) return;
      el.appendChild(drawChar(el.getAttribute("data-char")));
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
  function addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); }
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
      t = (a.slice(-2) === b.slice(-2) ? a.slice(0, -2) : a) + "–" + b;
    }
    return day + " · " + t;
  }

  // events.json status is as of the last ingest; recompute from the end time (ISO strings carry the offset).
  function liveStatus(e) {
    if (e.status === "cancelled") return "cancelled";
    var st = Date.parse(e.start), en = e.end ? Date.parse(e.end) : st + (e.all_day ? 86400000 : 3 * 3600000);
    return isNaN(en) ? e.status : (en < Date.now() ? "past" : "upcoming");
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
  function lngLat(ll) { return [ll[1], ll[0]]; }

  // ---------- map ----------
  var HOME = [[-125, 24.5], [-66.5, 49.5]], HI = [-157.95, 21.4];
  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
  function styleUrl() { return isDark() ? "map-style-dark.json" : "map-style.json"; }
  var map = new maplibregl.Map({
    container: "map", style: styleUrl(), bounds: HOME, fitBoundsOptions: { padding: 16 },
    minZoom: 2.5, maxZoom: 18, dragRotate: false, pitchWithRotate: false, touchPitch: false,
    attributionControl: { compact: true }, fadeDuration: 200
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  if (wide.matches) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.getCanvas().setAttribute("aria-label", "Map of matcha pop-ups. Use arrow keys to pan, plus and minus to zoom.");

  // Brand mochi get eyes and blush from zoom 9 up (class z9 on the map container).
  function syncZoomFace() { map.getContainer().classList.toggle("z9", map.getZoom() >= 9); }
  map.on("zoomend", syncZoomFace);

  function featureColl(list) {
    return { type: "FeatureCollection", features: list.map(function (it) {
      return { type: "Feature", geometry: { type: "Point", coordinates: lngLat(it.ll) }, properties: { key: it.key } };
    }) };
  }
  // Clusters come from MapLibre's GeoJSON clustering; every pin and cluster is drawn as an HTML
  // marker holding a character, synced from querySourceFeatures. The circle layers are invisible
  // and exist only so the sources load.
  function addData() {
    if (!map.getSource("ev")) map.addSource("ev", { type: "geojson", data: featureColl(visibleEvents()), cluster: true, clusterRadius: 56, clusterMaxZoom: 13 });
    if (!map.getSource("br")) map.addSource("br", { type: "geojson", data: featureColl(visibleBrands()), cluster: true, clusterRadius: 44, clusterMaxZoom: 12 });
    if (!map.getSource("sh")) map.addSource("sh", { type: "geojson", data: featureColl(visibleShops()), cluster: true, clusterRadius: 40, clusterMaxZoom: 13 });
    ["ev", "br", "sh"].forEach(function (s) {
      if (!map.getLayer(s + "-hit")) map.addLayer({ id: s + "-hit", type: "circle", source: s, paint: { "circle-radius": 1, "circle-opacity": 0 } });
    });
    scheduleSync();
  }
  map.on("style.load", addData);

  var syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(function () { syncQueued = false; syncMarkers(); });
  }
  map.on("render", scheduleSync);

  var NUDGE = 12; // px: brand mochi sit down-right of their spot so an event pin on top does not hide them
  function syncMarkers() {
    var seen = {};
    ["ev", "br", "sh"].forEach(function (src) {
      if (!map.getSource(src) || !map.isSourceLoaded(src)) {
        Object.keys(live).forEach(function (id) { if (live[id].src === src) seen[id] = 1; });
        return;
      }
      map.querySourceFeatures(src).forEach(function (f) {
        var p = f.properties, id = p.cluster ? src + "c" + p.cluster_id : p.key;
        if (seen[id]) return;
        if (!p.cluster && !items[id]) return;
        seen[id] = 1;
        var rec = live[id];
        if (!rec) {
          rec = live[id] = p.cluster ? makeCluster(src, id, f) : makePin(items[id]);
          rec.src = src;
          rec.marker.addTo(map);
          rec.el.setAttribute("aria-label", rec.label); // addTo writes "Map marker" over it
        } else if (p.cluster && rec.count !== p.point_count) setCount(rec, p.point_count);
      });
    });
    Object.keys(live).forEach(function (id) { if (!seen[id]) { live[id].marker.remove(); delete live[id]; } });
  }

  function animOnce(el, cls, delay) {
    if (calm()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    if (delay) el.style.animationDelay = delay + "ms";
    el.classList.add(cls);
    el.addEventListener("animationend", function done(ev) {
      if (ev.target !== el) return;
      el.classList.remove(cls); el.style.animationDelay = ""; el.removeEventListener("animationend", done);
    });
  }

  var dropUntil = 0, dropIdx = 0;
  function entrance(rec, fallback) {
    var inner = rec.el.firstChild;
    if (Date.now() < dropUntil) animOnce(inner, "drop", Math.min(dropIdx++ * 38, 700));
    else animOnce(inner, fallback);
  }

  function pinLabel(it) {
    if (it.kind === "s") return it.data.name + ", shop" + (it.data.city ? ", " + it.data.city : "");
    return it.kind === "e" ? it.data.brand + ", " + whenText(it.data) : it.data.brand + ", " + it.data.home_city + ", no dates yet";
  }
  function makePin(it) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "mk " + (it.kind === "e" ? "mk-ev" : it.kind === "s" ? "mk-sh" : "mk-br") + (it.past ? " past" : "") + (it.key === openKey ? " sel" : "");
    el.setAttribute("aria-label", pinLabel(it));
    var inner = document.createElement("span");
    inner.className = "mk-in";
    if (it.kind === "e") {
      inner.appendChild(drawChar("m-base"));
      if (!it.past) { var dot = document.createElement("span"); dot.className = "mk-new"; inner.appendChild(dot); }
    } else if (it.kind === "s") {
      inner.appendChild(drawChar("s-shop"));
    } else {
      inner.innerHTML = "<span class=\"mochi\"></span>";
    }
    el.appendChild(inner);
    el.addEventListener("click", function (ev) { ev.stopPropagation(); cardOpener = null; pinOpener = el; showCard(it.key, ev.detail === 0); });
    var marker = new maplibregl.Marker({ element: el, anchor: it.kind === "e" ? "bottom" : "center", offset: it.kind === "e" || it.kind === "s" ? [0, 0] : [NUDGE, NUDGE] }).setLngLat(lngLat(it.ll));
    var rec = { marker: marker, el: el, kind: it.kind, key: it.key, label: pinLabel(it) };
    if (it.kind === "e") el.style.zIndex = "2";
    if (it.kind === "s") el.style.zIndex = "1";
    entrance(rec, it.kind === "e" || it.kind === "s" ? "pop" : "jiggle");
    return rec;
  }
  function makeCluster(src, id, f) {
    var n = f.properties.point_count;
    var el = document.createElement("button");
    el.type = "button";
    el.className = "mk mk-cl " + (src === "ev" ? "cl-ev" : src === "sh" ? "cl-sh" : "cl-br");
    var inner = document.createElement("span");
    inner.className = "mk-in";
    inner.appendChild(drawChar(src === "sh" ? "s-shop" : "c-dango"));
    var num = document.createElement("span");
    num.className = "cl-n";
    inner.appendChild(num);
    el.appendChild(inner);
    var rec = { marker: null, el: el, kind: "c", count: 0, num: num };
    setCount(rec, n, true);
    el.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var cid = f.properties.cluster_id;
      map.getSource(src).getClusterExpansionZoom(cid).then(function (z) {
        var c = f.geometry.coordinates;
        if (calm()) map.jumpTo({ center: c, zoom: z + 0.2 }); else map.easeTo({ center: c, zoom: z + 0.2, duration: 600 });
      }).catch(function () { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }); });
    });
    rec.marker = new maplibregl.Marker({ element: el, anchor: "center", offset: src === "br" ? [NUDGE, NUDGE] : [0, 0] }).setLngLat(f.geometry.coordinates);
    if (src === "ev") el.style.zIndex = "3";
    if (src === "sh") el.style.zIndex = "1";
    entrance(rec, "pop");
    return rec;
  }
  function setCount(rec, n, first) {
    rec.count = n;
    rec.num.textContent = n;
    rec.label = n + (rec.el.classList.contains("cl-ev") ? " pop-ups" : rec.el.classList.contains("cl-sh") ? " shops" : " brands") + " here, zoom in";
    rec.el.setAttribute("aria-label", rec.label);
    rec.el.classList.toggle("cl-m", n > 9);
    rec.el.classList.toggle("cl-l", n > 24);
    if (!first) animOnce(rec.num, "morph");
  }
  function setSelected(key) {
    Object.keys(live).forEach(function (id) {
      var r = live[id];
      if (r.kind === "c") return;
      var on = id === key;
      if (on !== r.el.classList.contains("sel")) {
        r.el.classList.toggle("sel", on);
        if (on && r.kind === "e") animOnce(r.el.querySelector(".ch"), "wave");
      }
    });
  }

  // ---------- cards ----------
  // Only http(s) links are ever put in an href.
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : ""; }
  // The picture: the downloaded copy, then the post's own url, then the url the Instagram API gave (Meta's urls expire, so the
  // error handler below falls back to the drawn card).
  function imgSrc(e) { var im = e.image; return (im && (im.local || safeUrl(im.url))) || safeUrl(e.image_url); }
  function remoteAttr(e) { return e.image && e.image.local && safeUrl(e.image.url) ? " data-remote=\"" + esc(e.image.url) + "\"" : ""; }
  function eventById(id) {
    for (var i = 0; i < state.events.length; i++) if (state.events[i].data.id === id) return state.events[i].data;
    return null;
  }
  function postUrl(e) {
    var p = e.posts || {};
    return safeUrl(p.instagram) || safeUrl(p.tiktok) || safeUrl(p.other) || safeUrl(e.source_url);
  }
  function menuOf(e) { return Array.isArray(e.menu) ? e.menu : []; }
  var FACE_BLOCK = "<span class=\"ph-face\" data-char=\"m-happy\"></span>";
  var SMALL_FACE = "<span class=\"card-face\" data-char=\"m-base\"></span>";
  var THUMB_FACE = "<span class=\"th-char\" data-char=\"m-base\"></span>";
  function photoHTML(e) {
    var src = imgSrc(e);
    if (!src) return window.Drawn ? window.Drawn.block(e, { when: whenText(e) }) : "<div class=\"ph ph-empty\">" + FACE_BLOCK + "</div>";
    var credit = e.image && e.image.credit ? "<span class=\"ph-credit\">Photo: " + esc(e.image.credit) + "</span>" : "";
    return "<div class=\"ph\"><img src=\"" + esc(src) + "\" alt=\"" + esc(e.brand) + " pop-up post photo\" data-eid=\"" + esc(e.id) + "\" loading=\"lazy\" decoding=\"async\"" +
      remoteAttr(e) + ">" + credit + "</div>";
  }
  // Broken image: try the remote copy once, then the drawn card (or the foam block with Mattie when there is nothing to draw from).
  function imgFallback(root) {
    root.addEventListener("error", function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== "IMG") return;
      var remote = img.getAttribute("data-remote");
      if (remote) { img.removeAttribute("data-remote"); img.src = remote; return; }
      var box = img.closest(".ph, .th");
      if (!box) return;
      var ev = eventById(img.getAttribute("data-eid"));
      if (box.classList.contains("th")) {
        if (ev && window.Drawn) { box.className = "th th-drawn"; box.innerHTML = window.Drawn.card(ev, { mode: "thumb" }); }
        else { box.className = "th th-face"; box.innerHTML = THUMB_FACE; }
      } else if (ev && window.Drawn) { box.outerHTML = window.Drawn.block(ev, { when: whenText(ev) }); return; }
      else { box.className = "ph ph-empty"; box.innerHTML = FACE_BLOCK; }
      fillChars(box);
    }, true);
  }
  function linksHTML(links) {
    return "<div class=\"links\">" + links.map(function (l) {
      return "<a href=\"" + esc(l[1]) + "\" target=\"_blank\" rel=\"noopener\">" + l[0] + "</a>";
    }).join("") + "</div>";
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
    return "<div class=\"card ecard\">" + photoHTML(e) + "<h3>" + SMALL_FACE + "<span>" + esc(e.brand) + tag + "</span></h3>" + kindWord(e) +
      "<p class=\"when\">" + esc(whenText(e)) + (e.status === "past" ? " <span class=\"muted\">(past)</span>" : "") + "</p>" +
      "<p class=\"muted\">" + esc(line2) + "</p>" + menuHTML(e) +
      (e.description ? "<p class=\"desc muted\">" + esc(e.description) + "</p>" : "") + linksHTML(links) + "</div>";
  }
  function brandCard(b) {
    var links = [];
    if (safeUrl(b.website)) links.push(["Website", b.website]);
    if (b.instagram) links.push(["Instagram", "https://www.instagram.com/" + encodeURIComponent(b.instagram) + "/"]);
    if (b.tiktok) links.push(["TikTok", "https://www.tiktok.com/@" + encodeURIComponent(b.tiktok)]);
    if (safeUrl(b.schedule_url) && b.schedule_url !== b.website) links.push(["Schedule", b.schedule_url]);
    return "<div class=\"card bcard\">" + (window.Drawn ? window.Drawn.block(b, { mode: "brand" }) : "") + "<h3><span class=\"card-mochi\" aria-hidden=\"true\"></span><span>" + esc(b.brand) + "</span></h3>" + kindWord(b) +
      "<p class=\"muted\">" + esc(b.home_city + ", " + b.home_state) + "</p>" +
      "<p class=\"when\">No dates posted here yet</p>" + linksHTML(links) + "</div>";
  }
  // Hours: the raw OSM string, passed through; long ones are cut with the full text in a title.
  function hoursHTML(h) {
    if (!h) return "";
    var s = String(h).replace(/\s+/g, " ").trim(), cut = s.length > 64 ? s.slice(0, 63).replace(/[\s;,]+$/, "") + "\u2026" : s;
    return "<p class=\"hours\" title=\"" + esc(s) + "\">" + esc(cut) + "</p>";
  }
  function shopAddress(s) {
    var tail = [s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [s.address, tail].filter(Boolean).join(", ");
  }
  function shopCard(s) {
    var links = [];
    if (safeUrl(s.website)) links.push(["Website", s.website]);
    if (s.instagram) links.push(["Instagram", "https://www.instagram.com/" + encodeURIComponent(s.instagram) + "/"]);
    links.push(["Directions", "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lng]);
    var credit = s.source === "osm" && safeUrl(s.osm_url) ? "<p class=\"credit-line\">Data: <a href=\"" + esc(s.osm_url) + "\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a></p>" : "";
    var art = window.Drawn ? window.Drawn.block({ id: s.id, brand: s.name, home_city: s.city, home_state: s.state }, { mode: "shop" }) : "";
    return "<div class=\"card scard\">" + art + "<h3><span class=\"card-shop\" data-char=\"s-shop\"></span><span>" + esc(s.name) + "</span></h3><span class=\"kindword\">Shop</span>" +
      "<p class=\"muted\">" + esc(shopAddress(s)) + "</p>" + hoursHTML(s.opening_hours) + linksHTML(links) + credit + "</div>";
  }
  function cardHTML(item) { return item.kind === "e" ? eventCard(item.data) : item.kind === "s" ? shopCard(item.data) : brandCard(item.data); }

  var popup = null, closeT = null;
  function finishClose() {
    clearTimeout(closeT); closeT = null;
    $("sheet").hidden = true;
    $("sheet").classList.remove("out");
    if (popup) { popup.remove(); popup = null; }
  }
  function closeCard(instant) {
    if (!openKey && !popup && $("sheet").hidden) return;
    openKey = null;
    setSelected(null);
    var sheetOpen = !$("sheet").hidden;
    if (instant || calm()) { finishClose(); return; }
    if (sheetOpen) $("sheet").classList.add("out");
    if (popup) popup.getElement().classList.add("out");
    clearTimeout(closeT);
    closeT = setTimeout(finishClose, 200);
  }
  function showCard(key, focusIt) {
    var it = items[key];
    if (!it) return;
    finishClose();
    openKey = key;
    setSelected(key);
    var html = cardHTML(it);
    if (wide.matches) {
      var box = document.createElement("div");
      box.innerHTML = "<button type=\"button\" class=\"close pop-close\" aria-label=\"Close details\">&times;</button>" + html;
      fillChars(box);
      box.querySelector(".pop-close").addEventListener("click", function () { var back = cardOpener; closeCard(); refocus(back); });
      popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "340px", focusAfterOpen: false, className: "mm-pop",
        anchor: "bottom", offset: it.kind === "e" ? [0, -50] : it.kind === "s" ? [0, -18] : [NUDGE, NUDGE - 12] })
        .setLngLat(lngLat(it.ll)).setDOMContent(box).addTo(map);
      // Keep the whole card on screen: nudge the map down when the card would run off the top.
      var pr = popup.getElement().getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
      var over = mr.top + 12 - pr.top;
      if (over > 0) map.panBy([0, -over], { duration: calm() ? 0 : 300 });
      if (focusIt) box.querySelector(".pop-close").focus();
    } else {
      var body = $("sheet-body");
      body.innerHTML = html;
      fillChars(body);
      var sh = $("sheet");
      body.scrollTop = 0;
      sh.hidden = false;
      animOnce(sh, "in");
      if (focusIt) $("sheet-close").focus();
    }
  }
  var pinOpener = null;
  function refocus(back) {
    if (!back) { if (pinOpener && document.contains(pinOpener)) pinOpener.focus(); pinOpener = null; return; }
    pinOpener = null;
    setTimeout(function () { var r = document.querySelector("#list [data-key=\"" + back + "\"]"); if (r) r.focus(); }, 0);
  }
  imgFallback(document);
  $("sheet-close").addEventListener("click", function () { var back = cardOpener; closeCard(); refocus(back); });
  map.on("click", function (e) {
    var t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest(".maplibregl-marker, .maplibregl-popup")) return;
    closeCard();
  });
  // Escape closes the open card (the About dialog handles its own Escape) and hands focus back to the row that opened it.
  var cardOpener = null;
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !openKey || $("about").open) return;
    var back = cardOpener;
    closeCard();
    refocus(back);
  });

  function moveMap(opts, done) {
    // Listen first: jumpTo fires moveend before it returns.
    if (done) map.once("moveend", function () { setTimeout(done, 30); });
    if (calm()) { map.jumpTo(opts); } else { opts.curve = 1.3; opts.speed = 1.5; opts.essential = false; map.flyTo(opts); }
  }
  function flyTo(key) {
    var it = items[key];
    if (!it) return;
    var ae = document.activeElement;
    cardOpener = ae && ae.closest && ae.closest("#list") ? ae.getAttribute("data-key") : null;
    if (state.view === "list") setView("map");
    map.resize();
    var z = Math.max(map.getZoom(), it.kind === "e" ? 14 : it.kind === "s" ? 15 : 13.2);
    // On a phone the sheet covers the lower part of the map, so the pin lands in the upper part;
    // on desktop the card opens above the pin, so the pin lands low.
    var h = map.getContainer().clientHeight;
    var off = wide.matches ? [0, Math.round(h * 0.3)] : [0, -Math.round(h * 0.26)];
    moveMap({ center: lngLat(it.ll), zoom: z, offset: off }, function () { syncMarkers(); showCard(key, !!cardOpener); });
  }

  // ---------- layers ----------
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
        var it = { kind: "b", key: "b:" + s.id, ll: ll, data: s, name: s.brand };
        items[it.key] = it;
        out.push(it);
      });
    });
    state.brands = out;
  }

  function buildShops(list) {
    state.shops = (list || []).filter(function (s) { return isFinite(s.lat) && isFinite(s.lng) && s.name; }).map(function (s) {
      var it = { kind: "s", key: "s:" + s.id, ll: [s.lat, s.lng], data: s, name: s.name };
      items[it.key] = it;
      return it;
    });
  }
  // Storefronts switch: on by default, remembered on its own key.
  var SHOPS_KEY = "matchamap.shops", shopsOn = true;
  try { if (localStorage.getItem(SHOPS_KEY) === "0") shopsOn = false; } catch (e) { /* ignore */ }
  function visibleShops() { return shopsOn ? state.shops : []; }

  // ---------- what counts: kind and category (data/KINDS.md) ----------
  var KINDS = ["popup", "cafe", "organizer", "festival", "venue", "tea-brand"], CATS = ["matcha", "coffee", "boba", "bakery", "dessert", "other"];
  var KIND_WORD = { cafe: "cafe", organizer: "class", festival: "festival", venue: "host", "tea-brand": "tea brand" };
  // Default: category matcha, every kind on. "Pop-up brands only" keeps kind popup.
  var show = { po: false, k: {}, c: { matcha: true } };
  KINDS.forEach(function (k) { show.k[k] = true; });
  try {
    var sv = JSON.parse(localStorage.getItem("matchamap.show2") || "null");
    if (sv && Array.isArray(sv.k) && Array.isArray(sv.c)) {
      show = { po: !!sv.po, k: {}, c: {} };
      sv.k.forEach(function (k) { if (KINDS.indexOf(k) >= 0) show.k[k] = true; });
      sv.c.forEach(function (c) { if (CATS.indexOf(c) >= 0) show.c[c] = true; });
    }
  } catch (e) { /* ignore */ }
  function passesShow(o) {
    var k = o.kind || "popup";
    return (show.po ? k === "popup" : !!show.k[k]) && !!show.c[o.category || "matcha"];
  }
  // How many choices differ from the default (the badge number).
  function showDiff() {
    var n = (show.po ? 1 : 0) + (shopsOn ? 0 : 1);
    if (!show.po) KINDS.forEach(function (k) { if (!show.k[k]) n++; });
    CATS.forEach(function (c) { if (!!show.c[c] !== (c === "matcha")) n++; });
    return n;
  }
  function kindWord(o) { return KIND_WORD[o.kind] ? "<span class=\"kindword\">" + KIND_WORD[o.kind] + "</span>" : ""; }
  function visibleBrands() { return state.brands.filter(function (it) { return passesShow(it.data); }); }

  function visibleEvents() {
    return state.events.filter(function (it) {
      var e = it.data;
      if (!passesShow(e)) return false;
      if (e.status === "cancelled") return false;
      if (e.status === "past") {
        if (!state.recent) return false;
        var p = parts(e.start);
        return state.day ? !!p && p.key === state.day : state.chip === "any"; // Recent follows the date filter
      }
      return matchesChip(e);
    });
  }

  function refreshEvents(stagger) {
    var src = map.getSource("ev");
    if (src) src.setData(featureColl(visibleEvents()));
    var b = map.getSource("br");
    if (b) b.setData(featureColl(visibleBrands()));
    var sh = map.getSource("sh");
    if (sh) sh.setData(featureColl(visibleShops()));
    renderList(stagger);
  }

  // ---------- list ----------
  function inView(ll) { return map.getBounds().contains(lngLat(ll)); }
  function distOf(it) { return state.userLoc ? miles(state.userLoc, it.ll) : null; }

  function rowHTML(it) {
    var d = distOf(it), dist = d != null ? "<span class=\"dist\">" + (d < 10 ? Math.round(d * 10) / 10 : Math.round(d)) + " mi</span>" : "";
    if (it.kind === "e") {
      var e = it.data, tag = e.confidence && e.confidence !== "confirmed" ? "<em class=\"tag\">" + esc(e.confidence) + "</em>" : "";
      var src = imgSrc(e), m = menuOf(e).slice(0, 3).join(" · ");
      var thumb = src
        ? "<span class=\"th\"><img src=\"" + esc(src) + "\" alt=\"\" width=\"56\" height=\"56\" data-eid=\"" + esc(e.id) + "\" loading=\"lazy\" decoding=\"async\"" + remoteAttr(e) + "></span>"
        : (window.Drawn ? "<span class=\"th th-drawn\">" + window.Drawn.card(e, { mode: "thumb" }) + "</span>" : "<span class=\"th th-face\">" + THUMB_FACE + "</span>");
      return "<button type=\"button\" class=\"row erow" + (e.status === "past" ? " past" : "") + "\" data-key=\"" + esc(it.key) + "\">" + thumb + "<span class=\"rt\"><strong>" + esc(e.brand) + tag + "</strong>" + kindWord(e) + "<span class=\"when\">" +
        esc(whenText(e)) + "</span><span>" + esc([e.venue, e.city + ", " + e.state].filter(Boolean).join(" · ")) + "</span>" +
        (m ? "<span class=\"menu-prev\">" + esc(m) + "</span>" : "") + dist + "</span></button>";
    }
    if (it.kind === "s") {
      var s = it.data;
      return "<button type=\"button\" class=\"row shoprow\" data-key=\"" + esc(it.key) + "\"><span class=\"th th-shop\" aria-hidden=\"true\" data-char=\"s-shop\"></span><span class=\"rt\"><strong>" + esc(s.name) + "</strong><span class=\"kindword\">Shop</span><span>" +
        esc([s.address, s.city].filter(Boolean).join(", ") || shopAddress(s)) + "</span>" + dist + "</span></button>";
    }
    return "<button type=\"button\" class=\"row brandrow\" data-key=\"" + esc(it.key) + "\"><span class=\"th th-mochi\" aria-hidden=\"true\"><span class=\"mochi\"></span></span><span class=\"rt\"><strong>" + esc(it.data.brand) + "</strong>" + kindWord(it.data) + "<span>" +
      esc(it.data.home_city + ", " + it.data.home_state) + " · No dates posted here yet</span>" + dist + "</span></button>";
  }

  function renderList(stagger) {
    var vis = visibleEvents();
    var evs = vis.filter(function (it) { return inView(it.ll); });
    var up = evs.filter(function (it) { return it.data.status !== "past"; });
    var past = evs.filter(function (it) { return it.data.status === "past"; });
    var byStart = function (a, b) { return a.data.start < b.data.start ? -1 : 1; };
    var cmp = state.userLoc ? function (a, b) { return distOf(a) - distOf(b); } : byStart;
    up.sort(cmp);
    past.sort(state.userLoc ? cmp : function (a, b) { return -byStart(a, b); });
    var brands = visibleBrands().filter(function (it) { return inView(it.ll); });
    brands.sort(state.userLoc ? cmp : function (a, b) { return a.name.localeCompare(b.name); });

    var shopsIn = visibleShops().filter(function (it) { return inView(it.ll); });
    shopsIn.sort(state.userLoc ? cmp : function (a, b) { return a.name.localeCompare(b.name); });

    $("empty").hidden = vis.length > 0 || (state.chip === "any" && !state.day);
    var html = "";
    if (up.length) html += "<li class=\"head\">Pop-ups</li>" + up.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    if (past.length) html += "<li class=\"head\">Recent</li>" + past.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    if (brands.length) html += "<li class=\"head\">Brands</li>" + brands.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    if (shopsIn.length) {
      if (map.getZoom() < 8 && !state.userLoc) html += "<li class=\"head\">Shops</li><li class=\"shopnote\">" + shopsIn.length + " shop" + (shopsIn.length === 1 ? "" : "s") + " \u00b7 zoom in</li>";
      else if (map.getZoom() >= 8) {
        var cap = 80, more = shopsIn.length - cap;
        html += "<li class=\"head\">Shops</li>" + shopsIn.slice(0, cap).map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("") +
          (more > 0 ? "<li class=\"shopnote\">+" + more + " more \u00b7 zoom in</li>" : "");
      } else html += "<li class=\"head\">Shops</li><li class=\"shopnote\">" + shopsIn.length + " shops \u00b7 zoom in</li>";
    }
    if (!html) html = "<li class=\"head\">Nothing in this part of the map. Zoom out or pan.</li>";
    var list = $("list");
    list.innerHTML = html;
    fillChars(list);
    if (stagger && !calm()) {
      var rows = list.children;
      for (var i = 0; i < rows.length && i < 12; i++) animOnce(rows[i], "row-in", i * 30);
    }
  }
  $("list").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-key]");
    if (b) flyTo(b.getAttribute("data-key"));
  });
  var moveT;
  map.on("moveend", function () { clearTimeout(moveT); moveT = setTimeout(function () { renderList(false); }, 80); });

  // ---------- filters ----------
  var ink = document.querySelector(".chip-ink");
  function moveInk() {
    var t = state.day ? null : document.querySelector("[data-chip][aria-pressed=\"true\"]");
    if (!t) { ink.classList.add("off"); return; }
    ink.classList.remove("off");
    ink.classList.toggle("pink", t.getAttribute("data-chip") === "today");
    ink.style.width = t.offsetWidth + "px";
    ink.style.height = t.offsetHeight + "px";
    ink.style.transform = "translate(" + t.offsetLeft + "px," + t.offsetTop + "px)";
  }
  function saveChip() {
    try { localStorage.setItem("matchamap.filter", JSON.stringify({ chip: state.chip })); } catch (e) { /* ignore */ }
  }
  function syncChips() {
    document.querySelectorAll("[data-chip]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(!state.day && b.getAttribute("data-chip") === state.chip));
    });
    $("recent").setAttribute("aria-pressed", String(state.recent));
    $("day").value = state.day;
    $("day").classList.toggle("set", !!state.day);
    $("day-clear").hidden = !state.day;
    moveInk();
  }
  function applyFilters() { syncChips(); saveChip(); closeCard(true); refreshEvents(true); }
  document.querySelectorAll("[data-chip]").forEach(function (b) {
    b.addEventListener("click", function () { state.chip = b.getAttribute("data-chip"); state.day = ""; applyFilters(); });
  });
  $("recent").addEventListener("click", function () { state.recent = !state.recent; applyFilters(); });
  $("day").addEventListener("change", function () { state.day = $("day").value; applyFilters(); });
  $("day-clear").addEventListener("click", function () { state.chip = "any"; state.day = ""; applyFilters(); $("day").focus(); });
  $("empty-any").addEventListener("click", function () { state.chip = "any"; state.day = ""; applyFilters(); });
  window.addEventListener("resize", moveInk);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInk);

  // ---------- Hawaii ----------
  // The first view fits the contiguous US; one quiet button jumps to Honolulu and back.
  // A small Mattie hops off the button while the map flies.
  var inHawaii = false;
  function hop() {
    if (calm()) return;
    var h = $("hop");
    h.hidden = false;
    animOnce(h, "go");
    setTimeout(function () { h.hidden = true; }, 820);
  }
  function setupHawaii() {
    var has = state.brands.some(function (b) { return b.data.home_state === "HI"; }) ||
      state.events.some(function (e) { return e.data.state === "HI"; });
    var btn = $("hawaii");
    btn.hidden = !has;
    btn.addEventListener("click", function () {
      closeCard(true);
      inHawaii = !inHawaii;
      hop();
      if (inHawaii) moveMap({ center: HI, zoom: 9 });
      else if (calm()) map.fitBounds(HOME, { padding: 16, animate: false });
      else map.fitBounds(HOME, { padding: 16, duration: 1400, curve: 1.3 });
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
    if (v === "map") setTimeout(function () { map.resize(); }, 0);
    else renderList(true);
  }
  $("view-toggle").addEventListener("click", function () { setView(state.view === "list" ? "map" : "list"); });
  wide.addEventListener("change", function () { closeCard(true); setView("map"); });

  // Status line with Mattie looking surprised (sweat drop), for errors and denied location.
  function oops(text) {
    var note = $("note");
    note.innerHTML = "<span class=\"oops\" data-char=\"m-surprised\"></span>";
    fillChars(note);
    note.appendChild(document.createTextNode(text));
    note.hidden = false;
  }

  // ---------- near me and zip ----------
  // One "you are here" marker: a dot for Near me, Chasen for a zip. Each clears the other.
  var youMarker = null, ZIP_KEY = "matchamap.zip";
  function placeYou(ll, zip) {
    state.userLoc = ll;
    if (youMarker) youMarker.remove();
    var el = document.createElement("span");
    el.className = "you" + (zip ? " you-zip" : "");
    el.innerHTML = "<span class=\"ring\"></span><span class=\"ring r2\"></span>" + (zip ? "" : "<span class=\"you-dot\"></span>");
    if (zip) el.appendChild(drawChar("c-chasen", "you-chasen"));
    youMarker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat(ll)).addTo(map);
    return el;
  }
  function clearYou() {
    if (youMarker) { youMarker.remove(); youMarker = null; }
    state.userLoc = null; state.zip = "";
    $("nearrow").hidden = true;
    try { localStorage.removeItem(ZIP_KEY); } catch (e) { /* ignore */ }
  }
  $("near").addEventListener("click", function () {
    var note = $("note");
    if (!navigator.geolocation) { oops("Location is off. Pan the map instead."); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      note.hidden = true;
      clearYou();
      $("zip").value = "";
      var el = placeYou([pos.coords.latitude, pos.coords.longitude], false);
      if (state.view === "list") setView("map");
      moveMap({ center: lngLat(state.userLoc), zoom: 10 }, function () { animOnce(el, "ping"); renderList(true); });
    }, function () {
      oops("Location is off. Pan the map instead.");
    }, { timeout: 10000, maximumAge: 300000 });
  });

  var zipsP = null;
  function loadZips() {
    if (!zipsP) {
      var ld = $("loading");
      ld.hidden = false;
      zipsP = fetch("data/zips.json").then(function (r) { if (!r.ok) throw new Error("zips"); return r.json(); }).then(function (z) { ld.hidden = true; return z; }, function (err) { ld.hidden = true; zipsP = null; throw err; });
    }
    return zipsP;
  }
  var zipErrT = null;
  function zipError(text) {
    var inp = $("zip"), er = $("zip-err");
    er.textContent = text || "No such zip";
    var r = inp.getBoundingClientRect();
    er.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 150)) + "px";
    er.style.top = (r.bottom + 6) + "px";
    er.hidden = false;
    animOnce(inp, "shake");
    clearTimeout(zipErrT);
    zipErrT = setTimeout(function () { er.hidden = true; }, 3000);
  }
  // Fly to a zip's centroid. quiet: a return visit, so no error and the map jumps there.
  function goZip(zip, quiet) {
    if (!/^\d{5}$/.test(zip)) { if (!quiet) zipError("No such zip"); return; }
    loadZips().then(function (z) {
      var c = Object.prototype.hasOwnProperty.call(z, zip) ? z[zip] : null;
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) {
        if (!quiet) zipError("No such zip"); else { try { localStorage.removeItem(ZIP_KEY); } catch (e) { /* ignore */ } }
        return;
      }
      $("zip-err").hidden = true;
      closeCard(true);
      clearYou();
      state.zip = zip;
      $("zip").value = zip;
      var el = placeYou([c[0], c[1]], true);
      $("nearzip").textContent = zip;
      $("nearrow").hidden = false;
      try { localStorage.setItem(ZIP_KEY, zip); } catch (e) { /* ignore */ }
      if (state.view === "list") setView("map");
      var opts = { center: lngLat(state.userLoc), zoom: 10 };
      if (quiet) { map.jumpTo(opts); animOnce(el, "ping"); renderList(false); }
      else moveMap(opts, function () { animOnce(el, "ping"); renderList(true); });
    }).catch(function () { if (!quiet) zipError("Zip list did not load"); });
  }
  $("zip").addEventListener("input", function () { this.value = this.value.replace(/\D/g, "").slice(0, 5); });
  $("zip").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); goZip(this.value, false); } });
  $("zip-go").addEventListener("click", function () { goZip($("zip").value, false); });
  $("nearclear").addEventListener("click", function () { clearYou(); $("zip").value = ""; renderList(true); $("zip").focus(); });

  // ---------- show: which kinds and categories ----------
  var showBtn = $("show-btn"), showPop = $("show-pop");
  function syncShow() {
    $("show-po").checked = show.po;
    $("show-shops").checked = shopsOn;
    showPop.querySelectorAll("[data-kind]").forEach(function (i) { i.checked = !!show.k[i.getAttribute("data-kind")]; i.disabled = show.po; i.parentNode.classList.toggle("off", show.po); });
    showPop.querySelectorAll("[data-cat]").forEach(function (i) { i.checked = !!show.c[i.getAttribute("data-cat")]; });
    var n = showDiff(), badge = $("show-n");
    badge.hidden = n === 0;
    badge.textContent = " · " + n;
    showBtn.setAttribute("aria-label", n === 0 ? "Show" : "Show, " + n + " changed");
  }
  function placeShow() {
    var r = showBtn.getBoundingClientRect(), w = showPop.offsetWidth || 260;
    showPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    showPop.style.top = (r.bottom + 6) + "px";
  }
  function openShow() { showPop.hidden = false; showBtn.setAttribute("aria-expanded", "true"); placeShow(); animOnce(showPop, "pop-in"); }
  function closeShow(back) {
    if (showPop.hidden) return;
    showPop.hidden = true; showBtn.setAttribute("aria-expanded", "false");
    if (back) showBtn.focus();
  }
  showBtn.addEventListener("click", function () { if (showPop.hidden) openShow(); else closeShow(); });
  showPop.addEventListener("change", function (ev) {
    var t = ev.target, k = t.getAttribute("data-kind"), c = t.getAttribute("data-cat");
    if (t.id === "show-po") show.po = t.checked;
    if (t.id === "show-shops") { shopsOn = t.checked; try { localStorage.setItem(SHOPS_KEY, shopsOn ? "1" : "0"); } catch (e) { /* ignore */ } }
    if (k) { if (t.checked) show.k[k] = true; else delete show.k[k]; }
    if (c) { if (t.checked) show.c[c] = true; else delete show.c[c]; }
    try { localStorage.setItem("matchamap.show2", JSON.stringify({ po: show.po, k: Object.keys(show.k), c: Object.keys(show.c) })); } catch (e) { /* ignore */ }
    syncShow();
    closeCard(true);
    refreshEvents(true);
  });
  document.addEventListener("pointerdown", function (ev) {
    if (showPop.hidden || showPop.contains(ev.target) || showBtn.contains(ev.target)) return;
    closeShow();
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !showPop.hidden) { ev.stopPropagation(); closeShow(true); } }, true);
  window.addEventListener("resize", function () { if (!showPop.hidden) placeShow(); });
  document.querySelectorAll(".filters, .frow1").forEach(function (f) { f.addEventListener("scroll", function () { closeShow(); }); });
  syncShow();

  // ---------- about ----------
  var about = $("about"), aboutOpener = null;
  $("about-btn").addEventListener("click", function () { aboutOpener = document.activeElement; about.showModal(); $("about-close").focus(); });
  $("about-close").addEventListener("click", function () { about.close(); });
  about.addEventListener("click", function (e) { if (e.target === about) about.close(); });
  about.addEventListener("close", function () { if (aboutOpener) aboutOpener.focus(); });

  // ---------- theme crossfade ----------
  // Light by default; the header button turns dark on and off and remembers it (theme.js reads it first).
  var themeBtn = $("theme-btn"), themeMeta = document.querySelector("meta[name=theme-color]");
  function syncThemeBtn() {
    themeBtn.setAttribute("aria-pressed", String(isDark()));
    themeMeta.setAttribute("content", isDark() ? "#17211A" : "#FBF6EA");
  }
  syncThemeBtn();
  themeBtn.addEventListener("click", function () {
    var dark = !isDark();
    if (dark) document.documentElement.setAttribute("data-theme", "dark"); else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("matchamap.theme", dark ? "dark" : "light"); } catch (e) { /* ignore */ }
    syncThemeBtn();
    var f = $("mapfade");
    f.classList.add("on");
    twirl();
    setTimeout(function () {
      map.setStyle(styleUrl(), { diff: false });
      map.once("idle", function () { f.classList.remove("on"); });
    }, 250);
  });

  // ---------- header Mattie: blink, breathe, glance ----------
  var hdr = $("hdr-mattie");
  function blinkLoop() {
    setTimeout(function () {
      var svg = hdr.querySelector("svg");
      if (svg && !calm() && !document.hidden) animOnce(svg, "blink");
      var dc = document.querySelector(".ph-drawn svg.dc");
      if (dc && !calm() && !document.hidden) animOnce(dc, "blink");
      blinkLoop();
    }, 4000 + Math.random() * 3000);
  }
  var lookRaf = 0, lookX = 0, lookY = 0;
  function onPointer(ev) {
    lookX = ev.clientX; lookY = ev.clientY;
    if (lookRaf) return;
    lookRaf = requestAnimationFrame(function () {
      lookRaf = 0;
      var g = hdr.querySelector(".m-look");
      if (!g || calm()) return;
      var r = hdr.getBoundingClientRect(), dx = lookX - (r.left + r.width / 2), dy = lookY - (r.top + r.height / 2);
      var d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(d / 240, 1) * 2;
      g.style.transform = "translate(" + (dx / d * k).toFixed(2) + "px," + (dy / d * k * 0.7).toFixed(2) + "px)";
    });
  }
  if (fineQ.matches) document.addEventListener("pointermove", onPointer, { passive: true });

  function twirl() { var s = $("chasen").querySelector("svg"); if (s) animOnce(s, "twirl"); }

  // ---------- opening moment ----------
  var SEEN = "matchamap.opened";
  var intro = $("intro");
  var introDone = false, introTimers = [];
  function endIntro(fast) {
    if (introDone) return;
    introDone = true;
    introTimers.forEach(clearTimeout);
    try { sessionStorage.setItem(SEEN, "1"); } catch (e) { /* ignore */ }
    intro.classList.add("gone");
    setTimeout(function () { intro.hidden = true; $("petals").hidden = true; $("petals").innerHTML = ""; }, fast ? 160 : 320);
  }
  function petals() {
    var box = $("petals");
    box.hidden = false;
    var n = 8;
    for (var i = 0; i < n; i++) {
      var p = document.createElement("span");
      p.className = "petal";
      p.style.left = (6 + i * (88 / n) + Math.random() * 6).toFixed(1) + "%";
      p.style.animationDelay = Math.round(i * 90 + Math.random() * 120) + "ms";
      p.style.animationDuration = Math.round(1700 + Math.random() * 700) + "ms";
      p.style.setProperty("--sway", (Math.random() * 40 - 20).toFixed(0) + "px");
      p.style.setProperty("--spin", (Math.random() * 300 + 120).toFixed(0) + "deg");
      p.appendChild(drawChar("c-petal"));
      box.appendChild(p);
    }
  }
  function playIntro() {
    var first = params.get("intro") === "1";
    try { first = first || !sessionStorage.getItem(SEEN); } catch (e) { first = false; }
    if (!first || calm()) {
      // Repeat visit, or calm mode: a 300ms fade only.
      intro.classList.add("quick");
      setTimeout(function () { endIntro(false); }, 0);
      return;
    }
    fillChars(intro);
    intro.classList.add("play");
    petals();
    introTimers.push(setTimeout(function () {
      var m = intro.querySelector(".intro-mattie").getBoundingClientRect();
      intro.style.setProperty("--ix", Math.round(m.left + m.width / 2) + "px");
      intro.style.setProperty("--iy", Math.round(m.top + m.height / 2) + "px");
      intro.classList.add("iris");
      dropUntil = Date.now() + 900; dropIdx = 0;
      Object.keys(live).forEach(function (id) { entrance(live[id], "pop"); });
    }, 880));
    introTimers.push(setTimeout(function () { endIntro(false); }, 1400));
  }
  $("intro-skip").addEventListener("click", function () { endIntro(true); });

  // ---------- load ----------
  function getJSON(u) { twirl(); return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }

  try {
    var saved = JSON.parse(localStorage.getItem("matchamap.filter") || "null");
    if (saved && ["today", "weekend", "week", "any"].indexOf(saved.chip) >= 0) state.chip = saved.chip;
  } catch (e) { /* ignore */ }
  syncChips();

  charsReady.then(function () {
    fillChars(document.querySelector(".bar"));
    fillChars($("loading"));
    fillChars($("empty"));
    fillChars($("about"));
    fillChars($("sheet"));
    fillChars($("hop"));
    playIntro();
    blinkLoop();
    twirl();
  });

  var dataReady = Promise.all([getJSON("data/events.json"), getJSON("data/sources.json").catch(function () { return []; })]);
  Promise.all([dataReady, charsReady]).then(function (r) {
    var res = r[0], data = res[0];
    if (data.generated) {
      var g = new Date(data.generated);
      $("updated").textContent = "Last updated " + MONTHS[g.getMonth()] + " " + g.getDate() + ", " + g.getFullYear() + ".";
    }
    state.events = (data.events || []).filter(function (e) { return e.lat != null && e.lng != null; }).map(function (e) {
      e.status = liveStatus(e);
      var it = { kind: "e", key: "e:" + e.id, ll: [e.lat, e.lng], data: e, past: e.status === "past", name: e.brand };
      items[it.key] = it;
      return it;
    });
    buildBrands(res[1] || []);
    setupHawaii();
    var go = function () { syncZoomFace(); refreshEvents(false); };
    go(); // sources added later by addData (style.load) start from the same lists
    var zs = ""; try { zs = localStorage.getItem(ZIP_KEY) || ""; } catch (e) { /* ignore */ }
    if (/^\d{5}$/.test(zs)) goZip(zs, true);
    loadShops();
  }).catch(function () {
    oops("Could not load pop-ups. Try again in a moment.");
  }).then(function () { $("loading").hidden = true; });

  // Storefronts load after events and brands so the first paint never waits for them.
  function loadShops() {
    fetch("data/shops.json").then(function (r) { if (!r.ok) throw new Error("shops"); return r.json(); }).then(function (d) {
      buildShops(d.shops);
      refreshEvents(false);
    }).catch(function () { /* the storefront layer is optional */ });
  }

  // Exposed for tests only.
  window.__matcha = { state: state, shopsOn: function () { return shopsOn; }, matchesChip: matchesChip, whenText: whenText, map: map, live: live };
})();
