// City pins for the state and region zooms (5 to 9): one pin per city with anything on, at the city's own centre, carrying
// the count of pop-ups there. Cities whose centres sit closer than MERGE_PX pixels at the current zoom fold into the biggest
// of them, never one more than CAP_MI miles away, so at zoom 5 a metro reads as one pin on its main city and from zoom 7 the
// suburbs stand on their own. MapLibre's own clustering put a state's pins at the mean of its points and then on its biggest
// city, which read as "only the top two or three cities" (Steven, 2026-11-23). Pure functions; test/citypins.test.js runs them in node.
(function (root) {
  var MERGE_PX = 30, CAP_MI = 40;
  function miles(a, b) {
    var R = 3958.8, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  // Ground distance of one screen pixel at this latitude and zoom (MapLibre's 512 px tiles), in miles.
  function milesPerPx(lat, zoom) { return 24901 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, zoom)); }
  function mergeMiles(lat, zoom) { return Math.min(CAP_MI, MERGE_PX * milesPerPx(lat, zoom)); }

  // items: [{ key, ll: [lat, lng], data: { city, state } }]. centroids: { "City|ST": [lat, lng] } (window.CITIES), optional.
  // opts (optional): { mergePx, capMi }: the national tier (app.js, 2026-11-23) merges only pins that would overlap
  // (mergePx, its pin size) and never by a radius (capMi Infinity).
  // Returns pins: [{ ll, city, state, n, cities: [{ city, state, n, ll }], keys }], biggest first, deterministic.
  function cityPins(items, zoom, centroids, opts) {
    var groups = {}, order = [], mpx = opts && opts.mergePx, cap = opts && opts.capMi != null ? opts.capMi : CAP_MI;
    var within = function (lat) { return mpx ? Math.min(cap, mpx * milesPerPx(lat, zoom)) : mergeMiles(lat, zoom); };
    items.forEach(function (it) {
      var e = it.data || {}, ck = (e.city || "") + "|" + (e.state || "");
      var g = groups[ck];
      if (!g) { g = groups[ck] = { ck: ck, city: e.city || "", state: e.state || "", keys: [], lat: 0, lng: 0, n: 0 }; order.push(g); }
      g.keys.push(it.key); g.lat += it.ll[0]; g.lng += it.ll[1]; g.n++;
    });
    order.forEach(function (g) {
      // The city's centre from the Census list, unless it is far from the city's own pop-ups: San Francisco's includes the
      // Farallon Islands and sits 44 miles out to sea. Then the pop-ups' own mean is the pin.
      var mean = [g.lat / g.n, g.lng / g.n], c = centroids && centroids[g.ck];
      g.ll = c && isFinite(c[0]) && isFinite(c[1]) && miles(c, mean) <= 12 ? [c[0], c[1]] : mean;
      delete g.lat; delete g.lng;
    });
    order.sort(function (a, b) { return b.n - a.n || (a.ck < b.ck ? -1 : a.ck > b.ck ? 1 : 0); });
    var pins = [];
    order.forEach(function (g) {
      var best = null, bd = Infinity;
      for (var i = 0; i < pins.length; i++) {
        var p = pins[i], d = miles(p.ll, g.ll);
        if (d <= within(p.ll[0]) && d < bd) { bd = d; best = p; }
      }
      if (best) { best.n += g.n; best.cities.push(g); best.keys = best.keys.concat(g.keys); }
      else pins.push({ ll: g.ll, city: g.city, state: g.state, n: g.n, cities: [g], keys: g.keys.slice() });
    });
    pins.sort(function (a, b) { return b.n - a.n || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0); });
    return pins;
  }

  root.MatchaCityPins = { cityPins: cityPins, miles: miles, milesPerPx: milesPerPx, mergeMiles: mergeMiles, MERGE_PX: MERGE_PX, CAP_MI: CAP_MI };
})(typeof window !== "undefined" ? window : this);
