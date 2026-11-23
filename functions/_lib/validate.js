// Pure validators shared by the Pages Functions (functions/api/*.js) and the tests. No I/O, no Cloudflare APIs.
// Every function returns plain data: { ok, errors: {field: message}, clean } so the form can show errors per field.

export const MIN_FILL_MS = 1500;          // phone autofill plus one tap can be quick, so this stays low; the honeypot does the real work
export const MAX_FORM_AGE_MS = 24 * 36e5; // a form page open for a day is stale: ask to reload
export const DAILY_LIMIT = 10;            // submissions per IP per day
export const HONEYPOT = "company";        // hidden field; bots fill it, people never see it
export const REPORT_REASONS = ["wrong-date", "wrong-place", "cancelled", "not-matcha", "other"];

// Strip control characters, trim, cap length.
export function str(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
// Multi-line text (notes): keep newlines, collapse the rest.
export function para(v, max = 600) {
  if (typeof v !== "string") return "";
  return v.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
export const isEmail = (s) => /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i.test(s) && s.length <= 254;
export const isUrl = (s) => { try { const u = new URL(s); return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes("."); } catch { return false; } };

// "@Sunny.Books", "instagram.com/sunny.books/", "https://www.tiktok.com/@sunny" -> "sunny.books" ("" when it is not a handle).
export function normHandle(v) {
  let h = str(v, 200);
  const m = /(?:instagram\.com|tiktok\.com)\/@?([A-Za-z0-9._]+)/i.exec(h);
  if (m) h = m[1];
  h = h.replace(/^@+/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h.toLowerCase() : "";
}
export function normDate(v) {
  const s = str(v, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : "";
}
export function normTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(v, 5));
  if (!m || +m[1] > 23 || +m[2] > 59) return "";
  return `${String(+m[1]).padStart(2, "0")}:${m[2]}`;
}
// "Austin, TX" or "Austin TX" -> {city, state}; null when there is no 2-letter state.
export function splitCity(v) {
  const m = /^(.{2,60}?)[\s,]+([A-Za-z]{2})\.?$/.exec(str(v, 80));
  return m ? { city: m[1].replace(/,$/, "").trim(), state: m[2].toUpperCase() } : null;
}
export function listOf(v, maxItems = 8, maxLen = 40) {
  const parts = Array.isArray(v) ? v : String(v || "").split(/[,;\n]+/);
  const out = [];
  for (const p of parts) { const s = str(String(p), maxLen).toLowerCase(); if (s && !out.includes(s)) out.push(s); if (out.length >= maxItems) break; }
  return out;
}

// field name -> cleaner. Used for whole submissions and for the moderator's edit patch.
const FIELDS = {
  brand: (v) => str(v, 80), handle: normHandle, url: (v) => { const s = str(v, 400); return isUrl(s) ? s : ""; },
  date: normDate, start: normTime, end: normTime, venue: (v) => str(v, 100), address: (v) => str(v, 120),
  city: (v) => str(v, 60), state: (v) => str(v, 2).toUpperCase(), drinks: (v) => listOf(v), price: (v) => str(v, 40),
  notes: (v) => para(v, 600), email: (v) => { const s = str(v, 254); return isEmail(s) ? s : ""; },
};
export const FIELD_NAMES = Object.keys(FIELDS);

// Moderator edit: only known fields, each cleaned the same way. Unknown keys are dropped.
export function sanitizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== "object") return out;
  for (const k of FIELD_NAMES) if (k in patch) out[k] = FIELDS[k](patch[k]);
  return out;
}

