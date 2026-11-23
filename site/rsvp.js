// "I'm going" on a pop-up card (social wave, S1). No account: the browser makes itself a random id once
// (matchamap.me) and sends it, hashed server-side, with each toggle; the list of pop-ups this device marked is kept
// here (matchamap.going). The count shown is the server's count of rows, never a number the page made up. The strip
// stays hidden until data/social.json says rsvp is on (flipped once the KV namespace is bound) and the API answers,
// so nothing half-works and a page without the API makes no API calls at all.
(function () {
  "use strict";
  var API = "/api/rsvp", ME_KEY = "matchamap.me", GOING_KEY = "matchamap.going";
  var counts = {}, stamp = {}, probeP = null; // counts by id, and when each was fetched
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode: the tap still counts this session */ } }
  function rand() {
    var a = new Uint8Array(16), c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : null;
    if (c) c.getRandomValues(a); else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }
  var meMem = null;
  function me() {
    var m = read(ME_KEY) || meMem;
    if (!/^[a-f0-9]{32}$/.test(m || "")) { m = rand(); meMem = m; store(ME_KEY, m); }
    return m;
  }
  var goingMem = null;
  function going() {
    try { var g = JSON.parse(read(GOING_KEY) || "null"); if (Array.isArray(g)) return g; } catch (e) { /* fall through */ }
    return goingMem || [];
  }
  function isGoing(id) { return going().indexOf(id) >= 0; }
  function setGoing(id, yes) {
    var g = going().filter(function (x) { return x !== id; });
    if (yes) g.unshift(id);
    goingMem = g.slice(0, 200);
    store(GOING_KEY, JSON.stringify(goingMem));
  }
  // One probe per page: is the feature on (data/social.json) and is the API there?
  function probe() {
    if (!probeP) probeP = fetch("data/social.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (f) { return f && f.rsvp === true ? fetch(API + "?events=", { cache: "no-store" }).then(function (r) { return r.ok; }) : false; })
      .catch(function () { return false; });
    return probeP;
  }
  // The count line, in words that stay true: the number is the server's, "you" is this device.
  function label(n, mine) {
    if (typeof n !== "number") return mine ? "You're going" : "";
    if (mine) return n <= 1 ? "You're going" : "You and " + (n - 1) + (n === 2 ? " other going" : " others going");
    return n === 0 ? "Be the first to say you're going" : n + " going";
  }
  function paint(strip, id) {
    var b = strip.querySelector("[data-mm-going]"), c = strip.querySelector(".mm-gcount"), t = b && b.querySelector("span"), mine = isGoing(id);
    if (b) b.setAttribute("aria-pressed", mine ? "true" : "false");
    if (t) t.textContent = mine ? "Going" : "I'm going";
    if (c) c.textContent = label(counts[id], mine);
  }
  function fetchCounts(ids) {
    return fetch(API + "?events=" + ids.join(","), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.counts) Object.keys(d.counts).forEach(function (k) { counts[k] = d.counts[k]; stamp[k] = Date.now(); });
    }).catch(function () { /* the strip keeps its last words */ });
  }
  // Shows the strips under root once the API is known to be there, with this device's state and the live count.
  function hydrate(root) {
    var strips = (root || document).querySelectorAll("[data-mm-go]");
    if (!strips.length) return;
    probe().then(function (ok) {
      if (!ok) return;
      var want = [];
      strips.forEach(function (s) { var id = s.getAttribute("data-mm-go"); s.hidden = false; paint(s, id); if (counts[id] == null) want.push(id); });
      if (want.length) fetchCounts(want).then(function () { strips.forEach(function (s) { paint(s, s.getAttribute("data-mm-go")); }); });
    });
  }
  // List rows (S1b): a quiet "3 going" under the place line, only when someone is going (a zero says nothing).
  function rowLabel(n, mine) {
    if (mine) return n <= 1 ? "You're going" : "You and " + (n - 1) + " more going";
    return n >= 1 ? n + " going" : "";
  }
  function paintRows(root) {
    (root || document).querySelectorAll(".mm-row[data-event]").forEach(function (r) {
      var id = r.getAttribute("data-event"), t = rowLabel(counts[id] || 0, isGoing(id)), el = r.querySelector(".mm-rgo");
      if (!t) { if (el) el.remove(); return; }
      if (!el) {
        var rt = r.querySelector(".mm-rt");
        if (!rt) return;
        el = document.createElement("span"); el.className = "mm-rgo";
        var rp = rt.querySelector(".mm-rp");
        if (rp) rt.insertBefore(el, rp.nextSibling); else rt.appendChild(el);
      }
      el.textContent = t;
    });
  }
  // Fetches counts for the upcoming rows under root (at most 60, each at most once a minute) and paints the labels.
  function hydrateRows(root) {
    var rows = (root || document).querySelectorAll(".mm-row[data-event]:not(.mm-v-past):not(.mm-v-cancelled)");
    if (!rows.length) return;
    probe().then(function (ok) {
      if (!ok) return;
      var now = Date.now(), want = [], seen = {};
      rows.forEach(function (r) { var id = r.getAttribute("data-event"); if (!seen[id] && (!stamp[id] || now - stamp[id] > 60000) && want.length < 60) { seen[id] = 1; want.push(id); } });
      paintRows(root);
      if (want.length) fetchCounts(want).then(function () { paintRows(root); });
    });
  }
  function toggle(strip, id) {
    if (strip.classList.contains("mm-busy")) return;
    var yes = !isGoing(id), c = strip.querySelector(".mm-gcount");
    strip.classList.add("mm-busy");
    fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: id, me: me(), going: yes }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        setGoing(id, yes);
        if (d && typeof d.count === "number") { counts[id] = d.count; stamp[id] = Date.now(); }
        paint(strip, id);
        paintRows(document);
        try { document.dispatchEvent(new CustomEvent("mm:going", { detail: { id: id, going: yes } })); } catch (e) { /* no choreography */ }
      })
      .catch(function (st) { if (c) c.textContent = st === 429 ? "That's a lot of taps for one day. Try again tomorrow." : "Could not save that. Try again."; })
      .then(function () { strip.classList.remove("mm-busy"); });
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest("[data-mm-going]");
      if (!b) return;
      var strip = b.closest("[data-mm-go]");
      if (!strip) return;
      ev.preventDefault();
      toggle(strip, b.getAttribute("data-mm-going"));
    });
  }
  // forget(): drops this device's id and list (the data-deletion page can call it; the server rows expire on their own)
  window.MatchaRsvp = { hydrate: hydrate, hydrateRows: hydrateRows, isGoing: isGoing, going: going, probe: probe, label: label, rowLabel: rowLabel, forget: function () { meMem = null; goingMem = null; store(ME_KEY, null); store(GOING_KEY, null); } };
})();
