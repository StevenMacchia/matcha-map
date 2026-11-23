// POST /api/featured: a host asks for a Featured slot. Stored as featured:<id> (90 days), with paid:false until a payment is confirmed.
import { validateFeatured } from "../_lib/validate.js";
import { storeForm, methodNot, json, kvOf } from "../_lib/http.js";

export const onRequestPost = ({ request, env }) => storeForm({ request, env, validate: validateFeatured, prefix: "featured", ttl: 90 * 86400, scope: "featured", thanks: "Got it. We will check the pop-up and write back." });

// GET /api/featured: the picks visitors may see: approved (featured-ok:<id>) and not yet past their week.
// { picks: [{ event, brand, until, paid }] }, at most 50. Never ids of requests, emails or notes.
// No per-IP limit on purpose: a limit costs a KV write per read (the free plan allows 1000 writes a day), the reply is
// small and public, and a 60 second copy is kept in the worker so a burst of readers shares one set of KV reads.
const MAX = 50, LIST = 45; // one list plus 45 gets stays under the 50 subrequest cap
let memo = null;
export function resetMemo() { memo = null; }
export async function onRequestGet({ env }) {
  const kv = kvOf(env);
  if (!kv) return json({ error: "not set up" }, 503);
  const now = Date.now();
  let picks;
  if (memo && now - memo.at < 60000) picks = memo.picks;
  else {
    const list = await kv.list({ prefix: "featured-ok:", limit: LIST });
    const rows = await Promise.all(list.keys.map(async (k) => { try { return JSON.parse(await kv.get(k.name)); } catch { return null; } }));
    picks = rows.filter((r) => r && /^[a-f0-9]{12}$/.test(r.event || "") && Date.parse(r.until || "") > now)
      .sort((a, b) => Date.parse(a.until) - Date.parse(b.until)).slice(0, MAX)
      .map((r) => ({ event: r.event, brand: String(r.brand || "").slice(0, 80), until: r.until, paid: r.paid === true }));
    memo = { at: now, picks };
  }
  return json({ picks }, 200, { "cache-control": "public, max-age=300" });
}
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : request.method === "GET" ? onRequestGet({ request, env }) : methodNot("GET, POST"));