// Bot gate: honeypot filled, or the form was "submitted" faster than a person can type, or the stamp is missing.
// {bot:true} -> answer with a fake success and store nothing. {stale:true} -> ask the person to reload.
export function botCheck(body, now = Date.now()) {
  const b = body && typeof body === "object" ? body : {};
  if (str(String(b[HONEYPOT] == null ? "" : b[HONEYPOT]), 50)) return { bot: true };
  const t = Number(b.t);
  if (!isFinite(t) || t <= 0) return { bot: true };
  // "n" is the phone's own clock at send time: n - t is the fill time with no clock skew. Fall back to the server clock.
  const n = Number(b.n);
  const age = isFinite(n) && n > t ? n - t : now - t;
  if (age < MIN_FILL_MS) return { bot: true };
  if (age > MAX_FORM_AGE_MS) return { stale: true };
  return {};
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

export function validateSubmission(body, { now = Date.now() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const gate = botCheck(b, now);
  if (gate.bot) return { ok: false, bot: true, errors: {}, clean: null };
  const errors = {};
  if (gate.stale) errors.form = "This page has been open a while. Reload it and try again.";
  const clean = {};
  for (const k of FIELD_NAMES) clean[k] = FIELDS[k](b[k]);
  if (!clean.brand) errors.brand = "What is the brand called?";
  if (!clean.handle && !clean.url) errors.handle = str(String(b.handle || ""), 200) ? "That does not look like a handle. Try @name." : "Add an Instagram or TikTok handle, or a post link.";
  if (str(String(b.url || ""), 400) && !clean.url) errors.url = "That link needs to start with https://";
  if (!clean.date) errors.date = "Pick the date.";
  else if (clean.date < ymd(now - 36e5 * 36)) errors.date = "That date has passed.";
  else if (clean.date > ymd(now + 366 * 864e5)) errors.date = "That is more than a year away.";
  const sc = splitCity(String(b.city || ""));
  if (!sc) errors.city = "City and state, like Austin, TX.";
  else { clean.city = sc.city; clean.state = sc.state; }
  if (String(b.start || "") && !clean.start) errors.start = "Use a time like 11:00.";
  if (String(b.end || "") && !clean.end) errors.end = "Use a time like 15:00.";
  if (clean.end && !clean.start) errors.start = "Add the start time too.";
  if (String(b.email || "") && !clean.email) errors.email = "That email does not look right.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function validateReport(body, { now = Date.now() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const gate = botCheck(b, now);
  if (gate.bot) return { ok: false, bot: true, errors: {}, clean: null };
  const errors = {};
  if (gate.stale) errors.form = "This page has been open a while. Reload it and try again.";
  const ev = str(String(b.event || ""), 40);
  const event = /^[a-z0-9]{6,32}$/i.test(ev) ? ev.toLowerCase() : "";
  const reason = REPORT_REASONS.includes(b.reason) ? b.reason : "";
  const clean = { event, reason, details: para(b.details, 600), email: FIELDS.email(b.email) };
  if (!event) errors.event = "Which pop-up? Open this page from a card.";
  if (!reason) errors.reason = "Pick what is wrong.";
  if (reason === "other" && !clean.details) errors.details = "Tell us a little.";
  if (String(b.email || "") && !clean.email) errors.email = "That email does not look right.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function validateClaim(body, { now = Date.now() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const gate = botCheck(b, now);
  if (gate.bot) return { ok: false, bot: true, errors: {}, clean: null };
  const errors = {};
  if (gate.stale) errors.form = "This page has been open a while. Reload it and try again.";
  const clean = {
    brand: str(String(b.brand || ""), 80), handle: normHandle(b.handle), role: str(String(b.role || ""), 80),
    email: FIELDS.email(b.email), proof: FIELDS.url(b.proof),
  };
  if (!clean.brand) errors.brand = "Which brand?";
  if (!clean.handle) errors.handle = "Add the Instagram or TikTok handle.";
  if (!clean.role) errors.role = "What is your role there?";
  if (!clean.email) errors.email = "We need an email to reply to.";
  if (!clean.proof) errors.proof = "Add a link that shows it is yours, like your bio page.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function validateAlert(body, { now = Date.now() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const gate = botCheck(b, now);
  if (gate.bot) return { ok: false, bot: true, errors: {}, clean: null };
  const errors = {};
  if (gate.stale) errors.form = "This page has been open a while. Reload it and try again.";
  const city = str(String(b.city || ""), 60).toLowerCase();
  const clean = { email: FIELDS.email(b.email), city: /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z]{2}$/.test(city) ? city : "", consent: b.consent === true || b.consent === "true" || b.consent === "on" };
  if (!clean.email) errors.email = "We need an email to write to.";
  if (!clean.city) errors.city = "Pick a city.";
  if (!clean.consent) errors.consent = "Tick the box so we know it is ok.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

// ---- ids and hashes (Web Crypto: same in Workers and Node 20+) ----
export function makeId() {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256(s) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}
export const isId = (s) => /^[a-f0-9]{16}$/.test(String(s || ""));

// ---- bearer token (constant-time compare) ----
export function bearerOk(header, token) {
  if (!token || typeof header !== "string") return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = m[1], b = String(token);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
