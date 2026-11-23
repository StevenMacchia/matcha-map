// Map density from zoom 10 up (2026-11-23, after the Triangle showed blank brand faces piled on the city centre): which
// pins stand alone, which fold into a group. Two rules, both in screen pixels at the given zoom:
//   - zoom 10 to 12 (grid > 0): places fold by neighbourhood, a 0.01 degree cell (about a kilometre), not a pixel radius;
//   - every zoom: a pin closer than MIN_PX to one already placed joins it. The first pin of a group (the leader: the
//     biggest group, then the key) keeps its own spot, so any two markers left on the map stand at least MIN_PX apart.
// A group from the grid is a neighbourhood ("cell": tap zooms in); one from the pixel rule alone is a stack ("fan": tap
// spreads it, fanOffsets). Pure functions; test/density.test.js runs them in node.
(function (root) {
  var MIN_PX = 28;
  function mx(lng) { return (lng + 180) / 360; }
  function my(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  // World pixels at this zoom (MapLibre's 512 px tiles), plus the marker's own offset from its point (shift(p) -> [dx, dy]).
  function px(p, zoom, shift) {
    var w = 512 * Math.pow(2, zoom), d = shift ? shift(p) || [0, 0] : [0, 0];
    return [mx(p.ll[1]) * w + d[0], my(p.ll[0]) * w + d[1]];
  }
  // points: [{ key, ll: [lat, lng], kind }]. opts: { grid: degrees (0 = none), minPx, shift(p) }.
  // Returns [{ key, ll, keys, kind: "one" | "cell" | "fan", kinds: { e: n, s: n, b: n } }], leaders first, deterministic.
  function group(points, zoom, opts) {
    opts = opts || {};
    var grid = opts.grid || 0, minPx = opts.minPx || MIN_PX, nodes = [];
    if (grid > 0) {
      var cells = {}, order = [];
      points.forEach(function (p) {
        var k = Math.floor(p.ll[0] / grid) + "," + Math.floor(p.ll[1] / grid), c = cells[k];
        if (!c) { c = cells[k] = []; order.push(k); }
        c.push(p);
      });
      order.forEach(function (k) {
        var c = cells[k].slice().sort(byKey);
        if (c.length === 1) { nodes.push({ lead: c[0], pts: c, cell: false }); return; }
        // the cell's marker stands on its middle member (nearest the mean), so it sits on a real place
        var la = 0, lo = 0;
        c.forEach(function (p) { la += p.ll[0]; lo += p.ll[1]; });
        la /= c.length; lo /= c.length;
        var mid = c.slice().sort(function (a, b) { return d2(a.ll, la, lo) - d2(b.ll, la, lo) || byKey(a, b); })[0];
        nodes.push({ lead: mid, pts: c, cell: true });
      });
    } else points.forEach(function (p) { nodes.push({ lead: p, pts: [p], cell: false }); });
    nodes.sort(function (a, b) { return b.pts.length - a.pts.length || byKey(a.lead, b.lead); });
    // leader-follower in pixels, with a hash of MIN_PX buckets so a city's thousand shops stay fast
    var placed = [], buckets = {};
    nodes.forEach(function (n) {
      var q = px(n.lead, zoom, opts.shift), bx = Math.floor(q[0] / minPx), by = Math.floor(q[1] / minPx), hit = null, hd = Infinity;
      for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) {
        (buckets[(bx + i) + "," + (by + j)] || []).forEach(function (g) {
          var d = Math.hypot(g.q[0] - q[0], g.q[1] - q[1]);
          if (d < minPx && d < hd) { hd = d; hit = g; }
        });
      }
      if (hit) { hit.pts = hit.pts.concat(n.pts); hit.cell = hit.cell || n.cell; return; }
      var g = { lead: n.lead, pts: n.pts.slice(), cell: n.cell, q: q };
      placed.push(g);
      (buckets[bx + "," + by] = buckets[bx + "," + by] || []).push(g);
    });
    return placed.map(function (g) {
      var kinds = {};
      g.pts.forEach(function (p) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
      return { key: g.lead.key, ll: g.lead.ll, keys: g.pts.map(function (p) { return p.key; }), kind: g.pts.length === 1 ? "one" : g.cell ? "cell" : "fan", kinds: kinds };
    });
  }
  function byKey(a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }
  function d2(ll, la, lo) { return (ll[0] - la) * (ll[0] - la) + (ll[1] - lo) * (ll[1] - lo); }
  // Where the members of a spread stack go, in pixels from its spot: a ring for up to eight, a spiral past that, each
  // at least MIN_PX + 4 from the others and from the middle.
  function fanOffsets(n) {
    var out = [], gap = MIN_PX + 6;
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
  root.MatchaDensity = { group: group, fanOffsets: fanOffsets, px: px, MIN_PX: MIN_PX };
})(typeof window !== "undefined" ? window : this);
