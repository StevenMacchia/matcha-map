// Lighthouse 12 mobile (simulated throttling) on one or more URLs; prints one row per URL and writes the raw reports.
// Shared by tools/perf-gate.js. Usage: node tools/perf-measure.js [--out dir] [--runs 1] <url> [<url> ...]
// Needs Chrome (found by Lighthouse) and network access to npm for `npx lighthouse@12` the first time.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LH_VERSION = '12';

export function runLighthouse(url, outFile) {
  const args = ['--yes', `lighthouse@${LH_VERSION}`, url, '--form-factor=mobile', '--screenEmulation.mobile',
    '--throttling-method=simulate', '--only-categories=performance,seo', '--output=json', `--output-path=${outFile}`,
    '--quiet', '--chrome-flags=--headless=new --no-sandbox'];
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: 240000 });
  if (!fs.existsSync(outFile)) throw new Error(`lighthouse failed for ${url}: ${(r.stderr || r.stdout || '').slice(-400)}`);
  return JSON.parse(fs.readFileSync(outFile, 'utf8'));
}

export function summarize(lh) {
  const a = lh.audits, c = lh.categories;
  const ms = (id) => a[id] && a[id].numericValue != null ? a[id].numericValue : null;
  return {
    url: lh.finalDisplayedUrl || lh.finalUrl,
    performance: Math.round((c.performance.score || 0) * 100),
    seo: c.seo ? Math.round((c.seo.score || 0) * 100) : null,
    fcp: ms('first-contentful-paint'), lcp: ms('largest-contentful-paint'), si: ms('speed-index'), tti: ms('interactive'),
    tbt: ms('total-blocking-time'), cls: ms('cumulative-layout-shift'),
    bytes: ms('total-byte-weight'), mainThread: ms('mainthread-work-breakdown'),
    requests: a['network-requests'] && a['network-requests'].details ? a['network-requests'].details.items.length : null,
  };
}

const s = (v) => (v == null ? 'n/a' : (v / 1000).toFixed(1) + ' s');
export function row(m) {
  return `| ${m.url.replace(/^https?:\/\/[^/]+/, '') || '/'} | ${m.performance} | ${m.seo} | ${s(m.fcp)} | ${s(m.lcp)} | ${s(m.si)} | ${s(m.tti)} | ${m.tbt == null ? 'n/a' : Math.round(m.tbt) + ' ms'} | ${m.cls == null ? 'n/a' : m.cls.toFixed(3)} | ${m.bytes == null ? 'n/a' : (m.bytes / 1048576).toFixed(2) + ' MB'} |`;
}
export const HEADER = '| Page | Perf | SEO | FCP | LCP | Speed index | TTI | TBT | CLS | Transferred |\n|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|';

export function topRequests(lh, n = 10) {
  const items = (lh.audits['network-requests'].details || { items: [] }).items;
  return items.slice().sort((x, y) => (y.transferSize || 0) - (x.transferSize || 0)).slice(0, n)
    .map((i) => ({ url: i.url, bytes: i.transferSize }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const argv = process.argv.slice(2);
  let out = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lh-'));
  const urls = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]; else urls.push(argv[i]);
  }
  fs.mkdirSync(out, { recursive: true });
  console.log(HEADER);
  urls.forEach((u, i) => {
    const lh = runLighthouse(u, path.join(out, `lh-${i}.json`));
    console.log(row(summarize(lh)));
    if (process.env.TOP) console.log(topRequests(lh).map((t) => `    ${t.bytes}  ${t.url.slice(0, 110)}`).join('\n'));
  });
}
