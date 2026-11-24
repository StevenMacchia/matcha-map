import test from "node:test";
import assert from "node:assert/strict";
import { productNameFromUrl, squareMatchaFromSitemap, readSquareMenu, isSquareOnline, isBotCheck, toastMenuFromLd, readToastMenu, resetToast, unreadableMenuKind, hostedMenu, isSquareHost } from "../ingest/lib/shops/hosted-menus.js";
import { confirmCandidate } from "../ingest/lib/shops/providers.js";

process.env.SQUARE_GAP_MS = "0";
const sitemap = (...slugs) => `<?xml version="1.0"?><urlset>${slugs.map((s) => `<url><loc>https://x.square.site/product/${s}</loc></url>`).join("")}<url><loc>https://x.square.site/shop/matcha-tea/ABC</loc></url></urlset>`;

test("Square product names come from the sitemap URLs; retail items and categories are dropped", () => {
  assert.equal(productNameFromUrl("https://x.square.site/product/iced-matcha-latte/AB12"), "Iced Matcha Latte");
  assert.equal(productNameFromUrl("https://x.square.site/product/matcha-latte-1/623"), "Matcha Latte");
  const { drinks, retail } = squareMatchaFromSitemap(sitemap("iced-matcha-latte/A", "hot-matcha/B", "strawberry-matcha-cold-foam/C", "organic-matcha-powder-tin/D", "matcha-whisk-set/E", "americano/F", "iced-matcha-latte-1/G"));
  assert.deepEqual(drinks.map((d) => d.name), ["Iced Matcha Latte", "Hot Matcha", "Strawberry Matcha Cold Foam"]);
  assert.ok(retail.includes("Organic Matcha Powder Tin"));
});

test("readSquareMenu reads one sitemap and says why it found nothing", async () => {
  const mk = (res) => async (u) => { assert.ok(/\/sitemap\.xml$/.test(u)); return res; };
  const ok = await readSquareMenu(mk({ ok: true, text: sitemap("matcha-latte/A", "iced-matcha/B", "matcha-lemonade/C") }), "https://x.square.site");
  assert.equal(ok.drinks.length, 3);
  assert.equal(ok.menu_url, "https://x.square.site/");
  assert.equal((await readSquareMenu(mk({ ok: true, text: sitemap("americano/A") }), "https://x.square.site")).reason, "square: no matcha products listed");
  assert.equal((await readSquareMenu(mk({ ok: true, text: sitemap("matcha-powder/A") }), "https://x.square.site")).reason, "square: matcha products are retail items only");
  assert.equal((await readSquareMenu(mk({ ok: false, status: 429, text: "" }), "https://x.square.site")).reason, "square: rate limited (429)");
  assert.equal((await readSquareMenu(mk({ ok: false, status: 404, text: "" }), "https://x.square.site")).reason, "square: no sitemap");
});

test("Square Online is recognised by its generator tag or host", () => {
  assert.ok(isSquareOnline('<meta name="generator" content="Square Online">', "https://shop.com/"));
  assert.ok(isSquareOnline("<html></html>", "https://x.square.site/"));
  assert.ok(!isSquareOnline("<html></html>", "https://shop.com/"));
  assert.ok(isSquareHost("https://x.square.site/a") && !isSquareHost("https://square.com/a"));
});

test("Toast: the Cloudflare bot check is counted, not worked around; an unchallenged page's Menu JSON-LD is read", async () => {
  const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-chl</body></html>';
  assert.ok(isBotCheck(challenge, 403));
  assert.ok(!isBotCheck("<html><title>Menu</title></html>", 200));
  resetToast();
  let calls = 0;
  const get = async () => { calls++; return { ok: false, status: 403, text: challenge }; };
  for (let i = 0; i < 6; i++) assert.equal((await readToastMenu(get, "https://order.toasttab.com/online/x")).reason, "toast: bot check, not read");
  assert.equal(calls, 3, "stops asking after three challenges");
  resetToast();
  const ld = { "@context": "https://schema.org", "@type": "Restaurant", hasMenu: { "@type": "Menu", hasMenuSection: [{ "@type": "MenuSection", hasMenuItem: [{ "@type": "MenuItem", name: "Iced Matcha Latte", offers: { price: "6.5" } }, { "@type": "MenuItem", name: "Drip Coffee" }, { "@type": "MenuItem", name: "Matcha Tin" }] }] } };
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  assert.deepEqual(toastMenuFromLd(html), [{ name: "Iced Matcha Latte", price: "$6.50" }]);
});

test("PDF and picture-only menus are named, not guessed", () => {
  assert.equal(unreadableMenuKind([{ url: "https://a.com/", html: '<a href="/files/menu.pdf">Our Menu</a>' }]), "menu is a PDF");
  assert.equal(unreadableMenuKind([{ url: "https://a.com/menu", html: '<img src="1.jpg"><img src="2.jpg"><p>Menu</p>' }]), "menu is pictures only");
  assert.equal(unreadableMenuKind([{ url: "https://a.com/menu", html: "<ul><li>Matcha Latte $6</li></ul><img src=a><img src=b>" }]), null);
});

test("confirmCandidate turns a Square Online cafe with three matcha products into a serves row, and counts why others are held", async () => {
  const shell = '<html><head><meta name="generator" content="Square Online"><title>Cafe</title></head><body>Cafe<br>12 Main St, Durham, NC 27701</body></html>';
  const pages = (xml, status = 200) => async (u) => (/sitemap\.xml/.test(u) ? { ok: status === 200, status, text: xml } : { ok: true, status: 200, text: shell });
  const cand = { provider: "overture", name: "Cafe Test", address: "12 Main St", city: "Durham", state: "NC", zip: "27701", website: "https://cafetest.com/", hint: "serves-check" };
  const r = await confirmCandidate(cand, pages(sitemap("matcha-latte/A", "iced-matcha/B", "matcha-lemonade/C")), { relaxAddress: true });
  assert.equal(r.row.tier, "serves");
  assert.equal(r.row.menu_matcha.length, 3);
  assert.equal(r.row.menu_url, "https://cafetest.com/");
  const held = await confirmCandidate(cand, pages(sitemap("americano/A")), { relaxAddress: true });
  assert.equal(held.held, "square: no matcha products listed");
});
