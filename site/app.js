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

  var state = { chip: "any", day: "", recent: false, apCity: "", userLoc: null, zip: "", events: [], brands: [], shops: [], view: "map" };
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
  // motion.js draws petals with the same model sheet.
  window.MatchaChars = { draw: drawChar, fill: fillChars };
  // Tell motion.js (rung 32) what just happened; the site works the same when nothing listens.
  function announce(name, detail) {
    try { document.dispatchEvent(new CustomEvent("mm:" + name, { detail: detail || {} })); } catch (e) { /* old browsers: no choreography */ }
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
  // City-only events (no place was found, the pin sits on the city's centre) are drawn as approximate markers.
  function isApprox(e) { return e.approx === true || (e.geocode_source === "none" && !e.address); }
  function cityLine(e) { return [e.city, e.state].filter(Boolean).join(", "); }
  function placeLine(e) { return "Place not posted yet" + (cityLine(e) ? " \u00b7 " + cityLine(e) : ""); }
  function approxLabel(e) { return e.brand + ", somewhere in " + (e.city || "the city") + ", place not posted yet"; }

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
  // Phone (N7): the map runs under the floating header and chips, and the list peeks from the bottom; the map's padding
  // keeps the camera's centre in the open part between them. --chrome (the chips' bottom edge) places the toasts and list.
  var pad = { top: 0, bottom: 0, left: 0, right: 0 };
  function syncPad(refit) {
    var f = document.querySelector(".filters"), g = $("list-grip");
    var top = wide.matches || !f ? 0 : Math.round(f.getBoundingClientRect().bottom - map.getContainer().getBoundingClientRect().top);
    pad = { top: Math.max(0, top), bottom: wide.matches || !g ? 0 : g.offsetHeight, left: 0, right: 0 };
    document.documentElement.style.setProperty("--chrome", (wide.matches || !f ? 0 : Math.round(f.getBoundingClientRect().bottom)) + "px");
    map.setPadding(pad);
    if (refit) map.fitBounds(HOME, { padding: 16, animate: false });
  }
  syncPad(true);
  var padT;
  window.addEventListener("resize", function () { clearTimeout(padT); padT = setTimeout(function () { syncPad(false); }, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { syncPad(false); });

  // Brand mochi get eyes and blush from zoom 9 up (class z9 on the map container).
  // The approximate rings also shrink when zoomed out: zl under 6, zm from 6 to 9 (style.css). One class toggle, at most once a frame.
  function syncZoomFace() {
    var z = map.getZoom(), c = map.getContainer().classList;
    c.toggle("z9", z >= 9); c.toggle("zl", z < 6); c.toggle("zm", z >= 6 && z < 9);
  }
  var zoomRaf = 0;
  map.on("zoom", function () { if (!zoomRaf) zoomRaf = requestAnimationFrame(function () { zoomRaf = 0; syncZoomFace(); }); });
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
    if (!map.getSource("ev")) map.addSource("ev", { type: "geojson", data: featureColl(visibleEvents(false)), cluster: true, clusterRadius: 56, clusterMaxZoom: 13 });
    if (!map.getSource("br")) map.addSource("br", { type: "geojson", data: featureColl(visibleBrands()), cluster: true, clusterRadius: 44, clusterMaxZoom: 12 });
    if (!map.getSource("sh")) map.addSource("sh", { type: "geojson", data: featureColl(visibleShops()), cluster: true, clusterRadius: 40, clusterMaxZoom: 13 });
    // City-only events: always clustered (points on one spot join at every zoom), never drawn as separate stacked pins.
    if (!map.getSource("ap")) map.addSource("ap", { type: "geojson", data: featureColl(visibleEvents(true)), cluster: true, clusterRadius: 1, clusterMaxZoom: 24 });
    ["ev", "br", "sh", "ap"].forEach(function (s) {
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
    ["ev", "br", "sh", "ap"].forEach(function (src) {
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
    Object.keys(live).forEach(function (id) { if (!seen[id]) { leave(live[id]); delete live[id]; } });
  }
  // During a scene change (a filter, the opening) markers fade out in 180ms before they go; otherwise they go at once.
  function leave(rec) {
    if (calm() || Date.now() > stageUntil) { rec.marker.remove(); return; }
    rec.el.classList.add("leaving");
    setTimeout(function () { rec.marker.remove(); }, 190);
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

  // Arrival. Inside a scene window (the opening, a filter change) markers rise in a ripple from the centre of the map
  // out: eight rings, 30ms apart. Outside it, a quick pop as clusters split and join while zooming.
  // The opening (N7) is a longer, continuous wave: each pin drops with a spring, 0 to 480 ms by its distance from the centre.
  var stageUntil = 0, stageKind = "";
  function stage(ms, kind) { stageUntil = Date.now() + ms; stageKind = kind || "scene"; }
  function ringDelay(rec) {
    var c = map.getContainer(), w = c.clientWidth / 2, h = c.clientHeight / 2;
    var p = map.project(rec.marker.getLngLat()), d = Math.sqrt((p.x - w) * (p.x - w) + (p.y - h) * (p.y - h));
    var f = Math.min(1, d / (Math.sqrt(w * w + h * h) || 1));
    return stageKind === "open" ? Math.round(f * 480) : Math.min(7, Math.floor(f * 8)) * 30;
  }
  function entrance(rec, fallback) {
    var inner = rec.el.firstChild;
    if (Date.now() < stageUntil) animOnce(inner, stageKind === "open" ? "drop-in" : "rise", ringDelay(rec));
    else animOnce(inner, fallback);
  }
  // A pop-up that is open right now has steam rising from the cup.
  function happeningNow(e) {
    var st = Date.parse(e.start), en = e.end ? Date.parse(e.end) : st + 3 * 3600000, now = Date.now();
    return !e.all_day && !isNaN(st) && !isNaN(en) && st <= now && now < en;
  }
  function steamEl() {
    var s = document.createElement("span");
    s.className = "mk-steam";
    s.innerHTML = "<svg viewBox=\"0 0 18 14\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M5 13c-2-2.5 2-4 0-6.5S5 3 4.5 1\"/><path d=\"M12 13c-2-2.5 2-4 0-6.5S12 3 11.5 1\"/></svg>";
    return s;
  }

  function pinLabel(it) {
    if (it.kind === "e" && it.approx) return approxLabel(it.data);
    if (it.kind === "s") return it.data.name + ", shop" + (it.data.city ? ", " + it.data.city : "");
    return it.kind === "e" ? it.data.brand + ", " + whenText(it.data) + (it.now ? ", happening now" : "") : it.data.brand + ", " + it.data.home_city + ", no dates yet";
  }
  function makePin(it) {
    if (it.kind === "e") it.now = !it.past && !it.approx && happeningNow(it.data);
    var el = document.createElement("button");
    el.type = "button";
    el.className = "mk " + (it.kind === "e" ? "mk-ev" : it.kind === "s" ? "mk-sh" : "mk-br") + (it.approx ? " mk-ap" : "") + (it.past ? " past" : "") + (it.key === openKey ? " sel" : "");
    el.setAttribute("aria-label", pinLabel(it));
    if (it.approx) el.title = pinLabel(it);
    var inner = document.createElement("span");
    inner.className = "mk-in";
    if (it.kind === "e") {
      if (it.approx) inner.appendChild(ringEl());
      inner.appendChild(drawChar(it.key === openKey && !it.approx ? "m-point" : "m-base"));
      if (!it.past && !it.approx) { var dot = document.createElement("span"); dot.className = "mk-new"; inner.appendChild(dot); }
      if (it.now) inner.appendChild(steamEl());
    } else if (it.kind === "s") {
      inner.appendChild(drawChar("s-shop"));
    } else {
      inner.innerHTML = "<span class=\"mochi\"></span>";
    }
    el.appendChild(inner);
    el.addEventListener("click", function (ev) { ev.stopPropagation(); cardOpener = null; pinOpener = el; showCard(it.key, ev.detail === 0); });
    var marker = new maplibregl.Marker({ element: el, anchor: it.kind === "e" && !it.approx ? "bottom" : "center", offset: it.kind === "e" || it.kind === "s" ? [0, 0] : [NUDGE, NUDGE] }).setLngLat(lngLat(it.ll));
    var rec = { marker: marker, el: el, kind: it.kind, key: it.key, label: pinLabel(it) };
    if (it.kind === "e") el.style.zIndex = it.approx ? "1" : "2";
    if (it.kind === "s") el.style.zIndex = "1";
    entrance(rec, it.kind === "e" || it.kind === "s" ? "pop" : "jiggle");
    return rec;
  }
  function ringEl() { var r = document.createElement("span"); r.className = "mk-ring"; return r; }
  // The events behind an approximate cluster, and the one city they share (empty when it spans cities).
  var apLeaves = {};
  function apInfo(cid) {
    if (apLeaves[cid]) return Promise.resolve(apLeaves[cid]);
    return Promise.resolve(map.getSource("ap").getClusterLeaves(cid, 400, 0)).then(function (leaves) {
      var keys = (leaves || []).map(function (l) { return l.properties.key; }), cities = {};
      keys.forEach(function (k) { var e = items[k] && items[k].data; if (e) cities[e.city + "|" + e.state] = e; });
      var ck = Object.keys(cities);
      return (apLeaves[cid] = { keys: keys, city: ck.length === 1 ? ck[0] : "", ev: ck.length === 1 ? cities[ck[0]] : null });
    });
  }
  map.on("sourcedata", function (e) { if (e.sourceId === "ap" && e.isSourceLoaded && e.sourceDataType !== "metadata") apLeaves = {}; });
  function makeCluster(src, id, f) {
    var n = f.properties.point_count;
    var el = document.createElement("button");
    el.type = "button";
    el.className = "mk mk-cl " + (src === "ev" ? "cl-ev" : src === "ap" ? "cl-ap" : src === "sh" ? "cl-sh" : "cl-br");
    var inner = document.createElement("span");
    inner.className = "mk-in";
    if (src === "ap") { inner.appendChild(ringEl()); inner.appendChild(drawChar("m-base")); }
    else inner.appendChild(drawChar(src === "sh" ? "s-shop" : "c-dango"));
    var num = document.createElement("span");
    num.className = "cl-n";
    inner.appendChild(num);
    el.appendChild(inner);
    var rec = { marker: null, el: el, kind: "c", count: 0, num: num };
    setCount(rec, n, true);
    el.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var cid = f.properties.cluster_id;
      if (src === "ap") { openApprox(cid, f); return; }
      map.getSource(src).getClusterExpansionZoom(cid).then(function (z) {
        var c = f.geometry.coordinates;
        if (calm()) map.jumpTo({ center: c, zoom: z + 0.2 }); else map.easeTo({ center: c, zoom: z + 0.2, duration: 600 });
      }).catch(function () { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }); });
    });
    if (src === "ap") apInfo(f.properties.cluster_id).then(function (a) { if (a.ev) { rec.city = a.ev.city; setCount(rec, rec.count, true); } }).catch(function () { /* the label keeps the general wording */ });
    rec.marker = new maplibregl.Marker({ element: el, anchor: "center", offset: src === "br" ? [NUDGE, NUDGE] : [0, 0] }).setLngLat(f.geometry.coordinates);
    if (src === "ev") el.style.zIndex = "3";
    if (src === "sh" || src === "ap") el.style.zIndex = "1";
    if (src !== "ap") { // an approximate cluster sits exactly on its city's point; the snap is for the other sources
      rec.snap = function () { snapCluster(src, rec, f.properties.cluster_id); };
      rec.snap();
    }
    entrance(rec, "pop");
    return rec;
  }
  // MapLibre places a cluster at the mean of its points, which zoomed out is often open water or empty country between
  // cities (Florida's cluster in the Gulf, the Southeast's in rural Alabama). Move it onto the place inside it that holds
  // the most points: leaves are grouped on a 0.05 degree grid (about 5 km, one town), the biggest group wins, and the
  // marker goes to that group's own centre. Leaves are read once per cluster id; the ids change with the zoom anyway.
  var snapCache = {};
  function snapCluster(src, rec, cid) {
    var source = map.getSource(src), k = src + cid;
    if (!source || !source.getClusterLeaves) return;
    var done = function (ll) { if (rec.marker && live[src + "c" + cid] === rec) rec.marker.setLngLat(ll); };
    if (snapCache[k]) return done(snapCache[k]);
    Promise.resolve(source.getClusterLeaves(cid, 400, 0)).then(function (leaves) {
      var cells = {}, best = null;
      (leaves || []).forEach(function (l) {
        var c = l.geometry.coordinates, key = Math.round(c[0] / 0.05) + "," + Math.round(c[1] / 0.05);
        var cell = cells[key] || (cells[key] = { n: 0, x: 0, y: 0 });
        cell.n++; cell.x += c[0]; cell.y += c[1];
        if (!best || cell.n > best.n) best = cell;
      });
      if (!best) return;
      snapCache[k] = [best.x / best.n, best.y / best.n];
      done(snapCache[k]);
    }).catch(function () { /* keep MapLibre's position */ });
  }
  map.on("sourcedata", function (e) { if (e.isSourceLoaded && e.sourceDataType !== "metadata") snapCache = {}; });
  function setCount(rec, n, first) {
    rec.count = n;
    if (!first && rec.snap) rec.snap();
    rec.num.textContent = n;
    var ap = rec.el.classList.contains("cl-ap");
    rec.label = ap ? n + " pop-ups, somewhere in " + (rec.city || "this area") + ", place not posted yet"
      : n + (rec.el.classList.contains("cl-ev") ? " pop-ups" : rec.el.classList.contains("cl-sh") ? " shops" : " brands") + " here, zoom in";
    if (ap) rec.el.title = rec.label;
    rec.el.setAttribute("aria-label", rec.label);
    rec.el.classList.toggle("cl-m", n > 9);
    rec.el.classList.toggle("cl-l", n > 24);
    if (!first) { animOnce(rec.num, "morph"); animOnce(rec.el.firstChild, "breathe"); }
  }
  // A cluster of city-only events: when they share one city, open the list filtered to that city's approximate events;
  // when it spans several (zoomed far out), zoom in like any cluster.
  function openApprox(cid, f) {
    apInfo(cid).then(function (a) {
      if (a.city && a.keys.length > 1) {
        state.apCity = a.city;
        closeCard(true);
        var c = f.geometry.coordinates, z = Math.max(map.getZoom(), 10.5);
        if (!wide.matches) setView("list");
        else if (calm()) map.jumpTo({ center: c, zoom: z }); else map.easeTo({ center: c, zoom: z, duration: 600 });
        renderList(true);
      } else {
        map.getSource("ap").getClusterExpansionZoom(cid).then(function (z) {
          if (calm()) map.jumpTo({ center: f.geometry.coordinates, zoom: z + 0.2 }); else map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.2, duration: 600 });
        });
      }
    }).catch(function () { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }); });
  }
  function setSelected(key) {
    Object.keys(live).forEach(function (id) {
      var r = live[id];
      if (r.kind === "c") return;
      var on = id === key;
      if (on !== r.el.classList.contains("sel")) {
        r.el.classList.toggle("sel", on);
        // The selected Mattie lifts (motion.css) and points up at his card; he goes back to rest when it closes.
        if (r.kind === "e" && !r.el.classList.contains("mk-ap")) {
          var old = r.el.querySelector(".ch"), next = drawChar(on ? "m-point" : "m-base");
          if (old) old.parentNode.replaceChild(next, old);
          if (on) animOnce(next, "point-in");
        }
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
      var small = img.closest(".bpic, .rc, .yphoto");
      if (small) {
        if (small.classList.contains("bpic")) { small.innerHTML = SMALL_FACE; fillChars(small); }
        else if (small.classList.contains("yphoto")) small.remove();
        else if (window.Drawn) { var nm = img.getAttribute("data-bn") || "Matcha"; small.className = "rc rc-drawn"; small.innerHTML = window.Drawn.card({ id: "rc-" + nm, brand: nm }, { mode: "thumb" }); }
        else { small.className = "rc rc-face"; small.innerHTML = THUMB_FACE; fillChars(small); }
        return;
      }
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
  // ---------- fuller card: brand facts (data/brands.json, from the Instagram Graph read) and Yelp places (data/places.json) ----------
  var brandsBy = {}, placesBy = {}, sourceIg = {};
  function squeeze(s) { return String(s == null ? "" : s).toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim(); }
  // The same key ingest/lib/enrich/yelp.js writes: "venue|city|state", or the rounded position for a shop with no city.
  function placeKey(name, city, state, lat, lng) {
    if (!(city && state) && lat != null && lng != null && isFinite(lat) && isFinite(lng)) return squeeze(name) + "|" + (+lat).toFixed(2) + "," + (+lng).toFixed(2) + "|";
    return [name, city, state].map(squeeze).join("|");
  }
  function igHandle(e) {
    var h = e.handle || "";
    if (!h) { var m = /instagram\.com\/([A-Za-z0-9._]+)/.exec((e.links && e.links.instagram) || ""); if (m) h = m[1]; }
    if (!h && e.source_id) h = sourceIg[e.source_id] || "";
    return String(h).replace(/^@/, "").toLowerCase();
  }
  function followersText(n) {
    if (typeof n !== "number" || !isFinite(n) || n < 0) return "";
    if (n >= 1000000) return (Math.round(n / 100000) / 10) + "M followers";
    if (n >= 1000) return (Math.round(n / 100) / 10) + "k followers";
    return n + (n === 1 ? " follower" : " followers");
  }
  function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function igUrl(h) { return "https://www.instagram.com/" + encodeURIComponent(h) + "/"; }
  function factsHTML(b) {
    if (!b) return "";
    var h = String(b.handle), web = safeUrl(b.website), dom = web ? domainOf(web) : "";
    var pic = safeUrl(b.picture) ? "<img src=\"" + esc(b.picture) + "\" alt=\"\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\">" : SMALL_FACE;
    var meta = ["<a href=\"" + esc(igUrl(h)) + "\" target=\"_blank\" rel=\"noopener\">@" + esc(h) + "</a>"];
    var fol = followersText(b.followers);
    if (fol) meta.push(esc(fol));
    if (dom) meta.push("<a href=\"" + esc(web) + "\" target=\"_blank\" rel=\"noopener\">" + esc(dom) + "</a>");
    var out = "<div class=\"brow\"><span class=\"bpic\">" + pic + "</span><div class=\"btxt\"><span class=\"bname\">" + esc(b.name || h) + "</span><span class=\"bmeta\">" + meta.join(" · ") + "</span></div></div>";
    if (b.bio) out += "<p class=\"bio muted\">" + esc(b.bio) + "</p>";
    var rec = (b.recent || []).filter(function (r) { return safeUrl(r.permalink) && safeUrl(r.image_url); }).slice(0, 3);
    if (rec.length) {
      out += "<div class=\"recent\"><p class=\"rlabel\">Latest from @" + esc(h) + "</p><div class=\"rgrid\">" + rec.map(function (r) {
        var cap = r.caption ? r.caption : "Recent post";
        return "<a class=\"rc\" href=\"" + esc(r.permalink) + "\" target=\"_blank\" rel=\"noopener\" aria-label=\"" + esc("Post by @" + h + ": " + cap) + "\"><img src=\"" + esc(r.image_url) + "\" alt=\"\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\" data-bn=\"" + esc(b.name || h) + "\"></a>";
      }).join("") + "</div></div>";
    }
    return out;
  }
  function mapsUrl(what, city, state) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([what, city, state].filter(Boolean).join(", "));
  }
  function clock12(hhmm) {
    var h = +String(hhmm).slice(0, 2) % 24, m = String(hhmm).slice(2, 4), ap = h >= 12 ? "pm" : "am", h12 = h % 12 || 12;
    return h12 + (m && m !== "00" ? ":" + m : "") + " " + ap;
  }
  // Today's hours at the venue, from Yelp's open array (day 0 is Monday), in the venue's time zone.
  function hoursToday(p) {
    if (!p.hours || !p.hours.length || !p.tz) return "";
    var o = {};
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: p.tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (x) { o[x.type] = x.value; });
    } catch (err) { return ""; }
    var dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(o.weekday), mins = (+o.hour % 24) * 60 + (+o.minute);
    if (dow < 0) return "";
    var toM = function (t) { return +String(t).slice(0, 2) * 60 + (+String(t).slice(2, 4)); };
    var open = false, until = "", today = [];
    p.hours.forEach(function (h) {
      var st = toM(h.start), en = toM(h.end), over = h.is_overnight || en <= st;
      if (h.day === dow) { today.push(h); if (mins >= st && (over || mins < en)) { open = true; until = h.end; } }
      else if (over && h.day === (dow + 6) % 7 && mins < en) { open = true; until = h.end; }
    });
    if (open) return "Open now, until " + clock12(until);
    if (!today.length) return "Closed today";
    return "Closed now, today " + today.map(function (h) { return clock12(h.start) + " to " + clock12(h.end); }).join(", ");
  }
  function yelpHTML(p) {
    if (!p || !safeUrl(p.url)) return "";
    var line = [], r = typeof p.rating === "number" ? p.rating : null;
    var stars = r === null ? "" : "<span class=\"stars s" + Math.max(0, Math.min(10, Math.round(r * 2))) + "\" role=\"img\" aria-label=\"" + r + " out of 5 stars\"><span class=\"stars-on\" aria-hidden=\"true\">★★★★★</span></span> <b>" + r + "</b>";
    if (stars && typeof p.review_count === "number") stars += " <span class=\"muted\">(" + p.review_count + (p.review_count === 1 ? " review" : " reviews") + ")</span>";
    if (stars) line.push(stars);
    if (p.price && /^\$+$/.test(p.price)) line.push("<span class=\"yprice\">" + esc(p.price) + "</span>");
    var hrs = hoursToday(p), phone = /^\+?[0-9]{7,15}$/.test(p.phone || "") ? p.phone : "";
    var photo = safeUrl(p.image_url) ? "<span class=\"yphoto\"><img src=\"" + esc(p.image_url) + "\" alt=\"\" loading=\"lazy\" decoding=\"async\"></span>" : "";
    return "<div class=\"yelp\">" + photo + "<div class=\"ytxt\">" +
      (line.length ? "<p class=\"yline\">" + line.join(" · ") + "</p>" : "") +
      (hrs ? "<p class=\"yhours\">" + esc(hrs) + "</p>" : "") +
      (phone ? "<p class=\"yphone\"><a href=\"tel:" + esc(phone) + "\">" + esc(phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")) + "</a></p>" : "") +
      "<p class=\"ycredit muted\">Details from <a class=\"ywm\" href=\"" + esc(p.url) + "\" target=\"_blank\" rel=\"noopener\">Yelp</a></p></div></div>";
  }
  function loadExtras() {
    var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); };
    get("data/brands.json").then(function (d) { (d.brands || []).forEach(function (b) { if (b && b.handle) brandsBy[String(b.handle).toLowerCase()] = b; }); }).catch(function () { /* optional layer */ });
    get("data/places.json").then(function (d) { (d.places || []).forEach(function (p) { if (p && p.key) placesBy[p.key] = p; }); }).catch(function () { /* optional layer */ });
  }
  function eventCard(e) {
    var approx = isApprox(e), line2 = approx && !e.address ? placeLine(e) : [e.venue, e.address, cityLine(e)].filter(Boolean).join(" \u00b7 ");
    var tag = e.confidence && e.confidence !== "confirmed" ? " <span class=\"tag\">" + esc(e.confidence) + "</span>" : "";
    var links = [], post = postUrl(e), L = e.links || {}, where = e.venue || e.address;
    if (where) links.push(["Open in Google Maps", mapsUrl(where, e.city, e.state)]);
    if (!approx) links.push(["Directions", "https://www.google.com/maps/dir/?api=1&destination=" + e.lat + "," + e.lng]);
    if (post) links.push(["Post", post]);
    if (safeUrl(L.instagram)) links.push(["Instagram", L.instagram]);
    if (safeUrl(L.tiktok)) links.push(["TikTok", L.tiktok]);
    if (safeUrl(e.source_url) && e.source_url !== post) links.push(["Event page", e.source_url]);
    // The title is the name alone; kind and confidence share one quiet line under it.
    var kline = kindWord(e) + tag;
    return "<div class=\"card ecard\">" + photoHTML(e) + "<h3>" + SMALL_FACE + "<span>" + esc(e.brand) + "</span></h3>" + (kline ? "<p class=\"kline\">" + kline + "</p>" : "") +
      "<p class=\"when\">" + esc(whenText(e)) + (e.status === "past" ? " <span class=\"muted\">(past)</span>" : "") + "</p>" +
      "<p class=\"muted\">" + esc(line2) + "</p>" + menuHTML(e) +
      (e.description ? "<p class=\"desc muted\">" + esc(e.description) + "</p>" : "") +
      factsHTML(brandsBy[igHandle(e)]) + linksHTML(links) + (e.venue ? yelpHTML(placesBy[placeKey(e.venue, e.city, e.state)]) : "") + "</div>";
  }
  function brandCard(b) {
    var links = [];
    if (safeUrl(b.website)) links.push(["Website", b.website]);
    if (b.instagram) links.push(["Instagram", "https://www.instagram.com/" + encodeURIComponent(b.instagram) + "/"]);
    if (b.tiktok) links.push(["TikTok", "https://www.tiktok.com/@" + encodeURIComponent(b.tiktok)]);
    if (safeUrl(b.schedule_url) && b.schedule_url !== b.website) links.push(["Schedule", b.schedule_url]);
    return "<div class=\"card bcard\">" + (window.Drawn ? window.Drawn.block(b, { mode: "brand" }) : "") + "<h3><span class=\"card-mochi\" aria-hidden=\"true\"></span><span>" + esc(b.brand) + "</span></h3>" + kindWord(b) +
      "<p class=\"muted\">" + esc(b.home_city + ", " + b.home_state) + "</p>" +
      "<p class=\"when\">No dates posted here yet</p>" + factsHTML(brandsBy[String(b.instagram || "").toLowerCase()]) + linksHTML(links) + "</div>";
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
    links.unshift(["Open in Google Maps", mapsUrl(s.address ? s.name + ", " + s.address : s.name, s.city, s.state)]);
    links.push(["Directions", "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lng]);
    var credit = s.source === "osm" && safeUrl(s.osm_url) ? "<p class=\"credit-line\">Data: <a href=\"" + esc(s.osm_url) + "\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a></p>" : "";
    var art = window.Drawn ? window.Drawn.block({ id: s.id, brand: s.name, home_city: s.city, home_state: s.state }, { mode: "shop" }) : "";
    return "<div class=\"card scard\">" + art + "<h3><span class=\"card-shop\" data-char=\"s-shop\"></span><span>" + esc(s.name) + "</span></h3><span class=\"kindword\">Shop</span>" +
      "<p class=\"muted\">" + esc(shopAddress(s)) + "</p>" + hoursHTML(s.opening_hours) + factsHTML(brandsBy[String(s.instagram || "").toLowerCase()]) + linksHTML(links) + yelpHTML(placesBy[placeKey(s.name, s.city, s.state, s.lat, s.lng)]) + credit + "</div>";
  }
  // renderCard: the single card entry point (N7). cards.js (N6), when it is loaded, draws the rich card; the built-in
  // card below is the fallback, so the site works without it.
  function renderCard(item, ctx) {
    var C = window.MatchaCards;
    if (C && typeof C.render === "function") {
      try { var h = C.render(item, ctx || {}); if (h) return h; } catch (e) { /* fall back to the built-in card */ }
    }
    return cardHTML(item);
  }
  function cardHTML(item) { return item.kind === "e" ? eventCard(item.data) : item.kind === "s" ? shopCard(item.data) : brandCard(item.data); }

  // Back gestures (N7): an open card, or the phone's full list, is one history step, so Back (and Escape) closes it.
  function pushStep(kind) {
    try {
      if (history.state && history.state.mm) history.replaceState({ mm: kind }, "");
      else history.pushState({ mm: kind }, "");
    } catch (e) { /* ignore */ }
  }
  function dropStep(kind, user) {
    try {
      if (!history.state || history.state.mm !== kind) return;
      if (user) history.back(); else history.replaceState(null, "");
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("popstate", function () {
    var s = history.state && history.state.mm;
    if (s !== "card" && openKey) { var back = cardOpener; closeCard(false, "pop"); refocus(back); }
    if (s !== "list" && state.view === "list" && !wide.matches) setView("map", "pop");
  });

  var popup = null, closeT = null;
  function finishClose() {
    clearTimeout(closeT); closeT = null;
    document.body.classList.remove("card-open");
    $("sheet").hidden = true;
    $("sheet").classList.remove("out");
    if (popup) { popup.remove(); popup = null; }
  }
  // how: "user" (a close button, Escape, a tap on the map) steps history back; "pop" came from Back itself.
  function closeCard(instant, how) {
    if (!openKey && !popup && $("sheet").hidden) return;
    if (openKey && how !== "pop") dropStep("card", how === "user");
    announce("cardclose", { key: openKey });
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
    pushStep("card");
    var html = renderCard(it, { phone: !wide.matches, dist: distOf(it), events: state.events, items: items });
    if (wide.matches) {
      var box = document.createElement("div");
      box.innerHTML = "<button type=\"button\" class=\"close pop-close\" aria-label=\"Close details\">&times;</button>" + html;
      fillChars(box);
      box.querySelector(".pop-close").addEventListener("click", function () { var back = cardOpener; closeCard(false, "user"); refocus(back); });
      popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "340px", focusAfterOpen: false, className: "mm-pop",
        anchor: "bottom", offset: it.kind === "e" ? [0, -50] : it.kind === "s" ? [0, -18] : [NUDGE, NUDGE - 12] })
        .setLngLat(lngLat(it.ll)).setDOMContent(box).addTo(map);
      // Keep the whole card on screen: nudge the map down when the card would run off the top.
      var pr = popup.getElement().getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
      var over = mr.top + 12 - pr.top;
      if (over > 0) map.panBy([0, -over], { duration: calm() ? 0 : 300 });
      if (focusIt) box.querySelector(".pop-close").focus();
      announce("card", { root: box, phone: false, key: key });
    } else {
      var body = $("sheet-body");
      body.innerHTML = html;
      fillChars(body);
      var sh = $("sheet");
      body.scrollTop = 0;
      sh.hidden = false;
      document.body.classList.add("card-open");
      animOnce(sh, "in");
      if (focusIt) $("sheet-close").focus();
      announce("card", { root: body, phone: true, key: key });
    }
  }
  var pinOpener = null;
  function refocus(back) {
    if (!back) { if (pinOpener && document.contains(pinOpener)) pinOpener.focus(); pinOpener = null; return; }
    pinOpener = null;
    setTimeout(function () { var r = document.querySelector("#list [data-key=\"" + back + "\"]"); if (r) r.focus(); }, 0);
  }
  imgFallback(document);
  $("sheet-close").addEventListener("click", function () { var back = cardOpener; closeCard(false, "user"); refocus(back); });
  map.on("click", function (e) {
    var t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest(".maplibregl-marker, .maplibregl-popup")) return;
    closeCard(false, "user");
  });
  // Escape closes the open card (the About dialog handles its own Escape) and hands focus back to the row that opened it.
  var cardOpener = null;
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !openKey || $("about").open) return;
    var back = cardOpener;
    closeCard(false, "user");
    refocus(back);
  });

  function moveMap(opts, done) {
    // Listen first: jumpTo fires moveend before it returns.
    if (done) map.once("moveend", function () { setTimeout(done, 30); });
    if (calm()) { map.jumpTo(opts); } else {
      // A glide, never longer than two seconds, that slows down as it lands.
      // MapLibre's maxDuration turns a long flight into a jump, so the length is set here from distance and zoom change.
      var c = map.getCenter(), to = maplibregl.LngLat.convert(opts.center || c), d = miles([c.lat, c.lng], [to.lat, to.lng]);
      var dz = Math.abs((opts.zoom == null ? map.getZoom() : opts.zoom) - map.getZoom());
      opts.curve = 1.3; opts.essential = false;
      opts.duration = Math.round(Math.min(2000, 650 + 260 * Math.log2(1 + d / 5) + 90 * dz));
      opts.easing = function (t) { var s = t * t * (3 - 2 * t), o = 1 - Math.pow(1 - t, 3); return 0.45 * s + 0.55 * o; };
      map.flyTo(opts);
    }
  }
  function flyTo(key) {
    var it = items[key];
    if (!it) return;
    var ae = document.activeElement;
    cardOpener = ae && ae.closest && ae.closest("#list") ? ae.getAttribute("data-key") : null;
    if (state.view === "list") setView("map");
    map.resize();
    var z = Math.max(map.getZoom(), it.kind === "e" ? (it.approx ? 11 : 14) : it.kind === "s" ? 15 : 13.2);
    // On a phone the sheet covers the lower part of the map, so the pin lands in the upper part;
    // on desktop the card opens above the pin, so the pin lands low.
    var h = map.getContainer().clientHeight;
    var off = wide.matches ? [0, Math.round(h * 0.3)] : [0, Math.round((pad.bottom - 0.52 * h) / 2)];
    moveMap({ center: lngLat(it.ll), zoom: z, offset: off }, function () { syncMarkers(); showCard(key, !!cardOpener); });
  }

  // ---------- layers ----------
  function buildBrands(sources) {
    var byCity = {};
    sources.forEach(function (s) {
      if (s.instagram) sourceIg[s.id] = s.instagram;
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

  // only: true for the city-only events, false for the precise ones, omitted for both.
  function visibleEvents(only) {
    return state.events.filter(function (it) {
      var e = it.data;
      if (only !== undefined && !!it.approx !== only) return false;
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
    if (src) src.setData(featureColl(visibleEvents(false)));
    var ap = map.getSource("ap");
    if (ap) ap.setData(featureColl(visibleEvents(true)));
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
        esc(whenText(e)) + "</span><span>" + esc(it.approx && !e.address ? placeLine(e) : [e.venue, e.city + ", " + e.state].filter(Boolean).join(" \u00b7 ")) + "</span>" +
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
    if (state.apCity) return renderApproxList(vis, stagger);
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

    // Empty: nothing on for the chosen dates anywhere, or nothing in this part of the map. Sleepy Mattie, one line,
    // one button to the next range (motion.js also floats it over the map on a phone).
    var dated = !!state.day || state.chip !== "any", near = vis.length > 0 && !up.length && !past.length;
    $("empty").hidden = !dated || !(vis.length === 0 || near);
    if (!$("empty").hidden) emptyCopy(near);
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
    if (!html && $("empty").hidden) html = "<li class=\"head\">Nothing in this part of the map. Zoom out or pan.</li>";
    var list = $("list");
    list.innerHTML = html;
    fillChars(list);
    if (stagger && !calm()) {
      var rows = list.children;
      for (var i = 0; i < rows.length && i < 8; i++) animOnce(rows[i], "row-in", i * 30);
    }
  }
  var NEXT_RANGE = { today: ["weekend", "See this weekend"], weekend: ["week", "See next 7 days"], week: ["any", "See any date"] };
  var RANGE_WORDS = { today: "today", weekend: "this weekend", week: "in the next 7 days" };
  function emptyCopy(near) {
    var words = state.day ? "on this day" : RANGE_WORDS[state.chip] || "on these dates";
    var next = (!state.day && NEXT_RANGE[state.chip]) || ["any", "See any date"];
    $("empty").querySelector("p").textContent = (near ? "Nothing near here " : "Nothing ") + words + ".";
    var b = $("empty-any");
    b.textContent = next[1];
    b.setAttribute("data-next", next[0]);
  }
  // The list for one city's approximate events (opened from an approximate cluster), with a way back to the usual list.
  function renderApproxList(vis, stagger) {
    var rows = vis.filter(function (it) { return it.approx && it.data.city + "|" + it.data.state === state.apCity; });
    rows.sort(function (a, b) { return a.data.start < b.data.start ? -1 : 1; });
    if (!rows.length) { state.apCity = ""; return renderList(stagger); }
    var e0 = rows[0].data;
    $("empty").hidden = true;
    var list = $("list");
    list.innerHTML = "<li class=\"head\">Place not posted yet \u00b7 " + esc(cityLine(e0)) + "</li><li class=\"apnote\"><button type=\"button\" class=\"aplink\" data-clear-ap>Show everything in view</button></li>" +
      rows.map(function (it) { return "<li>" + rowHTML(it) + "</li>"; }).join("");
    fillChars(list);
    if (stagger && !calm()) { var kids = list.children; for (var i = 0; i < kids.length && i < 8; i++) animOnce(kids[i], "row-in", i * 30); }
  }
  $("list").addEventListener("click", function (ev) {
    if (ev.target.closest("[data-clear-ap]")) { state.apCity = ""; renderList(false); return; }
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
  // A filter change is a scene change: old pins fade out, new ones rise from the centre out, petals drift (motion.js).
  function applyFilters() { syncChips(); saveChip(); closeCard(true); stage(700); refreshEvents(true); announce("filter", { chip: state.chip, day: state.day }); }
  document.querySelectorAll("[data-chip]").forEach(function (b) {
    b.addEventListener("click", function () { state.chip = b.getAttribute("data-chip"); state.day = ""; applyFilters(); });
  });
  $("recent").addEventListener("click", function () { state.recent = !state.recent; applyFilters(); });
  $("day").addEventListener("change", function () { state.day = $("day").value; applyFilters(); });
  $("day-clear").addEventListener("click", function () { state.chip = "any"; state.day = ""; applyFilters(); $("day").focus(); });
  $("empty-any").addEventListener("click", function () { state.chip = this.getAttribute("data-next") || "any"; state.day = ""; applyFilters(); });
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
  // how: "user" (the grip or the toggle), "pop" (Back); otherwise a side effect of another action (N7).
  function setView(v, how) {
    var was = state.view;
    state.view = v;
    $("list-grip").setAttribute("aria-expanded", String(v === "list"));
    if (!wide.matches && how !== "pop" && v !== was) { if (v === "list") pushStep("list"); else dropStep("list", how === "user"); }
    document.body.classList.toggle("show-list", v === "list");
    var t = $("view-toggle");
    t.textContent = v === "list" ? "Map" : "List";
    t.setAttribute("aria-pressed", String(v === "list"));
    if (v === "map") setTimeout(function () { map.resize(); }, 0);
    else renderList(true);
  }
  $("view-toggle").addEventListener("click", function () { setView(state.view === "list" ? "map" : "list", "user"); });
  $("list-grip").addEventListener("click", function () { if (!wide.matches) setView(state.view === "list" ? "map" : "list", "user"); });
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
  // Land on a point for a zip or a city: Chasen, the label under the filters, the list sorted by distance. quiet: a return visit.
  function landAt(c, label, zip, quiet) {
    $("zip-err").hidden = true;
    closeCard(true);
    clearYou();
    state.zip = zip;
    $("zip").value = label;
    var el = placeYou([c[0], c[1]], true);
    $("nearzip").textContent = label;
    $("nearrow").hidden = false;
    if (zip) { try { localStorage.setItem(ZIP_KEY, zip); } catch (e) { /* ignore */ } }
    if (state.view === "list") setView("map");
    var opts = { center: lngLat(state.userLoc), zoom: 10 };
    if (quiet) { map.jumpTo(opts); animOnce(el, "ping"); renderList(false); }
    else moveMap(opts, function () { animOnce(el, "ping"); announce("land", { label: label }); renderList(true); });
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
      landAt(c, zip, zip, quiet);
    }).catch(function () { if (!quiet) zipError("Zip list did not load"); });
  }
  // A city of window.CITY_LIST (biggest first): "Raleigh", "Raleigh NC" or "Raleigh, NC". The biggest city of a shared name wins.
  var plain = function (s) { return String(s).toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim(); };
  function findListed(q) {
    var list = window.CITY_LIST || [], m = /^(.+?)[,\s]+([A-Za-z]{2})$/.exec(q.trim());
    var tries = m ? [[plain(m[1]), m[2].toUpperCase()], [plain(q), ""]] : [[plain(q), ""]];
    for (var t = 0; t < tries.length; t++) {
      for (var i = 0; i < list.length; i++) if (plain(list[i][0]) === tries[t][0] && (!tries[t][1] || list[i][1] === tries[t][1])) return list[i];
    }
    return null;
  }
  function goCity(q) {
    var c = findListed(q);
    if (!c) { zipError("No such zip or city"); return; }
    landAt([c[2], c[3]], c[0] + ", " + c[1], "", false);
  }
  // The input takes a zip or a city; the datalist of listed cities (biggest first) is filled on the first focus.
  function goPlace(v) { if (/^\d{5}$/.test(v.trim())) goZip(v.trim(), false); else if (v.trim()) goCity(v); }
  $("zip").addEventListener("focus", function () {
    var dl = $("citylist");
    if (dl.firstChild || !window.CITY_LIST) return;
    var frag = document.createDocumentFragment();
    window.CITY_LIST.forEach(function (c) { var o = document.createElement("option"); o.value = c[0] + ", " + c[1]; frag.appendChild(o); });
    dl.appendChild(frag);
  });
  $("zip").addEventListener("input", function () { if (/^\d/.test(this.value)) this.value = this.value.replace(/\D/g, "").slice(0, 5); });
  $("zip").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); goPlace(this.value); } });
  $("zip-go").addEventListener("click", function () { goPlace($("zip").value); });
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

  // ---------- opening moment (N7) ----------
  // First visit in a session: the map settles in (a fade and a slight zoom), the chrome slides down, Mattie hops into
  // his disc and the pins drop in a wave from the centre out, with one puff of petals. About 1.5 s from the first map
  // frame; any tap, key or wheel skips it; sessionStorage keeps it from replaying. Repeat visits and calm mode: a fade.
  var SEEN = "matchamap.opened", rootEl = document.documentElement;
  var firstVisit = params.get("intro") === "1";
  try { firstVisit = firstVisit || !sessionStorage.getItem(SEEN); } catch (e) { firstVisit = false; }
  var opening = firstVisit && !calm(), introDone = false, introStarted = false, introTimers = [];
  rootEl.classList.add(opening ? "opening" : "fadein");
  var SKIPS = ["pointerdown", "keydown", "wheel", "touchstart"];
  function endIntro() {
    if (introDone) return;
    introDone = true;
    introTimers.forEach(clearTimeout);
    SKIPS.forEach(function (t) { window.removeEventListener(t, skipNow, true); });
    try { sessionStorage.setItem(SEEN, "1"); } catch (e) { /* ignore */ }
    rootEl.classList.add("open-go");
    rootEl.classList.remove("opening", "fadein");
    setTimeout(function () { rootEl.classList.remove("open-go"); }, 700);
  }
  function skipNow() {
    if (window.MatchaFX) window.MatchaFX.stop();
    rootEl.classList.add("open-skip");
    setTimeout(function () { rootEl.classList.remove("open-skip"); }, 60);
    endIntro();
  }
  function playIntro() {
    if (introDone || introStarted) return;
    introStarted = true;
    rootEl.classList.add("open-go");
    if (!opening) { introTimers.push(setTimeout(endIntro, 320)); return; }
    SKIPS.forEach(function (t) { window.addEventListener(t, skipNow, { capture: true, passive: true }); });
    stage(1300, "open");
    Object.keys(live).forEach(function (id) { entrance(live[id], "pop"); });
    if (!map.isMoving()) {
      var z = map.getZoom();
      map.jumpTo({ zoom: z - 0.35 });
      map.easeTo({ zoom: z, duration: 900, easing: function (t) { return 1 - Math.pow(1 - t, 3); }, essential: false });
    }
    introTimers.push(setTimeout(function () {
      var m = hdr.getBoundingClientRect();
      if (window.MatchaFX && m.width) window.MatchaFX.burst(m.left + m.width / 2, m.top + m.height / 2, { n: 9, kind: "petal", spread: 1 });
    }, 420));
    introTimers.push(setTimeout(endIntro, 1500));
  }
  // The opening starts on the map's first full frame, or after 1.2 s whatever happens (a slow network never waits).
  map.once("load", function () { setTimeout(playIntro, 40); });
  setTimeout(playIntro, 1200);
  // Test switch: ?intro=1 replays the opening.

  // ---------- deep links (?q= ?city= ?event= ?brand=; parsing lives in deeplink.js) ----------
  (function () { // the home page is the only canonical address, whatever the query string
    var l = document.querySelector("link[rel=canonical]");
    if (!l) { l = document.createElement("link"); l.rel = "canonical"; document.head.appendChild(l); }
    l.href = (l.href || location.origin + "/").split(/[?#]/)[0];
  })();
  function brandKeyOf(h) {
    for (var i = 0; i < state.brands.length; i++) {
      var d = state.brands[i].data;
      if (String(d.instagram || "").replace(/^@/, "").toLowerCase() === h || d.id === h) return state.brands[i].key;
    }
    for (var j = 0; j < state.events.length; j++) if (String(state.events[j].data.handle || "").toLowerCase() === h) return state.events[j].key;
    return "";
  }
  function applyDeepLink() {
    var DL = window.MatchaDeepLink, dl = DL && DL.parse(location.search);
    if (!dl) return false;
    if (dl.event && items["e:" + dl.event]) { flyTo("e:" + dl.event); return true; }
    var bk = dl.brand && brandKeyOf(dl.brand);
    if (bk) { flyTo(bk); return true; }
    var c = dl.city && DL.findCityBySlug(window.CITY_LIST, dl.city);
    if (c) { landAt([c[2], c[3]], c[0] + ", " + c[1], "", false); return true; }
    if (dl.q) { goPlace(dl.q); return true; }
    return false;
  }

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
      var it = { kind: "e", key: "e:" + e.id, ll: [e.lat, e.lng], data: e, past: e.status === "past", name: e.brand, approx: isApprox(e) };
      items[it.key] = it;
      return it;
    });
    buildBrands(res[1] || []);
    setupHawaii();
    var go = function () { syncZoomFace(); refreshEvents(false); };
    go(); // sources added later by addData (style.load) start from the same lists
    var zs = ""; try { zs = localStorage.getItem(ZIP_KEY) || ""; } catch (e) { /* ignore */ }
    if (!applyDeepLink() && /^\d{5}$/.test(zs)) goZip(zs, true);
    loadShops();
    loadExtras();
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
