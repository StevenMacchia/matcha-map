// Three-way-ish union of the generated state files: node merge-state.cjs <kind> <ours> <theirs> <out>
// kinds: byid|sources|shops (records by id, ours' fields over theirs), events (union by id, later last_seen wins), watchlist (union by platform|handle, later last_checked wins),
// review (union by brand|start|venue, ours wins), geocache (union keys, ours wins), budget (max used_month, later updated).
const fs = require("fs");
const [, , kind, oursF, theirsF, outF] = process.argv;
const J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const ours = J(oursF), theirs = J(theirsF);
const later = (a, b, k) => (String(a?.[k] || "") >= String(b?.[k] || "") ? a : b);
let out, note;
if (kind === "events") {
  const m = new Map(theirs.events.map((e) => [e.id, e]));
  let added = 0, newer = 0;
  for (const e of ours.events) { if (!m.has(e.id)) { m.set(e.id, e); added++; } else if (later(e, m.get(e.id), "last_seen") === e && e !== m.get(e.id)) { m.set(e.id, e); newer++; } }
  out = { ...theirs, generated: later(ours, theirs, "generated").generated, events: [...m.values()] };
  note = `events: theirs ${theirs.events.length}, ours ${ours.events.length}, union ${out.events.length} (+${added} only ours, ${newer} ours newer)`;
} else if (kind === "watchlist") {
  const key = (a) => `${a.platform}|${String(a.handle).toLowerCase()}`;
  const m = new Map(theirs.accounts.map((a) => [key(a), a]));
  let added = 0, newer = 0;
  for (const a of ours.accounts) { const k = key(a); if (!m.has(k)) { m.set(k, a); added++; } else if (later(a, m.get(k), "last_checked") === a && a !== m.get(k)) { m.set(k, { ...m.get(k), ...a }); newer++; } }
  out = { ...theirs, updated: later(ours, theirs, "updated").updated, accounts: [...m.values()] };
  note = `watchlist: theirs ${theirs.accounts.length}, ours ${ours.accounts.length}, union ${out.accounts.length} (+${added}, ${newer} ours newer)`;
} else if (kind === "review") {
  const key = (i) => `${i.brand}|${String(i.start).slice(0, 10)}|${i.venue || i.address || ""}`.toLowerCase();
  const m = new Map((theirs.items || []).map((i) => [key(i), i]));
  for (const i of ours.items || []) m.set(key(i), i);
  out = { ...theirs, generated: later(ours, theirs, "generated").generated, items: [...m.values()].sort((a, b) => String(a.start).localeCompare(String(b.start))) };
  note = `review: theirs ${(theirs.items || []).length}, ours ${(ours.items || []).length}, union ${out.items.length}`;
} else if (kind === "geocache") {
  out = { ...theirs, ...ours };
  note = `geocache: theirs ${Object.keys(theirs).length}, ours ${Object.keys(ours).length}, union ${Object.keys(out).length}`;
} else if (kind === "budget") {
  out = { ...theirs, ...ours, used_month: Math.max(ours.used_month || 0, theirs.used_month || 0), updated: later(ours, theirs, "updated").updated };
  note = `budget: used_month ours ${ours.used_month} theirs ${theirs.used_month} -> ${out.used_month}`;
} else if (kind === "byid" || kind === "sources" || kind === "shops") {
  // A list of records with an id, either a bare array (data/sources.json) or under a key (data/shops.json {shops: [...]}).
  // Theirs is the base; a record present on both sides takes ours' fields over theirs; records only on one side are kept.
  const listKey = Array.isArray(theirs) ? null : Object.keys(theirs).find((k) => Array.isArray(theirs[k]) && theirs[k].length && theirs[k][0] && "id" in theirs[k][0]) || "shops";
  const tl = Array.isArray(theirs) ? theirs : theirs[listKey] || [], ol = Array.isArray(ours) ? ours : ours[listKey] || [];
  const m = new Map(tl.map((r) => [r.id, r]));
  let added = 0, changed = 0;
  for (const r of ol) { if (!m.has(r.id)) { m.set(r.id, r); added++; } else if (JSON.stringify(m.get(r.id)) !== JSON.stringify(r)) { m.set(r.id, { ...m.get(r.id), ...r }); changed++; } }
  const list = [...m.values()];
  out = Array.isArray(theirs) ? list : { ...theirs, ...(Array.isArray(ours) ? {} : ours), [listKey]: list };
  note = `${kind}: theirs ${tl.length}, ours ${ol.length}, union ${list.length} (+${added} only ours, ${changed} ours' fields over theirs)`;
} else throw new Error("kind? one of events, watchlist, review, geocache, budget, byid (sources, shops)");
fs.writeFileSync(outF, JSON.stringify(out, null, kind === "events" || kind === "review" ? 2 : 1) + "\n");
console.log(note);
