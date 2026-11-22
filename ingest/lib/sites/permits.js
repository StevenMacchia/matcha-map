// Open data: temporary food and special event permits. A permit with a matcha name on it is strong evidence that a pop-up
// happens (the hours are unknown), so each match becomes an all-day event, confidence "likely", description "Temporary food
// permit on file". Public JSON, no key (Socrata SODA and one ArcGIS feature service); robots.txt is read on every host
// (the shared fetcher), 1 request per second per host, 6-hour cache. One query per dataset: the matcha name test and the
// date window are in the $where, so a run costs about 8 requests.
//
// Datasets (checked 2026-11-22; the Socrata catalog at api.us.socrata.com/api/catalog/v1 found them):
//   nyc-events   data.cityofnewyork.us  tvpp-9vvx  "NYC Permitted Event Information" (Street Activity Permit Office, updated daily).
//                fields: event_name, start_date_time, end_date_time, event_location, event_borough, event_id.
//                query:  start_date_time >= today AND upper(event_name) like %MATCHA% (or HOJICHA).
//   chicago-licenses  data.cityofchicago.org  r5kz-chrr  "Business Licenses". fields: doing_business_as_name, legal_name, address,
//                zip_code, license_description ("Special Event Food", mobile food), license_start_date, expiration_date.
//                query:  expiration_date >= today, a special-event or mobile food licence, and a matcha name.
//   chicago-events    data.cityofchicago.org  xgse-8eg7  "Special Events" (city-run events). fields: event_details, venue, venue_address, date.
//   la-tse       data.lacity.org        8spw-3fhx  "Building and Safety Temporary Special Event (TSE) Permits". fields: event_name,
//                work_desc, location (street), event_start_date, event_end_date. query: end >= today and a matcha name or description.
//   sf-street-use  data.sf.gov (was data.sfgov.org)  b6tj-gt35  "Street-Use Permits". fields: agent, permit_purpose, streetname,
//                cross_street_1, permit_type, permit_start_date, permit_end_date. query: permit_type in FoodFac, FreeSample,
//                MobileFood and a matcha agent or purpose, end >= today. (TableChair permits are sidewalk seating of cafes, not
//                events, so they are left out.)
//   seattle-events  data.seattle.gov    dm95-f8w5  "Special Events Permits". fields: name_of_event, organization, event_start_date,
//                event_end_date, event_location_park, event_location_neighborhood. Not updated since 2025-01, so it returns nothing
//                current; kept because the query is cheap.
//   dc-ddot      maps2.dcgis.dc.gov    DDOT/FeatureServer/49  "Occupancy Permits in 2026" (ArcGIS REST, open). fields: PERMITTEENAME,
//                WLFULLADDRESS, EFFECTIVEDATE, EXPIRATIONDATE. Public-space permits; a matcha permittee only.
// Checked and no usable dataset: Los Angeles County (data.lacounty.gov is an ArcGIS hub of boundaries and health inspections, no
//   temporary food facility or event permit table with names and dates); Austin (data.austintexas.gov has inspection scores and
//   mobile vendor registrations without event dates, and no special event permit table); SF "Mobile Food Schedule" (jjew-r69b) is a
//   weekly slot per truck with no dates, so it is not used; Seattle's food permits are not published as open data.
// A licence or permit that has already started and runs longer than 14 days is skipped (a long licence is not an event date);
// a short permit that is still running keeps its real start and end dates.
import { siteBudget, gate, finish, CAP, hasMatcha } from "./common.js";
import { tagKinds } from "./textfind.js";
import { readEvents } from "../write.js";
import { zonedIso, tzFor } from "../tz.js";

export const name = "permits";
export const host = "data.cityofnewyork.us";

