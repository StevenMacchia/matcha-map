// tools/seo-gate.js (docs/SEO-RULES.md): each of the nine rules passes on a fixture site tree in a temp dir and fails when the tree breaks it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGate, wordsOutside, stripBoilerplate, faqAnswers } from "../tools/seo-gate.js";
import { hash12, hashInput, subHash, readState, writeState } from "../tools/seo-lib.js";
import { SITE_URL } from "../tools/site-url.js";

const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}w${i}`).join(" ");
const faq = (tag) => `<section class="pg-faq"><h2>Questions</h2>\n<details><summary>Is there one?</summary><p>${tag} answer one with its own numbers ${tag.length}.</p></details>\n<details><summary>How many?</summary><p>${tag} answer two.</p></details>\n</section>`;
const html = ({ key, title, desc, seo, noindex, body, canonical, ld = "" }) => `<!doctype html>
<html lang="en" class="pg"${seo ? ` data-seo="${seo}"` : ""}>
<head>
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canonical === undefined ? `${SITE_URL}/${key}/` : canonical}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}${ld}</head>
<body class="pg">
<header class="pg-top" data-boiler>Matcha Map header text that is the same everywhere</header>
<main>
${body}
</main>
<footer class="pg-foot" data-boiler>Matcha Map footer text</footer>
</body>
</html>
`;

// The default fixture: two indexed cities, one noindex city, one state hub, the /state/ index, a brand, an event, the home page.
const BASE = {
  "city/nc/raleigh": { seo: "u2 s0 b0 n0", body: `<h1>Raleigh</h1><p>${words(160, "ral")}</p>${faq("Raleigh")}` },
  "city/nc/cary": { seo: "u0 s1 b0 n0", body: `<h1>Cary</h1><p>${words(160, "car")}</p>${faq("Cary")}` },
  "city/nc/quietton": { seo: "u0 s0 b0 n0", noindex: true, body: `<h1>Quietton</h1><p>${words(20, "qui")}</p>${faq("Quietton")}` },
  "state/nc": { seo: "u2 s1 c6", body: `<h1>North Carolina</h1><p>${words(160, "nc")}</p>` },
  state: { body: `<h1>States</h1><p>${words(160, "all")}</p>` },
  "brand/moon": { body: `<h1>Moon</h1><p>${words(20, "moon")}</p>` },
  "e/abc123def456": { body: `<h1>Event</h1><p>${words(20, "ev")}</p>` },
};
const SECS = ["a", "b", "c", "d", "e", "f"].map((x) => subHash(x));

// Writes the tree under root. o: { pages: {key: override | null (omit)}, lm: {key: day}, sitemapDrop: [keys], sitemapAdd: [{ loc, lastmod }], robots, headers, redirects,
// home, store: {key: stored entry override}, sections: {key: [6 hashes]} }.
function build(root, o = {}) {
  fs.rmSync(path.join(root, "site"), { recursive: true, force: true }); // data/seo-state.json stays between builds
  const site = path.join(root, "site"), put = (rel, text) => { const f = path.join(site, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const store = {}, rows = [{ loc: SITE_URL + "/", lastmod: "2026-11-20" }];
  const keys = new Set([...Object.keys(BASE), ...Object.keys(o.pages || {})]);
  for (const key of keys) {
    const spec = (o.pages || {})[key];
    if (spec === null) continue;
    const p = { ...BASE[key], ...spec };
    const page = html({ key, title: p.title ?? `Title of ${key}`, desc: p.desc ?? `Description of ${key}`, canonical: p.canonical, seo: p.seo, noindex: p.noindex, body: p.body, ld: p.ld });
    put(key === "state" ? "state/index.html" : `${key}/index.html`, page);
    const lm = (o.lm || {})[key] || "2026-11-20";
    store[key] = [hash12(hashInput(page)), lm, ...(key.startsWith("city/") ? [(o.sections || {})[key] || SECS] : [])];
    if (o.store && o.store[key]) store[key] = o.store[key];
    if (!p.noindex && !(o.sitemapDrop || []).includes(key)) rows.push({ loc: `${SITE_URL}/${key}/`, lastmod: (o.sitemapLm || {})[key] || lm });
  }
  rows.push(...(o.sitemapAdd || []));
  put("index.html", o.home ?? "<!doctype html><html><head><title>Home</title></head><body>home</body></html>");
  put("robots.txt", o.robots ?? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  put("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  if (o.headers) put("_headers", o.headers);
  if (o.redirects) put("_redirects", o.redirects);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "pages-lastmod.json"), JSON.stringify(store));
  return { site, store, rows };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mm-seo-"));
const gate = (root, o = {}) => runGate({ root, dry: true, env: {}, ...o });
const rule = (r, n) => r.results[n - 1];
const fails = (r) => r.results.filter((x) => !x.ok).map((x) => x.n);
// run a body with a fixture root, then clean up
const withRoot = (fn) => { const root = tmp(); try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } };
// the passing baseline: records the state a later run compares with
const baselined = (root, o) => { build(root, o); const r = runGate({ root, baseline: true, env: {} }); assert.deepEqual(fails(r), [], r.lines.join("\n")); return r; };

test("the fixture passes all nine rules; the summary line has the counts; --dry writes no state, a passing run does", () => withRoot((root) => {
  build(root);
  const first = gate(root, { baseline: true });
  assert.deepEqual(fails(first), [], first.lines.join("\n"));
  assert.equal(first.lines.length, 9);
  assert.match(first.summary, /^seo gate: 9 rules, 0 failed; indexable 6, noindex 1, lastmod moved 0, pace queue 0$/);
  assert.equal(readState(root), null, "dry: no state written");
  const real = runGate({ root, baseline: true, env: {} });
  assert.equal(real.wrote, true);
  const s = readState(root);
  assert.deepEqual(s.indexable, ["brand/moon", "city/nc/cary", "city/nc/raleigh", "state", "state/nc"], "the evergreen set: no events, no home");
  assert.ok(s.pages["city/nc/raleigh"] && s.pages["e/abc123def456"], "the snapshot of the per-page store");
  const next = gate(root);
  assert.deepEqual(fails(next), [], next.lines.join("\n"));
  assert.match(rule(next, 9).msg, /^0 newly indexable/);
}));

// ---- rule 1 ----
test("rule 1: a city page's robots meta and sitemap entry must follow its own data-seo counts", () => withRoot((root) => {
  const bad = (pages, o) => { build(root, { pages, ...o }); return rule(gate(root, { baseline: true }), 1); };
  assert.equal(bad({ "city/nc/quietton": { seo: "u0 s0 b0 n2" } }).ok, true, "two other cities earn nothing");
  const a = bad({ "city/nc/quietton": { seo: "u0 s0 b0 n3" } });
  assert.equal(a.ok, false);
  assert.match(a.examples[0], /city\/nc\/quietton: counts u0 s0 b0 n3 say indexable, the page is noindex/);
  assert.equal(bad({ "city/nc/cary": { seo: "u0 s0 b1 n2", noindex: false } }).ok, false, "one brand with a picture, two cities: the page claims an index it did not earn");
  assert.equal(bad({ "city/nc/cary": { seo: "u0 s0 b2 n0" } }).ok, true, "two brands with a picture earn it");
  assert.equal(bad({}, { sitemapDrop: ["city/nc/raleigh"] }).ok, false, "indexable but missing from the sitemap");
  assert.match(bad({ "city/nc/cary": { seo: undefined } }).examples[0], /no data-seo summary/);
  assert.equal(bad({ "city/nc/cary": { noindex: true } }).ok, false, "earned an index but carries noindex");
}));

// ---- rule 2 ----
test("rule 2: lastmod holds when the content holds, moves with a reason when a section moved, and the printed date is the page's own", () => withRoot((root) => {
  baselined(root);
  const same = gate(root);
  assert.equal(same.moved, 0);
  // moved without a change in content
  build(root, { lm: { "city/nc/raleigh": "2026-11-23" } });
  const bad = rule(gate(root), 2);
  assert.equal(bad.ok, false);
  assert.match(bad.examples[0], /city\/nc\/raleigh: lastmod moved 2026-11-20 to 2026-11-23 with no change in content/);
  // moved with a change: a new event (intro and events sections) and a nearby change
  const sec = (...idx) => SECS.map((h, i) => (idx.includes(i) ? subHash("changed" + i) : h));
  build(root, { pages: { "city/nc/raleigh": { body: `<h1>Raleigh</h1><p>${words(161, "ral")}</p>${faq("Raleigh")}` }, "city/nc/cary": { body: `<h1>Cary</h1><p>${words(161, "car")}</p>${faq("Cary")}` } }, lm: { "city/nc/raleigh": "2026-11-23", "city/nc/cary": "2026-11-23" }, sections: { "city/nc/raleigh": sec(0, 1, 5), "city/nc/cary": sec(4, 5) } });
  const ok = gate(root);
  assert.deepEqual(fails(ok), [], ok.lines.join("\n"));
  assert.equal(ok.moved, 2);
  assert.match(rule(ok, 2).msg, /lastmod moved on 2 \(nearby changed 1, new or removed event 1\)/);
  // the page printing a date that is not its lastmod
  const withDate = (day) => `<h1>Raleigh</h1><p>1 upcoming pop-up, updated ${day}. ${words(160, "ral")}</p>${faq("Raleigh")}`;
  build(root, { pages: { "city/nc/raleigh": { body: withDate("Nov 23, 2026") } }, lm: { "city/nc/raleigh": "2026-11-20" } });
  assert.match(rule(gate(root), 2).examples[0], /city\/nc\/raleigh: Updated line prints Nov 23, 2026, its lastmod is 2026-11-20/);
  build(root, { pages: { "city/nc/raleigh": { body: withDate("Nov 20, 2026") } }, lm: { "city/nc/raleigh": "2026-11-20" } });
  assert.equal(rule(gate(root), 2).ok, true, "the printed date is the stored lastmod");
  // the sitemap and the store must agree; a page edited after the store was written is caught
  build(root, { sitemapLm: { "city/nc/cary": "2026-11-21" } });
  assert.match(rule(gate(root), 2).examples[0], /sitemap lastmod 2026-11-21 is not the stored 2026-11-20/);
  build(root, { store: { "city/nc/cary": ["0123456789ab", "2026-11-20", SECS] } });
  assert.match(rule(gate(root), 2).examples[0], /changed after data\/pages-lastmod\.json was written/);
}));

// ---- rule 3 ----
test("rule 3: a published city or state page never goes missing; a missing event or brand page needs a 301 line; a live page has none", () => withRoot((root) => {
  baselined(root);
  build(root, { pages: { "city/nc/quietton": null } });
  assert.match(rule(gate(root), 3).examples[0], /\/city\/nc\/quietton\/: a published city page is missing/);
  build(root, { pages: { "state/nc": null } });
  assert.equal(rule(gate(root), 3).ok, false);
  build(root, { pages: { "e/abc123def456": null } });
  assert.match(rule(gate(root), 3).examples[0], /\/e\/abc123def456\/: published before, missing now, and no 301/);
  build(root, { pages: { "e/abc123def456": null, "brand/moon": null }, redirects: "# generated\n/e/abc123def456/ /city/nc/raleigh/ 301\n/brand/moon/ / 301\n" });
  const ok = rule(gate(root), 3);
  assert.equal(ok.ok, true, ok.examples.join("; "));
  build(root, { redirects: "/city/nc/raleigh/ / 301\n" });
  assert.match(rule(gate(root), 3).examples[0], /a 301 line on a path that is a live page hides it/);
}));

// ---- rule 4 ----
test("rule 4: titles and descriptions are unique and every page has exactly one canonical equal to its own address", () => withRoot((root) => {
  const r4 = (pages) => { build(root, { pages }); return rule(gate(root, { baseline: true }), 4); };
  assert.equal(r4({}).ok, true);
  assert.match(r4({ "city/nc/cary": { title: "Title of city/nc/raleigh" } }).examples[0], /title "Title of city\/nc\/raleigh" on 2 pages/);
  assert.match(r4({ "city/nc/cary": { desc: "Description of city/nc/raleigh" } }).examples[0], /description .* on 2 pages/);
  assert.match(r4({ "city/nc/cary": { canonical: `${SITE_URL}/city/nc/raleigh/` } }).examples[0], /canonical .*expected https:\/\/matchamap\.app\/city\/nc\/cary\//);
  assert.match(r4({ "city/nc/cary": { canonical: `${SITE_URL}/city/nc/cary` } }).examples[0], /canonical/, "a missing trailing slash is a different address");
  assert.match(r4({ "city/nc/cary": { canonical: "https://example.com/city/nc/cary/" } }).examples[0], /canonical/);
  assert.match(r4({ "city/nc/cary": { ld: '<link rel="canonical" href="https://matchamap.app/city/nc/cary/">\n' } }).examples[0], /2 canonical links/);
  const none = r4({ "city/nc/cary": { canonical: null } });
  assert.equal(none.ok, false);
}));

// ---- rule 5 ----
test("rule 5: an indexed city or state page needs 150 words outside the boilerplate; no FAQ answer on more than 5% of indexed pages", () => withRoot((root) => {
  const r5 = (pages) => { build(root, { pages }); return rule(gate(root, { baseline: true }), 5); };
  assert.equal(r5({}).ok, true);
  assert.match(r5({ "city/nc/cary": { body: `<h1>Cary</h1><p>${words(100, "car")}</p>${faq("Cary")}` } }).examples[0], /city\/nc\/cary: \d+ words outside the boilerplate, need 150/);
  // boilerplate does not count: a big data-boiler block, a nav, headings and summaries add nothing
  const padded = `<h1>Cary</h1><p>${words(100, "car")}</p><p data-boiler>${words(300, "boil")}</p><nav>${words(300, "nav")}</nav><section data-boiler><div>${words(300, "inner")}</div><p>${words(50, "nested")}</p></section><h2>${words(100, "head")}</h2>${faq("Cary")}`;
  assert.equal(r5({ "city/nc/cary": { body: padded } }).ok, false);
  assert.equal(r5({ "state/nc": { body: `<h1>NC</h1><p>${words(10, "x")}</p>` } }).ok, false, "state hubs too");
  assert.equal(r5({ "city/nc/quietton": { body: "<p>short</p>" } }).ok, true, "a noindex page may be thin");
  // the same answer on two of two indexed city pages is more than 5%
  const same = (tag) => `<h1>${tag}</h1><p>${words(160, tag)}</p><section><details><summary>Q</summary><p>The one answer everywhere.</p></details></section>`;
  const r = r5({ "city/nc/raleigh": { body: same("ral") }, "city/nc/cary": { body: same("car") } });
  assert.equal(r.ok, false);
  assert.match(r.examples[0], /FAQ answer on 2 of 2 indexable city pages \(limit 1\): "The one answer everywhere\./);
  // helpers
  assert.deepEqual(faqAnswers(`<details><summary>Q</summary><p>A1</p></details><details><summary>R</summary><p>A2</p></details>`), ["A1", "A2"]);
  assert.equal(wordsOutside("<body><header>one two</header><p>three four</p><p data-boiler>five<span>six</span></p><img src=x><p>seven</p><script>eight nine</script></body>"), 3);
  assert.equal(stripBoilerplate("<div>a<section data-boiler><div>b</div>c</section>d</div>").replace(/<[^>]*>/g, ""), "ad");
}));

// ---- rule 6 ----
test("rule 6: the sitemap lists only pages that exist without noindex, with YYYY-MM-DD lastmods, split under the limits, and robots.txt names it", () => withRoot((root) => {
  const r6 = (o, g) => { build(root, o); return rule(gate(root, { baseline: true, ...g }), 6); };
  assert.equal(r6({}).ok, true);
  assert.match(r6({ sitemapAdd: [{ loc: `${SITE_URL}/city/nc/ghost/`, lastmod: "2026-11-20" }] }).examples[0], /\/city\/nc\/ghost\/: in the sitemap, no file/);
  assert.match(r6({ sitemapAdd: [{ loc: `${SITE_URL}/city/nc/quietton/`, lastmod: "2026-11-20" }] }).examples[0], /in the sitemap and noindex/);
  assert.match(r6({ sitemapAdd: [{ loc: `${SITE_URL}/city/nc/cary/`, lastmod: "2026-11-20" }] }).examples[0], /listed twice/);
  assert.match(r6({ lm: { "city/nc/cary": "20/11/2026" } }).examples[0], /lastmod "20\/11\/2026" is not YYYY-MM-DD/);
  assert.match(r6({ lm: { "city/nc/cary": "2026-13-45" } }).examples[0], /not YYYY-MM-DD/);
  assert.match(r6({ sitemapAdd: [{ loc: "https://example.com/x/", lastmod: "2026-11-20" }] }).examples[0], /not under https:\/\/matchamap\.app/);
  assert.match(r6({ robots: "User-agent: *\nAllow: /\n" }).examples[0], /robots\.txt does not name/);
  assert.match(r6({}, { limits: { file: 3 } }).examples[0], /sitemap\.xml: 7 URLs, the limit is 3/);
  assert.match(r6({}, { limits: { split: 3 } }).examples[0], /past 3 it must be an index/);
  // an index over parts: each part counted, a part over the limit fails; a split under the limit passes
  const site = path.join(root, "site"), rows = fs.readFileSync(path.join(site, "sitemap.xml"), "utf8").match(/<url>.*?<\/url>/g);
  const urlset = (r) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${r.join("\n")}\n</urlset>\n`;
  fs.writeFileSync(path.join(site, "sitemap-1.xml"), urlset(rows.slice(0, 4)));
  fs.writeFileSync(path.join(site, "sitemap-2.xml"), urlset(rows.slice(4)));
  fs.writeFileSync(path.join(site, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<sitemap><loc>${SITE_URL}/sitemap-1.xml</loc></sitemap>\n<sitemap><loc>${SITE_URL}/sitemap-2.xml</loc></sitemap>\n</sitemapindex>\n`);
  const split = rule(gate(root, { baseline: true, limits: { split: 3, file: 5 } }), 6);
  assert.equal(split.ok, true, split.examples.join("; "));
  assert.match(split.msg, /7 URLs in 3 files/);
  assert.match(rule(gate(root, { baseline: true, limits: { split: 3, file: 3 } }), 6).examples[0], /sitemap-1\.xml: 4 URLs, the limit is 3/);
}));

// ---- rule 7 ----
test("rule 7: the structured-data check runs in the gate and any problem fails it", () => withRoot((root) => {
  const ld = (j) => `<script type="application/ld+json">${j}</script>\n`;
  const r7 = (j) => { build(root, { pages: { "city/nc/cary": { ld: ld(j) } } }); return rule(gate(root, { baseline: true }), 7); };
  assert.equal(r7(JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "A", startDate: "2026-11-28T11:00:00-05:00", location: { "@type": "Place", name: "X" }, image: ["https://matchamap.app/og.png"] })).ok, true);
  assert.match(r7("{ not json").examples[0], /invalid JSON/);
  assert.match(r7(JSON.stringify({ "@type": "Event", name: "A", startDate: "soon", location: { name: "X" } })).examples[0], /startDate/);
  assert.match(r7(JSON.stringify({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q" }] })).examples[0], /acceptedAnswer/);
  // an empty site must not read as clean
  fs.rmSync(path.join(root, "site", "city"), { recursive: true });
  for (const d of ["state", "brand", "e"]) fs.rmSync(path.join(root, "site", d), { recursive: true, force: true });
  assert.match(rule(gate(root, { baseline: true }), 7).examples[0], /no pages found/);
}));

// ---- rule 8 ----
test("rule 8: robots.txt, the home page and _headers never block the home, the hubs, the cities, /weekend, /e, /brand", () => withRoot((root) => {
  const r8 = (o) => { build(root, o); return rule(gate(root, { baseline: true }), 8); };
  const sm = `Sitemap: ${SITE_URL}/sitemap.xml\n`;
  assert.equal(r8({}).ok, true);
  assert.equal(r8({ robots: `User-agent: *\nDisallow: /admin/\nDisallow: /claim/\n\n${sm}` }).ok, true, "other paths may be closed");
  for (const d of ["/", "/city", "/city/", "/state", "/weekend", "/e", "/brand/", "/c", "/*", "/e/*"]) {
    const r = r8({ robots: `User-agent: *\nDisallow: ${d}\n\n${sm}` });
    assert.equal(r.ok, false, "Disallow: " + d);
    assert.match(r.examples[0], /robots\.txt: Disallow: /);
  }
  assert.equal(r8({ robots: `User-agent: Googlebot\nUser-agent: *\nDisallow: /city/\n\n${sm}` }).ok, false, "a group naming several agents");
  assert.equal(r8({ robots: `User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n\n${sm}` }).ok, true, "a block for another agent only");
  assert.match(r8({ home: '<html><head><meta name="robots" content="noindex"></head></html>' }).examples[0], /home page carries noindex/);
  assert.match(r8({ headers: "/*\n  X-Robots-Tag: noindex\n" }).examples[0], /X-Robots-Tag/);
  assert.equal(r8({ headers: "/*\n  X-Content-Type-Options: nosniff\n" }).ok, true);
  // a state hub with pop-ups and enough cities is never noindex; a hub of too few cities is
  assert.match(r8({ pages: { "state/nc": { noindex: true } } }).examples[0], /state\/nc: u2 s1 c6 says indexable, the page is noindex/);
  assert.equal(r8({ pages: { "state/nc": { seo: "u2 s1 c4", noindex: true } } }).ok, true, "fewer than 5 cities: noindex is the rule");
  assert.equal(r8({ pages: { "state/nc": { seo: "u2 s1 c4" } } }).ok, false);
}));

// ---- rule 9 ----
test("rule 9: a pace breach never refuses; the gate reports admitted and waiting pages, and fails only when the queue holds a page already indexed", () => withRoot((root) => {
  build(root);
  const none = runGate({ root, dry: true, env: {} });
  assert.equal(rule(none, 9).ok, true, "no previous state is the baseline, not a failure");
  assert.match(rule(none, 9).msg, /^no previous state; this run's 5 indexable pages are the baseline, 0 earned and waiting/);
  baselined(root);
  const more = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`city/nc/new${i}`, { seo: "u1 s0 b0 n0", body: `<h1>New ${i}</h1><p>${words(160, "new" + i)}</p>${faq("New" + i)}` }]));
  build(root, { pages: more(5) });
  const five = runGate({ root, dry: true, env: { SEO_PACE_LIMIT: "4" } });
  assert.equal(rule(five, 9).ok, true, "more newly indexable pages than the cap is reported, never refused");
  assert.match(rule(five, 9).msg, /^5 newly indexable admitted \(cap 4 city pages per run\), 0 earned and waiting in the pace queue, 0 new event pages, 0 no longer indexable$/);
  assert.match(runGate({ root, dry: true, env: {} }).summary, /, pace queue 0$/);
  // 151 new pages and 301 new event pages pass as well
  build(root, { pages: { ...more(151), ...Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`e/ev${String(i).padStart(6, "0")}`, { body: "<p>x</p>" }])) } });
  const flood = runGate({ root, dry: true, env: {} });
  assert.equal(rule(flood, 9).ok, true);
  assert.match(rule(flood, 9).msg, /^151 newly indexable admitted \(cap 100 city pages per run\), 0 earned and waiting in the pace queue, 301 new event pages/);
  // a page waiting in the queue: earned by its counts, noindex, out of the sitemap, " q" in data-seo; rule 1 accepts it, rule 9 counts it
  build(root, { pages: { "city/nc/waiting": { seo: "u0 s1 b0 n0 q", noindex: true, body: `<h1>Waiting</h1><p>${words(160, "wai")}</p>${faq("Waiting")}` } } });
  const q = runGate({ root, dry: true, env: {} });
  assert.deepEqual(fails(q), [], q.lines.join("\n"));
  assert.match(rule(q, 1).msg, /4 city pages, 2 indexable, 1 earned and waiting in the pace queue, 1 noindex/);
  assert.match(rule(q, 9).msg, /, 1 earned and waiting in the pace queue,/);
  assert.match(q.summary, /, pace queue 1$/);
  // " q" on a page whose counts do not earn an index is a rule 1 failure
  const fake = runGate({ root: (build(root, { pages: { "city/nc/fake": { seo: "u0 s0 b0 n0 q", noindex: true, body: `<h1>Fake</h1><p>${words(20, "fak")}</p>` } } }), root), dry: true, env: {} });
  assert.match(rule(fake, 1).examples[0], /city\/nc\/fake: counts u0 s0 b0 n0 q do not earn an index, yet the page is marked as waiting/);
  // a queued page the last passing run indexed is a demotion: the one thing rule 9 fails on
  build(root, { pages: { "city/nc/cary": { seo: "u0 s1 b0 n0 q", noindex: true } } });
  const demoted = runGate({ root, dry: true, env: {} });
  assert.equal(rule(demoted, 9).ok, false);
  assert.match(rule(demoted, 9).examples[0], /^1 pages the last passing run indexed are waiting in the pace queue \(the queue never demotes\): city\/nc\/cary/);
  // a failed run does not move the state forward; a passing one does
  const before = JSON.stringify(readState(root));
  const failed = runGate({ root, env: {} });
  assert.ok(failed.failed > 0 && !failed.wrote);
  assert.equal(JSON.stringify(readState(root)), before);
}));

test("the state file keeps the other owners' keys when the gate writes its own", () => withRoot((root) => {
  build(root);
  writeState(root, { registry: { events: { a: "nc/raleigh" }, brands: {} }, gone: { "/e/x/": "/" } });
  const r = runGate({ root, baseline: true, env: {} });
  assert.equal(r.wrote, true);
  const s = readState(root);
  assert.deepEqual(s.registry.events, { a: "nc/raleigh" });
  assert.deepEqual(s.gone, { "/e/x/": "/" });
  assert.ok(s.indexable.length && s.pages);
}));
