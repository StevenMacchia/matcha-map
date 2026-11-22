// RSS 2.0 and Atom reader, no dependencies. parseFeed(xml) -> {title, items:[{title, link, published, summary, content, image, categories}]}.
// Text comes out with CDATA unwrapped, tags stripped and entities decoded (the feeds hold HTML summaries).
import { decode } from "./html.js";

const unwrap = (s) => String(s ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
const strip = (s) => decode(unwrap(s)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\/?(p|div|br|li|h[1-6])\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? m[1] : null;
};
const attr = (s, name) => new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, "i").exec(s || "");

export function parseFeed(xml) {
  const text = String(xml || "");
  const atom = /<feed\b/i.test(text);
  const blocks = [...text.matchAll(atom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const head = text.slice(0, text.search(atom ? /<entry\b/i : /<item\b/i) >>> 0 || 2000);
  const title = strip(tag(head, "title") || "");
  const items = blocks.map((b) => {
    let link = null;
    if (atom) {
      for (const m of b.matchAll(/<link\b[^>]*>/gi)) {
        const rel = attr(m[0], "rel");
        if (!rel || (rel[1] ?? rel[2]) === "alternate") { const h = attr(m[0], "href"); if (h) { link = decode(h[1] ?? h[2]); break; } }
      }
    } else link = strip(tag(b, "link") || "") || strip(tag(b, "guid") || "") || null;
    const summary = strip(tag(b, atom ? "summary" : "description") || "");
    const content = strip(tag(b, atom ? "content" : "content:encoded") || "");
    const img = /<(?:media:content|media:thumbnail|enclosure)\b[^>]*\b(?:url)\s*=\s*"([^"]+)"/i.exec(b) || /<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(unwrap(tag(b, atom ? "content" : "content:encoded") || tag(b, atom ? "summary" : "description") || ""));
    const dateStr = strip(tag(b, atom ? "published" : "pubDate") || tag(b, "updated") || tag(b, "dc:date") || "");
    const t = Date.parse(dateStr);
    return {
      title: strip(tag(b, "title") || ""), link, summary, content,
      published: Number.isFinite(t) ? new Date(t).toISOString() : null,
      image: img ? decode(img[1]) : null,
      categories: [...b.matchAll(/<category\b[^>]*?(?:term\s*=\s*"([^"]*)"[^>]*\/?>|>([\s\S]*?)<\/category>)/gi)].map((m) => strip(m[1] || m[2] || "")).filter(Boolean),
    };
  });
  return { title, items };
}
