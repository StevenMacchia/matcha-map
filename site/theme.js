// Light is the default for everyone. Dark only when the visitor turns it on with the header button
// (app.js); the choice is kept under one localStorage key. Runs in the head so the page paints in the
// chosen theme from the first frame.
(function () {
  var dark = false;
  try { dark = localStorage.getItem("matchamap.theme") === "dark"; } catch (e) { /* ignore */ }
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  // The app page (not the generated city and brand pages, which link their own) loads the web font and the map's
  // stylesheet from here, so neither blocks the first paint (N7, Lighthouse). The font swaps in when it arrives.
  if (document.documentElement.className.indexOf("pg") >= 0 || !document.querySelector("meta[name=mm-app]")) return;
  [["https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"],
   ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css", "sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V"]].forEach(function (s) {
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = s[0];
    if (s[1]) { l.integrity = s[1]; l.crossOrigin = "anonymous"; }
    document.head.appendChild(l);
  });
})();
