// Search the web through Tavily from a terminal, counting credits in data/tavily-budget.json like the crawler does.
//   npm run search -- "matcha pop up Denver"            Instagram and TikTok only (the default), 8 results
//   npm run search -- "matcha pop up Denver" --web      any site
//   npm run search -- "..." --max 12 --raw              more results; --raw prints the first 1,500 chars of page text when Tavily has it
// One basic search costs 1 credit. Needs TAVILY_API_KEY in .env (free tier: about 1,000 a month).
import "../ingest/lib/env.js";
import { tavilySearch, loadBudget, canSpend, spend, saveBudget, budgetLine } from "../ingest/lib/sites/social-search.js";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const query = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--max").join(" ").trim();
if (!query) { console.error("usage: npm run search -- \"query\" [--web] [--max n] [--raw]"); process.exit(2); }
const key = process.env.TAVILY_API_KEY;
if (!key) { console.error("TAVILY_API_KEY is not set (put it in .env)."); process.exit(2); }

const budget = loadBudget();
const why = canSpend(budget, 1);
if (why) { console.error(`Not searching: ${why}. ${budgetLine(budget)}`); process.exit(3); }
const domains = flag("--web") ? undefined : ["instagram.com", "tiktok.com"];
let results;
try {
  results = await tavilySearch(query, { key, domains, max: Number(opt("--max", 8)), raw: flag("--raw") });
} catch (e) { console.error(String(e.message || e)); process.exit(1); }
spend(budget, 1);
saveBudget(budget);
for (const r of results) {
  const text = String(r.content || "").replace(/\s+/g, " ").trim();
  console.log(`\n== ${r.url}\n   ${r.title || ""}${r.published_date ? `  (${r.published_date})` : ""}\n   ${text.slice(0, 700)}`);
  if (flag("--raw") && r.raw_content) console.log(`   --- ${String(r.raw_content).replace(/\s+/g, " ").slice(0, 1500)}`);
}
console.log(`\n${results.length} results. ${budgetLine(budget)}`);
