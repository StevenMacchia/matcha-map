// POST /api/rsvp { event, me, going }  -> { ok, count }   one row per device per pop-up: rsvp:<event>:<hash(me)>
// GET  /api/rsvp?events=a,b,c          -> { counts: { a: 2, ... } }   the count is the number of rows, never a stored number
// "me" is a random id the browser made for itself (site/rsvp.js); it is hashed before it becomes a key and is never
// shown to anyone. No account, no email, nothing to log in to. Rows expire after 120 days. 60 toggles a day per IP.
import { json, kvOf, NOT_SET_UP, readBody, withinLimit, methodNot } from "../_lib/http.js";
import { sha256 } from "../_lib/validate.js";

export const EVENT_ID = /^[a-z0-9]{6,32}$/i, ME = /^[a-f0-9]{32}$/, MAX_EVENTS = 60, ROW_TTL = 120 * 86400, DAILY_TOGGLES = 60;

export async function rowKey(event, me) { return `rsvp:${event}:${(await sha256(me + "|rsvp")).slice(0, 24)}`; }

// Counts the rows under one pop-up, leaving out `except` (the caller's own row, so a toggle can answer at once
// without waiting for KV's eventual consistency).
export async function count(kv, event, except) {
  let n = 0, cursor;
  do {
    const r = await kv.list({ prefix: `rsvp:${event}:`, limit: 1000, cursor });
    n += r.keys.filter((k) => k.name !== except).length;
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return n;
}

export async function onRequestGet({ request, env }) {
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const ids = [...new Set((new URL(request.url).searchParams.get("events") || "").split(",").map((s) => s.trim()).filter((s) => EVENT_ID.test(s)))].slice(0, MAX_EVENTS);
  const counts = {};
  for (const id of ids) counts[id] = await count(kv, id);
  return json({ counts }, 200, { "cache-control": "public, max-age=60" });
}

export async function onRequestPost({ request, env }) {
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const body = await readBody(request);
  if (!body) return json({ error: "Could not read that." }, 400);
  const event = String(body.event || ""), me = String(body.me || ""), going = body.going === true;
  if (!EVENT_ID.test(event) || !ME.test(me)) return json({ error: "That pop-up or device id is not right." }, 400);
  if (!(await withinLimit(kv, request, "rsvp", DAILY_TOGGLES))) return json({ error: "That's a lot of taps for one day. Try again tomorrow." }, 429);
  const key = await rowKey(event, me);
  if (going) await kv.put(key, JSON.stringify({ at: new Date().toISOString() }), { expirationTtl: ROW_TTL });
  else await kv.delete(key);
  const others = await count(kv, event, key);
  return json({ ok: true, going, count: others + (going ? 1 : 0) });
}

export const onRequest = () => methodNot("GET, POST");
