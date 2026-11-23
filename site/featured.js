// "Featured" pill on pop-ups a host asked to feature and a moderator approved (Profitability lane, rung 2).
// One fetch of /api/featured per page; if the API answers anything but 200 (or not at all) nothing happens: no pill,
// no retry, no console noise. Paid and free picks look the same to visitors. app.js calls paint(root) after each
// render of a list or a card (guarded hooks), and this file paints the whole page once when the picks arrive.
(function () {
  "use strict";
  var picks = null, started = false;
  function has(id) { return !!(picks && id && picks[id]); }
  function pill() {
    var s = document.createElement("span");
    s.className = "mm-feat"; s.textContent = "Featured";
    return s;
  }
  // root: any element (a list, a card box, a card body) or the document. Safe to call many times.
  function paint(root) {
    if (!picks || !root || !root.querySelectorAll) return;
    var rows = root.querySelectorAll(".mm-row[data-event]"), cards = root.querySelectorAll(".mm-card[data-id]"), i, el, host;
    for (i = 0; i < rows.length; i++) {
      el = rows[i];
      if (!has(el.getAttribute("data-event")) || el.querySelector(".mm-feat")) continue;
      host = el.querySelector(".mm-rn");
      if (host) host.appendChild(pill());
    }
    for (i = 0; i < cards.length; i++) {
      el = cards[i];
      if (!has(el.getAttribute("data-id")) || el.querySelector(".mm-feat")) continue;
      host = el.querySelector(".mm-bname");
      if (host) host.appendChild(pill());
    }
  }
  function load() {
    if (started || typeof fetch !== "function") return;
    started = true;
    try {
      fetch("/api/featured").then(function (r) { return r.status === 200 ? r.json() : null; }).then(function (d) {
        if (!d || !Array.isArray(d.picks) || !d.picks.length) return;
        var m = {};
        d.picks.forEach(function (p) { if (p && /^[a-f0-9]{12}$/.test(p.event || "")) m[p.event] = true; });
        picks = m;
        if (typeof document !== "undefined") paint(document);
      }).catch(function () { /* quiet on purpose */ });
    } catch (e) { /* quiet on purpose */ }
  }
  window.MatchaFeatured = { paint: paint, load: load, has: has };
  load();
})();
