// Drawn cards: a house-style card for any pop-up that has no photo. Plain inline SVG, built from
// the model sheet (characters.svg symbols handed over by app.js through Drawn.init). No external
// resources. Colours are inline styles with CSS-variable overrides (style.css, .dcv0-.dcv2, light and
// dark) and light fallbacks, so the same string also rasterizes on its own for "Save card".
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var FONT = "'M PLUS Rounded 1c', ui-rounded, 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', 'Nunito', Arial, sans-serif";
  // Light fallbacks per variant: card tint, blob, pill outline.
  var VARS = [
    { bg: "#F4F8EA", blob: "#DCEBC9", edge: "#8CBF7A" },   // matcha
    { bg: "#FFF1F4", blob: "#F9D5DF", edge: "#D98CA2" },   // sakura
    { bg: "#FFF3E6", blob: "#F8D3B5", edge: "#C98A5E" }    // peach
  ];
  var SYM = null, symCache = {}, cache = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hash(s) { var h = 5381; s = String(s || ""); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
  function slug(s) { return String(s || "card").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card"; }

  // Estimated text width (no layout needed, which keeps a build well under 2 ms). Conservative for 800-weight rounded type.
  function tw(s, size) { return s.length * size * 0.6; }
  function fit(s, size, max) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    if (tw(s, size) <= max) return s;
    var n = Math.max(1, Math.floor(max / (size * 0.6)) - 1);
    return s.slice(0, n).replace(/\s+$/, "") + "…";
  }
  function wrap2(s, size, max) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    var per = Math.max(4, Math.floor(max / (size * 0.6))), words = s.split(" "), l1 = "", i = 0;
    while (i < words.length && (l1 ? l1.length + 1 : 0) + words[i].length <= per) { l1 += (l1 ? " " : "") + words[i]; i++; }
    if (!l1) { l1 = words[0].slice(0, per); words[0] = words[0].slice(per); i = words[0] ? 0 : 1; }
    var rest = words.slice(i).join(" ");
    return rest ? [l1, fit(rest, size, max)] : [l1];
  }

  function symbolMarkup(id) {
    if (symCache[id] != null) return symCache[id];
    var s = SYM && SYM[id], out = "";
    if (s) {
      var ser = new XMLSerializer();
      for (var n = s.firstElementChild; n; n = n.nextElementSibling) out += ser.serializeToString(n);
      out = out.replace(/ xmlns="[^"]*"/g, "");
    }
    return (symCache[id] = out);
  }
  function put(id, x, y, size, rot) {
    var vb = (SYM && SYM[id] && SYM[id].getAttribute("viewBox") || "0 0 64 64").split(" "), w = +vb[2], h = +vb[3], k = size / w;
    var t = "translate(" + x + " " + y + ") " + (rot ? "rotate(" + rot + " " + (size / 2) + " " + (h * k / 2) + ") " : "") + "scale(" + k + ")";
    return "<g transform=\"" + t + "\">" + symbolMarkup(id) + "</g>";
  }

  function build(e, o) {
    var mode = o.mode || "card", h = hash(e.brand), v = h % 3, P = VARS[v];
    var uid = "dc" + h.toString(36) + mode.charAt(0);
    var small = mode === "brand" || mode === "shop" || mode === "strip", W = 640, H = mode === "strip" ? 244 : small ? 240 : 400;
    var bg = "class=\"dc-bg\" fill=\"" + P.bg + "\"", blob = "class=\"dc-blob\" fill=\"" + P.blob + "\"";
    var ink = "class=\"dc-ink\" fill=\"#3B2E27\"", mut = "class=\"dc-mut\" fill=\"#6B5A4F\"";
    var pose = e.kind === "organizer" ? "m-whisk" : (h % 2 ? "m-excited" : "m-happy");
    var pat = "<pattern id=\"" + uid + "\" width=\"80\" height=\"80\" patternUnits=\"userSpaceOnUse\"><g fill=\"#F6A3B8\" fill-opacity=\".3\"><ellipse cx=\"12\" cy=\"14\" rx=\"4\" ry=\"2.2\" transform=\"rotate(-35 12 14)\"/><ellipse cx=\"58\" cy=\"52\" rx=\"4\" ry=\"2.2\" transform=\"rotate(40 58 52)\"/></g><g fill=\"#8CBF7A\" fill-opacity=\".3\"><circle cx=\"46\" cy=\"14\" r=\"1.6\"/><circle cx=\"22\" cy=\"58\" r=\"1.6\"/></g></pattern>";
    var s = "<svg xmlns=\"" + NS + "\" class=\"dc dcv" + v + (mode === "thumb" ? " dc-thumb" : "") + "\" viewBox=\"0 0 " + (mode === "thumb" ? "100 100" : W + " " + H) + "\" preserveAspectRatio=\"xMidYMid slice\" focusable=\"false\" aria-hidden=\"true\" font-family=\"" + FONT + "\"><defs>" + pat + "</defs>";

    if (mode === "thumb") {
      var ini = (String(e.brand || "?").replace(/[^A-Za-z0-9]/g, "").charAt(0) || "?").toUpperCase();
      return s + "<rect width=\"100\" height=\"100\" " + bg + "/><rect width=\"100\" height=\"100\" fill=\"url(#" + uid + ")\"/>" +
        "<circle cx=\"50\" cy=\"64\" r=\"36\" " + blob + "/>" + put(pose === "m-whisk" ? "m-whisk" : "m-happy", 20, 32, 66) +
        "<text x=\"9\" y=\"30\" font-size=\"28\" font-weight=\"800\" " + ink + ">" + esc(ini) + "</text></svg>";
    }

    s += "<rect x=\"3\" y=\"3\" width=\"" + (W - 6) + "\" height=\"" + (H - 6) + "\" rx=\"26\" " + bg + "/>" +
      "<rect x=\"3\" y=\"3\" width=\"" + (W - 6) + "\" height=\"" + (H - 6) + "\" rx=\"26\" fill=\"url(#" + uid + ")\"/>";
    var mx, my, ms;
    if (small) { mx = 470; my = 56; ms = 130; } else { mx = 448; my = 70; ms = 156; }
    s += "<ellipse cx=\"" + (mx + ms / 2) + "\" cy=\"" + (my + ms * 0.55) + "\" rx=\"" + (ms * 0.6) + "\" ry=\"" + (ms * 0.6) + "\" " + blob + "/>";
    s += put(mode === "shop" ? "s-shop" : pose, mx, my, ms);
    s += put("c-petal", W - 52, 18, 26, 25) + put("c-petal", W - 84, 30, 17, -20);

    var maxW = small ? 410 : 396, name = String(e.brand || ""), size = 52, lines, i;
    if (tw(name, 52) <= maxW) lines = [name.replace(/\s+/g, " ").trim()];
    else if (!/\s/.test(name.trim())) { size = Math.max(28, Math.min(40, Math.floor(maxW / (name.length * 0.6)))); lines = [fit(name, size, maxW)]; } // one long word (a handle): smaller, never split mid-word
    else { size = 40; lines = wrap2(name, 40, maxW); }
    var y0 = lines.length > 1 ? 74 : 86;
    for (i = 0; i < lines.length; i++) s += "<text x=\"38\" y=\"" + (y0 + i * 46) + "\" font-size=\"" + size + "\" font-weight=\"800\" " + ink + ">" + esc(lines[i]) + "</text>";

    if (mode === "shop") {
      s += "<text x=\"38\" y=\"150\" font-size=\"24\" font-weight=\"700\" " + ink + ">Matcha shop</text>";
      s += "<text x=\"38\" y=\"186\" font-size=\"21\" font-weight=\"700\" " + mut + ">" + esc(fit([e.home_city, e.home_state].filter(Boolean).join(", "), 21, maxW)) + "</text>";
    } else if (mode === "brand") {
      s += "<text x=\"38\" y=\"150\" font-size=\"24\" font-weight=\"700\" " + ink + ">No dates posted here yet</text>";
      s += "<text x=\"38\" y=\"186\" font-size=\"21\" font-weight=\"700\" " + mut + ">" + esc(fit([e.home_city, e.home_state].filter(Boolean).join(", "), 21, maxW)) + "</text>";
    } else if (mode === "strip") {
      // the photo strip on the phone card: the name and one row of menu pills; the day and place are already above it
      var sItems = (Array.isArray(e.menu) ? e.menu : []).slice(0, 3), sx = 38;
      for (i = 0; i < sItems.length; i++) {
        var st = fit(sItems[i], 19, 200), sw = Math.round(tw(st, 19) * 0.92 + 30);
        if (sx + sw > 430) break;
        s += "<rect x=\"" + sx + "\" y=\"" + (lines.length > 1 ? 150 : 128) + "\" width=\"" + sw + "\" height=\"36\" rx=\"18\" stroke-width=\"2.5\" class=\"dc-pillr\" fill=\"#FFFBF0\" stroke=\"" + P.edge + "\"/>" +
          "<text x=\"" + (sx + sw / 2) + "\" y=\"" + ((lines.length > 1 ? 150 : 128) + 25) + "\" font-size=\"19\" font-weight=\"800\" text-anchor=\"middle\" " + ink + ">" + esc(st) + "</text>";
        sx += sw + 10;
      }
    } else {
      if (o.when) s += "<text x=\"38\" y=\"182\" font-size=\"26\" font-weight=\"800\" " + ink + ">" + esc(fit(o.when, 26, maxW)) + "</text>";
      if (e.venue) s += "<text x=\"38\" y=\"214\" font-size=\"21\" font-weight=\"700\" " + ink + ">" + esc(fit(e.venue, 21, maxW)) + "</text>";
      var cityLine = [e.city, e.state].filter(Boolean).join(", ");
      if (cityLine) s += "<text x=\"38\" y=\"242\" font-size=\"21\" font-weight=\"700\" " + mut + ">" + esc(fit(cityLine, 21, maxW)) + "</text>";
      // menu pills (up to four) plus the price, wrapped over at most two rows
      var items = (Array.isArray(e.menu) ? e.menu : []).slice(0, 4).map(function (m) { return { t: fit(m, 19, 230), price: false }; });
      if (e.price) items.push({ t: fit(e.price, 19, 150), price: true });
      var x = 38, y = 270, row = 0;
      for (i = 0; i < items.length; i++) {
        var w = Math.round(tw(items[i].t, 19) * 0.92 + 30);
        if (x + w > W - 36) { row++; x = 38; y += 46; if (row > 1) break; }
        s += "<rect x=\"" + x + "\" y=\"" + y + "\" width=\"" + w + "\" height=\"36\" rx=\"18\" stroke-width=\"2.5\" class=\"dc-pillr" + (items[i].price ? " dc-price" : "") + "\" fill=\"" + (items[i].price ? P.blob : "#FFFBF0") + "\" stroke=\"" + P.edge + "\"/>" +
          "<text x=\"" + (x + w / 2) + "\" y=\"" + (y + 25) + "\" font-size=\"19\" font-weight=\"800\" text-anchor=\"middle\" " + ink + ">" + esc(items[i].t) + "</text>";
        x += w + 10;
      }
    }
    // sticker outline, drawn last so it sits over the fills
    return s + "<rect x=\"3\" y=\"3\" width=\"" + (W - 6) + "\" height=\"" + (H - 6) + "\" rx=\"26\" fill=\"none\" stroke-width=\"5\" stroke=\"#4B3426\" class=\"dc-line\"/></svg>";
  }

  // drawnCard(event, opts): opts.mode "card" (16:10, default), "thumb" (square crop), "brand" (no dates),
  // "strip" (21:8, the name and menu pills, for the phone card's photo strip);
  // opts.when is the venue-local day and time line the page already computes.
  function drawnCard(e, opts) {
    opts = opts || {};
    var key = (opts.mode || "card") + "|" + (e.id || e.brand) + "|" + (opts.when || "");
    if (cache[key]) return cache[key];
    var out = build(e, opts);
    if (SYM) cache[key] = out;   // never cache a build made before the model sheet arrived
    return out;
  }
  // Photo-slot markup: same size and radius as a photo, aria-label on the box, Save card beneath.
  function drawnBlock(e, opts) {
    opts = opts || {};
    var brand = opts.mode === "brand" || opts.mode === "shop", shop = opts.mode === "shop";
    return "<div class=\"dc-wrap\"><div class=\"ph ph-drawn" + (brand ? " ph-drawn-brand" : "") + "\" role=\"img\" aria-label=\"" + esc(e.brand) + ", drawn card\">" + drawnCard(e, opts) + "</div>" +
      (shop || opts.noSave ? "" : "<button type=\"button\" class=\"dc-save\" data-dc-save=\"" + esc(slug(e.brand)) + "\">Save card</button>") + "</div>";
  }

  // Save card: serialize the SVG, draw it to a canvas 1200px wide, download a PNG.
  function save(btn) {
    var box = btn.closest(".dc-wrap") || btn.closest(".card"), svg = box && box.querySelector("svg.dc");
    if (!svg) return;
    var vb = svg.viewBox.baseVal, w = 1200, h = Math.round(w * vb.height / vb.width);
    var src = svg.outerHTML.replace("<svg ", "<svg width=\"" + w + "\" height=\"" + h + "\" ").replace(/\sblink/, "");
    if (src.indexOf("xmlns=") < 0) src = src.replace("<svg ", "<svg xmlns=\"" + NS + "\" ");
    var url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml;charset=utf-8" })), img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) {
        if (!b) return;
        var u = URL.createObjectURL(b), a = document.createElement("a");
        a.href = u; a.download = btn.getAttribute("data-dc-save") + ".png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      }, "image/png");
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest("[data-dc-save]");
    if (b) save(b);
  });

  window.Drawn = { init: function (sym) { SYM = sym; symCache = {}; cache = {}; }, card: drawnCard, block: drawnBlock };
  window.drawnCard = drawnCard;
})();
