// One fetch per data file for the whole page: app.js, cards-app.js and pwa.js all asked for brands.json, sources.json, places.json and
// events.json on their own (the same bytes twice on the wire). window.mmJSON(url) gives the same promise to every caller.
window.mmJSON = function (u, o) {
  var c = window.__mmJ || (window.__mmJ = {});
  if (!c[u]) { c[u] = fetch(u, o).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); c[u].catch(function () { delete c[u]; }); }
  return c[u];
};
// Light is the default for everyone. Dark only when the visitor turns it on with the header button
// (app.js); the choice is kept under one localStorage key. Runs in the head so the page paints in the
// chosen theme from the first frame.
(function () {
  var dark = false;
  try { dark = localStorage.getItem("matchamap.theme") === "dark"; } catch (e) { /* ignore */ }
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  // The app page (not the generated city and brand pages, which link their own) loads the map's stylesheet from here,
  // so it does not block the first paint (N7, Lighthouse). The font is in style.css (@font-face, fonts/), served from this site.
  if (document.documentElement.className.indexOf("pg") >= 0 || !document.querySelector("meta[name=mm-app]")) return;
  var l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "vendor/maplibre-gl-4.7.1/maplibre-gl.css";
  document.head.appendChild(l);
})();