const WORDS = ["MATCHA", "HOJICHA"];
const likeAny = (fields) => `(${fields.flatMap((f) => WORDS.map((w) => `upper(${f}) like '%${w}%'`)).join(" OR ")})`;
const BOROUGH = { Manhattan: "New York", Brooklyn: "Brooklyn", Queens: "Queens", Bronx: "Bronx", "Staten Island": "Staten Island" };
const t1 = (s) => String(s || "").trim();
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export const DATASETS = [
  {
    id: "nyc-events", host: "data.cityofnewyork.us", dataset: "tvpp-9vvx", order: "start_date_time",
    where: (today) => `start_date_time >= '${today}' AND ${likeAny(["event_name"])}`,
    row: (r) => ({
      brand: t1(r.event_name), title: t1(r.event_name), key: r.event_id, start: r.start_date_time, end: r.end_date_time,
      venue: String(r.event_location || "").split(",")[0].trim(), address: null, city: BOROUGH[r.event_borough] || "New York", state: "NY",
    }),
  },
  {
    id: "chicago-licenses", host: "data.cityofchicago.org", dataset: "r5kz-chrr", order: "license_start_date",
    where: (today) => `expiration_date >= '${today}' AND (upper(license_description) like '%SPECIAL EVENT%' OR upper(license_description) like '%MOBILE FOOD%') AND ${likeAny(["doing_business_as_name", "legal_name"])}`,
    row: (r) => ({
      brand: t1(r.doing_business_as_name || r.legal_name), title: `${t1(r.doing_business_as_name || r.legal_name)} pop-up`, key: r.id,
      start: r.license_start_date, end: r.expiration_date, venue: "",
      address: r.address ? `${t1(r.address)}, ${titleCase(r.city || "Chicago")}, ${r.state || "IL"}${r.zip_code ? " " + String(r.zip_code).slice(0, 5) : ""}` : null,
      city: titleCase(r.city || "Chicago"), state: r.state || "IL",
    }),
  },
  {
    id: "chicago-events", host: "data.cityofchicago.org", dataset: "xgse-8eg7", order: "date",
    where: (today) => `date >= '${today}' AND ${likeAny(["event_details"])}`,
    row: (r) => ({
      brand: t1(r.event_details), title: t1(r.event_details), key: `${r.date}-${r.event_details}`, start: r.date, end: null,
      venue: t1(r.venue), address: r.venue_address ? `${t1(r.venue_address)}, Chicago, IL` : null, city: "Chicago", state: "IL",
    }),
  },
  {
    id: "la-tse", host: "data.lacity.org", dataset: "8spw-3fhx", order: "event_start_date",
    where: (today) => `event_end_date >= '${today}' AND ${likeAny(["event_name", "work_desc"])}`,
    row: (r) => ({
      brand: t1(r.event_name), title: t1(r.event_name), key: r.permitno, start: r.event_start_date, end: r.event_end_date,
      venue: "", address: r.location ? `${t1(r.location)}, Los Angeles, CA` : null, city: "Los Angeles", state: "CA",
    }),
  },
  {
    id: "sf-street-use", host: "data.sf.gov", dataset: "b6tj-gt35", order: "permit_start_date",
    where: (today) => `permit_end_date >= '${today}' AND permit_type in('FoodFac','FreeSample','MobileFood') AND ${likeAny(["agent", "permit_purpose"])}`,
    row: (r) => ({
      brand: t1(r.agent), title: `${t1(r.agent)} pop-up`, key: r.unique_identifier || r.permit_number, start: r.permit_start_date, end: r.permit_end_date,
      venue: [r.streetname, r.cross_street_1].filter(Boolean).map(titleCase).join(" at "), address: null, city: "San Francisco", state: "CA",
    }),
  },
  {
    id: "seattle-events", host: "data.seattle.gov", dataset: "dm95-f8w5", order: "event_start_date",
    where: (today) => `event_end_date >= '${today}' AND ${likeAny(["name_of_event", "organization"])}`,
    row: (r) => ({
      brand: t1(r.organization || r.name_of_event), title: t1(r.name_of_event), key: r.year_month_app, start: r.event_start_date, end: r.event_end_date,
      venue: t1(r.event_location_park || r.event_location_neighborhood), address: null, city: "Seattle", state: "WA",
    }),
  },
];

const epochDay = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
export const DC = {
  id: "dc-ddot", host: "maps2.dcgis.dc.gov", dataset: "DDOT/FeatureServer/49",
  url: (today) => `https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DDOT/FeatureServer/49/query?where=${encodeURIComponent(`EXPIRATIONDATE >= DATE '${today}' AND (${WORDS.map((w) => `upper(PERMITTEENAME) like '%${w}%'`).join(" OR ")})`)}&outFields=*&orderByFields=EFFECTIVEDATE&resultRecordCount=200&f=json`,
  row: (a) => ({
    brand: t1(a.PERMITTEENAME), title: `${t1(a.PERMITTEENAME)} pop-up`, key: a.PERMITNUMBER || a.TRACKINGNUMBER,
    start: epochDay(a.EFFECTIVEDATE), end: epochDay(a.EXPIRATIONDATE), venue: "",
    address: a.WLFULLADDRESS ? `${t1(a.WLFULLADDRESS).replace(/,?\s*(WASHINGTON|DC)\b.*$/i, "")}, Washington, DC` : null, city: "Washington", state: "DC",
  }),
};

