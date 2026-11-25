// Menus a cafe keeps on a hosting platform instead of its own page: Square Online and Toast, plus the kinds we cannot read (a PDF, pictures).
// Public pages only, robots.txt respected (the caller's `get` is the fetcher), no login, no private API, no bot-check evasion.
//
//   Square Online (*.square.site and custom domains whose page says <meta name="generator" content="Square Online">): the storefront is drawn by
//   script, but every product has a public page listed in the site's own /sitemap.xml (named in its robots.txt), and the product's name is in
//   its URL ("/product/iced-matcha-latte/<id>") and <title>. The reader takes the matcha products from the sitemap: names only (prices are loaded
//   by script, so they stay null), retail items (powder, tins, whisks, shirts) dropped. Square asks for a 5 second Crawl-delay: one request per site.
//
//   Toast (order.toasttab.com, www.toasttab.com/<slug>/v3): every page we have asked for answers with Cloudflare's "Just a moment" bot check
//   (HTTP 403). That is a bot check, not a paywall, and we do not get around it: the reader recognises the challenge, counts the skip
//   ("toast: bot check, not read") and stops. If a Toast page ever comes back unchallenged, its schema.org Menu JSON-LD is read the same way as any
//   own-site menu (toastMenuFromLd). Verified 2026-11-24 against five NC Toast pages: all challenged.
import { jsonLd, htmlToLines } from "../html.js";
import { menuPdfLinks, readMenuPdfs } from "./pdf-menus.js";

const RETAIL = /\b(powder|tins?|whisks?|chasen|bowls?|chawan|sets?|kits?|totes?|shirts?|tees?|hoodie|balm|samples?|gift ?cards?|bags?|lbs?|oz|grams?|class(?:es)?|workshops?|courses?|merch|candles?|soap|scoops?|spoons?|sifters?|subscriptions?|stickers?|mugs?|tumblers?|caps?|hats?|bundle|blend|pouch)\b/i;
// "Lg Matcha Latte" and "Rg Matcha Latte" are one drink in two sizes.
const SIZE = /^(?:sm|md|med|lg|rg|reg|small|medium|large|regular|\d{1,2}\s?oz|\d{1,2}oz)\s+/i;
const titleCase = (s) => s.replace(/\b([a-z])([a-z']*)/g, (_, a, b) => a.toUpperCase() + b);

export const isSquareOnline = (html, url = "") => /<meta[^>]+name=["']generator["'][^>]+content=["']Square Online/i.test(html || "") || /\.square\.site(?:[/:]|$)/i.test(url);
export const isToastUrl = (u) => /(^|\/\/|\.)(order\.)?toasttab\.com\b/i.test(u || "");
export const toastLinkIn = (html) => (/https?:\/\/(?:order|www)\.toasttab\.com\/[A-Za-z0-9_\-/.]+/i.exec(html || "") || [])[0] || null;
export const isBotCheck = (html, status) => /<title>\s*Just a moment|cf-chl|challenge-platform|Attention Required! \| Cloudflare/i.test(String(html || "").slice(0, 6000)) || (status === 403 && /cloudflare/i.test(String(html || "").slice(0, 6000)));

// "/product/iced-matcha-latte/ABC123" -> "Iced Matcha Latte" (a trailing "-1" duplicate suffix dropped).
export function productNameFromUrl(u) {
  const m = /\/product\/([^/?#]+)/i.exec(u || "");
  if (!m) return null;
  let slug; try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  return titleCase(slug.replace(/-\d{1,2}$/, "").replace(/[-_]+/g, " ").trim().replace(SIZE, "")) || null;
}

// A site's sitemap XML -> its matcha drinks [{ name, price: null }] (distinct, retail items and non-drinks dropped).
export function squareMatchaFromSitemap(xml) {
  const seen = new Set(), out = [], retail = [];
  for (const m of String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const name = productNameFromUrl(m[1]);
    if (!name || !/matcha|hojicha|ceremonial/i.test(name)) continue;
    if (RETAIL.test(name) || name.split(/\s+/).length > 7) { retail.push(name); continue; }
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, price: null });
  }
  return { drinks: out, retail };
}

// Every *.square.site shop sits behind the same service, which answers a burst with 429 and asks for a 5 second Crawl-delay in each site's
// robots.txt: all requests to *.square.site share one gate, 5 seconds apart (a 429 pushes the next one five minutes out).
export const isSquareHost = (u) => { try { return /\.square\.site$/i.test(new URL(u).hostname); } catch { return false; } };
const gapMs = () => (process.env.SQUARE_GAP_MS != null ? +process.env.SQUARE_GAP_MS : 5000);
let squareLast = 0, squareQueue = Promise.resolve();
export function squareGate() {
  const turn = squareQueue.then(async () => { const wait = squareLast + gapMs() - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); squareLast = Date.now(); });
  squareQueue = turn.catch(() => {});
  return turn;
}
export const squareBackoff = () => { squareLast = Math.max(squareLast, Date.now() + 60 * gapMs() - gapMs()); };
// A fetch that takes its turn at the Square gate when the URL is a *.square.site page.
export async function gatedGet(get, url) {
  if (!isSquareHost(url)) return get(url);
  // During a back-off the request is not made at all (workers would only stand in line): it counts as rate limited.
  if (squareLast - Date.now() > 20000) return { ok: false, status: 429, text: "", skipped: true };
  await squareGate();
  const r = await get(url);
  if (r?.status === 429) squareBackoff();
  return r;
}

// -> { drinks, menu_url, reason? } for a Square Online site. One request: the sitemap (public, listed in the site's robots.txt).
export async function readSquareMenu(get, origin) {
  let r; try { r = await gatedGet(get, new URL("/sitemap.xml", origin).href); } catch { return { drinks: [], reason: "square: sitemap not readable" }; }
  if (!r?.ok) return { drinks: [], reason: r?.blocked ? "square: robots disallow" : r?.status === 429 ? "square: rate limited (429)" : "square: no sitemap" };
  const { drinks, retail } = squareMatchaFromSitemap(r.text);
  if (!drinks.length) return { drinks, reason: retail.length ? "square: matcha products are retail items only" : "square: no matcha products listed" };
  return { drinks, menu_url: new URL("/", origin).href };
}

// Toast pages: JSON-LD Menu -> matcha items, for a page that is not behind the bot check.
export function toastMenuFromLd(html) {
  const seen = new Set(), out = [];
  const walk = (n, d = 0) => {
    if (!n || typeof n !== "object" || d > 8) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1));
    if (/MenuItem/i.test([].concat(n["@type"] || []).join(" ")) && n.name && /matcha|hojicha/i.test(String(n.name)) && !RETAIL.test(String(n.name))) {
      const k = String(n.name).toLowerCase();
      if (!seen.has(k)) { seen.add(k); const p = [].concat(n.offers || [])[0]?.price; out.push({ name: String(n.name).trim().slice(0, 80), price: p != null && p !== "" ? `$${Number(p).toFixed(2)}` : null }); }
    }
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, d + 1);
  };
  for (const x of jsonLd(html)) walk(x);
  return out;
}

