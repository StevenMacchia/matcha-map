// Small helpers for the Pages Functions: JSON replies, KV presence, per-IP daily limit, token gate.
import { bearerOk, sha256, makeId, DAILY_LIMIT } from "./validate.js";

export const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export const NOT_SET_UP = "Mattie is napping. Try again in a little while.";
export function kvOf(env) { return env && env.INTAKE && typeof env.INTAKE.put === "function" ? env.INTAKE : null; }

export async function readBody(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 20000) return null;
  try { const t = await request.text(); if (t.length > 20000) return null; const j = JSON.parse(t); return j && typeof j === "object" ? j : null; } catch { return null; }
}
export function clientIp(request) { return request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown"; }

// Counts one use per IP per UTC day under rl:<scope>:<day>:<hash>. Returns true when still within the limit.
export async function withinLimit(kv, request, scope, limit = DAILY_LIMIT) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${scope}:${day}:${(await sha256(clientIp(request) + "|matchamap")).slice(0, 24)}`;
  const n = Number(await kv.get(key)) || 0;
  if (n >= limit) return false;
  await kv.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  return true;
}

// Token gate for queue and approve. Returns a Response to send, or null when allowed.
export function guard(request, env) {
  if (!env || !env.INTAKE_TOKEN) return json({ error: "INTAKE_TOKEN is not set on this project. See docs/INTAKE.md." }, 503);
  if (!bearerOk(request.headers.get("authorization"), env.INTAKE_TOKEN)) return json({ error: "Not allowed." }, 401);
  return null;
}
export const methodNot = (allow) => json({ error: "Method not allowed." }, 405, { allow });

// Shared by report, claim and alerts: POST -> validate -> limit -> store under <prefix>:<id>.
export async function storeForm({ request, env, validate, prefix, ttl, scope, thanks, keyOf }) {
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const body = await readBody(request);
  if (!body) return json({ error: "Hmm, that did not go through. Reload and try again." }, 400);
  const v = validate(body);
  if (v.bot) return json({ ok: true, id: "ok", message: thanks }); // look like success, store nothing
  if (!v.ok) return json({ ok: false, errors: v.errors }, 422);
  if (!(await withinLimit(kv, request, scope))) return json({ error: "That is plenty for today. Come back tomorrow." }, 429);
  const id = makeId();
  const key = keyOf ? await keyOf(v.clean, id) : `${prefix}:${id}`;
  const opts = ttl ? { expirationTtl: ttl } : {};
  await kv.put(key, JSON.stringify({ id, at: new Date().toISOString(), ...v.clean }), opts);
  return json({ ok: true, id, message: thanks });
}
