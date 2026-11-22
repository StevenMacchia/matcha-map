// Luma discover crawler: matcha events on luma.com's city pages.
//
// What the public structure looks like (read 2026-11-22):
//   robots.txt     https://luma.com/robots.txt has a Googlebot group only; for everyone else nothing is disallowed.
//                  https://api2.luma.com/robots.txt (and api.lu.ma): "User-agent: * Disallow: /insights/".
//   discover page  https://luma.com/discover is Next.js; <script id="__NEXT_DATA__"> holds
//                  props.pageProps.initialData.places[] = {place:{api_id, slug, name, timezone, coordinate,...}, event_count}.
//                  About 87 places worldwide; the US ones are nyc, sf, la, sd, seattle, chicago, austin, miami, dc, ...
//   city page      https://luma.com/<slug> embeds initialData.data.events[] (the first 20 only, mostly tech).
//   paging         the same page reads https://api2.luma.com/discover/get-paginated-events?discover_place_api_id=<api_id>
//                  &pagination_limit=50[&pagination_cursor=<next_cursor>] -> {entries[], has_more, next_cursor}, public, no
//                  login or token. We call that, PAGES pages per US place, soonest first.
//   entry          {event:{name,start_at(UTC),end_at,timezone,url,location_type,geo_address_info{city,region_short,
//                  address,full_address,country_code},cover_url}, calendar:{name,slug,instagram_handle,website}, hosts[]}.
//   not used       https://api.lu.ma/search/get-results answers 401 "not signed in": no login, so we do not call it.
// Entries have no description, so the matcha word filter reads the event name and the host calendar name.
// Candidates are the host calendars (organizer = calendar name, handle = its instagram_handle when it has one).
import { readNextData, entryToRaw } from "../../adapters/luma.js";
import { siteBudget, gate, finish, skipped, CAP, hasMatcha } from "./common.js";
import { debug } from "../log.js";

export const name = "luma";
export const host = "luma.com";
const API = "https://api2.luma.com";
export const PAGES = 3;
const NON_US = new Set(["waterloo_ca", "toronto", "montreal", "mexico-city", "calgary", "edmonton", "vancouver", "medellin", "bogota"]);

// discover page html -> [{slug, api_id, name}] for North American places that are not in Canada or Latin America.
export function parsePlaces(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return [];
  let j;
  try { j = JSON.parse(m[1]); } catch { return []; }
  return (j?.props?.pageProps?.initialData?.places || []).map((x) => x.place).filter((p) => p && p.geo_continent === "na" && p.slug && !NON_US.has(p.slug)).map((p) => ({ slug: p.slug, api_id: p.api_id, name: p.name }));
}

// One entry (discover API or city page) -> RawItem or null. US only; the host calendar is the organizer.
export function entryToItem(entry) {
  const ev = entry?.event;
  const cc = ev?.geo_address_info?.country_code;
  if (!ev || (cc && cc !== "US")) return null;
  if (!hasMatcha(ev.name, entry.calendar?.name)) return null;
  const raw = entryToRaw(entry);
  if (!raw || !raw.hints.state) return null;
  const cal = entry.calendar || {};
  raw.organizer = { name: cal.name || null, url: cal.slug ? `https://luma.com/${cal.slug}` : null };
  const ig = String(cal.instagram_handle || "").replace(/^@/, "");
  if (/^[A-Za-z0-9._]{3,30}$/.test(ig)) raw.handle = ig;
  raw.hints.title = ev.name;
  return raw;
}

// Entries -> {items, candidates}.
export function fromEntries(entries, sources = []) {
  const seen = new Set();
  const raws = [];
  for (const e of entries) {
    const raw = entryToItem(e);
    if (!raw || seen.has(raw.source_url)) continue;
    seen.add(raw.source_url);
    raws.push(raw);
  }
  return finish(name, raws, sources);
}

export async function discover(ctx) {
  const { fetcher, sources = [], cap = CAP, pages = PAGES } = ctx;
  const b = siteBudget(fetcher, name, cap);
  const g = await gate(b, host);
  if (!g.ok) return skipped(g.reason);
  const g2 = await gate(b, "api2.luma.com");
  if (!g2.ok) return skipped(`api2.luma.com: ${g2.reason}`);
  const d = await b.get(`https://${host}/discover`);
  if (!d.ok) return skipped(d.blocked ? "blocked by robots.txt" : `discover page HTTP ${d.status || "error"}`, { fetches: b.st.used });
  const places = parsePlaces(d.text);
  const entries = [];
  for (const p of places) {
    let cursor = null;
    for (let i = 0; i < pages; i++) {
      const url = `${API}/discover/get-paginated-events?discover_place_api_id=${encodeURIComponent(p.api_id)}&pagination_limit=50${cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await b.get(url);
      if (!r.ok) break;
      let j; try { j = JSON.parse(r.text); } catch { break; }
      entries.push(...(j.entries || []));
      if (!j.has_more || !j.next_cursor) break;
      cursor = j.next_cursor;
    }
    if (b.st.stopped || b.left() <= 0) break;
  }
  debug("luma entries", entries.length);
  const out = fromEntries(entries, sources);
  return { ...out, stats: { places: places.length, entries: entries.length, fetches: b.st.used, pages: b.st.pages, hitCap: b.st.hitCap, stopped: b.st.stopped } };
}

export default { name, host, discover };
export { readNextData };
