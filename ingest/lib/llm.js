// Optional Claude step. No-op without CLAUDE_API_KEY. Never throws into the pipeline.
import { debug, warn } from "./log.js";

const MODEL = "claude-sonnet-5-5";
const MAX_CALLS = 20; // per run, a cost guard
let calls = 0;

const PROMPT = (text, nowIso) =>
  `Extract ONE matcha pop-up event from this post. Today is ${nowIso.slice(0, 10)}.\n` +
  `Reply with JSON only, no prose: {"title":string|null,"start":"ISO 8601 with local offset"|null,"end":string|null,"venue":string|null,"address":string|null,"city":string|null,"state":"two-letter"|null}\n` +
  `Use null for anything the post does not say. Do not guess.\n\nPOST:\n${text.slice(0, 2500)}`;

export const llmEnabled = (env = process.env) => !!env.CLAUDE_API_KEY;

// Ask the model for fields. Returns an object or null. Injectable fetch for tests.
export async function askLlm(text, { env = process.env, now = new Date(), fetchFn = fetch } = {}) {
  if (!env.CLAUDE_API_KEY || calls >= MAX_CALLS) return null;
  calls++;
  try {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: PROMPT(text, new Date(now).toISOString()) }] }),
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

// Merge a model answer into rule candidates: model fills blanks, marks the result "llm", unsure.
export function mergeLlm(cands, ans) {
  if (!ans || !ans.start) return cands;
  const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ans.start) && !isNaN(Date.parse(ans.start));
  if (!ok) return cands;
  const day = ans.start.slice(0, 10);
  const i = cands.findIndex((c) => c.start.slice(0, 10) === day);
  const base = i >= 0 ? cands[i] : { ...(cands[0] || {}), start: ans.start, end: null, all_day: false };
  const merged = {
    ...base,
    title: base.title || ans.title,
    venue: base.venue || ans.venue || "",
    address: base.address || ans.address || "",
    city: base.cityInferred && ans.city ? ans.city : base.city,
    state: base.cityInferred && /^[A-Z]{2}$/.test(ans.state || "") ? ans.state : base.state,
    end: base.end || ans.end || null,
    extracted_by: "llm", confidence: "unsure",
  };
  if (base.all_day && /T(?!00:00)/.test(ans.start)) { merged.start = ans.start; merged.all_day = false; }
  if (i >= 0) return cands.map((c, k) => (k === i ? merged : c));
  return [...cands, merged];
}

export async function improve(cands, raw, opts) {
  try {
    if (!llmEnabled(opts?.env)) return cands;
    if (cands.length && cands.every((c) => c.confidence === "confirmed")) return cands;
    if (!cands.length && !raw.manual) return cands;
    return mergeLlm(cands, await askLlm(raw.text, opts));
  } catch (e) { debug("llm merge failed", e.message); return cands; }
}
