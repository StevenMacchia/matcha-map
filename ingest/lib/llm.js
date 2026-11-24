// Optional Claude step for candidates the rules leave "unsure". No-op without CLAUDE_API_KEY. Never throws into the pipeline.
// The model reads one post and returns strict JSON: for every field a value AND the exact span of the post that supports it.
// verify() keeps a field only when its quote is really in the post and the value really follows from the quote (a date the
// rule extractor itself reads in the quote, a time findTime reads, venue/city/menu words that are in the quote). So the model can
// point at what the text says, but cannot invent a date or a place. A reading with a verified date and a verified venue or street
// in a verified city is "likely"; anything less stays "unsure". extracted_by "llm".
import { debug, warn } from "./log.js";
import { findDates, findTime, refDate } from "./extract.js";
import { tzFor, zonedIso, STATES } from "./tz.js";

export const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 800;
const MAX_CALLS = 20; // per run, a cost guard
let calls = 0;
export const resetCalls = () => { calls = 0; };

export const FIELDS = ["brand", "date", "start_time", "end_time", "venue", "address", "city", "state", "menu", "price", "hours", "pay"];
export const PROMPT = (text, nowIso) =>
  `Read this post about a matcha pop-up. Today is ${nowIso.slice(0, 10)}.\n` +
  `Reply with one JSON object only, no prose. Keys: ${FIELDS.join(", ")}.\n` +
  `Each key maps to {"value": ..., "quote": "..."} or null. "quote" must be copied character for character from the post and must contain the value's evidence.\n` +
  `Values: brand string (who runs the pop-up); date "YYYY-MM-DD"; start_time and end_time "HH:MM" 24-hour; venue, address (street), city strings; state two-letter US code; ` +
  `menu array of drink or food names; price string as written; hours string as written; pay string (how to pay, as written).\n` +
  `Use null for anything the post does not state. Never guess, never fill a field from general knowledge, never compute a date the post does not name.\n\nPOST:\n`
  + text.slice(0, 2500);

// MATCHA_NO_MODEL=1 (the daily run, docs/DAILY-RUN.md) turns every model call off even when a key is present.
export const llmEnabled = (env = process.env) => !!env.CLAUDE_API_KEY && env.MATCHA_NO_MODEL !== "1";

// Ask the model. -> parsed JSON object or null. Injectable fetch for tests.
export async function askLlm(text, { env = process.env, now = new Date(), fetchFn = fetch } = {}) {
  if (!llmEnabled(env) || calls >= MAX_CALLS) return null;
  calls++;
  try {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: PROMPT(text, new Date(now).toISOString()) }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) { warn("llm: HTTP", res.status); return null; }
    const j = await res.json();
    const raw = j.content?.map((b) => b.text || "").join("") || "";
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    debug("llm failed", e.message);
    return null;
  }
}

const norm = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const words = (s) => norm(s).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 1);
const pad = (n) => String(n).padStart(2, "0");

// The model's answer + the post -> only the fields its quotes support: {brand, start, end, all_day, venue, address, city, state, menu, price, hours, pay}.
export function verify(ans, text, { now = new Date(), published_at = null, tz: tz0 = null } = {}) {
  const post = norm(text);
  const f = (k) => {
    const x = ans?.[k];
    if (!x || typeof x !== "object" || x.value === null || x.value === undefined || x.value === "") return null;
    const q = norm(x.quote);
    return q && post.includes(q) ? { value: x.value, quote: q } : null;
  };
  const inQuote = (v, q) => { const w = words(v); return w.length > 0 && w.every((x) => q.includes(x)); };
  const out = {};
  for (const k of ["brand", "venue", "address", "city", "price", "hours", "pay"]) {
    const x = f(k);
    if (x && typeof x.value === "string" && inQuote(x.value, x.quote)) out[k] = x.value.trim();
  }
  const st = f("state");
  if (st && STATES.includes(String(st.value).toUpperCase()) && (out.city || out.address)) out.state = String(st.value).toUpperCase();
  const menu = f("menu");
  if (menu && Array.isArray(menu.value)) { const m = menu.value.filter((v) => typeof v === "string" && post.includes(norm(v))).map((v) => norm(v).slice(0, 40)); if (m.length) out.menu = m.slice(0, 8); }
  const tz = (out.city && out.state && tzFor({ city: out.city, state: out.state })) || tz0 || "America/New_York";
  const d = f("date");
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d.value)) {
    const ref = refDate(published_at || now, tz);
    const seen = findDates(d.quote, ref).flatMap((g) => g.dates).some((x) => `${x.y}-${pad(x.mo)}-${pad(x.d)}` === d.value);
    if (seen) {
      const [y, mo, dd] = d.value.split("-").map(Number);
      const tm = (k) => { const t = f(k); if (!t || !/^\d{2}:\d{2}$/.test(t.value)) return null; const r = findTime(t.quote); const [h, mi] = t.value.split(":").map(Number); return r && ((r.start.h === h && r.start.mi === mi) || (r.end && r.end.h === h && r.end.mi === mi)) ? { h, mi } : null; };
      const s = tm("start_time"), e = tm("end_time");
      out.start = zonedIso(tz, y, mo, dd, s?.h ?? 0, s?.mi ?? 0);
      out.all_day = !s;
      out.end = s && e ? zonedIso(tz, y, mo, dd, e.h, e.mi) : null;
      out.tz = tz;
    }
  }
  return out;
}

// Merge a verified answer into rule candidates: it fills blanks only, never overrides a rule reading.
export function mergeLlm(cands, v) {
  if (!v || !v.start) return cands;
  const day = v.start.slice(0, 10);
  const i = cands.findIndex((c) => String(c.start).slice(0, 10) === day);
  const base = i >= 0 ? cands[i] : { ...(cands[0] || {}), start: v.start, end: v.end, all_day: v.all_day, tz: v.tz || cands[0]?.tz, title: cands[0]?.title || null };
  const placeFromModel = base.cityInferred && v.city && v.state;
  const merged = {
    ...base,
    venue: base.venue || v.venue || "", address: base.address || v.address || "",
    city: placeFromModel ? v.city : base.city, state: placeFromModel ? v.state : base.state,
    cityInferred: placeFromModel ? false : base.cityInferred,
    end: base.end || v.end || null, pay: base.pay || v.pay || null, hours: base.hours || v.hours || null, price: base.price || v.price || null,
    llm_menu: v.menu || null, llm_brand: v.brand || null, extracted_by: "llm",
  };
  if (base.all_day && v.all_day === false) { merged.start = v.start; merged.all_day = false; }
  merged.confidence = (merged.venue || merged.address) && merged.city && merged.state && !merged.cityInferred ? "likely" : "unsure";
  if (i >= 0) return cands.map((c, k) => (k === i ? merged : c));
  return [...cands, merged];
}

// Called by pipeline.itemToCandidates for every RawItem: runs only with a key and when the rules left a candidate unsure
// (or found none in a hand paste).
export async function improve(cands, raw, opts = {}) {
  try {
    if (!llmEnabled(opts?.env)) return cands;
    if (cands.length && !cands.some((c) => c.confidence === "unsure")) return cands;
    if (!cands.length && !raw.manual) return cands;
    const ans = await askLlm(raw.text, opts);
    if (!ans) return cands;
    return mergeLlm(cands, verify(ans, raw.text, { now: opts.now, published_at: raw.published_at, tz: cands[0]?.tz }));
  } catch (e) { debug("llm merge failed", e.message); return cands; }
}
