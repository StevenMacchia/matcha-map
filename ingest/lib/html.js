// Small HTML helpers (no deps): entity decode, strip to text lines, JSON-LD reader.
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };
export function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

// HTML -> array of text lines (block tags become line breaks; scripts and styles dropped).
export function htmlToLines(html) {
  const t = String(html)
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(p|div|li|ul|ol|br|h[1-6]|tr|td|section|article|header|footer|nav|main|a)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(t).split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// All JSON-LD objects on a page (flattens @graph).
export function jsonLd(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const x of Array.isArray(j) ? j : j["@graph"] || [j]) out.push(x);
    } catch { /* skip bad block */ }
  }
  return out;
}

// Content of <meta property|name="..."> (og:image and friends), or null.
export function metaContent(html, key) {
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!k || k[1].toLowerCase() !== key.toLowerCase()) continue;
    const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = c && (c[1] ?? c[2]);
    if (v) return decode(v).trim();
  }
  return null;
}

// First image url out of a JSON-LD "image" value (string, array, or ImageObject), or null.
export function ldImage(v) {
  const x = Array.isArray(v) ? v[0] : v;
  const u = typeof x === "string" ? x : x?.url || x?.contentUrl || null;
  return /^https?:\/\//.test(u || "") ? u : null;
}

// The value when it is an http(s) url, else null.
export const httpUrl = (v) => (typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v) ? v : null);
export const imageUrl = (v) => { const u = httpUrl(v); return u && /\.(jpe?g|png|webp)(\?.*)?$/i.test(u) ? u : null; };