// After three bot-check answers in one run (and no readable page) the reader stops asking Toast: the answer does not change.
let toastChecked = 0, toastRead = 0;
export const resetToast = () => { toastChecked = 0; toastRead = 0; };
export async function readToastMenu(get, url) {
  if (toastChecked >= 3 && !toastRead) return { drinks: [], reason: "toast: bot check, not read" };
  let r; try { r = await get(url); } catch { return { drinks: [], reason: "toast: not readable" }; }
  if (isBotCheck(r?.text, r?.status)) { toastChecked++; return { drinks: [], reason: "toast: bot check, not read" }; }
  if (!r?.ok) return { drinks: [], reason: r?.blocked ? "toast: robots disallow" : `toast: http ${r?.status}` };
  toastRead++;
  const drinks = toastMenuFromLd(r.text);
  return drinks.length ? { drinks, menu_url: url } : { drinks, reason: "toast: no matcha items in the page" };
}

// Why a menu we cannot read is unreadable: a PDF link, or a menu page that is pictures (several images, no prices in the text).
export function unreadableMenuKind(pages) {
  for (const p of pages) {
    const html = p.html || "";
    if (/<a\b[^>]*href=["'][^"']+\.pdf(?:\?[^"']*)?["'][^>]*>[^<]{0,40}menu/i.test(html) || /<a\b[^>]*href=["'][^"']*menu[^"']*\.pdf/i.test(html)) return "menu is a PDF";
  }
  for (const p of pages.filter((x) => /menu/i.test(x.url))) {
    const imgs = (p.html.match(/<img\b/gi) || []).length;
    const lines = htmlToLines(p.html);
    const priced = lines.filter((l) => /\$\s?\d/.test(l)).length;
    if (imgs >= 2 && priced === 0 && lines.length < 80) return "menu is pictures only";
  }
  return null;
}

// What the hosted-menu step adds to confirmCandidate: pages read from the shop's own site -> { drinks, menu_url } or { reason }.
export async function hostedMenu(pages, get, { toast = true, getPdf = null } = {}) {
  const sq = pages.find((p) => isSquareOnline(p.html, p.url));
  if (sq) return { kind: "square", ...(await readSquareMenu(get, new URL(sq.url).origin)) };
  if (toast) {
    const link = pages.map((p) => toastLinkIn(p.html)).find(Boolean);
    if (link) return { kind: "toast", ...(await readToastMenu(get, link)) };
  }
  // A menu that is a PDF the page links: read its text layer when a downloader is given (otherwise it is counted as unread below).
  const pdfs = getPdf ? menuPdfLinks(pages) : [];
  if (pdfs.length) {
    const r = await readMenuPdfs(pdfs, getPdf);
    const drinks = r.drinks.filter((d) => !RETAIL.test(d.name));
    return { kind: "pdf", drinks, ...(drinks.length ? { menu_url: r.menu_url } : { reason: r.reason || "pdf: no matcha drinks" }) };
  }
  const kind = unreadableMenuKind(pages);
  return kind ? { kind: "unreadable", drinks: [], reason: kind } : null;
}
