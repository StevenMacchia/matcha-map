// Merge OSM and brand shops, dedupe (same name within 150 m), apply overrides, fill the state.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function metres(a, b) {
  const r = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The first record keeps its position and id; later ones only fill gaps. OSM comes first, so a brand
// record on top of an OSM shop adds its brand id and any missing website or Instagram.
export function dedupe(list, within = 150) {
  const out = [];
  for (const s of list) {
    const k = norm(s.name);
    const dup = out.find((o) => norm(o.name) === k && metres(o, s) <= within);
    if (!dup) { out.push({ ...s }); continue; }
    for (const f of ["address", "city", "state", "zip", "website", "instagram", "phone", "opening_hours", "cuisine", "menu_url", "image_url", "image_credit", "source_url", "read", "confirmed_via"]) if (!dup[f] && s[f]) dup[f] = s[f];
    if (s.verified && !dup.verified) dup.verified = true;
    if (s.brand_id && !dup.brand_id) dup.brand_id = s.brand_id;
  }
  return out;
}

// Legitimacy: a name, a street address (OSM house number + street, or addr:full), not tagged closed.
// verified = a website, opening hours or a phone number backs it up; brand-site shops are verified.
// Unverified shops stay in data/shops.json but are not written to the site layer.
export function legitimate(list) {
  const kept = [], dropped = { closed: 0, noAddress: 0, noName: 0 };
  for (const s of list) {
    if (!String(s.name || "").trim()) { dropped.noName++; continue; }
    if (s.closed) { dropped.closed++; continue; }
    if (!String(s.address || "").trim()) { dropped.noAddress++; continue; }
    const { closed, ...rest } = s;
    kept.push({ ...rest, verified: s.source === "brand" ? true : s.source === "web" ? !!s.verified : !!(s.website || s.opening_hours || s.phone) });
  }
  return { kept, dropped };
}

export function applyOverrides(list, overrides = {}) {
  const out = [];
  for (const s of list) {
    const o = overrides[s.id];
    if (o && o.hide) continue;
    out.push(o ? { ...s, ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== "hide")) } : s);
  }
  return out;
}

const ZIP_STATE = [
  ["010", "027", "MA"], ["028", "029", "RI"], ["030", "038", "NH"], ["039", "049", "ME"], ["050", "059", "VT"], ["060", "069", "CT"],
  ["070", "089", "NJ"], ["100", "149", "NY"], ["150", "196", "PA"], ["197", "199", "DE"], ["200", "205", "DC"], ["206", "219", "MD"],
  ["220", "246", "VA"], ["247", "268", "WV"], ["270", "289", "NC"], ["290", "299", "SC"], ["300", "319", "GA"], ["320", "349", "FL"],
  ["350", "369", "AL"], ["370", "385", "TN"], ["386", "397", "MS"], ["398", "399", "GA"], ["400", "427", "KY"], ["430", "459", "OH"],
  ["460", "479", "IN"], ["480", "499", "MI"], ["500", "528", "IA"], ["530", "549", "WI"], ["550", "567", "MN"], ["570", "577", "SD"],
  ["580", "588", "ND"], ["590", "599", "MT"], ["600", "629", "IL"], ["630", "658", "MO"], ["660", "679", "KS"], ["680", "693", "NE"],
  ["700", "714", "LA"], ["716", "729", "AR"], ["730", "749", "OK"], ["750", "799", "TX"], ["800", "816", "CO"], ["820", "831", "WY"],
  ["832", "838", "ID"], ["840", "847", "UT"], ["850", "865", "AZ"], ["870", "884", "NM"], ["889", "898", "NV"], ["900", "961", "CA"],
  ["967", "968", "HI"], ["970", "979", "OR"], ["980", "994", "WA"], ["995", "999", "AK"],
];
export function stateFromZip(zip) {
  const z = String(zip || "").slice(0, 3);
  if (!/^\d{3}$/.test(z)) return null;
  const hit = ZIP_STATE.find(([a, b]) => z >= a && z <= b);
  return hit ? hit[2] : null;
}
const FULL = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC" };

// Fill state (two letters) from the OSM tag, the zip, or the nearest known city within 40 km.
// cities: { "City|ST": [lat, lng] } (site/cities.js).
export function fillState(s, cities = {}) {
  let st = s.state && (FULL[s.state.toLowerCase()] || (/^[A-Za-z]{2}$/.test(s.state) ? s.state.toUpperCase() : null));
  st = st || stateFromZip(s.zip);
  if (!st) {
    let best = 40000;
    for (const [k, c] of Object.entries(cities)) {
      const d = metres(s, { lat: c[0], lng: c[1] });
      if (d < best) { best = d; st = k.split("|")[1]; }
    }
  }
  return { ...s, state: st || null };
}
