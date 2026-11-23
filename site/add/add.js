// One small script for every form page (add, report, claim, alerts). A form opts in with data-endpoint="/api/...".
// Client-side checks are only for kindness: the function validates again. Bot checks: a hidden "company" field
// (must stay empty) and a load stamp "t" (forms sent in under 1.5 seconds count as bots); "n" is the send time so phone clock drift cannot trip it.
(function () {
  "use strict";
  var form = document.querySelector("form[data-endpoint]");
  if (!form) return;
  var loaded = Date.now();
  var done = document.getElementById("done");
  var topErr = document.getElementById("form-error");
  var btn = form.querySelector("button[type=submit]");

  // Prefill from the query string: /report/?event=<id>, /claim/?brand=<id>, /alerts/?city=raleigh-nc
  try {
    var q = new URLSearchParams(location.search);
    q.forEach(function (v, k) { var el = form.elements[k]; if (el && !el.value && el.type !== "checkbox") el.value = v.slice(0, 200); });
  } catch (e) { /* old browser: no prefill */ }

  // Alerts: fill the city picker from the site's top cities.
  var pick = form.querySelector("select[data-cities]");
  if (pick && window.CITY_LIST) {
    var want = pick.value;
    window.CITY_LIST.slice(0, 120).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).forEach(function (c) {
      var slug = String(c[0]).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (c[1] === "DC") slug = "washington";
      var o = document.createElement("option");
      o.value = slug + "-" + c[1].toLowerCase(); o.textContent = c[0] + ", " + c[1];
      pick.appendChild(o);
    });
    if (want) pick.value = want;
  }

  var email = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;
  function value(name) { var el = form.elements[name]; return el ? (el.type === "checkbox" ? el.checked : String(el.value || "").trim()) : ""; }
  function setErr(name, msg) {
    var el = form.elements[name], out = form.querySelector('[data-err="' + name + '"]');
    if (el && el.setAttribute) { if (msg) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid"); }
    if (out) out.textContent = msg || "";
  }
  function clear() { Array.prototype.forEach.call(form.querySelectorAll("[data-err]"), function (o) { setErr(o.getAttribute("data-err"), ""); }); if (topErr) topErr.textContent = ""; }

  // Same rules, said kindly. Fields a page does not have are skipped.
  function check() {
    var e = {};
    function has(n) { return !!form.elements[n]; }
    function need(n, msg) { if (has(n) && !value(n)) e[n] = msg; }
    if (form.id === "add-form") {
      need("brand", "What is the brand called?");
      if (!value("handle") && !value("url")) e.handle = "Add an Instagram or TikTok handle, or a post link.";
      if (value("url") && !/^https?:\/\/\S+\.\S+/i.test(value("url"))) e.url = "That link needs to start with https://";
      need("date", "Pick the date.");
      if (value("city") && !/[\s,]+[A-Za-z]{2}\.?$/.test(value("city"))) e.city = "City and state, like Austin, TX.";
      need("city", "City and state, like Austin, TX.");
      if (value("end") && !value("start")) e.start = "Add the start time too.";
    }
    if (form.id === "report-form") { need("reason", "Pick what is wrong."); need("event", "Open this page from a pop-up card."); if (value("reason") === "other") need("details", "Tell us a little."); }
    if (form.id === "claim-form") { need("brand", "Which brand?"); need("handle", "Add the handle."); need("role", "What is your role there?"); need("email", "We need an email to reply to."); need("proof", "Add a link that shows it is yours."); if (value("proof") && !/^https?:\/\/\S+\.\S+/i.test(value("proof"))) e.proof = "That link needs to start with https://"; }
    if (form.id === "alerts-form") { need("email", "We need an email to write to."); need("city", "Pick a city."); if (!value("consent")) e.consent = "Tick the box so we know it is ok."; }
    if (value("email") && !email.test(value("email"))) e.email = "That email does not look right.";
    return e;
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    clear();
    var errs = check(), names = Object.keys(errs);
    if (names.length) {
      names.forEach(function (n) { setErr(n, errs[n]); });
      var first = form.elements[names[0]]; if (first && first.focus) first.focus();
      return;
    }
    var body = { t: loaded, n: Date.now() };
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "submit") return;
      body[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });
    btn.disabled = true;
    var label = btn.textContent; btn.textContent = "Sending...";
    fetch(form.getAttribute("data-endpoint"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.ok) {
          form.hidden = true;
          var m = document.getElementById("done-msg"); if (m && res.j.message) m.textContent = res.j.message;
          if (done) { done.hidden = false; var h = done.querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); } }
          return;
        }
        var errors = (res.j && res.j.errors) || {};
        var keys = Object.keys(errors);
        keys.forEach(function (k) { if (k === "form") { if (topErr) topErr.textContent = errors[k]; } else setErr(k, errors[k]); });
        if (!keys.length && topErr) topErr.textContent = (res.j && res.j.error) || (res.status >= 500 ? "Mattie is napping. Try again in a little while." : "Hmm, that did not go through. Try again.");
        btn.disabled = false; btn.textContent = label;
      })
      .catch(function () {
        if (topErr) topErr.textContent = "No connection. Check your signal and try again.";
        btn.disabled = false; btn.textContent = label;
      });
  });
})();
