import test from "node:test";
import assert from "node:assert/strict";
import { menuPdfLinks, pdfLines, readMenuPdfs } from "../ingest/lib/shops/pdf-menus.js";
import { hostedMenu } from "../ingest/lib/shops/hosted-menus.js";
import { confirmCandidate } from "../ingest/lib/shops/providers.js";
import { matchaDrinksFromLines } from "../ingest/lib/shops/drinks.js";

// A one-page PDF built by hand: each [x, y, text] is drawn in Helvetica 12. No text at all makes a "scanned" page.
function makePdf(texts) {
  const stream = texts.map(([x, y, t]) => `BT /F1 12 Tf ${x} ${y} Td (${t.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const MENU = makePdf([[72, 700, "DRINK MENU - tea and coffee and everything else"], [72, 670, "Matcha Latte"], [300, 670, "6.50"], [72, 650, "Iced Matcha Latte"], [300, 650, "6.50"], [72, 630, "Strawberry Matcha"], [300, 630, "7.00"], [72, 610, "Americano"], [300, 610, "4.00"]]);

test("a menu PDF's text layer is read into lines, a price column staying a separate segment", async () => {
  const lines = await pdfLines(MENU);
  assert.ok(lines.includes("Matcha Latte"), JSON.stringify(lines));
  assert.ok(lines.includes("6.50"));
  assert.deepEqual(matchaDrinksFromLines(lines, { bare: true }).map((d) => d.name), ["Matcha Latte", "Iced Matcha Latte", "Strawberry Matcha"]);
});

test("a PDF with no text layer reads as null", async () => {
  assert.equal(await pdfLines(makePdf([])), null);
});

test("menuPdfLinks finds the PDFs a page calls a menu, not other PDFs", () => {
  const html = '<a href="/files/drink-menu.pdf">Drinks</a> <a href="https://cdn.x.com/a.pdf?v=2">Our Menu</a> <a href="/press-kit.pdf">Press</a> <a href="/files/drink-menu.pdf">again</a>';
  assert.deepEqual(menuPdfLinks([{ url: "https://cafe.com/menu", html }]).sort(), ["https://cafe.com/files/drink-menu.pdf", "https://cdn.x.com/a.pdf?v=2"]);
  assert.deepEqual(menuPdfLinks([{ url: "https://cafe.com/", html: "<p>no links</p>" }]), []);
});

test("readMenuPdfs gives drinks and the PDF's URL, or the reason it could not", async () => {
  const ok = await readMenuPdfs(["https://c.com/a.pdf"], async () => ({ ok: true, bytes: MENU }));
  assert.equal(ok.drinks.length, 3);
  assert.equal(ok.menu_url, "https://c.com/a.pdf");
  assert.equal((await readMenuPdfs(["https://c.com/a.pdf"], async () => ({ ok: true, bytes: makePdf([]) }))).reason, "pdf: scanned, no text layer");
  assert.equal((await readMenuPdfs(["https://c.com/a.pdf"], async () => ({ ok: true, bytes: makePdf([[72, 700, "Americano and espresso and drip coffee, hot or iced"]]) }))).reason, "pdf: no matcha drinks");
  assert.equal((await readMenuPdfs(["https://c.com/a.pdf"], async () => ({ ok: false, why: "http 404" }))).reason, "pdf: not readable (http 404)");
});

test("without a PDF downloader the PDF stays counted as unread; with one, a cafe whose menu is a PDF becomes a serves row", async () => {
  const page = '<html><body><h1>Cafe</h1><address>12 Main St, Raleigh, NC 27601</address><a href="/menu.pdf">Menu</a></body></html>';
  const pages = [{ url: "https://cafe.com/", html: page }];
  assert.equal((await hostedMenu(pages, async () => ({ ok: false }))).reason, "menu is a PDF");
  const hm = await hostedMenu(pages, async () => ({ ok: false }), { getPdf: async () => ({ ok: true, bytes: MENU }) });
  assert.equal(hm.kind, "pdf");
  assert.equal(hm.drinks.length, 3);
  assert.equal(hm.menu_url, "https://cafe.com/menu.pdf");
  const get = async (u) => (u === "https://cafe.com/" ? { ok: true, status: 200, text: page } : { ok: false, status: 404, text: "" });
  const cand = { provider: "overture", name: "Cafe", address: "12 Main St", city: "Raleigh", state: "NC", zip: "27601", website: "https://cafe.com/", hint: "serves-check" };
  const r = await confirmCandidate(cand, get, { relaxAddress: true, getPdf: async () => ({ ok: true, bytes: MENU }) });
  assert.equal(r.row?.tier, "serves");
  assert.equal(r.row.menu_url, "https://cafe.com/menu.pdf");
  assert.equal((await confirmCandidate(cand, get, { relaxAddress: true })).held, "menu is a PDF");
  assert.equal((await confirmCandidate(cand, get, { relaxAddress: true, getPdf: async () => ({ ok: true, bytes: makePdf([]) }) })).held, "pdf: scanned, no text layer");
});
