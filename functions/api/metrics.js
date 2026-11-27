// GET /api/metrics -> JSON for the dashboard at /m/. Needs "Authorization: Bearer <INTAKE_TOKEN>" like /api/queue.
// Visitors human vs bot per day, by state, path group, top paths and referrers, devices, feature counts, top clicked cards
// (resolved to names from the data files), RSVP totals per day and top pop-ups, map size, and the last daily run.
import { json, kvOf, guard, methodNot } from "../_lib/http.js";
import { dayOf, lastDays, dayCounts, summarize, listAll } from "../_lib/metrics.js";

async function asset(env, request, path) {
  try { const r = await env.ASSETS.fetch(new URL(path, request.url)); return r.ok ? await r.json() : null; } catch { return null; }
}
export async function rsvpRows(kv, cap = 1500) {
  const keys = (await listAll(kv, "rsvp:")).slice(0, cap), rows = [];
  for (let i = 0; i < keys.length; i += 25) {
    await Promise.all(keys.slice(i, i + 25).map(async (k) => {
      const ev = k.name.split(":")[1]; let at = "";
      try { const v = await kv.get(k.name, "json"); at = (v && v.at) || ""; } catch { /* keep the row, no date */ }
      rows.push({ event: ev, at: at || "1970-01-01T00:00:00Z" });
    }));
  }
  return { rows, capped: keys.length >= cap };
}

export async function onRequestGet({ request, env }) {
  const denied = guard(request, env); if (denied) return denied;
  const kv = kvOf(env); if (!kv) return json({ error: "KV is not bound." }, 503);
  const today = dayOf();
  const [perDay, slim, shops, daily] = await Promise.all([
    Promise.all(lastDays(30, today).map(async (day) => ({ day, counts: await dayCounts(kv, day, today) }))),asset(env, request, "/data/events-slim.json"), asset(env, request, "/data/shops.json"), asset(env, request, "/data/daily-status.json")]);
  const events = (slim && slim.events) || [], names = {};
  for (const e of events) names["e:" + e.id] = `${e.brand || e.title}${e.city ? ", " + e.city : ""}${e.state ? " " + e.state : ""}`;
  const now = Date.now(), upcoming = events.filter((e) => Date.parse(e.end || e.start) >= now).length;
  const out = summarize(perDay, { names, rsvp: await rsvpRows(kv) });
  out.today = today;
  out.map = { shops: shops ? (shops.shops || []).length : null, events: events.length, upcoming, dataGenerated: slim ? slim.generated : null };
  out.run = daily || null;
  return json(out, 200, { "cache-control": "private, no-store" });
}
export const onRequest = () => methodNot("GET");
