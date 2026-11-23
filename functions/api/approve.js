// POST /api/approve  { id, action: approve | reject | edit | consume, patch? }  with "Authorization: Bearer <INTAKE_TOKEN>".
//   approve: pending:<id> -> approved:<id> (90 days)       reject: pending:<id> -> rejected:<id> (30 days)
//   kind "featured": approve: featured:<id> -> featured-ok:<id> {approved_at, week, paid, until}   reject: -> featured-no:<id> (30 days)
//                    edit: {patch:{paid:true}} on featured-ok (or featured) sets paid and paid_at (Steven, by hand, after a Stripe payment)
//   kind "claim": approve: claim:<id> -> claim-ok:<id> (90 days), and when the claim carries a menu also menu-ok:<shop id or handle> (a year); reject: -> claim-no:<id> (30 days)
//   edit:    patch fields on pending:<id> (or approved:<id>)  consume: approved:<id> -> consumed:<id> (ingest uses this)
import { sanitizePatch, isId } from "../_lib/validate.js";
import { json, kvOf, readBody, guard, methodNot, NOT_SET_UP } from "../_lib/http.js";

const DAY = 86400;

// End of the chosen week (start day + 7 days, minus a second), ISO. "" when the week is missing.
export function weekEnd(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(week || ""));
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + 7 * 864e5 - 1000).toISOString();
}

async function featuredAction(kv, body) {
  const { id, action } = body;
  if (action === "consume") return json({ error: "Not for featured items." }, 400);
  let key = `featured:${id}`, raw = await kv.get(key);
  if (!raw && action === "edit") { key = `featured-ok:${id}`; raw = await kv.get(key); }
  if (!raw) return json({ error: "Not found (it may have expired or already moved)." }, 404);
  let item;
  try { item = JSON.parse(raw); } catch { return json({ error: "Stored item is unreadable." }, 500); }
  const now = new Date().toISOString();
  if (action === "edit") {
    const p = body.patch && typeof body.patch === "object" ? body.patch : {};
    if (p.paid !== true && p.paid !== false) return json({ error: "Featured edit takes {patch: {paid: true|false}}." }, 400);
    const next = { ...item, paid: p.paid, paid_at: p.paid ? now : null, edited_at: now };
    const ok = key.startsWith("featured-ok:");
    const ttl = ok ? Math.max(86400, Math.ceil((Date.parse(item.until || "") - Date.now()) / 1000) + 30 * DAY) : 90 * DAY;
    await kv.put(key, JSON.stringify(next), { expirationTtl: ttl });
    return json({ ok: true, id, status: ok ? "featured-ok" : "featured", paid: next.paid });
  }
  if (action === "reject") {
    await kv.put(`featured-no:${id}`, JSON.stringify({ ...item, status: "rejected", rejected_at: now }), { expirationTtl: 30 * DAY });
    await kv.delete(key);
    return json({ ok: true, id, status: "featured-no" });
  }
  const until = weekEnd(item.week);
  if (!until) return json({ error: "That request has no valid week." }, 422);
  const ttl = Math.max(86400, Math.ceil((Date.parse(until) - Date.now()) / 1000) + 30 * DAY);
  await kv.put(`featured-ok:${id}`, JSON.stringify({ ...item, status: "approved", approved_at: now, paid: item.paid === true, until }), { expirationTtl: ttl });
  await kv.delete(key);
  return json({ ok: true, id, status: "featured-ok", until });
}

// The key an owner menu is kept and read under: the shop id when the claim named one, else the brand's handle.
export const menuKeyOf = (item) => (item && item.shop) || (item && item.handle) || "";

async function claimAction(kv, body) {
  const { id, action } = body;
  if (action !== "approve" && action !== "reject") return json({ error: "Claims take approve or reject." }, 400);
  const key = `claim:${id}`, raw = await kv.get(key);
  if (!raw) return json({ error: "Not found (it may have expired or already moved)." }, 404);
  let item;
  try { item = JSON.parse(raw); } catch { return json({ error: "Stored item is unreadable." }, 500); }
  const now = new Date().toISOString();
  if (action === "reject") {
    await kv.put(`claim-no:${id}`, JSON.stringify({ ...item, status: "rejected", rejected_at: now }), { expirationTtl: 30 * DAY });
    await kv.delete(key);
    return json({ ok: true, id, status: "claim-no" });
  }
  await kv.put(`claim-ok:${id}`, JSON.stringify({ ...item, status: "approved", approved_at: now }), { expirationTtl: 90 * DAY });
  let menu = false;
  const mk = menuKeyOf(item);
  if (mk && item.menu && Array.isArray(item.menu.items) && item.menu.items.length) {
    // Only what visitors may see, plus who it is from. Never the email or the proof link.
    await kv.put(`menu-ok:${mk}`, JSON.stringify({ ...item.menu, kind: "owner", brand: item.brand, handle: item.handle, approved_at: now }), { expirationTtl: 365 * DAY });
    menu = true;
  }
  await kv.delete(key);
  return json({ ok: true, id, status: "claim-ok", menu });
}

export async function onRequestPost({ request, env }) {
  const denied = guard(request, env);
  if (denied) return denied;
  const kv = kvOf(env);
  if (!kv) return json({ error: NOT_SET_UP }, 503);
  const body = await readBody(request);
  if (!body || !isId(body.id) || !["approve", "reject", "edit", "consume"].includes(body.action)) return json({ error: "Need {id, action: approve|reject|edit|consume}." }, 400);
  const { id, action } = body;
  if (body.kind === "featured") return featuredAction(kv, body);
  if (body.kind === "claim") return claimAction(kv, body);
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
