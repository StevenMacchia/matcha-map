// Install and offline (rung 34). Registers sw.js, offers "Add to home screen" without ever blocking the page, says when the
// data on screen is the last saved copy, and offers a refresh when a new version is waiting. Nothing here is needed to use the map.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "matchamap.install", DAY = 86400000;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html) n.innerHTML = html; return n; }
  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var face = "<svg class=\"pwa-face\" viewBox=\"0 0 64 64\" aria-hidden=\"true\" focusable=\"false\"><use href=\"characters.svg#m-base\"></use></svg>";

  // ---------- visits (the second visit unlocks the quiet bar) ----------
  var st = load();
  try { if (!sessionStorage.getItem("matchamap.visit")) { sessionStorage.setItem("matchamap.visit", "1"); st.visits = (st.visits || 0) + 1; save(st); } } catch (e) { /* ignore */ }

  // ---------- install ----------
  var deferred = null, bar = null;
  var iosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  var btn = $("install-btn"), row = $("install-row"), ios = $("ios-install");
  if (ios && iosSafari) ios.hidden = false;

  function hideBar() { if (bar) { bar.remove(); bar = null; } }
  function dismiss() { st = load(); st.dismissed = Date.now(); save(st); hideBar(); }
  function ask() {
    if (!deferred) return;
    var p = deferred; deferred = null;
    hideBar();
    if (row) row.hidden = true;
    p.prompt();
    p.userChoice.then(function (c) { if (c && c.outcome === "dismissed") dismiss(); });
  }
  function showBar() {
    st = load();
    if (bar || !deferred || standalone || (st.visits || 0) < 2 || (st.dismissed && Date.now() - st.dismissed < 30 * DAY)) return;
    bar = el("div", "pwa-bar", face + "<span class=\"pwa-msg\">Keep Matcha Map on your home screen.</span><button type=\"button\" class=\"pwa-go\">Add</button><button type=\"button\" class=\"pwa-x\" aria-label=\"Not now\">&times;</button>");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Install");
    bar.querySelector(".pwa-go").addEventListener("click", ask);
    bar.querySelector(".pwa-x").addEventListener("click", dismiss);
    document.body.appendChild(bar);
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    if (row && !standalone) row.hidden = false;
    showBar();
  });
  window.addEventListener("appinstalled", function () { deferred = null; hideBar(); if (row) row.hidden = true; });
  if (btn) btn.addEventListener("click", ask);

  // ---------- offline note ----------
  var note = null, mapBadge = null, lastSaved = "";
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function drawOffline() {
    if (!note) {
      var panel = $("list-panel");
      if (!panel) return;
      note = el("p", "pwa-offline");
      note.setAttribute("role", "status");
      panel.insertBefore(note, panel.firstChild);
    }
    note.textContent = "Offline: showing the last update" + (lastSaved ? " from " + lastSaved : "");
    var mp = $("map-panel");
    if (mp && !mapBadge) {
      mapBadge = el("div", "pwa-mapnap", "<svg viewBox=\"0 0 64 64\" aria-hidden=\"true\" focusable=\"false\"><use href=\"characters.svg#m-sleepy\"></use></svg><span>The map needs a connection</span>");
      mp.appendChild(mapBadge);
    }
    document.documentElement.classList.add("offline");
  }
  function clearOffline() {
    if (note) { note.remove(); note = null; }
    if (mapBadge) { mapBadge.remove(); mapBadge = null; }
    document.documentElement.classList.remove("offline");
  }
  function setOffline(on) {
    if (!on) { clearOffline(); return; }
    if (lastSaved) { drawOffline(); return; }
    fetch("data/events.json").then(function (r) { return r.json(); }).then(function (d) { lastSaved = when(d.generated); }).catch(function () { /* no time known */ }).then(drawOffline);
  }
  window.addEventListener("offline", function () { setOffline(true); });
  window.addEventListener("online", function () { setOffline(false); });

  // ---------- service worker and the update bar ----------
  if (!("serviceWorker" in navigator)) return;
  // Reload only when a worker that was already in charge is replaced (the update bar). On a first visit the new worker takes
  // over with clients.claim(), which also fires controllerchange; reloading then restarted the opening mid-way (rung 35).
  var reloading = false, upd = null, hadController = !!navigator.serviceWorker.controller;
  function offerUpdate(w) {
    if (upd || !w) return;
    upd = el("button", "pwa-update", "New version, tap to refresh");
    upd.type = "button";
    upd.setAttribute("role", "status");
    upd.addEventListener("click", function () { w.postMessage({ type: "skip" }); upd.textContent = "Refreshing…"; });
    document.body.appendChild(upd);
  }
  navigator.serviceWorker.addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type === "offline") setOffline(true);
    else if (d.type === "online" && navigator.onLine !== false) setOffline(false);
  });
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloading || !navigator.serviceWorker.controller) return;
    if (!hadController) { hadController = true; return; }
    reloading = true;
    location.reload();
  });
  function watch(reg) {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", function () { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); });
    });
  }
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(watch).catch(function () { /* the site works without it */ });
    navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage({ type: "status" }); });
    if (navigator.onLine === false) setOffline(true);
  });
})();
