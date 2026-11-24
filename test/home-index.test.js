// The home page footer index (tools/gen-pages.js citiesBlock between the cities markers in site/index.html).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("the committed home page carries the footer index: the 50 biggest cities and every state hub, after the list, inside the list panel", () => {
  const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  const nav = /<section id="list-panel"[\s\S]*?<ul id="list" class="list"><\/ul>\s*<nav class="home-index" aria-label="[^"]+">([\s\S]*?)<\/nav>\s*<\/section>/.exec(html);
  assert.ok(nav, "the index sits after #list inside #list-panel (the smoke counts only #list rows)");
  const cityLinks = [...nav[1].matchAll(/<li><a href="\/city\/([a-z]{2})\/([^/]+)\/">/g)];
  assert.equal(cityLinks.length, 50);
  const top = JSON.parse(fs.readFileSync(new URL("../data/cities.json", import.meta.url), "utf8")).cities.sort((a, b) => b.pop - a.pop)[0];
  assert.equal(`${cityLinks[0][1]}/${cityLinks[0][2]}`, `${top.state.toLowerCase()}/${top.slug}`, "biggest first");
  assert.equal([...nav[1].matchAll(/<li><a href="\/state\/[a-z]{2}\/">/g)].length, 51, "50 states and DC");
  for (const m of cityLinks) assert.ok(fs.existsSync(new URL(`../site/city/${m[1]}/${m[2]}/index.html`, import.meta.url)), m[0]);
});
