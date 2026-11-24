// npm run social:publish -- --date YYYY-MM-DD --pick 02,04 [--live | --dry-run]
// Instagram Content Publishing for the day's outbox (tools/brand/outbox/<date>/plan.json), for after the Meta app review
// grants instagram_content_publish. Until then this only ever runs as a dry run.
//   feed post:  POST /{ig-user-id}/media (image_url, caption, user_tags), wait for FINISHED, POST /{ig-user-id}/media_publish
//   story:      POST /{ig-user-id}/media (image_url, media_type=STORIES), wait, POST /{ig-user-id}/media_publish
// The image must be reachable: outbox.js copies it to site/social/<date>/ and the daily deploy puts it on matchamap.app.
// Rules (docs/SOCIAL.md): nothing goes out without Steven's pick, so a live run needs --pick and posts only those items;
// --dry-run is the default until SOCIAL_PUBLISH=1, and prints every request it would make while making none; --live
// refuses unless SOCIAL_PUBLISH=1 and IG_ACCESS_TOKEN and IG_USER_ID are set (env or .env, never in git). Each publish is
// logged to tools/brand/outbox/<date>/published.json, and an item already there is never posted twice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GRAPH = "https://graph.facebook.com/v27.0";

export function parseArgs(argv) {
  const val = (name) => { const i = argv.findIndex((x) => x === name || x.startsWith(name + "=")); return i < 0 ? null : argv[i].includes("=") ? argv[i].split("=").slice(1).join("=") : argv[i + 1]; };
  const pick = val("--pick");
  return { date: val("--date"), picks: pick ? pick.split(",").map((s) => s.trim()).filter(Boolean) : null, live: argv.includes("--live"), dry: argv.includes("--dry-run") };
}

// Which mode: --dry-run always wins; --live asks for live; with neither, live only when SOCIAL_PUBLISH=1.
export function modeOf({ live, dry }, env) {
  if (dry) return "dry";
  if (live || env.SOCIAL_PUBLISH === "1") return "live";
  return "dry";
}
export function refusal(mode, env, picks) {
  if (mode !== "live") return null;
  if (env.SOCIAL_PUBLISH !== "1") return "refusing a live run: SOCIAL_PUBLISH is not 1 (turn it on only after the Meta app review grants instagram_content_publish)";
  if (!env.IG_ACCESS_TOKEN || !env.IG_USER_ID) return "refusing a live run: IG_ACCESS_TOKEN and IG_USER_ID must both be set";
  if (!picks || !picks.length) return "refusing a live run: name Steven's pick with --pick (item numbers or folder names from INDEX.md)";
  return null;
}

// The calls for one item, in order. `{container}` is filled from the first call's answer.
export function requestsFor(it, igUser) {
  const base = { image_url: it.image_url };
  const create = it.slot === "story"
    ? { ...base, media_type: "STORIES" }
    : { ...base, caption: it.caption, ...(it.user_tags && it.user_tags.length ? { user_tags: JSON.stringify(it.user_tags) } : {}) };
  return [
    { step: "create", method: "POST", url: `${GRAPH}/${igUser}/media`, body: create },
    { step: "status", method: "GET", url: `${GRAPH}/{container}`, query: { fields: "status_code" } },
    { step: "publish", method: "POST", url: `${GRAPH}/${igUser}/media_publish`, body: { creation_id: "{container}" } },
    { step: "permalink", method: "GET", url: `${GRAPH}/{media}`, query: { fields: "permalink" } },
  ];
}

const form = (obj, token) => new URLSearchParams({ ...obj, access_token: token }).toString();
const show = (r) => `${r.method} ${r.url}${r.query ? "?" + new URLSearchParams(r.query) : ""}${r.body ? "\n      " + Object.entries(r.body).map(([k, v]) => `${k}=${String(v).length > 120 ? String(v).slice(0, 117).replace(/\n/g, " ") + "..." : String(v).replace(/\n/g, " ")}`).join("\n      ") + "\n      access_token=<IG_ACCESS_TOKEN>" : " (access_token=<IG_ACCESS_TOKEN>)"}`;

export async function publish({ date, picks = null, mode = "dry", env = process.env, fetchImpl = globalThis.fetch, root = ROOT, log = console.log, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const dir = path.join(root, "tools", "brand", "outbox", date);
  const planFile = path.join(dir, "plan.json");
  if (!fs.existsSync(planFile)) throw new Error(`no outbox for ${date}: run npm run social -- --date ${date} first`);
  const no = refusal(mode, env, picks);
  if (no) throw new Error(no);
  const p = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const logFile = path.join(dir, "published.json");
  const done = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : [];
  const chosen = picks ? p.items.filter((it) => picks.some((k) => k === it.n || k === it.name || k === String(+it.n))) : p.items;
  if (picks && chosen.length !== picks.length) throw new Error(`--pick names an item not in ${date}'s outbox: ${picks.join(",")}`);
  const igUser = mode === "live" ? env.IG_USER_ID : "{IG_USER_ID}";
  const out = [];

  for (const it of chosen) {
    if (done.some((d) => d.name === it.name)) { log(`skip ${it.name}: already published (${done.find((d) => d.name === it.name).permalink || "see published.json"})`); continue; }
    const reqs = requestsFor(it, igUser);
    if (mode !== "live") {
      log(`dry run ${it.name} (${it.slot}, ${it.time} ET): would make ${reqs.length} requests, makes none`);
      for (const r of reqs) log("  " + show(r));
      out.push({ name: it.name, dry: true, requests: reqs });
      continue;
    }
    const tok = env.IG_ACCESS_TOKEN;
    const call = async (r, fill) => {
      const url = r.url.replace("{container}", fill.container || "").replace("{media}", fill.media || "");
      const res = r.method === "GET"
        ? await fetchImpl(`${url}?${new URLSearchParams({ ...r.query, access_token: tok })}`)
        : await fetchImpl(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(Object.fromEntries(Object.entries(r.body).map(([k, v]) => [k, String(v).replace("{container}", fill.container || "")])), tok) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(`${it.name} ${r.step}: ${(j.error && j.error.message) || res.status}`);
      return j;
    };
    const head = await fetchImpl(it.image_url, { method: "HEAD" });
    if (!head.ok) throw new Error(`${it.name}: ${it.image_url} answers ${head.status}; deploy the site (site/social/${date}/) first`);
    const fill = {};
    fill.container = (await call(reqs[0], fill)).id;
    for (let i = 0; i < 20; i++) {
      const s = await call(reqs[1], fill);
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`${it.name}: container ${s.status_code}`);
      await wait(3000);
    }
    fill.media = (await call(reqs[2], fill)).id;
    const permalink = (await call(reqs[3], fill).catch(() => ({}))).permalink || null;
    const row = { name: it.name, slot: it.slot, container_id: fill.container, media_id: fill.media, permalink, user_tags: it.user_tags.map((t) => t.username), published_at: new Date().toISOString() };
    done.push(row);
    fs.writeFileSync(logFile, JSON.stringify(done, null, 2) + "\n");
    log(`published ${it.name}: ${permalink || fill.media}`);
    out.push(row);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadEnv } = await import("../../ingest/lib/env.js");
  try { loadEnv(path.join(ROOT, ".env")); } catch { /* no .env: the environment only */ }
  const a = parseArgs(process.argv.slice(2));
  const { tomorrowNY } = await import("./plan.js");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const mode = modeOf(a, process.env);
  publish({ date: a.date || (mode === "live" ? today : tomorrowNY()), picks: a.picks, mode }).catch((e) => { console.error("social:publish: " + e.message); process.exit(1); });
}
