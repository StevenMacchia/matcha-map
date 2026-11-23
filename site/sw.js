// Matcha Map service worker. VERSION is stamped by tools/sw-version.js (a hash of the shell files) before every deploy, so a
// changed shell always installs a new worker; activate then drops every older cache. Online, shell files are fetched from the
// network first and the cache only fills in offline, so a visitor never gets yesterday's style.css under today's index.html
// (that happened on 2026-11-22 when rung 35 changed the shell under a worker that precached rung 34's). Never caches map
// tiles or Instagram images.
var VERSION = "mm-7c7b0092cc";
var SHELL_CACHE = VERSION + "-shell", DATA_CACHE = VERSION + "-data", LIB_CACHE = "mm-lib-maplibre-4.7.1";
var SHELL = ["/index.html", "/style.css", "/motion.css", "/pwa.css", "/app.js", "/motion.js", "/theme.js", "/drawn.js", "/deeplink.js", "/rsvp.js", "/featured.js", "/pwa.js", "/cities.js", "/citypins.js", "/density.js", "/series.js", "/characters.svg", "/map-style.json", "/map-style-dark.json", "/manifest.webmanifest", "/ownermenus.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png", "/icons/favicon-32.png", "/shell.css",
  "/cards.css", "/cards-app.js", "/cards.js", "/shopcard.js", "/shopcard.css", "/search.js", "/search.css", "/art.js", "/img-helper.js"];
// Files from the next-level workers (N6, N8): cached too, but one that is missing never stops the install.
var EXTRA = ["/weekend.css", "/weekend/", "/brand-extras.js"];
// The map library is pinned and checked by SRI in index.html; the shell cannot draw a map without it.
var LIB = ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"];
var offline = false;

self.addEventListener("install", function (e) {
  self.skipWaiting(); // a new shell takes over at once; pwa.js reloads the open page once when a previous worker is replaced
  e.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: "reload" })); }).concat(
        EXTRA.map(function (u) { return c.add(new Request(u, { cache: "reload" })).catch(function () { /* optional */ }); })));
    }),
    caches.open(LIB_CACHE).then(function (c) {
      return Promise.all(LIB.map(function (u) {
        return c.match(u).then(function (hit) { return hit || c.add(new Request(u, { mode: "cors", credentials: "omit" })); }).catch(function () { /* fills in on first use */ });
      }));
    })
  ]));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE && k !== DATA_CACHE && k !== LIB_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type === "skip") self.skipWaiting();
  else if (d.type === "status" && e.source) e.source.postMessage({ type: offline ? "offline" : "online" });
});

function tell(state) {
  var was = offline;
  offline = state === "offline";
  if (was === offline) return;
  self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: state }); }); });
}

function staleWhileRevalidate(req, name) {
  return caches.open(name).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        tell("online");
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }).catch(function () { tell("offline"); return null; });
      return hit || net.then(function (r) { return r || Response.error(); });
    });
  });
}

function networkFirstPage(req) {
  return fetch(req, { cache: "no-cache" }).then(function (r) {
    tell("online");
    if (r && r.ok) { var copy = r.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); }); } // clone before the body is read
    return r;
  }).catch(function () {
    tell("offline");
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("/index.html"); });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (LIB.indexOf(req.url) >= 0) { // cache first, the URL carries the version
    e.respondWith(caches.open(LIB_CACHE).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (r) { if (r && r.ok) c.put(req, r.clone()); return r; }); });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return; // tiles, fonts, Instagram images: straight to the network, never stored
  if (url.pathname.indexOf("/api/") === 0) return; // counts and forms: live answers only, never from a cache
  if (req.mode === "navigate") { e.respondWith(networkFirstPage(req)); return; }
  if ((url.pathname.indexOf("/data/") === 0 && /\.json$/.test(url.pathname)) || url.pathname.indexOf("/img/events/") === 0) {
    e.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }
  e.respondWith(networkFirstAsset(req));
});

// Shell files (css, js, svg, map styles, icons): the network copy when there is one, kept for offline; the cache only when there is not.
function networkFirstAsset(req) {
  // cache: "no-cache" revalidates with the server instead of trusting the browser's HTTP cache (a 304 when nothing changed)
  return fetch(req, { cache: "no-cache" }).then(function (r) {
    tell("online");
    if (r && r.ok) { var copy = r.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); }); }
    return r;
  }).catch(function () {
    tell("offline");
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
  });
}