const ymd = (v) => (v ? String(v).slice(0, 10) : null);
const DAY = 86400000;

// A mapped dataset row -> RawItem or null. The date rules are in the header comment.
export function permitToRaw(d, ds, { now = new Date() } = {}) {
  const start = ymd(d.start), end = ymd(d.end) || start;
  if (!d.brand || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  if (!hasMatcha(d.brand, d.title)) return null; // the matcha name is the test
  const todayMs = Date.parse(now.toISOString().slice(0, 10));
  if (Date.parse(end) < todayMs) return null;
  if (Date.parse(start) < todayMs && Date.parse(end) - Date.parse(start) > 14 * DAY) return null;
  const tz = tzFor({ city: d.city, state: d.state }) || "America/New_York";
  const when = (v, fallback) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(v || ""));
    const [y, mo, dd, h, mi] = m ? [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)] : fallback;
    return { iso: zonedIso(tz, y, mo, dd, h, mi), timed: !!(h || mi) };
  };
  const [sy, sm, sd] = start.split("-").map(Number), [ey, em, ed] = end.split("-").map(Number);
  const s0 = when(d.start, [sy, sm, sd, 0, 0]), e0 = when(d.end, [ey, em, ed, 0, 0]);
  const timed = s0.timed;
  const hints = { title: d.title, start: s0.iso, end: end !== start || (timed && e0.timed) ? e0.iso : null, all_day: !timed, venue: d.venue || null, address: d.address || null, city: d.city, state: d.state };
  const url = ds.host === DC.host ? "https://opendata.dc.gov/" : `https://${ds.host}/resource/${ds.dataset}.json?$q=${encodeURIComponent(d.brand)}`;
  return {
    source_url: url, text: `${d.title}. Temporary food permit on file.`, description: "Temporary food permit on file", image_url: null,
    tags: null, hints, organizer: { name: d.brand, url: null }, permit: { dataset: ds.id, key: d.key },
  };
}

const brandDay = (brand, day) => `${String(brand).toLowerCase().replace(/[^a-z0-9]+/g, "")}|${day}`;

export async function discover(ctx) {
  const { fetcher, sources = [], now = new Date(), cap = CAP } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const today = now.toISOString().slice(0, 10);
  let existing = ctx.existing;
  if (!existing) { try { existing = readEvents(); } catch { existing = []; } }
  const have = new Set(existing.map((e) => brandDay(e.brand, String(e.start).slice(0, 10))));
  const stats = { datasets: 0, skippedHosts: [], rows: 0, matched: 0 };
  const raws = [];
  const hostOk = new Map();
  const open = async (h) => {
    if (!hostOk.has(h)) hostOk.set(h, await gate(b, h));
    return hostOk.get(h);
  };
  const keep = (raw) => {
    if (!raw) return;
    const k = brandDay(raw.organizer.name, raw.hints.start.slice(0, 10));
    if (have.has(k)) return;
    have.add(k);
    raws.push(raw);
    stats.matched++;
  };
  for (const ds of DATASETS) {
    if (b.st.stopped || b.left() <= 0) break;
    const g = await open(ds.host);
    if (!g.ok) { stats.skippedHosts.push(`${ds.host}: ${g.reason}`); continue; }
    const r = await b.get(`https://${ds.host}/resource/${ds.dataset}.json?$where=${encodeURIComponent(ds.where(today))}&$order=${ds.order}&$limit=200`);
    if (!r.ok) continue;
    let rows; try { rows = JSON.parse(r.text); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    stats.datasets++; stats.rows += rows.length;
    for (const row of rows) keep(permitToRaw(ds.row(row), ds, { now }));
  }
  if (!b.st.stopped) {
    const g = await open(DC.host);
    if (!g.ok) stats.skippedHosts.push(`${DC.host}: ${g.reason}`);
    else {
      const r = await b.get(DC.url(today));
      if (r.ok) {
        let j; try { j = JSON.parse(r.text); } catch { j = null; }
        const feats = j?.features || [];
        stats.datasets++; stats.rows += feats.length;
        for (const f of feats) keep(permitToRaw(DC.row(f.attributes || {}), DC, { now }));
      }
    }
  }
  const out = finish(name, raws, sources);
  tagKinds(out.items);
  return { ...out, stats: { ...stats, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
