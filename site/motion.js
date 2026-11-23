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
    var d = ev.detail || {}, card = d.root && d.root.querySelector(".card, .mm-card");
    if (card && !calm()) {
      card.classList.add("enter");
      // drop the class once it has played, so the fill-mode no longer holds transforms (the photo parallax needs them)
      setTimeout(function () { card.classList.remove("enter"); }, 760);
    }
    if (d.phone) { sheetOpen(); morph(d.root); }
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

  // ---------- N7: effects, one canvas, only at moments ----------
  // Petals (and steam) for the opening, a landing and the empty state. One fixed canvas, added on demand and removed
  // when the last particle is gone; at most 16 particles at a time; nothing under reduced motion; never a loop on idle.
  var FX = (function () {
    var cv = null, cx = null, parts = [], raf = 0, last = 0, dpr = 1;
    var PINK = ["#F7C6D3", "#F6B7C7", "#FBD9E2"], VEIN = "#EFA6BA";
    function ensure() {
      if (cv) return true;
      cv = document.createElement("canvas");
      cv.className = "fx";
      cv.setAttribute("aria-hidden", "true");
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
      cx = cv.getContext("2d");
      if (!cx) { cv = null; return false; }
      document.body.appendChild(cv);
      return true;
    }
    function drop() { if (cv) cv.remove(); cv = null; cx = null; parts = []; cancelAnimationFrame(raf); raf = 0; }
    function add(p) { if (parts.length < 16) parts.push(p); }
    function frame(ts) {
      if (!cx) { raf = 0; return; }
      var dt = Math.min(48, ts - (last || ts)) / 1000;
      last = ts;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(function (p) { return (p.t += dt) < p.life; });
      var dark = root.getAttribute("data-theme") === "dark";
      parts.forEach(function (p) {
        var k = p.t / p.life;
        p.vy += p.g * dt; p.vx *= 0.985;
        p.x += (p.vx + Math.sin(p.t * p.wob + p.ph) * p.sway) * dt; p.y += p.vy * dt; p.r += p.spin * dt;
        var a = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        cx.save();
        cx.globalAlpha = Math.max(0, a) * (p.kind === "steam" ? 0.55 : 1);
        cx.translate(p.x, p.y); cx.rotate(p.r);
        if (p.kind === "steam") {
          cx.fillStyle = dark ? "#DCEBC9" : "#FFFFFF";
          cx.beginPath(); cx.arc(0, 0, p.s * (0.6 + k), 0, 6.283); cx.fill();
        } else {
          cx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(p.t * 4 + p.ph))); // a petal turning over
          cx.fillStyle = p.c; cx.beginPath(); cx.ellipse(0, 0, p.s, p.s * 0.58, 0, 0, 6.283); cx.fill();
          cx.strokeStyle = VEIN; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(-p.s * 0.6, 0); cx.lineTo(p.s * 0.5, 0); cx.stroke();
        }
        cx.restore();
      });
      if (parts.length) raf = requestAnimationFrame(frame); else drop();
    }
    function go() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    function petal(x, y, vx, vy, life) {
      add({ kind: "petal", x: x, y: y, vx: vx, vy: vy, g: 160, t: 0, life: life || 1.2, s: 5 + Math.random() * 3, r: Math.random() * 6, spin: (Math.random() - 0.5) * 6,
        sway: 18 + Math.random() * 20, wob: 3 + Math.random() * 2, ph: Math.random() * 6, c: PINK[(Math.random() * 3) | 0] });
    }
    return {
      // A puff from a point: petals thrown up and out, then drifting down (or a few wisps of steam rising).
      burst: function (x, y, o) {
        o = o || {};
        if (calm() || document.hidden || !ensure()) return;
        var n = Math.min(o.n || 8, 12), sp = o.spread || 1;
        for (var i = 0; i < n; i++) {
          var ang = -Math.PI / 2 + (i / (n - 1 || 1) - 0.5) * 2.4 * sp, v = 120 + Math.random() * 110;
          if (o.kind === "steam") add({ kind: "steam", x: x + (Math.random() - 0.5) * 18, y: y, vx: (Math.random() - 0.5) * 16, vy: -40 - Math.random() * 30, g: 0, t: 0, life: 1.1,
            s: 4 + Math.random() * 4, r: 0, spin: 0, sway: 8, wob: 4, ph: Math.random() * 6 });
          else petal(x, y, Math.cos(ang) * v, Math.sin(ang) * v, 1.1 + Math.random() * 0.4);
        }
        go();
      },
      // One petal left behind at a point (the flight's trail).
      trail: function (x, y) {
        if (calm() || document.hidden || !ensure()) return;
        petal(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 40, -30, 0.9);
        go();
      },
      stop: drop
    };
  })();
  window.MatchaFX = FX;

  // ---------- N7: the flight leaves a short petal trail; the landing gets a puff ----------
  var flyT = [];
  function fly(ev) {
    flyT.forEach(clearTimeout); flyT = [];
    var d = (ev.detail && ev.detail.duration) || 1200, panel = $("map-panel");
    if (calm() || !panel) return;
    // three petals near the middle of the map during the first part of the flight
    for (var i = 1; i <= 3; i++) flyT.push(setTimeout(function () {
      var r = panel.getBoundingClientRect();
      FX.trail(r.left + r.width / 2, r.top + r.height * 0.45);
    }, Math.round(d * 0.12 * i)));
  }
  function arrive() {
    var m = api().map, panel = $("map-panel");
    if (calm() || !m || !panel) return;
    var r = panel.getBoundingClientRect(), p = m.project(m.getCenter());
    FX.burst(r.left + p.x, r.top + p.y - 6, { n: 7, spread: 0.8 });
  }

  // ---------- N7: the pin becomes the card's picture (phone) ----------
  // A ghost of the selected pin leaves the map and grows into the picture slot of the rising sheet, then hands over.
  function morph(root) {
    var pin = document.querySelector(".mk.sel .mk-in");
    var slot = root && root.querySelector(".mm-media, [data-hero], .ph, figure, img");
    if (calm() || !pin || !slot || !sheet || typeof slot.animate !== "function") return;
    var a = pin.getBoundingClientRect();
    if (!a.width) return;
    // the slot's final place: the sheet ends at its peek snap; sheetOpen has just put it at its start
    var b = slot.getBoundingClientRect(), off = sy - (snap === "peek" ? peekY : 0);
    var tx = b.left, ty = b.top - off, tw = b.width, th = Math.min(b.height, innerHeight - ty);
    if (!tw || th <= 0) return;
    var g = document.createElement("div");
    g.className = "morph-ghost";
    g.setAttribute("aria-hidden", "true");
    var svg = pin.querySelector("svg");
    if (svg) g.appendChild(svg.cloneNode(true));
    g.style.width = tw + "px"; g.style.height = th + "px";
    document.body.appendChild(g);
    slot.classList.add("morph-hide");
    var anim = g.animate([
      { transform: "translate(" + a.left + "px," + a.top + "px) scale(" + (a.width / tw) + "," + (a.height / th) + ")", borderRadius: "50%", opacity: 1 },
      { transform: "translate(" + tx + "px," + ty + "px) scale(1,1)", borderRadius: "18px", opacity: 1, offset: 0.8 },
      { transform: "translate(" + tx + "px," + ty + "px) scale(1,1)", borderRadius: "18px", opacity: 0 }
    ], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    setTimeout(function () { slot.classList.add("morph-show"); slot.classList.remove("morph-hide"); }, 340);
    var done = function () { g.remove(); slot.classList.remove("morph-show", "morph-hide"); };
    anim.onfinish = done; anim.oncancel = done;
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
    var p = empty.querySelector("p");
    if (!mapEmpty) {
      mapEmpty = document.createElement("div");
      mapEmpty.className = "mapempty";
      mapEmpty.setAttribute("role", "status");
      var wrap = empty.querySelector(".sleepy-wrap");
      if (wrap) mapEmpty.appendChild(wrap.cloneNode(true));
      var txt = document.createElement("div");
      txt.className = "me-txt";
      txt.appendChild(document.createElement("p"));
      var acts = document.createElement("div");
      acts.className = "me-acts";
      txt.appendChild(acts);
      mapEmpty.appendChild(txt);
      $("map-panel").appendChild(mapEmpty);
      // one wisp of steam from sleepy Mattie when the empty card first appears (N7)
      setTimeout(function () { var s = mapEmpty && mapEmpty.querySelector(".sleepy"); if (s) { var r = s.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + 6, { n: 4, kind: "steam" }); } }, 260);
    }
    mapEmpty.querySelector("p").textContent = p ? p.textContent : "";
    // the same buttons as the list's empty card (Go to the nearest, the next range), each one clicking its original
    var acts = mapEmpty.querySelector(".me-acts");
    acts.innerHTML = "";
    empty.querySelectorAll(".empty-acts button").forEach(function (o) {
      if (o.hidden) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = o.className;
      b.textContent = o.textContent;
      b.addEventListener("click", function () { o.click(); });
      acts.appendChild(b);
    });
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
  document.addEventListener("mm:fly", fly);
  document.addEventListener("mm:arrive", arrive);
  var map = api().map;
  if (map) {
    var box = map.getContainer();
    box.addEventListener("pointerover", glance);
    box.addEventListener("focusin", glance);
    var ready = function () {
      addVeil(api().map); // the real map: app.js starts on a stand-in camera (N7c)
    };
    if (map.loaded()) ready(); else map.once("load", ready);
  }
})();
