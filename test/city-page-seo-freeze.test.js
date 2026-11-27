// The city-page redesign may change how a page looks and nothing a search engine reads. This builds every city page with the frozen
// baseline generator (test/fixtures/city-baseline/gen-pages.js, the template at 963dba358) and with tools/gen-pages.js in the new look,
// on the same data, and diffs the parts that matter: URL, canonical, title, description, robots and every other head tag, the H1 and
// H2s, the lead, all JSON-LD, the question and answer text, the links, the word count, the sitemap rows and the lastmod stamps.
// State hubs get the same comparison when they are redesigned (rung 2).
import test from "node:test";
import assert from "node:assert/strict";
import { loadData, buildSite } from "../tools/gen-pages.js";
import { buildSite as buildBaseline } from "./fixtures/city-baseline/gen-pages.js";
import { seoParts, isTpl2 } from "../tools/seo-lib.js";

const data = loadData({ now: new Date() });
data.now = new Date(Date.parse(JSON.stringify(data.generated).slice(1, -1)) || Date.now());
const before = buildBaseline({ ...data, v2: null });
const after = buildSite({ ...data, v2: true });
const cityFiles = [...before.files.keys()].filter((p) => /^city\/.+\/index\.html$/.test(p));

// links the new look may add: the live map at this city or event, and Directions
const NEW_LINK = /^(\/\?(city|event)=|https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=)/;

test("every city page is in the new look and nothing else moved", () => {
  assert.ok(cityFiles.length > 2000, `city pages: ${cityFiles.length}`);
  assert.deepEqual([...after.files.keys()].filter((p) => /^city\//.test(p)).sort(), [...cityFiles].sort(), "same URLs");
  assert.ok(cityFiles.every((p) => isTpl2(after.files.get(p))), "every city page carries the new template marker");
});

test("what a search engine reads from each city page is identical", () => {
  const bad = [];
  let words0 = 0, words1 = 0;
  for (const p of cityFiles) {
    const a = seoParts(before.files.get(p)), b = seoParts(after.files.get(p));
    for (const k of ["seo", "lang", "title", "metas", "links", "h1", "h2", "lead", "intro", "ld", "faq"]) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(`${p}: ${k} moved`);
    }
    const lost = a.hrefs.filter((h) => !b.hrefs.includes(h));
    const added = b.hrefs.filter((h) => !a.hrefs.includes(h) && !NEW_LINK.test(h));
    if (lost.length) bad.push(`${p}: links lost ${lost.slice(0, 3).join(" ")}`);
    if (added.length) bad.push(`${p}: links added ${added.slice(0, 3).join(" ")}`);
    if (b.words < a.words) bad.push(`${p}: words ${a.words} -> ${b.words}`);
    words0 += a.words; words1 += b.words;
    if (bad.length > 20) break;
  }
  assert.deepEqual(bad.slice(0, 20), []);
  assert.ok(words1 >= words0);
});

test("the sitemap and every lastmod stamp come out the same", () => {
  assert.deepEqual(after.urls, before.urls, "sitemap rows");
  assert.equal(after.files.get("sitemap.xml"), before.files.get("sitemap.xml"));
  const moved = Object.keys(before.lastmods).filter((k) => /^city\//.test(k) && before.lastmods[k][1] !== (after.lastmods[k] || [])[1]);
  assert.deepEqual(moved.slice(0, 10), [], "city lastmod stamps that moved");
});

test("structured data blocks are byte for byte the same", () => {
  for (const p of cityFiles.slice(0, 2500)) assert.deepEqual(seoParts(after.files.get(p)).ld, seoParts(before.files.get(p)).ld, p);
});
