// Dashboard at /m/: asks for the moderator token once (sessionStorage), reads /api/metrics, draws everything in code.
// window.MMDash.render(data, days) is also what the published artifact calls with its own data.
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg", W = 30, DATA = null;
  var LABEL = { map_move: "Moved the map", zoom_in: "Zoomed in", zoom_out: "Zoomed out", pin_tap: "Tapped a pin", card_open: "Opened a card", going: "I'm going", directions: "Directions", calendar: "Calendar", share: "Share", near_me: "Near me", search: "Searched", date_filter: "Date filter", list_tap: "Tapped the list", promote: "Promote this pop-up", report: "Report a problem", alerts_signup: "Alerts sign-up", theme_toggle: "Theme toggle" };
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else if (k === "cls") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function sv(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); return e; }
  var none = function () { return document.createDocumentFragment(); };
  var fmt = function (n) { return n == null ? "n/a" : Number(n).toLocaleString("en-US"); };
  var sum = function (a, f) { return a.reduce(function (s, x) { return s + (f(x) || 0); }, 0); };

  function tile(label, value, note, cls) { return el("div", { cls: "tile " + (cls || "") }, [el("b", { text: value }), el("span", { text: label }), note ? el("small", { text: note }) : none()]); }
  function card(title, body, cls, badge) {
    var h = el("h2", { text: title });
    if (badge) { h.appendChild(document.createTextNode(" ")); h.appendChild(el("span", { cls: "badge" + (badge.s ? " s" : ""), text: badge.t })); }
    return el("section", { cls: "card " + (cls || "") + (badge && badge.s ? " sample" : "") }, [h].concat(body));
  }
  function bars(items, cls) {
    if (!items.length) return el("p", { cls: "empty", text: "Nothing counted yet." });
    var m = Math.max.apply(null, items.map(function (x) { return x.count; })) || 1, ul = el("ul", { cls: "bars " + (cls || "") });
    items.forEach(function (x) {
      var i = el("i"); i.style.width = Math.max(2, Math.round(100 * x.count / m)) + "%";
      ul.appendChild(el("li", {}, [el("span", { cls: "nm", text: x.label || x.name, title: x.label || x.name }), el("span", { cls: "bar" }, [i]), el("span", { cls: "n", text: fmt(x.count) })]));
    });
    return ul;
  }
  function rank(items) {
    if (!items.length) return el("p", { cls: "empty", text: "Nothing counted yet." });
    var ol = el("ol", { cls: "rank" });
    items.forEach(function (x) { ol.appendChild(el("li", {}, [el("span", { cls: "nm", text: x.label || x.name, title: x.label || x.name }), el("span", { cls: "n", text: fmt(x.count) })])); });
    return ol;
  }
  // people vs bots, visitors per day: two lines drawn here
  function line(series) {
    var w = 640, h = 220, p = { l: 34, r: 8, t: 10, b: 24 };
    var max = Math.max(4, Math.max.apply(null, series.map(function (d) { return Math.max(d.humanVisitors, d.botVisitors); }))); max = Math.ceil(max / 4) * 4;
    var s = sv("svg", { "class": "chart", viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": "Visitors per day, people and bots" });
    var x = function (i) { return p.l + (series.length < 2 ? 0 : i * (w - p.l - p.r) / (series.length - 1)); }, y = function (v) { return h - p.b - v * (h - p.t - p.b) / max; };
    for (var g = 0; g <= 4; g++) { var gy = y(max * g / 4); s.appendChild(sv("line", { x1: p.l, x2: w - p.r, y1: gy, y2: gy, stroke: "var(--line)", "stroke-width": 1 })); var t = sv("text", { x: p.l - 6, y: gy + 4, "text-anchor": "end" }); t.textContent = Math.round(max * g / 4); s.appendChild(t); }
    [["humanVisitors", "var(--deep)"], ["botVisitors", "var(--pink-edge)"]].forEach(function (k) {
      var pts = series.map(function (d, i) { return x(i).toFixed(1) + "," + y(d[k[0]]).toFixed(1); }).join(" ");
      if (k[0] === "humanVisitors") s.appendChild(sv("polygon", { points: x(0) + "," + y(0) + " " + pts + " " + x(series.length - 1) + "," + y(0), fill: "var(--accent)", opacity: ".25" }));
      s.appendChild(sv("polyline", { points: pts, fill: "none", stroke: k[1], "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    });
    [0, Math.floor((series.length - 1) / 2), series.length - 1].forEach(function (i) { if (!series[i]) return; var t = sv("text", { x: x(i), y: h - 6, "text-anchor": i === 0 ? "start" : i === series.length - 1 ? "end" : "middle" }); t.textContent = series[i].day.slice(5); s.appendChild(t); });
    return s;
  }
  function legend() { return el("div", { cls: "legend" }, [el("span", {}, [el("i"), document.createTextNode("People")]), el("span", {}, [el("i", { cls: "b" }), document.createTextNode("Bots")])]); }

  function render(d, win) {
    var w = d.windows[win], series = d.series.slice(-win), board = $("board");
    var has = w.views.human + w.views.bot > 0, pend = !has && !d.sample, sm = d.sample ? { t: "sample", s: 1 } : null;
    var count = function (re) { return sum(w.features, function (f) { return re.test(f.name) ? f.count : 0; }); };
    var sub = pend ? "counting from launch" : d.sample ? "sample" : "last " + win + " days";
    var since = d.since ? new Date(d.since).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    var stamp = el("p", { cls: "since" }, [el("b", { text: d.sample ? "Sample numbers. " : since ? "Counting since " + since + ". " : "Not counting yet. " }), document.createTextNode(d.sample ? "Real counting starts at launch. " : "Visits before that were not counted. Google Search Console counts Google searches and clicks, not visits to the site, so the two will not match. "), el("span", { id: "upd", text: d.generatedAt && !d.sample ? "Updated " + new Date(d.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + ", refreshes every 5 minutes. " : "" }), d.sample ? none() : el("button", { type: "button", id: "refresh", text: "Refresh now" })]);
    var tiles = el("div", { cls: "tiles" }, [
      tile("People (visitors)", pend ? "—" : fmt(w.visitors.human), sub, pend ? "pend" : ""),
      tile("Bots (visitors)", pend ? "—" : fmt(w.visitors.bot), pend ? sub : "kept out of the rest", pend ? "pend" : ""),
      tile("Page views", pend ? "—" : fmt(w.views.human), pend ? sub : "people only", pend ? "pend" : ""),
      tile("RSVPs (I'm going)", fmt(w.rsvp.total), fmt(d.rsvp.allTime) + " all time on " + fmt(d.rsvp.events) + " pop-ups"),
      tile("Cards opened", pend ? "—" : fmt(count(/^card_open$/)), sub, pend ? "pend" : ""),
      tile("Map moves, zooms, pin taps", pend ? "—" : fmt(count(/map_move|zoom|pin_tap/)), sub, pend ? "pend" : "")
    ]);
    var feats = w.features.slice().sort(function (a, b) { return b.count - a.count; }).map(function (f) { return { label: LABEL[f.name] || f.name, count: f.count }; });
    var m = d.map || {}, r = d.run;
    var runBox = r ? el("div", { cls: "run" }, [
      el("span", {}, [el("b", { text: "Last daily run " }), document.createTextNode(r.date || "")]),
      el("span", { cls: /FAIL/i.test(r.outcome) ? "bad" : "ok", text: r.outcome || "" }),
      el("span", { text: fmt(r.events) + " events, " + fmt(r.upcoming) + " upcoming, " + fmt(r.shops) + " shops, " + fmt(r.cities) + " cities" }),
      r.failures ? el("span", { cls: "bad", text: String(r.failures).slice(0, 160) }) : none()
    ]) : el("p", { cls: "empty", text: "No run status found." });
    var mapBox = el("div", { cls: "tiles" }, [tile("Shops", fmt(m.shops)), tile("Events", fmt(m.events)), tile("Upcoming", fmt(m.upcoming))]);
    var devs = w.devices.map(function (x) { return x.name + " " + x.count; }).join(", ") || "none yet";
    var grid = el("div", { cls: "grid" }, [
      card("Visitors per day", [pend ? el("p", { cls: "empty", text: "Counting from launch." }) : line(series), pend ? none() : legend()], "wide", sm),
      card("Visitors by state", [bars(w.states.filter(function (x) { return /^[A-Z]{2}$/.test(x.name); }).slice(0, 15).map(function (x) { return { label: x.name, count: x.count }; }))], "", sm),
      card("Pages people view", [bars(w.groups.map(function (x) { return { label: x.name, count: x.count }; }), "pink")], "", sm),
      card("How people use the site", [bars(feats)], "wide", sm),
      card("Top clicked cards", [rank(w.clicked)], "", sm),
      card("RSVPs, top pop-ups", [rank(w.rsvp.top)], "", d.sampleRsvp ? { t: "sample", s: 1 } : null),
      card("Top pages", [rank(w.paths)], "", sm),
      card("Where visitors come from", [rank(w.referrers), el("p", { cls: "note", text: "Devices: " + devs })], "", sm),
      card("Map size", [mapBox], ""),
      card("Run health", [runBox], "")
    ]);
    board.textContent = ""; board.appendChild(stamp); board.appendChild(tiles); board.appendChild(grid);
    if (d.sample) board.appendChild(el("p", { cls: "note", text: "Cards marked sample show made-up numbers for one day, in a lighter tone, so the layout can be seen. Real counting starts at launch." }));
    if (pend) board.appendChild(el("p", { cls: "note", text: "No visits counted yet. Counting starts on the first page view after this branch is deployed." }));
    Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) { b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-win")) === win)); });
  }
  window.MMDash = { render: render };

  function load(tok) {
    return fetch("/api/metrics", { headers: { authorization: "Bearer " + tok }, cache: "no-store" }).then(function (r) {
      if (r.status === 401) throw new Error("That token was not accepted.");
      if (!r.ok) throw new Error("The metrics did not load (" + r.status + ").");
      return r.json();
    });
  }
  var TOKEN = null;
  function refresh() { if (!TOKEN || document.hidden) return; load(TOKEN).then(function (d) { DATA = d; render(d, W); }).catch(function () { /* keep what is on screen */ }); }
  document.addEventListener("click", function (e) { if (e.target && e.target.id === "refresh") { e.target.disabled = true; e.target.textContent = "Refreshing..."; TOKEN = TOKEN; if (TOKEN) load(TOKEN).then(function (d) { DATA = d; render(d, W); }).catch(function () { e.target.disabled = false; e.target.textContent = "Refresh now"; }); } });
  setInterval(refresh, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  function show(d) { DATA = d; $("gate").hidden = true; $("board").hidden = false; render(d, W); }
  Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) {
    b.addEventListener("click", function () { W = Number(b.getAttribute("data-win")); if (DATA) render(DATA, W); });
  });
  var gate = $("gate");
  if (gate && !window.MM_STATIC) {
    gate.addEventListener("submit", function (e) {
      e.preventDefault(); var tok = $("tok").value.trim(), go = gate.querySelector("button"); $("gate-msg").textContent = "Opening... the first load can take a few seconds.";
      go.disabled = true; go.textContent = "Opening...";
      load(tok).then(function (d) { TOKEN = tok; try { sessionStorage.setItem("mm-metrics-token", tok); } catch (x) { /* private mode */ } show(d); }).catch(function (err) { $("gate-msg").textContent = err.message; }).then(function () { go.disabled = false; go.textContent = "Open"; });
    });
    var saved = null; try { saved = sessionStorage.getItem("mm-metrics-token"); } catch (x) { /* private mode */ }
    if (saved) load(saved).then(function (d) { TOKEN = saved; show(d); }).catch(function () { try { sessionStorage.removeItem("mm-metrics-token"); } catch (x) { /* private mode */ } });
  }
  if (window.MM_STATIC) { window.MMDash.show = show; }
})();
