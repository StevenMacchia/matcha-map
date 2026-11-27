// POST /api/ev { k, v }  -> 204. One feature tap, counted without any identifier (docs/METRICS.md).
// k must be on the allowlist (FEATURES); v is a short label such as "e:<event id>" or "s:<shop name>" for a card open.
// Bots are dropped, not counted. Replies 204 even when it drops something, so a page never shows an error for counting.
import { kvOf, readBody, methodNot } from "../_lib/http.js";
import { FEATURES, recordFeature, visitorClass } from "../_lib/metrics.js";

export const VALUE = /^[a-z0-9][a-z0-9:_ .'&@\-]{0,59}$/i;
export function clean(body) {
  if (!body || typeof body.k !== "string" || !FEATURES.includes(body.k)) return null;
  let v = typeof body.v === "string" ? body.v.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (v && !VALUE.test(v)) v = "";
  if (body.k === "card_open" && !/^[es]:/.test(v)) return null;
  return { k: body.k, v };
}

export async function onRequestPost({ request, env, waitUntil }) {
  const kv = kvOf(env);
  const body = await readBody(request);
  const c = clean(body);
  if (kv && c && visitorClass(request) === "human") {
    const job = recordFeature(kv, c.k, c.v, "human").catch(() => {});
    if (typeof waitUntil === "function") waitUntil(job); else await job;
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
export const onRequest = () => methodNot("POST");
