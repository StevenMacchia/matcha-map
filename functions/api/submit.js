// POST /api/submit: the "Add your pop-up" form. Validates, rate-limits per IP (10 a day), stores pending:<id> in KV (30 days).
// It never touches data/events.json: ingest pulls approved items later (ingest/lib/intake.js).
import { validateSubmission, makeId } from "../_lib/validate.js";
import { json, kvOf, readBody, withinLimit, methodNot, NOT_SET_UP } from "../_lib/http.js";

const THANKS = "Mattie is on it. We will check it and put it on the map.";
export const PENDING_TTL = 30 * 86400;

export async function onRequestPost({ request, env }) {
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const body = await readBody(request);
  if (!body) return json({ error: "Hmm, that did not go through. Reload and try again." }, 400);
  const v = validateSubmission(body);
  if (v.bot) return json({ ok: true, id: "ok", message: THANKS }); // honeypot or too fast: fake success, store nothing
  if (!v.ok) return json({ ok: false, errors: v.errors }, 422);
  if (!(await withinLimit(kv, request, "submit"))) return json({ error: "That is plenty for today. Come back tomorrow." }, 429);
  const id = makeId();
  const item = { id, status: "pending", at: new Date().toISOString(), fields: v.clean };
  await kv.put(`pending:${id}`, JSON.stringify(item), { expirationTtl: PENDING_TTL });
  return json({ ok: true, id, message: THANKS });
}
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : methodNot("POST"));
