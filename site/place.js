// The remembered place (Steven, 2026-11-23: "make the site remember ur location when u share it for when u revisit").
// One place in localStorage, no account: where Near me, a zip, a city search or a city page landed, at the zoom the
// visitor had when the move ended. The next visit opens there instead of the whole country (app.js, firstList), with a
// "Whole map" button and Forget in the Show sheet. A shared link stores its view only while nothing is remembered, so
// a friend's link never replaces a visitor's own place; Near me or a new search does. Pure functions over any storage
// with getItem, setItem and removeItem; test/place.test.js runs them in node.
(function (root) {
  "use strict";
  var KEY = "matchamap.place", HOWS = ["near", "zip", "city", "page", "link"], MAX_AGE = 180 * 86400000;
  // A valid place or null: finite numbers in range, a known origin, a label of at most 80 characters, not older than
  // 180 days (when now is given). Anything else in storage (an old shape, a hand edit) reads as nothing.
  function clean(p, now) {
    if (!p || typeof p !== "object") return null;
    var lat = +p.lat, lng = +p.lng, zoom = +p.zoom, at = +p.at || 0;
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(zoom) || lat < -85 || lat > 85 || lng < -180 || lng > 180 || zoom < 1 || zoom > 20) return null;
    if (HOWS.indexOf(p.how) < 0) return null;
    if (at && now && now - at > MAX_AGE) return null;
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, zoom: Math.round(zoom * 100) / 100, label: String(p.label || "").slice(0, 80), how: p.how, at: at };
  }
  function read(storage, now) {
    try { var raw = storage && storage.getItem(KEY); return raw ? clean(JSON.parse(raw), now || Date.now()) : null; } catch (e) { return null; }
  }
  // Stores the place and returns it, or null when it is not valid, storage is not there, or a link finds a place already.
  function write(storage, place, now) {
    var p = clean(place, 0);
    if (!p || !storage) return null;
    if (p.how === "link" && read(storage, now)) return null;
    if (!p.at) p.at = now || Date.now();
    try { storage.setItem(KEY, JSON.stringify(p)); } catch (e) { return null; }
    return p;
  }
  function clear(storage) { try { if (storage) storage.removeItem(KEY); } catch (e) { /* nothing to forget */ } }
  function describe(p) { return p && p.label ? p.label : p && p.how === "near" ? "near you" : "your last spot"; }
  root.MatchaPlace = { KEY: KEY, MAX_AGE: MAX_AGE, read: read, write: write, clear: clear, describe: describe, clean: clean };
})(typeof window !== "undefined" ? window : this);
