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
