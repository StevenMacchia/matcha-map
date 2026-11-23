// /promote/: captions, a counter QR and a share card for a pop-up host. Everything is built here in the browser;
// nothing is posted, fetched from Instagram or TikTok, or sent anywhere. Pure builders first (tested in test/promote.test.js).
(function () {
  "use strict";
  var SITE = "https://matchamap-cu7.pages.dev";
  var FONT = "'M PLUS Rounded 1c', ui-rounded, 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', Arial, sans-serif";
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mapLink(e) { return SITE + "/?event=" + encodeURIComponent(e.id); }
  function eventLink(e) { return SITE + "/e/" + encodeURIComponent(e.id) + "/"; }

  // The wall-clock parts of an ISO string with an offset ("2026-11-28T11:00:00-05:00"): the venue's own time, whatever the visitor's zone.
  function parts(iso) {
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(iso || "");
    return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? 0 : +m[4], mi: m[5] == null ? 0 : +m[5] } : null;
  }
  function clock(p) { var h = p.h % 12 || 12; return h + (p.mi ? ":" + (p.mi < 10 ? "0" : "") + p.mi : "") + (p.h < 12 ? "am" : "pm"); }
  // "Saturday Nov 28, 11am to 3pm" (all day: "Saturday Nov 28, all day"; no end: just the start).
  function dayLine(e, now) {
    var s = parts(e.start);
    if (!s) return "";
    var wd = DAYS[new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay()];
    var yr = s.y !== (now || new Date()).getFullYear() ? ", " + s.y : "";
    var day = wd + " " + MONTHS[s.mo - 1] + " " + s.d + yr;
    if (e.all_day) return day + ", all day";
    var en = parts(e.end), t = clock(s);
    if (en && en.y === s.y && en.mo === s.mo && en.d === s.d) t += " to " + clock(en);
    return day + ", " + t;
  }
  function isPast(e, now) {
    var t = (now || new Date()).getTime(), st = Date.parse(e.start);
    var en = e.end ? Date.parse(e.end) : st + (e.all_day ? 86400000 : 3 * 3600000);
    return !isNaN(en) && en < t;
  }
  function where(e) { return [e.venue, e.city].filter(Boolean).join(", "); }
  function tag(s, max) {
    var t = String(s || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join("");
    return t ? "#" + t.slice(0, max || 24) : "";
  }
  function hashtags(e) {
    var out = [];
    [tag(e.brand), "#matcha", tag(e.city)].forEach(function (t) { if (t && out.indexOf(t) < 0) out.push(t); });
    return out.slice(0, 3);
  }

  function instagram(e, now) {
    var past = isPast(e, now), when = dayLine(e, now), lines = [];
    if (past) lines.push(e.brand + " popped up at " + (e.venue || e.city) + (when ? " on " + when : "") + ".", "That one already happened. Thank you to everyone who came by.");
    else lines.push(e.brand + " is popping up " + (when ? when : "soon") + ".", where(e) ? "Find us at " + where(e) + "." : "");
    lines = lines.filter(Boolean);
    return lines.join("\n\n") + "\n\n" + (past ? "See where else matcha is popping up: " : "Find us on the map: ") + mapLink(e) + "\n\n" + hashtags(e).join(" ");
  }
  function tiktok(e, now) {
    var past = isPast(e, now), when = dayLine(e, now), city = e.city || "your city";
    if (past) return e.brand + " popped up in " + city + (when ? " on " + when : "") + " and it already happened. See what is next on the map: " + mapLink(e);
    return e.brand + " matcha pop-up in " + city + (when ? ", " + when : "") + (e.venue ? " at " + e.venue : "") + ". Map and details: " + mapLink(e);
  }
  function captions(e, now) { return { instagram: instagram(e, now), tiktok: tiktok(e, now) }; }

  function wrap(s, n) {
    var words = String(s || "").split(/\s+/).filter(Boolean), lines = [], cur = "";
    words.forEach(function (w) { if (cur && (cur + " " + w).length > n) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; });
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }
  // 1080 by 1350 (Instagram portrait), drawn art only, fills as attributes so it rasterizes on its own.
  function shareCardSVG(e, now) {
    var name = String(e.brand || "Matcha pop-up"), ini = (name.replace(/[^A-Za-z0-9]/g, "").charAt(0) || "M").toUpperCase();
    var lines = wrap(name, 16), size = lines.length > 1 ? 84 : 100, when = dayLine(e, now), place = where(e);
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350" width="1080" height="1350" font-family="' + FONT + '" role="img" aria-label="' + esc(name + ", " + when) + '">' +
      '<rect width="1080" height="1350" fill="#F4F8EA"/><circle cx="930" cy="190" r="260" fill="#DCEBC9"/><circle cx="130" cy="1180" r="300" fill="#F9D5DF"/>' +
      '<rect x="18" y="18" width="1044" height="1314" rx="64" fill="none" stroke="#4B3426" stroke-width="10"/>' +
      '<circle cx="540" cy="370" r="150" fill="#FFFBF0" stroke="#8CBF7A" stroke-width="10"/><text x="540" y="425" font-size="170" font-weight="800" text-anchor="middle" fill="#3E6B33">' + esc(ini) + '</text>';
    lines.forEach(function (l, i) { s += '<text x="540" y="' + (690 + i * (size + 10)) + '" font-size="' + size + '" font-weight="800" text-anchor="middle" fill="#3B2E27">' + esc(l) + '</text>'; });
    var y = 690 + lines.length * (size + 10) + 40;
    if (when) { wrap(when, 30).forEach(function (l, i) { s += '<text x="540" y="' + (y + i * 56) + '" font-size="48" font-weight="800" text-anchor="middle" fill="#3B2E27">' + esc(l) + '</text>'; }); y += 70; }
    if (place) s += '<text x="540" y="' + (y + 30) + '" font-size="40" font-weight="700" text-anchor="middle" fill="#6B5A4F">' + esc(wrap(place, 34)[0]) + '</text>';
    return s + '<text x="540" y="1270" font-size="34" font-weight="800" text-anchor="middle" fill="#6B5A4F">matchamap</text></svg>';
  }

  function qrSVG(qr, px) {
    var n = qr.getModuleCount(), q = 4, d = "", r, c;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + (c + q) + " " + (r + q) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * q) + " " + (n + 2 * q) + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges" role="img" aria-label="QR code for the map link"><rect width="100%" height="100%" fill="#FFFFFF"/><path d="' + d + '" fill="#1F2E1B"/></svg>';
  }

  var api = { SITE: SITE, dayLine: dayLine, isPast: isPast, hashtags: hashtags, instagram: instagram, tiktok: tiktok, captions: captions, mapLink: mapLink, eventLink: eventLink, shareCardSVG: shareCardSVG, qrSVG: qrSVG };
  if (typeof window !== "undefined") window.MatchaPromote = api;
  if (typeof document === "undefined" || !document.getElementById || !document.getElementById("pr-root")) return;

  // ---- the page ----
  var root = document.getElementById("pr-root");
  function h(tagName, cls, html) { var el = document.createElement(tagName); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; }
  function card(title, sub) { var c = h("section", "fm-card pr-card"); c.appendChild(h("h2", "", esc(title))); if (sub) c.appendChild(h("p", "pr-sub", esc(sub))); root.appendChild(c); return c; }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea"); ta.value = text; ta.className = "pr-offscreen"; ta.setAttribute("readonly", "");
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand("copy")) res(); else rej(new Error("copy")); } catch (e) { rej(e); } finally { document.body.removeChild(ta); }
    });
  }
  function copyButton(getText) {
    var b = h("button", "fm-btn", "Copy"); b.type = "button";
    b.addEventListener("click", function () {
      copyText(getText()).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 2000); }, function () { b.textContent = "Select and copy"; setTimeout(function () { b.textContent = "Copy"; }, 2000); });
    });
    return b;
  }
  function download(name, blob) { var a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }
  function svgToPng(svgText, size, name, btn) {
    var img = new Image(), u = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = function () {
      var cv = document.createElement("canvas"), w = size, ht = Math.round(size * (img.naturalHeight / img.naturalWidth || 1));
      cv.width = w; cv.height = ht; cv.getContext("2d").drawImage(img, 0, 0, w, ht);
      cv.toBlob(function (b) { URL.revokeObjectURL(u); if (b) download(name, b); }, "image/png");
    };
    img.onerror = function () { URL.revokeObjectURL(u); if (btn) btn.textContent = "Could not make the image"; };
    img.src = u;
  }
  function slug(s) { return String(s || "popup").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "popup"; }

  function showEvent(e) {
    var now = new Date(), past = isPast(e, now), when = dayLine(e, now), ml = mapLink(e), c;
    document.title = "Promote " + e.brand + " | Matcha Map";
    c = card(e.brand, past ? "This pop-up already happened." : "Your pop-up, ready to share.");
    c.appendChild(h("p", "pr-line", "<b>" + esc(when) + "</b><br>" + esc(where(e) || "Place not posted")));
    c.appendChild(h("p", "pr-links", '<a href="' + esc(ml) + '">' + esc(ml) + '</a><br><a href="/e/' + esc(encodeURIComponent(e.id)) + '/">Event page</a>'));

    c = card("Captions", "Copy, paste, post. Nothing is sent from here.");
    var cap = captions(e, now);
    [["Instagram", cap.instagram], ["TikTok", cap.tiktok]].forEach(function (p) {
      var box = h("div", "pr-cap"); box.appendChild(h("h3", "", p[0]));
      var ta = h("textarea", "pr-ta"); ta.value = p[1]; ta.rows = p[0] === "Instagram" ? 8 : 4; ta.setAttribute("aria-label", p[0] + " caption");
      box.appendChild(ta); box.appendChild(copyButton(function () { return ta.value; })); c.appendChild(box);
    });

    c = card("Counter QR", "Print it for the counter. It opens the map.");
    c.id = "qr-card";
    var qrBox = h("div", "pr-qr"); c.appendChild(qrBox);
    c.appendChild(h("p", "pr-print-name", esc(e.brand)));
    c.appendChild(h("p", "pr-print-scan", "Scan for the map"));
    var acts = h("div", "pr-acts"); c.appendChild(acts);
    if (typeof window.qrcode === "function") {
      var qr = window.qrcode(0, "M"); qr.addData(ml); qr.make();
      qrBox.innerHTML = qrSVG(qr, 240);
      var dl = h("button", "fm-btn", "Download PNG"); dl.type = "button";
      dl.addEventListener("click", function () { svgToPng(qrSVG(qr, 1024), 1024, slug(e.brand) + "-qr.png", dl); });
      var pr = h("button", "fm-btn alt", "Print"); pr.type = "button";
      pr.addEventListener("click", function () { window.print(); });
      acts.appendChild(dl); acts.appendChild(pr);
    } else qrBox.appendChild(h("p", "pr-sub", "The QR maker did not load. Reload to try again."));

    c = card("Share card", "A 4 by 5 picture for Instagram.");
    var svg = shareCardSVG(e, now), frame = h("div", "pr-frame", svg); c.appendChild(frame);
    var di = h("button", "fm-btn", "Download image"); di.type = "button";
    di.addEventListener("click", function () { svgToPng(svg, 1080, slug(e.brand) + "-card.png", di); });
    var a2 = h("div", "pr-acts"); a2.appendChild(di); c.appendChild(a2);

    c = card("Get listed as the host", "A host page with edits and a Featured slot is coming.");
    var hd = e.handle ? "?brand=" + encodeURIComponent(e.handle) : "";
    c.appendChild(h("p", "", '<a class="fm-btn alt" href="/claim/' + hd + '">Claim your brand</a>'));
    c.appendChild(h("p", "fm-note", 'Want a Featured spot? <a href="/featured/">See how it works</a>.'));
  }

  function showSearch(events) {
    var c = card("Promote your pop-up", "Pick your pop-up to get captions, a QR and a share card.");
    var inp = h("input"); inp.type = "search"; inp.placeholder = "Your brand name"; inp.setAttribute("aria-label", "Brand name"); inp.autocomplete = "off"; inp.maxLength = 80;
    c.appendChild(inp);
    var out = h("ul", "pr-results"); c.appendChild(out);
    function run() {
      var q = inp.value.trim().toLowerCase(); out.innerHTML = "";
      if (q.length < 2) return;
      var now = new Date(), hits = events.filter(function (e) { return !isPast(e, now) && e.status !== "cancelled" && String(e.brand || "").toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; }).slice(0, 12);
      if (!hits.length) { out.appendChild(h("li", "pr-sub", "No upcoming pop-ups for that name. <a href=\"/add/\">Add yours</a>.")); return; }
      hits.forEach(function (e) { out.appendChild(h("li", "", '<a href="/promote/?event=' + esc(encodeURIComponent(e.id)) + '"><b>' + esc(e.brand) + '</b><br><span class="pr-sub">' + esc(dayLine(e, now) + " - " + where(e)) + '</span></a>')); });
    }
    inp.addEventListener("input", run);
  }

  var id = "";
  try { id = (new URLSearchParams(location.search).get("event") || "").slice(0, 40); } catch (er) { /* none */ }
  fetch("/data/events.json").then(function (r) { if (!r.ok) throw new Error("data"); return r.json(); }).then(function (d) {
    var events = d.events || [], ev = id && events.filter(function (e) { return e.id === id; })[0];
    if (ev) showEvent(ev);
    else {
      if (id) { var m = card("Pop-up not found", "Search for your brand instead."); m.className += " pr-miss"; }
      showSearch(events);
    }
  }).catch(function () { card("Could not load pop-ups", "Reload the page to try again."); });
})();
