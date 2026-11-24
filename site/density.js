// Map density (2026-11-23, rung "uncluster", after "you have to zoom WAY too far in for the matcha events to uncluster"):
// from zoom 9 up nothing groups by area. A pin joins another only when the two would overlap on screen: closer than
// MIN_PX (20 px) centre to centre at this zoom, each measured where its marker is drawn (opts.shift). The first pin of a
// stack (the leader, by key) keeps its own spot, so any two markers left on the map stand at least MIN_PX apart. A stack
// spreads on hover and on tap (fanOffsets). No neighbourhood grid, no radius clusters. spread() is the city split test the
// app uses from zoom 6 to 9: how far apart a city's places sit on screen. Pure functions; test/density.test.js runs them in node.
(function (root) {
  var MIN_PX = 20, TUCK = 4;
  function mx(lng) { return (lng + 180) / 360; }
  function my(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  // World pixels at this zoom (MapLibre's 512 px tiles), plus the marker's own offset from its point (shift(p) -> [dx, dy]).
  function px(p, zoom, shift) {
    var w = 512 * Math.pow(2, zoom), d = shift ? shift(p) || [0, 0] : [0, 0];
    return [mx(p.ll[1]) * w + d[0], my(p.ll[0]) * w + d[1]];
  }
  // points: [{ key, ll: [lat, lng], kind }]. opts: { minPx, shift(p), radius(p, n) }: with radius (half the icon drawn
  // for p's kind, n the count when it leads a stack), two markers join when their icons would overlap by more than TUCK (4) px
  // (an edge may tuck under, a middle never), and never further than that; minPx stays the floor. A stack is drawn
  // bigger than a single pin, so once the stacks are known, any two markers whose icons now overlap fold together too.
  // Returns [{ key, ll, keys, kind: "one" | "fan", kinds: { e: n, s: n, b: n } }], leaders first by key, deterministic.
  function group(points, zoom, opts) {
    opts = opts || {};
    var minPx = opts.minPx || MIN_PX, rad = opts.radius, placed = [], buckets = {}, maxR = 0;
    if (rad) points.forEach(function (p) { maxR = Math.max(maxR, rad(p, 1) || 0, rad(p, 2) || 0); });
    var B = Math.max(minPx, 2 * maxR - TUCK);
    var near = function (a, na, b, nb) { return rad ? Math.max(minPx, (rad(a, na) || 0) + (rad(b, nb) || 0) - TUCK) : minPx; };
    points.slice().sort(byKey).forEach(function (p) {
      // a hash of B px buckets, so a city's thousand shops stay fast
      var q = px(p, zoom, opts.shift), bx = Math.floor(q[0] / B), by = Math.floor(q[1] / B), hit = null, hd = Infinity;
      for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) {
        (buckets[(bx + i) + "," + (by + j)] || []).forEach(function (g) {
          var d = Math.hypot(g.q[0] - q[0], g.q[1] - q[1]);
          if (d < near(g.lead, 1, p, 1) && d < hd) { hd = d; hit = g; }
        });
      }
      if (hit) { hit.pts.push(p); return; }
      var g = { lead: p, pts: [p], q: q };
      placed.push(g);
      (buckets[bx + "," + by] = buckets[bx + "," + by] || []).push(g);
    });
    // fold markers whose icons overlap now that the stacks are drawn at their size: the smaller joins the bigger
    for (var pass = 0; rad && pass < 8; pass++) {
      var changed = false;
      placed.sort(function (a, b) { return b.pts.length - a.pts.length || byKey(a.lead, b.lead); });
      var bk = {};
      placed.forEach(function (g) { var k = Math.floor(g.q[0] / B) + "," + Math.floor(g.q[1] / B); (bk[k] = bk[k] || []).push(g); });
      placed.forEach(function (A) {
        if (A.gone || A.pts.length < 2) return;
        var bx = Math.floor(A.q[0] / B), by = Math.floor(A.q[1] / B);
        for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) (bk[(bx + i) + "," + (by + j)] || []).forEach(function (G) {
          if (G === A || G.gone || A.gone) return;
          if (Math.hypot(G.q[0] - A.q[0], G.q[1] - A.q[1]) >= near(A.lead, A.pts.length, G.lead, G.pts.length)) return;
          var big = A.pts.length > G.pts.length || (A.pts.length === G.pts.length && byKey(A.lead, G.lead) < 0) ? A : G, small = big === A ? G : A;
          big.pts = big.pts.concat(small.pts); small.gone = true; changed = true;
        });
      });
      placed = placed.filter(function (g) { return !g.gone; });
      if (!changed) break;
    }
    return placed.map(function (g) {
      var kinds = {};
      g.pts.forEach(function (p) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
      return { key: g.lead.key, ll: g.lead.ll, keys: g.pts.map(function (p) { return p.key; }), kind: g.pts.length === 1 ? "one" : "fan", kinds: kinds };
    });
  }
  // How far apart a set of places sits on screen at this zoom: the diagonal of their box in pixels (never less than the
  // widest pair, so a city whose spread is at most MIN_PX has no two places more than MIN_PX apart). lls: [[lat, lng]].
  function spread(lls, zoom) {
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    lls.forEach(function (ll) { var q = px({ ll: ll }, zoom); l = Math.min(l, q[0]); r = Math.max(r, q[0]); t = Math.min(t, q[1]); b = Math.max(b, q[1]); });
    return lls.length > 1 ? Math.hypot(r - l, b - t) : 0;
  }
  function byKey(a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }
  // Where the members of a spread stack go, in pixels from its spot: a ring for up to eight, a spiral past that, each
  // at least 28 px (a pin's width) from the others and from the middle.
  function fanOffsets(n) {
    var out = [], gap = 34;
    if (n <= 8) {
      var r = n <= 1 ? 0 : Math.max(gap, gap / (2 * Math.sin(Math.PI / n)));
      for (var i = 0; i < n; i++) { var a = -Math.PI / 2 + 2 * Math.PI * i / n; out.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]); }
      return out;
    }
    var t = 0;
    for (var k = 0; k < n; k++) { // Archimedean spiral, step along the arc about one gap
      var rr = gap * (1 + t / (2 * Math.PI));
      out.push([Math.round(rr * Math.cos(t - Math.PI / 2)), Math.round(rr * Math.sin(t - Math.PI / 2))]);
      t += gap / rr;
    }
    return out;
  }
  root.MatchaDensity = { group: group, spread: spread, fanOffsets: fanOffsets, px: px, MIN_PX: MIN_PX };
})(typeof window !== "undefined" ? window : this);
