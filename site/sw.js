// Matcha Map service worker. Bump VERSION whenever a shell file below changes (the files are not fingerprinted);
// activate then drops every older cache. Never caches map tiles or Instagram images.
var VERSION = "mm-3";
var SHELL_CACHE = VERSION + "-shell", DATA_CACHE = VERSION + "-data", LIB_CACHE = "mm-lib-maplibre-4.7.1";
var SHELL = ["/", "/index.html", "/style.css", "/motion.css", "/pwa.css", "/app.js", "/motion.js", "/theme.js", "/drawn.js", "/deeplink.js", "/pwa.js",
  "/cities.js", "/characters.svg", "/map-style.json", "/map-style-dark.json", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png", "/icons/favicon-32.png", "/shell.css"];
// Files from the next-level workers (N6, N8): cached too, but one that is missing never stops the install.
var EXTRA = ["/search.js", "/search.css", "/weekend.css", "/weekend/", "/brand-extras.js", "/cards.js", "/cards.css", "/cards-app.js", "/art.js"];
// The map library is pinned and checked by SRI in index.html; the shell cannot draw a map without it.
var LIB = ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"];
var offline = false;

self.addEventListener("install", function (e) {
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
  return fetch(req).then(function (r) {
    tell("online");
    if (r && r.ok) caches.open(SHELL_CACHE).then(function (c) { c.put(req, r.clone()); });
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
  if (req.mode === "navigate") { e.respondWith(networkFirstPage(req)); return; }
  if ((url.pathname.indexOf("/data/") === 0 && /\.json$/.test(url.pathname)) || url.pathname.indexOf("/img/events/") === 0) {
    e.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
});
