// Series rows for the list (design rung 5): with no date filter the list shows one row per series (a pop-up that repeats
// by weekday, events.json `series`) instead of one row per date, the next date first; a date filter expands it again.
// The map keeps one pin per date. Grouped by series.id, so a series whose dates differ in venue stays one row (the row
// names the venue of its next date). Pure functions; test/series-rows.test.js runs them in node. Loaded before app.js.
(function (root) {
  function seriesId(e) { var s = e && e.series; return s && typeof s.id === "string" && s.id ? s.id : ""; }
  // items: [{ key, data: event }] in the list's order. Returns [{ it, n, dates, series }], one per series (it: the date
  // that starts first, dates: every date in the order given) or per one-off date, at the place of its first date.
  function group(items) {
    var out = [], at = {};
    (items || []).forEach(function (it) {
      var id = seriesId(it && it.data);
      if (!id) { out.push({ it: it, n: 1, dates: [it], series: false }); return; }
      var g = at[id];
      if (!g) { g = at[id] = { it: it, n: 0, dates: [], series: true }; out.push(g); }
      g.dates.push(it); g.n++;
      if (String(it.data.start || "") < String(g.it.data.start || "")) g.it = it;
    });
    return out;
  }
  // { rows, dates }: what the header counts (a series once) and how many dates sit under the rows.
  function counts(groups) {
    var dates = 0;
    (groups || []).forEach(function (g) { dates += g.n; });
    return { rows: (groups || []).length, dates: dates };
  }
  // "(40 dates)" after the count when the rows hold more dates than rows, else "".
  function datesNote(c) { return c && c.dates > c.rows ? "(" + c.dates + " dates)" : ""; }

  root.MatchaSeries = { group: group, counts: counts, datesNote: datesNote, seriesId: seriesId };
})(typeof window !== "undefined" ? window : this);
