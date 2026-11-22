// Light is the default for everyone. Dark only when the visitor turns it on with the header button
// (app.js); the choice is kept under one localStorage key. Runs in the head so the page paints in the
// chosen theme from the first frame.
(function () {
  var dark = false;
  try { dark = localStorage.getItem("matchamap.theme") === "dark"; } catch (e) { /* ignore */ }
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
})();
