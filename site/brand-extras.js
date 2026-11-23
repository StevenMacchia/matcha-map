// Renders site/brand/<handle>/extra.json (tools/gen-brand-extras.js) into <div id="brand-extras">. Plain script, no
// dependencies, text only (nothing from the JSON is ever parsed as HTML). Include on a brand page with:
//   <div id="brand-extras" data-src="extra.json"></div><script src="/brand-extras.js" defer></script>
(function () {
  "use strict";
  var host = document.getElementById("brand-extras");
  if (!host) return;
  var link = document.createElement("link");
  link.rel = "stylesheet"; link.href = "/weekend.css";
  document.head.appendChild(link);
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function safe(u) { return typeof u === "string" && /^\/[^/]/.test(u) ? u : ""; }
  function render(x) {
    if (!x || x.v !== 1) return;
    var box = el("section", "bx");
    if (x.story) box.appendChild(el("p", "bx-story", x.story));
    if (x.price && x.price.text) box.appendChild(el("p", "bx-meta", "Usual price: " + x.price.text));
    if (x.upcoming && x.upcoming.length) {
      box.appendChild(el("h2", null, "Next dates"));
      var ul = el("ul", "bx-list");
      x.upcoming.forEach(function (u) {
        var li = el("li");
        var a = el("a", null, u.day + (u.time ? ", " + u.time : ""));
        if (safe(u.url)) a.href = u.url;
        li.appendChild(a);
        if (u.place) li.appendChild(el("span", "bx-dim", u.place));
        if (safe(u.map)) { var m = el("a", "bx-dim", "On the map"); m.href = u.map; li.appendChild(m); }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (x.drinks && x.drinks.length) {
      box.appendChild(el("h2", null, "On the menu"));
      var dl = el("ul", "bx-drinks");
      x.drinks.forEach(function (d) {
        var li = el("li");
        if (safe(d.art)) { var im = el("img"); im.src = d.art; im.alt = ""; im.width = 72; im.height = 86; im.loading = "lazy"; li.appendChild(im); }
        li.appendChild(el("span", null, d.name));
        dl.appendChild(li);
      });
      box.appendChild(dl);
    }
    if (box.childNodes.length) host.appendChild(box);
  }
  fetch(host.getAttribute("data-src") || "extra.json").then(function (r) { return r.ok ? r.json() : null; }).then(render).catch(function () {});
})();
