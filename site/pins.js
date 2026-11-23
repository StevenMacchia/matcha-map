// The map's pin look (2026-11-23, Steven's yes on the Manhattan mock, qa/map/2026-11-23/mock in the mapmock worktree):
// markup for each pin as an HTML string, so app.js only places them and test/pins.test.js can read them in node.
//   shop: a round photo (or the drawn shop) in a matcha green ring, the site's cup as a small mark, a green dot when the
//         hours say open now;
//   pop-up: a warm rounded card with a tail, the photo or the drawn card art, a day pill ("Today", "Sat", "Mar 7"), a
//         going badge only when the real count is at least one, a soft pulse ring when it is on today;
//   brand: the picture in a sage mochi frame, or the drawn card art with the initial (never a blank face);
//   stack (two or more pins closer than 28 px): the first two pins fanned with a count;
//   neighbourhood (zoom 10 to 12): a pill with up to three faces, the count, and a pink count of pop-ups in it.
// Every value is escaped; an image source is only https or a path on this site. Parts that stick out of a pin's box (the
// day pill, the cup, a badge) carry the class "bx", so the label pass and the map gate measure them with the pin.
(function (root) {
  "use strict";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // https, or a path on this site (img/..., /brand/<handle>/avatar.jpg); nothing else reaches a src
  function src(u) {
    u = typeof u === "string" ? u.trim() : "";
    if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (/^\/?[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(u) && u.indexOf("..") < 0 && u.indexOf("//") < 0) return u;
    return "";
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // The day pill from the event's own date (the start's written day, as the list reads it): "Today", the weekday within
  // the coming six days, else "Mar 7".
  function dayPill(start, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(start || ""));
    if (!m) return "";
    now = now || new Date();
    var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((d - t) / 864e5);
    if (diff === 0) return "Today";
    if (diff > 0 && diff < 7) return DAYS[d.getDay()];
    return MONTHS[d.getMonth()] + " " + d.getDate();
  }
  function img(u) { return "<img src=\"" + esc(u) + "\" alt=\"\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\" draggable=\"false\">"; }
  // the site's cup (cards.js CUP), small
  var CUP = "<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M10 13h20l-2.2 19a3 3 0 0 1-3 2.6h-9.6a3 3 0 0 1-3-2.6z\" fill=\"#FFFDF7\" stroke=\"#4B3426\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M11.2 20h17.6l-1.2 11.6a2.4 2.4 0 0 1-2.4 2.1h-10.4a2.4 2.4 0 0 1-2.4-2.1z\" fill=\"#8CBF7A\"/><path d=\"M8.5 13h23\" stroke=\"#4B3426\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>";
  // inner: the picture, or the fallback markup app.js hands in (drawn art, already safe markup it built itself)
  function art(photo, drawn) { var u = src(photo); return "<span class=\"pn-ph\">" + (u ? img(u) : drawn || "") + "</span>"; }
  function wrap(kind, body) { return "<span class=\"pn-ground\" aria-hidden=\"true\"></span><span class=\"pn-bob\"><span class=\"pn pn-" + kind + "\">" + body + "</span></span>"; }

  // o: { photo, drawn, open, serves }
  function shopPin(o) {
    o = o || {};
    return wrap("sh" + (o.serves ? " sv" : ""), art(o.photo, o.drawn) + "<span class=\"pn-cup bx\" aria-hidden=\"true\">" + CUP + "</span>" + (o.open ? "<span class=\"pn-open\" aria-hidden=\"true\"></span>" : ""));
  }
  // o: { photo, drawn, pill, today, going }
  function popPin(o) {
    o = o || {};
    var n = +o.going || 0;
    return wrap("pu" + (o.today ? " today" : ""), (o.today ? "<span class=\"pn-pulse\" aria-hidden=\"true\"></span><span class=\"pn-pulse b\" aria-hidden=\"true\"></span>" : "") + art(o.photo, o.drawn) +
      (o.pill ? "<span class=\"pn-pill bx\">" + esc(o.pill) + "</span>" : "") + (n >= 1 ? goingHTML(n) : ""));
  }
  function goingHTML(n) { n = Math.floor(+n || 0); return n >= 1 ? "<span class=\"pn-going bx\">" + n + " going</span>" : ""; }
  // o: { photo, drawn }
  function brandPin(o) { o = o || {}; return wrap("br", art(o.photo, o.drawn)); }
  // faces: [{ kind: "s" | "e" | "b", photo, drawn }]
  function face(f, cls) { return "<span class=\"" + cls + " k-" + esc(f.kind) + "\">" + art(f.photo, f.drawn) + "</span>"; }
  function stackPin(faces, n) {
    faces = (faces || []).slice(0, 2);
    return "<span class=\"pn-ground\" aria-hidden=\"true\"></span><span class=\"pn-bob\"><span class=\"pn pn-stack\">" + faces.map(function (f, i) { return face(f, "pn-st pn-st" + (i + 1)); }).join("") +
      "<span class=\"pn-fan bx\">" + (Math.floor(+n) || faces.length) + "</span></span></span>";
  }
  function hoodPin(faces, n, pops) {
    faces = (faces || []).slice(0, 3);
    pops = Math.floor(+pops || 0);
    return "<span class=\"pn-bob\"><span class=\"pn pn-hood\">" + faces.map(function (f) { return face(f, "pn-av"); }).join("") +
      "<span class=\"hd-n\">" + (Math.floor(+n) || 0) + "</span>" + (pops ? "<span class=\"hd-p bx\">" + pops + "</span>" : "") + "</span></span>";
  }
  // A slow random phase for the idle bob, the same for the same pin: a negative delay in 0 to 3.6 s.
  function phase(key) { var h = 5381; key = String(key || ""); for (var i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0; return -((h % 3600) / 1000); }

  root.MatchaPins = { shopPin: shopPin, popPin: popPin, brandPin: brandPin, stackPin: stackPin, hoodPin: hoodPin, goingHTML: goingHTML, dayPill: dayPill, phase: phase, src: src, esc: esc };
})(typeof window !== "undefined" ? window : this);
