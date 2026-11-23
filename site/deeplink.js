// Pure helpers for the app's query string (loaded before app.js; also required by the tests).
//   ?q=<zip or city>   runs the Zip-or-city box (the WebSite SearchAction points here)
//   ?city=<slug>-<st>  centres on a listed city, e.g. raleigh-nc
//   ?event=<id>        opens that pop-up's card
//   ?brand=<handle>    opens that brand's card
//   ?plan=<id,id,...>  opens the Weekend tour on those pop-ups, in that order (a shared plan; at most 12)
(function (root) {
  "use strict";
  function slugOf(name) { return String(name).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function clean(v, max) { return typeof v === "string" ? v.trim().slice(0, max || 80) : ""; }
  function parse(search) {
    var p = new URLSearchParams(search || "");
    return {
      q: clean(p.get("q"), 80),
      city: clean(p.get("city"), 80).toLowerCase(),
      event: /^[a-z0-9]{6,32}$/i.test(p.get("event") || "") ? p.get("event") : "",
      brand: clean(p.get("brand"), 60).replace(/^@/, "").toLowerCase(),
      plan: clean(p.get("plan"), 400).split(",").map(function (s) { return s.trim(); }).filter(function (s, i, a) { return /^[a-z0-9]{6,32}$/i.test(s) && a.indexOf(s) === i; }).slice(0, 12)
    };
  }
  // list: window.CITY_LIST rows [name, ST, lat, lng, pop], biggest first. DC is "washington-dc" like the page paths.
  function findCityBySlug(list, s) {
    var m = /^(.+)-([a-z]{2})$/.exec(String(s || "").toLowerCase());
    if (!m) return null;
    for (var i = 0; i < (list || []).length; i++) {
      var c = list[i];
      if (c[1].toLowerCase() !== m[2]) continue;
      if (slugOf(c[0]) === m[1] || (c[1] === "DC" && m[1] === "washington")) return c;
    }
    return null;
  }
  var api = { parse: parse, findCityBySlug: findCityBySlug, slugOf: slugOf };
  if (typeof module === "object" && module.exports) module.exports = api; else root.MatchaDeepLink = api;
})(typeof window !== "undefined" ? window : this);
