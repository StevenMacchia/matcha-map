// A static server for site/ that answers like Cloudflare Pages does for the numbers that matter to a speed test:
// Brotli (or gzip) for text types, so "transferred" is what a visitor downloads, and the extensionless city, state and
// brand folders resolve to their index.html. No other behaviour (no _headers, no functions): tools/perf-gate.js and
// `node tools/perf-server.js [port]` use it. Brotli runs at quality 5 (Cloudflare's own default is in that range) and
// the result is cached in memory per file.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".xml", ".webmanifest"]);

export function startServer(port = 0, root = ROOT) {
  const cache = new Map();
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
    let file = path.join(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch { /* 404 below */ }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
      const ext = path.extname(file).toLowerCase(), h = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" };
      const ae = String(req.headers["accept-encoding"] || "");
      let body = buf;
      if (TEXT.has(ext) && buf.length > 512) {
        const enc = /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : "";
        if (enc) {
          const k = enc + ":" + file + ":" + buf.length;
          if (!cache.has(k)) cache.set(k, enc === "br" ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(buf, { level: 6 }));
          body = cache.get(k); h["Content-Encoding"] = enc; h.Vary = "Accept-Encoding";
        }
      }
      h["Content-Length"] = body.length;
      res.writeHead(200, h);
      res.end(req.method === "HEAD" ? undefined : body);
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.argv[2] || process.env.PORT || 8792));
  console.log(`perf-server: http://127.0.0.1:${s.port}/`);
}
