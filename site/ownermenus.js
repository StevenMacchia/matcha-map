// Owner menus (Revenue lane, rung 3): menus a brand sent with its claim and a moderator approved. One fetch of /api/menus per page
// load; if the API answers anything but 200 (or not at all) nothing happens: no retry, no console noise. Exposes
//   window.MatchaOwnerMenus = { get(key) -> menu | null, ready: Promise }
// key is a shop id ("osm:node/123", "brand:labora") or a brand handle without the @. A menu has the same shape the shop card
// renders: { items: [{ name, price?, note? }], source_url, kind: "owner", read, note: "From the owner" }.
(function () {
  "use strict";
  var menus = null;
  function fetchMenus() {
    if (typeof fetch !== "function") return Promise.resolve();
    return fetch("/api/menus", { headers: { accept: "application/json" } })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (j) { if (j && j.menus && typeof j.menus === "object" && !Array.isArray(j.menus)) menus = j.menus; })
      .catch(function () { /* silent */ });
  }
  function get(key) {
    if (!menus || typeof key !== "string" || !key) return null;
    if (!Object.prototype.hasOwnProperty.call(menus, key)) return null;
    var m = menus[key];
    return m && Array.isArray(m.items) && m.items.length ? m : null;
  }
  window.MatchaOwnerMenus = { get: get, ready: fetchMenus() };
})();
