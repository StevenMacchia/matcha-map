// GET /api/menus: the owner menus a moderator approved (menu-ok:<shop id or brand handle>, written by /api/approve kind "claim").
// { menus: { "<key>": { items, source_url, kind: "owner", read, note: "From the owner" } } }, at most 100. No emails, no proof links,
// no claim ids. Like /api/featured there is no per-IP limit (a limit would cost a KV write per read) and a 60 second copy is kept in the worker.
import { kvOf, json, methodNot } from "../_lib/http.js";

const MAX = 100, LIST = 45; // the reply never exceeds MAX; one list plus 45 gets stays under the 50 subrequest cap, so 45 is what a read reaches today
let memo = null;
export function resetMemo() { memo = null; }

const cleanItem = (x) => {
  if (!x || typeof x.name !== "string" || !x.name.trim()) return null;
  const o = { name: x.name.slice(0, 40) };
  if (typeof x.price === "string" && x.price.trim()) o.price = x.price.slice(0, 12);
  if (typeof x.note === "string" && x.note.trim()) o.note = x.note.slice(0, 60);
  return o;
};
const okUrl = (u) => (typeof u === "string" && /^https?:\/\/[^\s]+\.[^\s]+$/i.test(u) ? u.slice(0, 400) : "");

async function readAll(kv) {
  const out = {};
  const list = await kv.list({ prefix: "menu-ok:", limit: Math.min(LIST, MAX) });
  const rows = await Promise.all(list.keys.map(async (k) => { try { return { key: k.name.slice("menu-ok:".length), v: JSON.parse(await kv.get(k.name)) }; } catch { return null; } }));
  for (const r of rows) {
    if (!r || !r.key || !r.v || !Array.isArray(r.v.items)) continue;
    const items = r.v.items.map(cleanItem).filter(Boolean).slice(0, 40);
    if (!items.length) continue;
    out[r.key.slice(0, 80)] = { items, source_url: okUrl(r.v.source_url), kind: "owner", read: typeof r.v.read === "string" ? r.v.read.slice(0, 10) : "", note: "From the owner" };
    if (Object.keys(out).length >= MAX) break;
  }
  return out;
}

export async function onRequestGet({ env }) {
  const kv = kvOf(env);
  if (!kv) return json({ error: "not set up" }, 503);
  const now = Date.now();
  if (!(memo && now - memo.at < 60000)) memo = { at: now, menus: await readAll(kv) };
  return json({ menus: memo.menus }, 200, { "cache-control": "public, max-age=300" });
}
export const onRequest = ({ request, env }) => (request.method === "GET" ? onRequestGet({ env }) : methodNot("GET"));
