(function () {
  function fit() {
    document.querySelectorAll('[data-fit]').forEach(function (e) {
      if (e.classList.contains('two')) return;
      var s = parseFloat(getComputedStyle(e).fontSize), max = e.clientWidth;
      while (e.scrollWidth > max && s > 24) { s -= 2; e.style.fontSize = s + 'px'; }
    });
  }
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener('load', fit);
  setTimeout(fit, 300);
})();
