// Self-serve intake -> data/inbox. The Pages Function (functions/api/*) keeps submissions in Cloudflare KV; a moderator
// approves them; this module pulls the approved ones, writes each as a paste file in the manual format
// (first line URL, then a caption) and marks it consumed. The manual adapter and brand matcher do the rest.
// It never writes data/events.json. Off unless INTAKE_URL and INTAKE_TOKEN are set (see run.js); never throws.
import fs from "node:fs";
import path from "node:path";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

function clock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return "";
  const h = +m[1], ap = h >= 12 ? "PM" : "AM", h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${ap}`;
}
export function longDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

// One approved queue item ({id, fields}) -> { file, text } in the data/inbox format.
// The caption names the brand, the @handle, the full date, time, venue and a street address so the extractor
// reads it as confirmed when all are given, and the matcher finds the brand by handle or by name.
export function itemToPaste(item) {
  const f = (item && item.fields) || {};
  const handle = String(f.handle || "").replace(/^@/, "");
  const url = f.url || (handle ? `https://www.instagram.com/${handle}/` : "");
  const when = [longDate(f.date), f.start ? (f.end ? `${clock(f.start)} to ${clock(f.end)}` : clock(f.start)) : ""].filter(Boolean).join(", ");
  const place = [f.venue, f.address, [f.city, f.state].filter(Boolean).join(", ")].map(oneLine).filter(Boolean);
  const parts = [`${oneLine(f.brand)} pop-up${handle ? ` @${handle}` : ""}.`];
  parts.push(`${when}${place.length ? (when ? ", at " : "At ") + place.join(", ") : ""}.`);
  if (Array.isArray(f.drinks) && f.drinks.length) parts.push(`Menu: ${f.drinks.join(", ")}.`);
  if (f.price) parts.push(`Price: ${oneLine(f.price)}.`);
  if (f.notes) parts.push(oneLine(f.notes));
  const text = `${url ? url + "\n" : ""}${parts.join(" ")}\n`;
  const file = `${slug(f.city) || "usa"}-${slug(f.brand) || "popup"}-${String(f.date || "").replace(/-/g, "")}-${String(item.id || "").slice(0, 8)}.txt`;
  return { file, text };
}

// Fetch /api/queue, write each approved item to dir, mark it consumed. Returns {written: [files], consumed, errors: []}.
// fetchFn is injectable for tests. A paste file is written before the item is marked consumed, so a failure
// in between leaves the file (same name, so no duplicate) and the item is simply picked up again.
export async function pullApproved({ baseUrl, token, dir = "data/inbox", fetchFn = globalThis.fetch, log = () => {} } = {}) {
  const res = { written: [], consumed: 0, errors: [] };
  if (!baseUrl || !token) return res;
  const base = String(baseUrl).replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    for (let round = 0; round < 3; round++) { // 40 a call; a few rounds drains a normal day
      const r = await fetchFn(`${base}/api/queue?kinds=approved`, { headers });
      if (!r.ok) { res.errors.push(`queue ${r.status}`); break; }
      const j = await r.json();
      const items = Array.isArray(j.approved) ? j.approved : [];
      if (!items.length) break;
      fs.mkdirSync(dir, { recursive: true });
      let progress = 0;
      for (const item of items) {
        try {
          if (!item || !item.id || !item.fields) continue;
          const { file, text } = itemToPaste(item);
          const target = path.join(dir, file);
          if (!fs.existsSync(target)) { fs.writeFileSync(target, text); res.written.push(file); }
          const c = await fetchFn(`${base}/api/approve`, { method: "POST", headers, body: JSON.stringify({ id: item.id, action: "consume" }) });
          if (c.ok) { res.consumed++; progress++; } else res.errors.push(`consume ${item.id}: ${c.status}`);
        } catch (e) { res.errors.push(`${item && item.id}: ${e.message}`); }
      }
      if (!j.approved_more || !progress) break;
    }
  } catch (e) { res.errors.push(e.message); }
  if (res.errors.length) log(`intake: ${res.errors.join("; ")}`);
  return res;
}
