// One fetch helper: User-Agent, robots.txt, 1 req/sec/host, disk cache, timeout.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { debug } from "./log.js";

export const UA = "matcha-map/0.1 (+https://github.com/StevenMacchia/matcha-map)";
const TTL_MS = 6 * 3600 * 1000;
const TIMEOUT_MS = 15000;
const MIN_GAP_MS = 1000;

// Parse a robots.txt into allow/disallow rules for our agent (falls back to "*").
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === "user-agent") {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if ((k === "allow" || k === "disallow") && cur) {
      lastWasAgent = false;
      if (v) cur.rules.push({ allow: k === "allow", pattern: v });
    } else lastWasAgent = false;
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && "matcha-map".includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  return (mine || star || { rules: [] }).rules;
}

function patternToRegex(p) {
  const end = p.endsWith("$");
  const body = (end ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + body + (end ? "$" : ""));
}

// Longest matching rule wins; allow wins a tie; no match = allowed.
export function robotsAllows(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (patternToRegex(r.pattern).test(pathAndQuery)) {
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}

export function createFetcher({ noFetch = false, cacheDir = ".cache" } = {}) {
  const lastHit = new Map();      // host -> ms of last request
  const robotsByHost = new Map(); // host -> rules (once per run)
  fs.mkdirSync(cacheDir, { recursive: true });

  const cacheFile = (url) => path.join(cacheDir, createHash("sha1").update(url).digest("hex") + ".json");
  function readCache(url, ignoreAge) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile(url), "utf8"));
      if (ignoreAge || Date.now() - c.fetched < TTL_MS) return c;
    } catch { /* no cache */ }
    return null;
  }

  async function throttle(host) {
    const next = (lastHit.get(host) || 0) + MIN_GAP_MS;
    const wait = next - Date.now();
    lastHit.set(host, Math.max(Date.now(), next));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  // Raw GET: cached, throttled, timed out. No robots check (callers decide).
  async function load(url, { headers = {}, cache = true } = {}) {
    if (cache) {
      const hit = readCache(url, noFetch);
      if (hit) { debug("cache", url); return { ok: hit.status < 400, status: hit.status, text: hit.body, fromCache: true }; }
    }
    if (noFetch) return { ok: false, status: 0, text: "", fromCache: false, error: "no-fetch and not cached" };
    await throttle(new URL(url).host);
    debug("get", url);
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    const body = await res.text();
    if (cache && res.status < 500) fs.writeFileSync(cacheFile(url), JSON.stringify({ url, fetched: Date.now(), status: res.status, body }));
    return { ok: res.ok, status: res.status, text: body, fromCache: false };
  }

  async function rulesFor(u) {
    if (robotsByHost.has(u.host)) return robotsByHost.get(u.host);
    let rules = [];
    try {
      const r = await load(`${u.protocol}//${u.host}/robots.txt`);
      if (r.ok) rules = parseRobots(r.text);
    } catch (e) { debug("robots fetch failed", u.host, e.message); }
    robotsByHost.set(u.host, rules);
    return rules;
  }

  // get(url) -> {ok,status,text,fromCache,blocked?}. Pass {robots:false} for official APIs.
  async function get(url, { robots = true, ...opts } = {}) {
    const u = new URL(url);
    if (robots) {
      const rules = await rulesFor(u);
      if (!robotsAllows(rules, u.pathname + u.search)) {
        debug("robots disallow", url);
        return { ok: false, status: 0, text: "", blocked: true, fromCache: false };
      }
    }
    return load(url, opts);
  }

  return { get, noFetch };
}
