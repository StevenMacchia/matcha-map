// npm run sw-version (also the first step of `npm run deploy`): stamp site/sw.js VERSION with a short hash of the shell files it
// precaches, so any change to the shell installs a new worker and drops the old cache. Prints the version; exits 0 when unchanged.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SITE = path.resolve("site");
const swPath = path.join(SITE, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
const list = /var SHELL = \[([\s\S]*?)\];/.exec(sw);
if (!list) { console.error("sw.js: SHELL list not found"); process.exit(1); }
const files = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((u) => u !== "/");
const h = crypto.createHash("sha256");
for (const u of files) {
  const p = path.join(SITE, u);
  if (!fs.existsSync(p)) { console.error(`sw.js precaches a missing file: ${u}`); process.exit(1); }
  h.update(u).update(fs.readFileSync(p));
}
h.update(sw.replace(/var VERSION = "[^"]*";/, "")); // the worker's own code counts too
const version = "mm-" + h.digest("hex").slice(0, 10);
const next = sw.replace(/var VERSION = "[^"]*";/, `var VERSION = "${version}";`);
if (next !== sw) fs.writeFileSync(swPath, next);

// index.html: every local script and stylesheet link carries ?v=<version>, so a browser that cached the old file under a
// day-long max-age still fetches the new one the moment the page changes. The service worker matches with ignoreSearch.
const htmlPath = path.join(SITE, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const stamped = html.replace(/((?:src|href)=")(?!https?:|\/\/)([^"?#]+\.(?:js|css))(?:\?v=[^"#]*)?(")/g, (m, a, file, b) => `${a}${file}?v=${version}${b}`);
if (stamped !== html) fs.writeFileSync(htmlPath, stamped);
console.log(`sw.js VERSION ${version}${next === sw ? " (unchanged)" : ""}; index.html links ${stamped === html ? "already" : "now"} stamped`);
