// POST /api/approve  { id, action: approve | reject | edit | consume, patch? }  with "Authorization: Bearer <INTAKE_TOKEN>".
//   approve: pending:<id> -> approved:<id> (90 days)       reject: pending:<id> -> rejected:<id> (30 days)
//   edit:    patch fields on pending:<id> (or approved:<id>)  consume: approved:<id> -> consumed:<id> (ingest uses this)
import { sanitizePatch, isId } from "../_lib/validate.js";
import { json, kvOf, readBody, guard, methodNot, NOT_SET_UP } from "../_lib/http.js";

const DAY = 86400;

export async function onRequestPost({ request, env }) {
  const denied = guard(request, env);
  if (denied) return denied;
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const body = await readBody(request);
  if (!body || !isId(body.id) || !["approve", "reject", "edit", "consume"].includes(body.action)) return json({ error: "Need {id, action: approve|reject|edit|consume}." }, 400);
  const { id, action } = body;
  let key = `${action === "consume" ? "approved" : "pending"}:${id}`;
  let raw = await kv.get(key);
  if (!raw && action === "edit") { key = `approved:${id}`; raw = await kv.get(key); }
  if (!raw) return json({ error: "Not found (it may have expired or already moved)." }, 404);
  let item;
  try { item = JSON.parse(raw); } catch { return json({ error: "Stored item is unreadable." }, 500); }
  if (body.patch) item.fields = { ...item.fields, ...sanitizePatch(body.patch) };
  const now = new Date().toISOString();
  if (action === "edit") {
    await kv.put(key, JSON.stringify({ ...item, edited_at: now }), { expirationTtl: key.startsWith("approved:") ? 90 * DAY : 30 * DAY });
    return json({ ok: true, id, status: item.status });
  }
  const to = { approve: "approved", reject: "rejected", consume: "consumed" }[action];
  const ttl = { approved: 90 * DAY, rejected: 30 * DAY, consumed: 30 * DAY }[to];
  await kv.put(`${to}:${id}`, JSON.stringify({ ...item, status: to, [`${to}_at`]: now }), { expirationTtl: ttl });
  await kv.delete(key);
  return json({ ok: true, id, status: to });
}
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : methodNot("POST"));
