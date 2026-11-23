// Matcha Map, rung 32: the cinematic pass (docs/DESIGN-CINEMATIC.md).
// app.js runs the site and announces what happened (mm:card, mm:filter, mm:land on document); this file adds the
// light, the choreography and the phone sheet. Remove it and the site still works: every card, filter and pin is there,
// just without the movement. Calm mode is app.js's html.rm class (prefers-reduced-motion or ?motion=reduce).
(function () {
  "use strict";
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var wide = window.matchMedia("(min-width: 900px)");
  var params = new URLSearchParams(location.search);
  function calm() { return root.classList.contains("rm"); }
  function api() { return window.__matcha || {}; }
  function chars() { return window.MatchaChars || null; }
  root.classList.add("mo");

  // Images fade in once they have loaded (motion.css hides them until .ld, with a 1.6 s failsafe).
  document.addEventListener("load", function (ev) {
    var t = ev.target;
    if (t && t.tagName === "IMG") t.classList.add("ld");
  }, true);

  // ---------- light: time of day ----------
  // Four moods by the visitor's clock; ?tod=morning|day|evening|night forces one for review.
  var TODS = ["morning", "day", "evening", "night"];
  function todNow() {
    var forced = params.get("tod");
    if (TODS.indexOf(forced) >= 0) return forced;
    var h = new Date().getHours();
    return h >= 5 && h < 10 ? "morning" : h >= 10 && h < 16 ? "day" : h >= 16 && h < 20 ? "evening" : "night";
  }
  function syncTod() {
    var t = todNow();
    TODS.forEach(function (x) { root.classList.toggle("tod-" + x, x === t); });
  }
  syncTod();
  setInterval(syncTod, 10 * 60 * 1000);
  // The veil sits in MapLibre's canvas container right after the canvas, so the markers (added later) stay on top.
  function addVeil(map) {
    var box = map.getCanvasContainer(), cv = map.getCanvas();
    if (!box || box.querySelector(".tod-veil")) return;
    var v = document.createElement("div");
    v.className = "tod-veil";
    v.setAttribute("aria-hidden", "true");
    box.insertBefore(v, cv.nextSibling);
    requestAnimationFrame(function () { v.classList.add("on"); });
  }

  // ---------- pins: a glance and a wave on hover or focus ----------
  function once(el, cls, ms) {
    if (!el || calm() || el.classList.contains(cls)) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function glance(ev) {
    var mk = ev.target && ev.target.closest && ev.target.closest(".mk-ev");
    if (!mk || mk.classList.contains("mk-ap") || mk.classList.contains("sel")) return;
    if (ev.type === "pointerover" && ev.relatedTarget && mk.contains(ev.relatedTarget)) return;
    once(mk.querySelector(".ch"), "glance", 560);
  }

  // ---------- filters: a few petals drift across the map ----------
  function drift() {
    var A = chars(), panel = $("map-panel");
    if (calm() || !A || !panel) return;
    var box = panel.querySelector(".drift");
    if (!box) { box = document.createElement("div"); box.className = "drift"; box.setAttribute("aria-hidden", "true"); panel.appendChild(box); }
    box.innerHTML = "";
    var w = panel.clientWidth, h = panel.clientHeight;
    for (var i = 0; i < 6; i++) {
      var p = document.createElement("span");
      var x = Math.random() * w * 0.7, y = Math.random() * h * 0.5;
      p.style.left = x.toFixed(0) + "px";
      p.style.top = y.toFixed(0) + "px";
      p.style.setProperty("--dx", (120 + Math.random() * 160).toFixed(0) + "px");
      p.style.setProperty("--dy", (60 + Math.random() * 140).toFixed(0) + "px");
      p.style.setProperty("--spin", (90 + Math.random() * 220).toFixed(0) + "deg");
      p.style.animationDelay = i * 40 + "ms";
      p.appendChild(A.draw("c-petal"));
      box.appendChild(p);
    }
    clearTimeout(drift.t);
    drift.t = setTimeout(function () { box.innerHTML = ""; }, 1300);
  }

  // ---------- city jump: the list slides in from the side ----------
  function land() {
    var l = $("list");
    l.classList.add("side");
    clearTimeout(land.t);
    land.t = setTimeout(function () { l.classList.remove("side"); }, 900);
  }

  // ---------- the card as a scene ----------
  function cardIn(ev) {
    var d = ev.detail || {}, card = d.root && d.root.querySelector(".card");
    if (card && !calm()) {
      card.classList.add("enter");
      // drop the class once it has played, so the fill-mode no longer holds transforms (the photo parallax needs them)
      setTimeout(function () { card.classList.remove("enter"); }, 760);
    }
    if (d.phone) sheetOpen();
  }

  // ---------- phone: the bottom sheet ----------
  // Two snaps: peek (half the map, the pin still visible above) and full. Drag the handle or, at peek, the whole sheet;
  // a flick decides, dragging well below peek closes. The handle is a button, so the keyboard toggles the snap too.
  var sheet = $("sheet"), body = $("sheet-body"), grip = null;
  var sy = 0, peekY = 0, snap = "full", drag = null, swallow = false;
  function setY(y) { sy = y; sheet.style.setProperty("--sy", Math.round(y) + "px"); }
  function measure() {
    var panelH = sheet.parentNode.clientHeight, sh = sheet.offsetHeight;
    peekY = Math.max(0, sh - Math.round(panelH * 0.52));
    if (peekY < 48) peekY = 0;
    grip.hidden = peekY === 0;
    return sh;
  }
  function setSnap(s) {
    snap = peekY ? s : "full";
    setY(snap === "peek" ? peekY : 0);
    sheet.classList.toggle("peek", snap === "peek");
    grip.setAttribute("aria-expanded", String(snap === "full"));
    grip.setAttribute("aria-label", snap === "full" ? "Show less of the card" : "Show all of the card");
  }
  function sheetOpen() {
    if (!sheet || sheet.hidden || wide.matches) return;
    var sh = measure();
    if (calm()) { setSnap("peek"); return; }
    sheet.classList.add("drag");
    setY(sh);
    void sheet.offsetHeight;
    sheet.classList.remove("drag");
    setSnap("peek");
  }
  function closeSheet() { var c = $("sheet-close"); if (c) c.click(); }
  function onDown(ev) {
    if (sheet.hidden || wide.matches || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    var onGrip = grip.contains(ev.target);
    if (snap === "full" && !onGrip) return; // at full the body scrolls natively
    drag = { id: ev.pointerId, y0: ev.clientY, s0: sy, last: ev.clientY, t: ev.timeStamp, v: 0, on: false, grip: onGrip };
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var dy = ev.clientY - drag.y0;
    if (!drag.on) {
      if (Math.abs(dy) < 6) return;
      drag.on = true;
      sheet.classList.add("drag");
      try { sheet.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    var dt = Math.max(1, ev.timeStamp - drag.t);
    drag.v = 0.7 * ((ev.clientY - drag.last) / dt) + 0.3 * drag.v;
    drag.last = ev.clientY; drag.t = ev.timeStamp;
    var y = drag.s0 + dy;
    setY(y < 0 ? y / 3 : y); // a little resistance above full
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.on) return;
    swallow = true;
    setTimeout(function () { swallow = false; }, 0);
    sheet.classList.remove("drag");
    var sh = sheet.offsetHeight;
    if (sy > (peekY || 0) + 90 || (d.v > 0.6 && snap === "peek") || sy > sh * 0.8) { closeSheet(); return; }
    if (d.v < -0.4) setSnap("full");
    else if (d.v > 0.4) setSnap("peek");
    else setSnap(sy < peekY / 2 ? "full" : "peek");
  }
  function onScroll() {
    if (onScroll.raf || calm()) return;
    onScroll.raf = requestAnimationFrame(function () {
      onScroll.raf = 0;
      var img = body.querySelector(".ph img");
      if (!img) return;
      var py = Math.min(body.scrollTop * 0.22, 12), hgt = img.offsetHeight || 200;
      img.style.transform = py ? "translateY(" + py.toFixed(1) + "px) scale(" + (1 + 2 * py / hgt).toFixed(4) + ")" : "";
    });
  }
  if (sheet && body) {
    grip = document.createElement("button");
    grip.type = "button";
    grip.className = "sheet-grip";
    grip.setAttribute("aria-controls", "sheet-body");
    sheet.insertBefore(grip, sheet.firstChild);
    grip.addEventListener("click", function () { if (!swallow) setSnap(snap === "full" ? "peek" : "full"); });
    sheet.addEventListener("pointerdown", onDown);
    sheet.addEventListener("pointermove", onMove);
    sheet.addEventListener("pointerup", onUp);
    sheet.addEventListener("pointercancel", function (ev) { if (drag && ev.pointerId === drag.id) { drag = null; sheet.classList.remove("drag"); setSnap(snap); } });
    sheet.addEventListener("click", function (ev) { if (swallow) { ev.preventDefault(); ev.stopPropagation(); } }, true);
    body.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { if (!sheet.hidden && !wide.matches) { measure(); setSnap(snap); } });
  }

  // ---------- loading: placeholder rows until the list arrives ----------
  (function () {
    var list = $("list"), ld = $("loading");
    if (!list || list.children.length || !ld || ld.hidden) return;
    var row = "<li class=\"sk\" aria-hidden=\"true\"><span class=\"sk-row\"><i></i><b></b></span></li>";
    list.innerHTML = row + row + row + row;
    new MutationObserver(function (m, obs) {
      if (!ld.hidden) return;
      obs.disconnect();
      list.querySelectorAll("li.sk").forEach(function (li) { li.remove(); });
    }).observe(ld, { attributes: true, attributeFilter: ["hidden"] });
  })();

  // ---------- empty: on a phone the sleepy card also floats over the map ----------
  var empty = $("empty"), mapEmpty = null;
  function syncMapEmpty() {
    var show = empty && !empty.hidden && !wide.matches && !document.body.classList.contains("show-list");
    if (!show) { if (mapEmpty) { mapEmpty.remove(); mapEmpty = null; } return; }
    var p = empty.querySelector("p"), b = $("empty-any");
    if (!mapEmpty) {
      mapEmpty = document.createElement("div");
      mapEmpty.className = "mapempty";
      mapEmpty.setAttribute("role", "status");
      var wrap = empty.querySelector(".sleepy-wrap");
      if (wrap) mapEmpty.appendChild(wrap.cloneNode(true));
      mapEmpty.appendChild(document.createElement("p"));
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "linkbtn";
      btn.addEventListener("click", function () { var o = $("empty-any"); if (o) o.click(); });
      mapEmpty.appendChild(btn);
      $("map-panel").appendChild(mapEmpty);
    }
    mapEmpty.querySelector("p").textContent = p ? p.textContent : "";
    mapEmpty.querySelector("button").textContent = b ? b.textContent : "Show any date";
  }
  if (empty) {
    new MutationObserver(syncMapEmpty).observe(empty, { attributes: true, childList: true, subtree: true, characterData: true });
    new MutationObserver(syncMapEmpty).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    wide.addEventListener("change", syncMapEmpty);
  }

  // ---------- wiring ----------
  document.addEventListener("mm:card", cardIn);
  document.addEventListener("mm:filter", drift);
  document.addEventListener("mm:land", land);
  var map = api().map;
  if (map) {
    var box = map.getContainer();
    box.addEventListener("pointerover", glance);
    box.addEventListener("focusin", glance);
    var ready = function () {
      addVeil(map);
    };
    if (map.loaded()) ready(); else map.once("load", ready);
  }
})();
