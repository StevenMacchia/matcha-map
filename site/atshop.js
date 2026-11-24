// A pop-up at a shop's address (rung 8, 2026-11-23): the two are one place when they stand within 40 m of each other
// or when their street addresses read the same once the usual spellings are evened out ("224 E Hennepin Ave" and
// "224 East Hennepin Avenue", a suite dropped, the city after the comma dropped). app.js then draws the pop-up pin
// alone there with the shop's cup on it, and each card names the other. Pure functions; test/atshop.test.js runs them in node.
(function (root) {
  "use strict";
  var WORDS = { street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", place: "pl", court: "ct", parkway: "pkwy", highway: "hwy", east: "e", west: "w", north: "n", south: "s", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw" };
  // The street part of an address in one spelling: lower case, the first comma on, a suite or floor on, and the words
  // above shortened. "" when there is no house number, so two bare street names never match by accident.
  function norm(a) {
    var s = String(a || "").toLowerCase().split(",")[0].replace(/[.#]/g, " ").replace(/\b(suite|ste|unit|apt|fl|floor|room|rm)\b.*$/, "").replace(/\s+/g, " ").trim();
    if (!/^\d+[a-z]?\s/.test(s)) return "";
    return s.split(" ").map(function (w) { return WORDS[w] || w; }).join(" ");
  }
  function miles(a, b) {
    var R = 3958.8, dl = (b[0] - a[0]) * Math.PI / 180, dn = (b[1] - a[1]) * Math.PI / 180;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  var num = function (v) { return typeof v === "number" && isFinite(v); };
  // events: [{ id, lat, lng, address, status }], shops: [{ id, lat, lng, address }]. opts.maxMi: the distance that still
  // counts as one place (0.025 mi, 40 m). Past events pair with nothing. Returns { byEvent: { eventId: shopId },
  // byShop: { shopId: [eventId, ...] } }, the nearest shop winning when two sit within range.
  function pair(events, shops, opts) {
    var maxMi = (opts && opts.maxMi) || 0.025, cells = {}, byAddr = {}, byEvent = {}, byShop = {};
    var cell = function (lat, lng) { return [Math.round(lat * 500), Math.round(lng * 500)]; }; // 0.002 degree cells, about 220 m
    (shops || []).forEach(function (s) {
      if (!s || s.id == null) return;
      if (num(s.lat) && num(s.lng)) { var c = cell(s.lat, s.lng), k = c[0] + "," + c[1]; (cells[k] = cells[k] || []).push(s); }
      var n = norm(s.address);
      if (n) (byAddr[n] = byAddr[n] || []).push(s);
    });
    (events || []).forEach(function (e) {
      if (!e || e.id == null || e.status === "past") return;
      var best = null, bd = Infinity;
      if (num(e.lat) && num(e.lng)) {
        var c = cell(e.lat, e.lng);
        for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) (cells[(c[0] + i) + "," + (c[1] + j)] || []).forEach(function (s) {
          var d = miles([e.lat, e.lng], [s.lat, s.lng]);
          if (d <= maxMi && d < bd) { bd = d; best = s; }
        });
      }
      if (!best) { var n = norm(e.address), list = n && byAddr[n]; if (list && list.length) best = list[0]; }
      if (!best) return;
      byEvent[e.id] = best.id;
      (byShop[best.id] = byShop[best.id] || []).push(e.id);
    });
    return { byEvent: byEvent, byShop: byShop };
  }
  root.MatchaAtShop = { pair: pair, norm: norm, miles: miles };
})(typeof window !== "undefined" ? window : this);
