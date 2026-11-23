// GET /api/queue: pending and approved items. Needs "Authorization: Bearer <INTAKE_TOKEN>".
// ?kinds=pending,approved (default) | report | claim | featured ; ?limit=40 (max 40 per kind, keeps us under the subrequest cap).
import { json, kvOf, guard, methodNot, NOT_SET_UP } from "../_lib/http.js";

const KINDS = ["pending", "approved", "report", "claim", "featured"];

export async function onRequestGet({ request, env }) {
  const denied = guard(request, env);
  if (denied) return denied;
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const url = new URL(request.url);
  const kinds = (url.searchParams.get("kinds") || "pending,approved").split(",").map((s) => s.trim()).filter((k) => KINDS.includes(k));
  const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 40));
  const out = {};
  for (const kind of kinds) {
    const list = await kv.list({ prefix: `${kind}:`, limit });
    const rows = await Promise.all(list.keys.map(async (k) => {
      const raw = await kv.get(k.name);
      try { return JSON.parse(raw); } catch { return null; }
    }));
    out[kind] = rows.filter(Boolean);
    if (!list.list_complete) out[`${kind}_more`] = true;
  }
  return json({ ok: true, ...out });
}
export const onRequest = ({ request, env }) => (request.method === "GET" ? onRequestGet({ request, env }) : methodNot("GET"));
