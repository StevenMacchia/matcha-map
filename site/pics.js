// Pictures on other people's sites (a brand's Instagram picture, a shop's own photo) are full size: 0.2 to 2 MB each,
// shown in a 40 to 68 px pin or row. We can not shrink them (no proxy, no copy of them on this site), so this file only
// decides WHEN one is fetched. A pin or row writes `<img data-pic="https://...">` over its drawn art instead of `src`;
// this loader gives the picture its `src` only when
//   1. the visitor has touched the page (or ten seconds have passed: then six at most),
//   2. the picture is on screen,
//   3. fewer than three are loading, nearest to the middle of the screen first,
// and stops after 30 a visit (6 on the ten second fallback), and never under Save-Data. The drawn art under it is the
// look until the photo arrives; a picture that fails keeps the art (app.js and cards.js already handle the error).
// A card the visitor opens loads its own photo straight away: that is a tap, not ambient.
(function () {
  "use strict";
  var MAX_LIVE = 3, CAP_IDLE = 6, CAP_TOUCH = 30, IDLE_MS = 10000, FAILSAFE_MS = 8000, SETTLE_MS = 250;
  var conn = navigator.connection || {};
  if (conn.saveData) return;
  var seen = typeof WeakSet === "function" ? new WeakSet() : null;
  var waiting = [], started = 0, running = 0, opened = false, touched = false, pumpT = 0, scanT = 0, io = null;

  function pump() {
    pumpT = 0;
    if (!opened) return;
    var cap = touched ? CAP_TOUCH : CAP_IDLE;
    while (running < MAX_LIVE && started < cap && waiting.length) {
      var cx = innerWidth / 2, cy = innerHeight / 2, best = -1, bd = Infinity;
      for (var i = 0; i < waiting.length; i++) {
        var r = waiting[i].getBoundingClientRect(), d = Math.pow(r.left + r.width / 2 - cx, 2) + Math.pow(r.top + r.height / 2 - cy, 2);
        if (d < bd) { bd = d; best = i; }
      }
      var img = waiting.splice(best, 1)[0];
      if (!img.isConnected || img.getAttribute("src") || !img.getAttribute("data-pic")) continue;
      load(img);
    }
  }
  function load(img) {
    started++; running++;
    var done = false, t = 0;
    function end() { if (done) return; done = true; clearTimeout(t); running--; img.removeEventListener("load", end); img.removeEventListener("error", end); soon(); }
    img.addEventListener("load", end); img.addEventListener("error", end);
    t = setTimeout(end, FAILSAFE_MS);
    img.src = img.getAttribute("data-pic");
  }
  function soon() { if (!pumpT) pumpT = setTimeout(pump, SETTLE_MS); }

  function onSeen(entries) {
    entries.forEach(function (en) {
      var img = en.target, i = waiting.indexOf(img);
      if (en.isIntersecting) { if (i < 0) waiting.push(img); } else if (i >= 0) waiting.splice(i, 1);
    });
    soon();
  }
  function track(img) {
    if (seen) { if (seen.has(img)) return; seen.add(img); }
    if (img.getAttribute("src")) return;
    if (io) io.observe(img);
  }
  function scan() {
    scanT = 0;
    var list = document.querySelectorAll("img[data-pic]");
    for (var i = 0; i < list.length; i++) track(list[i]);
  }
  function rescan() { if (!scanT) scanT = setTimeout(scan, 60); }

  function open(byTouch) {
    if (byTouch) touched = true;
    if (!opened) opened = true;
    soon();
  }
  function start() {
    if (typeof IntersectionObserver !== "function") return;
    io = new IntersectionObserver(onSeen, { rootMargin: "60px" });
    scan();
    if (typeof MutationObserver === "function") new MutationObserver(rescan).observe(document.documentElement, { childList: true, subtree: true });
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (n) { addEventListener(n, function () { open(true); }, { passive: true, capture: true, once: true }); });
    function idle() { setTimeout(function () { open(false); }, IDLE_MS); }
    if (document.readyState === "complete") idle(); else addEventListener("load", idle, { once: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();

  window.MatchaPics = { stats: function () { return { started: started, running: running, waiting: waiting.length, opened: opened, touched: touched }; } };
})();
