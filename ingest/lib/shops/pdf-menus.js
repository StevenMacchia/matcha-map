// A cafe's menu that is a PDF linked from its own site: download the PDF the page links, read its text layer, run the same drink counter as for an HTML menu.
// Public files only: robots.txt respected (the fetcher's `allowed`), one request a second to a host, size capped. A PDF with no text layer (a scan or a
// poster made of pictures) is not read and is counted ("pdf: scanned, no text layer"): no OCR here.
import { UA } from "../fetch.js";
import { matchaDrinksFromLines } from "./drinks.js";

// PDF text is noisier than a page's: a heading ("MATCHA AND TEA", "MATCHA + NON-COFFEE"), a bullet ("- Matcha, Chai, Honey Lavender") or a list of flavours is not one drink.
// Letters, spaces, apostrophes, hyphens between letters and a bracketed note only; no digit, slash, bar, bullet, "and"/"or"/"with", no one-letter word.
export const pdfDrinkOk = (name) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ()-]*$/.test(name) && !/--|-$|\b(and|or|with|using|prepared|from|served|made)\b/i.test(name) && !/(^|\s)[A-Za-zÀ-ÿ](\s|$)/.test(name.replace(/\([^)]*\)/g, "")) && name.split(/\s+/).length <= 6;
// "Matcha Latte  6.50 /" -> "Matcha Latte": a price or separator left on the end of the line is not part of the name.
export const cleanPdfName = (name) => String(name || "").replace(/[\s/|•*.$\d-]+$/, "").replace(/\s+/g, " ").trim();

export const MAX_PDF_BYTES = 6 * 1024 * 1024;
const MAX_PAGES = 12, MAX_PDFS = 3, READ_MS = 25000, MIN_TEXT_CHARS = 40, GAP = 20;

const LINK_TEXT = /<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>[^<]{0,40}menu/gi;
const LINK_HREF = /<a\b[^>]*href=["']([^"']*menu[^"']*\.pdf(?:\?[^"']*)?)["']/gi;

// The pages read from a site -> the menu PDFs they link (absolute URLs, distinct, at most three: "Drink Menu", "Food Menu", ...).
export function menuPdfLinks(pages) {
  const out = [];
  for (const p of pages || []) {
    for (const re of [LINK_TEXT, LINK_HREF]) {
      re.lastIndex = 0;
      for (const m of String(p.html || "").matchAll(re)) {
        let u; try { u = new URL(m[1].replace(/&amp;/g, "&"), p.url).href; } catch { continue; }
        if (/^https?:/i.test(u) && !out.includes(u)) out.push(u);
      }
    }
  }
  return out.slice(0, MAX_PDFS);
}

// PDF bytes -> lines of text, or null when there is no text layer. Items on one baseline make a line; a wide gap (a second column) starts a new one.
export async function pdfLines(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const lines = [];
  let chars = 0;
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const items = (await page.getTextContent()).items.filter((i) => typeof i.str === "string" && i.str.trim());
      const rows = [];
      for (const it of items) {
        const y = it.transform[5], row = rows.find((r) => Math.abs(r.y - y) < 3);
        (row || rows[rows.push({ y, items: [] }) - 1]).items.push(it);
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let seg = "", end = null;
        for (const it of r.items) {
          if (end != null && it.transform[4] - end > GAP && seg) { lines.push(seg.trim()); seg = ""; }
          seg += (seg && !/\s$/.test(seg) && !/^\s/.test(it.str) ? " " : "") + it.str;
          end = it.transform[4] + (it.width || 0);
        }
        if (seg.trim()) lines.push(seg.trim());
      }
      page.cleanup();
    }
  } finally { await doc.destroy().catch(() => {}); }
  for (const l of lines) chars += l.length;
  return chars >= MIN_TEXT_CHARS ? lines.map((l) => l.replace(/\s+/g, " ")) : null;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// -> async (url) => { ok, bytes } | { ok:false, why } : a download through the shared fetcher's robots rule and per-host pace.
export function createPdfGetter(fetcher) {
  return async (url) => {
    try {
      if (!(await fetcher.allowed(url))) return { ok: false, why: "robots" };
      await fetcher.throttle(new URL(url).host);
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/pdf" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
      if (!res.ok) return { ok: false, why: `http ${res.status}` };
      if (+res.headers.get("content-length") > MAX_PDF_BYTES) return { ok: false, why: "too big" };
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_PDF_BYTES) return { ok: false, why: "too big" };
      if (!bytes.subarray(0, 1024).includes("%PDF")) return { ok: false, why: "not a pdf" };
      return { ok: true, bytes };
    } catch (e) { return { ok: false, why: String(e.cause?.code || e.message || e).slice(0, 40) }; }
  };
}

// The PDFs a site links -> { drinks, menu_url } (the first PDF that lists matcha drinks adds to the same list) or { drinks: [], reason }.
export async function readMenuPdfs(urls, getPdf) {
  const drinks = [], seen = new Set();
  let menuUrl = null, text = 0, scanned = 0, failed = 0, why = "";
  for (const url of urls) {
    const r = await getPdf(url);
    if (!r?.ok) { failed++; why ||= r?.why || ""; continue; }
    let lines; try { lines = await withTimeout(pdfLines(r.bytes), READ_MS); } catch (e) { failed++; why ||= String(e.message || e).slice(0, 30); continue; }
    if (!lines) { scanned++; continue; }
    text++;
    for (const d of matchaDrinksFromLines(lines, { bare: true }).map((x) => ({ ...x, name: cleanPdfName(x.name) })).filter((x) => pdfDrinkOk(x.name))) if (!seen.has(d.name.toLowerCase())) { seen.add(d.name.toLowerCase()); drinks.push(d); menuUrl ||= url; }
  }
  if (drinks.length) return { drinks, menu_url: menuUrl };
  return { drinks, reason: text ? "pdf: no matcha drinks" : scanned ? "pdf: scanned, no text layer" : `pdf: not readable${why ? ` (${why})` : ""}` };
}
