// Refresh the long-lived Instagram Graph user token before it expires (every ~60 days).
// Reads INSTAGRAM_TOKEN, INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET from .env, exchanges the token for a fresh long-lived one,
// writes it back to .env and prints only the expiry. Usage: node tools/ig-token.js [--check]
import fs from "node:fs";
import "../ingest/lib/env.js";
const { INSTAGRAM_TOKEN: tok, INSTAGRAM_APP_ID: app, INSTAGRAM_APP_SECRET: sec } = process.env;
if (!tok || !app || !sec) { console.error("Missing INSTAGRAM_TOKEN, INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET in .env"); process.exit(1); }
const v = "v27.0";
async function debug(t) {
  const r = await fetch(`https://graph.facebook.com/${v}/debug_token?input_token=${t}&access_token=${t}`);
  const j = await r.json(); const d = j.data || {};
  return { ok: !!d.is_valid, expires: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "never", scopes: d.scopes || [] };
}
const before = await debug(tok);
console.log("current token:", before.ok ? "valid" : "invalid", "expires", before.expires, "scopes", before.scopes.length);
if (process.argv.includes("--check")) process.exit(0);
const r = await fetch(`https://graph.facebook.com/${v}/oauth/access_token?grant_type=fb_exchange_token&client_id=${app}&client_secret=${sec}&fb_exchange_token=${tok}`);
const j = await r.json();
if (!j.access_token) { console.error("refresh failed:", JSON.stringify(j.error || j).slice(0, 200)); process.exit(1); }
const env = fs.readFileSync(".env", "utf8").replace(/^INSTAGRAM_TOKEN=.*$/m, `INSTAGRAM_TOKEN=${j.access_token}`);
fs.writeFileSync(".env", env);
const after = await debug(j.access_token);
console.log("new token stored in .env, expires", after.expires);
