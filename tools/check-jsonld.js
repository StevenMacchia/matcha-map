// Structured data self-check: parses every JSON-LD block in site/e, site/city, site/state and site/brand and checks the fields
// Google needs (Event: name, startDate, location; Organization: name, url; CafeOrCoffeeShop/LocalBusiness: name, address, geo;
// FAQPage: every Question has an acceptedAnswer with text), parseable dates, absolute image URLs, no
// "undefined"/"null"/"NaN" strings, and that no ListItem carries both url and item (a mutually-exclusive pair).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BAD = /\b(undefined|NaN)\b|^null$/;
const isAbs = (u) => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);
const okDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && !isNaN(Date.parse(d));

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkFiles(p, out); else if (n.name === "index.html") out.push(p);
  }
  return out;
}

export function blocksOf(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) out.push(m[1]);
  return out;
}

function checkNode(node, at, err, stats) {
  if (Array.isArray(node)) { node.forEach((x, i) => checkNode(x, `${at}[${i}]`, err, stats)); return; }
  if (node === null) { err(`${at}: null value`); return; }
  if (typeof node === "string") { if (BAD.test(node.trim())) err(`${at}: bad string "${node.slice(0, 40)}"`); return; }
  if (typeof node === "number") { if (!isFinite(node)) err(`${at}: non-finite number`); return; }
  if (typeof node !== "object") return;
  const t = node["@type"];
  if (t === "Event") {
    stats.events++;
    if (!node.name) err(`${at}: Event without name`);
    if (!okDate(node.startDate)) err(`${at}: Event startDate missing or unparseable (${node.startDate})`);
    if (node.endDate != null && !okDate(node.endDate)) err(`${at}: endDate unparseable (${node.endDate})`);
    const loc = node.location;
    if (!loc || !(loc.name || loc.address)) err(`${at}: Event location needs a name or address`);
  }
  if (t === "Organization") {
    stats.orgs++;
    if (!node.name) err(`${at}: Organization without name`);
    // an Event organizer with no known site is fine (Google only recommends a url there); a standalone Organization needs one
    if (node.url !== undefined && !isAbs(node.url)) err(`${at}: Organization url not absolute`);
    else if (node.url === undefined && !/\.organizer$/.test(at)) err(`${at}: Organization url missing`);
  }
  if (t === "CafeOrCoffeeShop" || t === "LocalBusiness") {
    stats.shops++;
    if (!node.name) err(`${at}: ${t} without name`);
    if (!node.address || typeof node.address !== "object" || !node.address.streetAddress || !node.address.addressLocality) err(`${at}: ${t} without a full address`);
    if (!node.geo || !isFinite(node.geo.latitude) || !isFinite(node.geo.longitude)) err(`${at}: ${t} without geo`);
    if (node.aggregateRating !== undefined || node.review !== undefined) err(`${at}: ${t} carries a rating or review`);
  }
  if (t === "FAQPage") {
    stats.faqs++;
    if (!Array.isArray(node.mainEntity) || !node.mainEntity.length) err(`${at}: FAQPage without questions`);
    for (const [i, q] of (node.mainEntity || []).entries()) {
      if (!q || q["@type"] !== "Question" || !q.name) err(`${at}.mainEntity[${i}]: not a named Question`);
      else if (!q.acceptedAnswer || typeof q.acceptedAnswer.text !== "string" || !q.acceptedAnswer.text.trim()) err(`${at}.mainEntity[${i}]: Question without acceptedAnswer.text`);
    }
  }
  if (t === "ListItem" && node.url !== undefined && node.item !== undefined) err(`${at}: ListItem has both url and item`);
  if (t === "ListItem") stats.listItems++;
  for (const k of ["image", "logo"]) {
    if (node[k] === undefined) continue;
    for (const u of [].concat(node[k])) if (!isAbs(typeof u === "object" && u ? u.url : u)) err(`${at}.${k}: not an absolute URL (${String(u).slice(0, 60)})`);
  }
  if (t === "Event" && node.image === undefined && (at.includes("itemListElement") || at.startsWith("city/"))) err(`${at}: ${at.startsWith("city/") ? "city page" : "list"} Event without image`);
  for (const [k, v] of Object.entries(node)) if (k !== "@context") checkNode(v, `${at}.${k}`, err, stats);
}

export function checkSite(siteDir = path.join(root, "site")) {
  const files = [...walkFiles(path.join(siteDir, "e")), ...walkFiles(path.join(siteDir, "city")), ...walkFiles(path.join(siteDir, "state")), ...walkFiles(path.join(siteDir, "brand"))];
  const stats = { files: files.length, blocks: 0, events: 0, orgs: 0, shops: 0, faqs: 0, listItems: 0 };
  const errors = [];
  for (const f of files) {
    const rel = path.relative(siteDir, f).split(path.sep).join("/");
    for (const [i, raw] of blocksOf(fs.readFileSync(f, "utf8")).entries()) {
      stats.blocks++;
      let j;
      try { j = JSON.parse(raw); } catch (e) { errors.push(`${rel} block ${i}: invalid JSON (${e.message})`); continue; }
      checkNode(j, `${rel}#${i}`, (m) => errors.push(m), stats);
    }
  }
  return { stats, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { stats, errors } = checkSite();
  console.log(`jsonld: ${stats.files} pages, ${stats.blocks} blocks, ${stats.events} Event, ${stats.orgs} Organization, ${stats.shops} LocalBusiness, ${stats.faqs} FAQPage, ${stats.listItems} ListItem, ${errors.length} problems`);
  errors.slice(0, 40).forEach((m) => console.log("  " + m));
  if (errors.length > 40) console.log(`  ... ${errors.length - 40} more`);
  // any problem exits 1, and so does a run that found no page to check (a missing or empty site/ must not read as clean)
  if (!stats.files) console.log("  no pages found under site/e, city, state or brand");
  process.exit(errors.length || !stats.files ? 1 : 0);
}
