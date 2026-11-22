// Shrink-to-fit for [data-fit]: one line from data-max down to data-min1; if it still overflows and
// data-lines is 2, wrap (class "wrap") and shrink from data-max2 down to data-min until it fits two lines.
(function () {
  function px(e, s) { e.style.fontSize = s + "px"; }
  function fitOne(e) {
    var max = +e.dataset.max || parseFloat(getComputedStyle(e).fontSize);
    var min1 = +e.dataset.min1 || Math.round(max * 0.7), lines = +e.dataset.lines || 1;
    var max2 = +e.dataset.max2 || max, min = +e.dataset.min || Math.round(min1 * 0.7);
    e.classList.remove("wrap");
    var s = max; px(e, s);
    while (e.scrollWidth > e.clientWidth + 1 && s > min1) { s -= 2; px(e, s); }
    if (e.scrollWidth <= e.clientWidth + 1) return;
    if (lines < 2) { while (e.scrollWidth > e.clientWidth + 1 && s > min) { s -= 2; px(e, s); } return; }
    e.classList.add("wrap"); s = max2; px(e, s);
    var lh = function () { return parseFloat(getComputedStyle(e).lineHeight) || s * 1.05; };
    while ((e.clientHeight > lh() * lines + 2 || e.scrollWidth > e.clientWidth + 1) && s > min) { s -= 2; px(e, s); }
  }
  function fit() { document.querySelectorAll("[data-fit]").forEach(fitOne); }
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("load", fit);
  setTimeout(fit, 300);
})();
