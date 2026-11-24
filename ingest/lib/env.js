// Tiny .env loader, no dependency. Real environment variables win over the file.
import fs from "node:fs";

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

// Model keys. With MATCHA_NO_MODEL=1 (set by ingest/daily.js on every child) the .env file may not put them back.
export const MODEL_KEYS = ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"];
export const noModel = (env = process.env) => env.MATCHA_NO_MODEL === "1";

export function loadEnv(file = ".env", env = process.env) {
  try {
    for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, "utf8")))) {
      if (noModel(env) && MODEL_KEYS.includes(k)) continue;
      if (env[k] === undefined || env[k] === "") env[k] = v;
    }
  } catch { /* no .env: fine */ }
}

loadEnv();
