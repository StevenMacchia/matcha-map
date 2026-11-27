// Visit and feature counting (docs/METRICS.md). Pure helpers first, KV second. No cookies, no addresses stored.
// Design: every counted thing is ONE KV row with a random suffix, so two requests never write the same key and KV's eventual
// consistency cannot lose an increment. The row's facts ride in its list metadata, so a day is counted with list() alone
// (no get per row). Finished days are rolled up once into m:<day>:<dimension> rows; today is always counted live.
import { sha256 } from "./validate.js";

export const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebot|preview|headless|lighthouse|python-requests|python-urllib|curl|wget|httpclient|okhttp|go-http|java\/|libwww|scrapy|axios|node-fetch|undici|phantom|selenium|puppeteer|playwright|monitor|uptime|pingdom|validator|archive|fetch|check|scan|reader|feedly|mediapartners|bingpreview|ahrefs|semrush|dataprovider|petalbot|bytespider|gptbot|claudebot|perplexity/i;
export const ROW_TTL = 40 * 86400, VISITOR_TTL = 2 * 86400, STATES = /^[A-Z]{2}$/;
export const FEATURES = ["map_move", "zoom_in", "zoom_out", "pin_tap", "card_open", "going", "directions", "calendar", "share", "near_me", "search", "date_filter", "list_tap", "promote", "report", "alerts_signup", "theme_toggle"];

export const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
export function visitorClass(request) {
  const cf = request.cf || {}, ua = request.headers.get("user-agent") || "";
  if (cf.verifiedBotCategory) return "bot";
  if (!ua || BOT_UA.test(ua)) return "bot"; // no user agent at all is not a browser
  return "human";
}
export function deviceOf(ua = "") { return /ipad|tablet|kindle|silk/i.test(ua) ? "tablet" : /mobi|iphone|android/i.test(ua) ? "mobile" : "desktop"; }
export function pathGroup(path) {
  if (path === "/" || path === "/index.html") return "home";
  const m = /^\/(city|state|brand|e|weekend)(\/|$)/.exec(path);
  return m ? (m[1] === "e" ? "event" : m[1]) : "other";
}
export function refHost(request) {
  const r = request.headers.get("referer"); if (!r) return "direct";
  try { const h = new URL(r).hostname.replace(/^www\./, ""); return h === new URL(request.url).hostname.replace(/^www\./, "") ? "(this site)" : h.slice(0, 60); } catch { return "direct"; }
}
export function regionOf(request) {
  const cf = request.cf || {};
  if (cf.country === "US" && STATES.test(cf.regionCode || "")) return cf.regionCode;
  return /^[A-Z]{2}$/.test(cf.country || "") ? cf.country : "??";
}
export const saltOf = (env) => (env && (env.METRICS_SALT || env.INTAKE_TOKEN)) || "matchamap-metrics";
// Salted hash of address + user agent + day: only ever a key name, expires in two days, never the address.
export async function visitorKey(request, env, day) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  return `mv:${day}:${(await sha256(`${saltOf(env)}|${ip}|${request.headers.get("user-agent") || ""}|${day}`)).slice(0, 24)}`;
}
const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

// True when this is a page a person could see: a GET answered 200 with HTML, not the API and not the dashboard itself.
export function countable(request, response) {
  if (request.method !== "GET" || !response || response.status !== 200) return false;
  const p = new URL(request.url).pathname;
  if (p.startsWith("/api/") || p.startsWith("/m/")) return false;
  return /text\/html/i.test(response.headers.get("content-type") || "");
}

export async function recordPageview(kv, request, env, now = new Date()) {
  const day = dayOf(now), url = new URL(request.url), cls = visitorClass(request);
  const vk = await visitorKey(request, env, day);
  let fresh = false;
  try { if (!(await kv.get(vk))) { fresh = true; await kv.put(vk, "1", { expirationTtl: VISITOR_TTL }); } } catch { /* count the view anyway */ }
  const md = { c: cls === "bot" ? "b" : "h", s: regionOf(request), v: deviceOf(request.headers.get("user-agent") || ""), g: pathGroup(url.pathname), p: url.pathname.slice(0, 90), r: refHost(request), u: fresh ? 1 : 0 };
  await kv.put(`mp:${day}:${rand()}`, "1", { expirationTtl: ROW_TTL, metadata: md });
  return md;
}
export async function recordFeature(kv, k, v, cls, now = new Date()) {
  if (!FEATURES.includes(k)) return false;
  await kv.put(`mf:${dayOf(now)}:${rand()}`, "1", { expirationTtl: ROW_TTL, metadata: { k, v: String(v || "").slice(0, 60), c: cls === "bot" ? "b" : "h" } });
  return true;
}

export async function listAll(kv, prefix) {
  const out = []; let cursor;
  do { const r = await kv.list({ prefix, limit: 1000, cursor }); out.push(...r.keys); cursor = r.list_complete ? null : r.cursor; } while (cursor);
  return out;
}
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
// Folds a day's rows into counters: { views:{human,bot}, visitors:{human,bot}, state:{}, group:{}, path:{}, ref:{}, device:{}, feature:{}, item:{} } (humans only except views/visitors).
export function rollup(pageRows, featureRows) {
  const d = { views: { human: 0, bot: 0 }, visitors: { human: 0, bot: 0 }, state: {}, group: {}, path: {}, ref: {}, device: {}, feature: {}, item: {}, botref: {} };
  for (const r of pageRows) {
    const m = r.metadata; if (!m) continue;
    const c = m.c === "b" ? "bot" : "human";
    d.views[c]++; if (m.u) d.visitors[c]++;
    if (c === "bot") continue;
    bump(d.state, m.s); bump(d.group, m.g); bump(d.path, m.p); bump(d.ref, m.r); bump(d.device, m.v);
  }
  for (const r of featureRows) {
    const m = r.metadata; if (!m || m.c === "b") continue;
    bump(d.feature, m.k);
    if (m.k === "card_open" && m.v) bump(d.item, m.v);
  }
  return d;
}
// One finished day, from its rollup rows if present, else counted from the raw rows and stored for next time.
export async function dayCounts(kv, day, today) {
  if (day !== today) {
    const hit = await kv.get(`m:${day}:all`, "json").catch(() => null);
    if (hit) return hit;
  }
  const d = rollup(await listAll(kv, `mp:${day}:`), await listAll(kv, `mf:${day}:`));
  if (day !== today) {
    await kv.put(`m:${day}:all`, JSON.stringify(d), { expirationTtl: ROW_TTL }).catch(() => {});
    for (const dim of ["state", "group", "feature"]) await kv.put(`m:${day}:${dim}`, JSON.stringify(d[dim]), { expirationTtl: ROW_TTL }).catch(() => {});
  }
  return d;
}
