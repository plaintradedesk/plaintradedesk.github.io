/**
 * The checks that can only be run against a site that is actually served.
 *
 *   node test/live-check.mjs https://example.org
 *   npm run verify:live -- https://example.org
 *
 * Everything else in this repository checks what the build produced. This
 * checks what a reader receives, which is not the same thing: a hosting
 * platform can inject an analytics snippet, a cookie banner, a consent frame or
 * a redirect, and none of that is visible in dist/.
 *
 * The promise page says, in its own words, that no third-party requests of any
 * kind are made and that nothing is stored in a reader's browser. This is the
 * only place that claim can be tested honestly, so the deploy workflow runs it
 * after every publish.
 */
import { chromium } from 'playwright';

const base = (process.argv[2] || process.env.PTD_LIVE_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('\nUsage: node test/live-check.mjs https://the-published-site\n');
  process.exit(2);
}

const PAGES = [
  '/', '/business.html', '/place.html', '/policy.html',
  '/about.html', '/promises.html', '/corrections.html',
  '/plain-trade-desk-offline.html'
];
const ASSETS = ['/robots.txt', '/sitemap.xml'];

const origin = new URL(base).origin;
const shareImages = new Set();
const results = [];
const ok = (name, cond, detail) => results.push([cond ? 'PASS' : 'FAIL', name, detail || '']);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const thirdParty = [];
page.on('request', r => { if (new URL(r.url()).origin !== origin) thirdParty.push(r.url()); });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

for (const p of PAGES) {
  const url = base + p;
  const res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  ok(`${p} is served`, res && res.status() === 200, res ? String(res.status()) : 'no response');

  const canonical = await page.getAttribute('link[rel="canonical"]', 'href').catch(() => null);
  ok(`${p} carries a canonical URL`, !!canonical && canonical.startsWith(origin), canonical || 'missing');

  const stored = await page.evaluate(() => {
    // A browser can refuse storage entirely, which reads the same as empty here.
    try { return localStorage.length + sessionStorage.length; } catch { return 0; }
  });
  ok(`${p} writes nothing to the reader's browser`, stored === 0, `${stored} keys`);

  const banner = await page.textContent('.notice');
  ok(`${p} carries the independent and unofficial banner`,
     !!banner && /Not a government website/.test(banner));

  const image = await page.getAttribute('meta[property="og:image"]', 'content').catch(() => null);
  if (image) shareImages.add(image);
}

// The share card is the copy of this that travels furthest, forwarded through
// WhatsApp by somebody who will never see an error page. If it does not resolve
// it fails silently inside somebody else's app.
for (const image of shareImages) {
  const res = await page.goto(image);
  ok(`the share card at ${image.replace(origin, '')} is served`,
     res && res.status() === 200 && /image\/png/.test(res.headers()['content-type'] || ''),
     res ? String(res.status()) : 'no response');
}

// Asking for an address that does not exist logs a console error, and that one
// is ours. Everything up to here is what a reader would actually hit.
const readerErrors = errors.slice();

// A 404 has to be the site's own 404, not the platform's.
const missing = await page.goto(base + '/this-address-does-not-exist-' + Date.now(), { waitUntil: 'load' });
ok('an unknown address gets this site\'s own 404',
   !!missing && missing.status() === 404 && /does not exist/i.test(await page.textContent('body')),
   missing ? String(missing.status()) : 'no response');

for (const a of ASSETS) {
  const res = await page.goto(base + a);
  ok(`${a} is served`, res && res.status() === 200, res ? String(res.status()) : 'no response');
}

const cookies = await context.cookies();
ok('no cookies are set on the reader', cookies.length === 0,
   cookies.map(c => c.name).join(', '));
ok('no request goes to any other host', thirdParty.length === 0,
   thirdParty.join(', '));
ok('no page errors and no console errors', readerErrors.length === 0, readerErrors.join(' | '));

await browser.close();

let failed = 0;
console.log(`\nLive check against ${base}\n`);
for (const [state, name, detail] of results) {
  if (state === 'FAIL') failed++;
  console.log(`  ${state}  ${name}${detail && state === 'FAIL' ? '  (' + detail + ')' : ''}`);
}
console.log(failed ? `\nFAILED ${failed} of ${results.length}` : `\nAll ${results.length} live checks passed.`);
process.exit(failed ? 1 : 0);
