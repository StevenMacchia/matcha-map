// Feature-use beacon (docs/METRICS.md). Sends { k, v } to /api/ev with navigator.sendBeacon: no cookie, no id, no text the visitor typed.
// Sends nothing when Do Not Track or Global Privacy Control is on. Repeats of the same tap are throttled.
(function () {
  "use strict";
  var nav = navigator;
  if (nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.globalPrivacyControl === true || !nav.sendBeacon) return;
  var last = {}, sent = 0, GAP = { map_move: 8000, zoom_in: 4000, zoom_out: 4000 };
  function send(k, v) {
    var now = Date.now(), key = k + (k === "card_open" ? v : ""), gap = GAP[k] || 1500;
    if (last[key] && now - last[key] < gap) return;
    if (sent >= 80) return;
    last[key] = now; sent++;
    try { nav.sendBeacon("/api/ev", new Blob([JSON.stringify({ k: k, v: v || "" })], { type: "application/json" })); } catch (e) { /* counting never breaks a page */ }
  }
  window.mmMetric = send;
  var $ = function (id) { return document.getElementById(id); };
  var tapAt = 0;

  // buttons and links, one delegated listener
  document.addEventListener("click", function (ev) {
    var t = ev.target; if (!t || !t.closest) return;
    var g = t.closest("[data-mm-going]");
    if (g) return send("going", (g.getAttribute("data-mm-going") || "").slice(0, 40));
    if (t.closest(".mm-act-go, .mm-shop-go")) return send("directions");
    if (t.closest("a[href*='feeds/events/']")) return send("calendar");
    if (t.closest("[data-mm-share]")) return send("share");
    if (t.closest(".mm-promote")) return send("promote");
    if (t.closest(".mm-report")) return send("report");
    if (t.closest("#near")) return send("near_me");
    if (t.closest("#theme-btn")) return send("theme_toggle");
    if (t.closest("#zip-go, #citylist [role=option]")) return send("search");
    if (t.closest("#day-clear")) return send("date_filter");
    if (t.closest("#list li") && !t.closest(".head")) return send("list_tap");
    if (t.closest(".maplibregl-ctrl-zoom-in")) return send("zoom_in");
    if (t.closest(".maplibregl-ctrl-zoom-out")) return send("zoom_out");
  }, true);
  document.addEventListener("change", function (ev) {
    var t = ev.target; if (t && t.id === "day") send("date_filter");
    if (t && t.id === "zip") send("search");
  }, true);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target && ev.target.id === "zip") send("search"); }, true);
  var form = $("alerts-form");
  if (form) form.addEventListener("submit", function () { send("alerts_signup"); });

  // the map: drag = moved, wheel / double tap / pinch = zoom, a short press = a pin tap candidate
  var map = $("map");
  if (map) {
    var down = {}, d0 = 0;
    map.addEventListener("pointerdown", function (e) {
      down[e.pointerId] = { x: e.clientX, y: e.clientY, t: Date.now(), x0: e.clientX, y0: e.clientY };
      var ids = Object.keys(down); if (ids.length === 2) d0 = Math.hypot(down[ids[0]].x - down[ids[1]].x, down[ids[0]].y - down[ids[1]].y);
    });
    map.addEventListener("pointermove", function (e) { var p = down[e.pointerId]; if (p) { p.x = e.clientX; p.y = e.clientY; } });
    function up(e) {
      var p = down[e.pointerId]; if (!p) return;
      var ids = Object.keys(down), moved = Math.hypot(p.x - p.x0, p.y - p.y0);
      if (ids.length === 2 && d0) {
        var a = down[ids[0]], b = down[ids[1]], d1 = Math.hypot(a.x - b.x, a.y - b.y);
        if (Math.abs(d1 - d0) > 24) send(d1 > d0 ? "zoom_in" : "zoom_out");
        d0 = 0;
      } else if (ids.length === 1) {
        if (moved > 8) send("map_move"); else if (Date.now() - p.t < 600) tapAt = Date.now();
      }
      delete down[e.pointerId];
    }
    map.addEventListener("pointerup", up); map.addEventListener("pointercancel", function (e) { delete down[e.pointerId]; });
    map.addEventListener("wheel", function (e) { send(e.deltaY < 0 ? "zoom_in" : "zoom_out"); }, { passive: true });
    map.addEventListener("dblclick", function () { send("zoom_in"); });
  }

  // a card opening: the sheet fills with an event card (data-id) or a storefront card (its name)
  var body = $("sheet-body");
  if (body && window.MutationObserver) {
    var seen = "";
    new MutationObserver(function () {
      var e = body.querySelector("article.mm-card[data-id]"), s = body.querySelector("article.mm-shop");
      var v = e ? "e:" + e.getAttribute("data-id") : s ? "s:" + (s.getAttribute("aria-label") || "").replace(/, matcha (on the menu|shop)$/i, "").replace(/[^a-z0-9 .'&@-]/gi, "").slice(0, 52) : "";
      if (!v || v === "s:" || v === seen) return;
      seen = v; send("card_open", v);
      if (Date.now() - tapAt < 1200) send("pin_tap");
    }).observe(body, { childList: true, subtree: true });
    var sheet = $("sheet"); if (sheet && window.MutationObserver) new MutationObserver(function () { if (!sheet.classList.contains("open") && !sheet.classList.contains("show")) seen = ""; }).observe(sheet, { attributes: true, attributeFilter: ["class", "hidden"] });
  }
})();
