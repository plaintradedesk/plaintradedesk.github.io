/**
 * Plain Trade Desk: browser checks against the built site.
 *
 *   npm install && npx playwright install chromium
 *   npm test            builds first, then runs this
 *
 * This file exists because every serious fault in this project so far appeared
 * when the page met a real browser, and none of them could have been found by
 * reading the source. Run it before sending anything to anybody.
 *
 * The checks are grouped by what they protect. The ones under DOCTRINE are the
 * ones that matter: they encode promises the site makes to its readers, and a
 * failure there means the page is claiming something it has not earned.
 *
 * The first thirty-four checks are the prototype's suite. They have been adapted
 * only where the file layout genuinely changed, which is in three places:
 *
 *   - the four doors are separate pages now, so a door is a navigation rather
 *     than a click, and the current door is marked with aria-current rather
 *     than aria-selected, which is what a link between pages should carry;
 *   - the standing pages are separate documents at stable addresses, because a
 *     municipality deciding whether to link needs to cite the commitment page
 *     inside their own approval process;
 *   - every card and every step is now in the markup and filtered by hiding, so
 *     the counts are of what is visible rather than of what exists.
 *
 * Everything after those thirty-four is new, and is about the build rather than
 * the page: it could not have been written against a single hand-edited file.
 */
import { chromium } from 'playwright';
import { shareCard } from '../src/templates/share.mjs';
import { readFileSync, readdirSync, cpSync, rmSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DIST = path.join(ROOT, 'dist');
const url = name => 'file://' + path.join(DIST, name).replace(/\\/g, '/');

const launchOpts = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

const results = [];
let group = '';
const g = name => { group = name; results.push(['GROUP', name]); };
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name, group]);

/* ------------------------------------------------------------------ */
/* Helpers for the build checks. Each one copies the repository into a
   temporary directory, breaks exactly one thing, and runs the build there, so
   nothing in the working tree is touched and the failure is the real one rather
   than a simulation of it. */

/* A check that throws before its own cleanup leaves a copy behind, inside the
   repository. Clearing them first means a failed run does not slow down or
   confuse the next one. */
for (const name of readdirSync(ROOT)) {
  if (name.startsWith('.tmp-test-')) rmSync(path.join(ROOT, name), { recursive: true, force: true });
}

function tempRepo() {
  // Inside the repository rather than in the system temp directory. A build run
  // in here has to resolve playwright and axe-core, and module resolution walks
  // up from the file it is running, so this is the only place a temporary copy
  // can be put and still be able to open a browser. Gate 12 cannot be tested
  // otherwise. The directories are gitignored and removed after each check.
  const dir = mkdtempSync(path.join(ROOT, '.tmp-test-'));
  cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  cpSync(path.join(ROOT, 'site.config.json'), path.join(dir, 'site.config.json'));
  return dir;
}

function build(dir, args = ['--no-browser'], env = {}) {
  const r = spawnSync(process.execPath, [path.join(dir, 'src', 'build.mjs'), ...args],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  // Failures print to stderr and warnings to stdout, and a check may be looking
  // for either, so both are returned as one stream.
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * Break one line of a template in the copy. It refuses if the line it was told
 * to break is not there any more, because a setup step that quietly does
 * nothing turns a gate check into a check that the build succeeds, and that
 * check would pass forever with the gate switched off.
 */
const editSource = (dir, rel, from, to) => {
  const file = path.join(dir, rel);
  const before = readFileSync(file, 'utf8');
  const after = before.replace(from, to);
  if (after === before) {
    throw new Error(`test setup is stale: ${rel} no longer contains ${JSON.stringify(from)}`);
  }
  writeFileSync(file, after);
};

const editJson = (dir, name, fn) => {
  const file = path.join(dir, 'data', name);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  fn(data);
  writeFileSync(file, JSON.stringify(data, null, 2));
};

/* ------------------------------------------------------------------ */

(async () => {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  const errors = [], network = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file:')) network.push(r.url()); });

  const go = async name => { await page.goto(url(name)); await page.waitForTimeout(120); };
  const text = sel => page.textContent(sel);
  const count = sel => page.locator(sel).count();
  const cards = () => count('#cards article:not([hidden])');
  const steps = () => count('#actions .action:not([hidden])');
  const stepText = () => page.locator('#actions .action:not([hidden]) .txt p').allTextContents();

  const shockData = JSON.parse(readFileSync(path.join(ROOT, 'data', 'shocks.json'), 'utf8')).shocks;
  const built = readdirSync(DIST).map(f => readFileSync(path.join(DIST, f), 'utf8'));

  await go('index.html');

  /* ------------------------------------------------------------------ */
  g('DOCTRINE: the page must not claim what it has not earned');

  ok('no third-party network requests at all', network.length === 0);

  ok('every shock record carries at least one primary source',
     shockData.every(s => s.sources.length > 0)
     && built.every(html => !html.includes('No primary source on file')));

  ok('no record is flagged unverified',
     shockData.every(s => !s.unverified)
     && built.every(html => !html.includes('Needs verification')));

  await go('corrections.html');
  const corrections = await text('#pageview');
  ok('known-gaps list is computed and currently clean', /No gaps\./.test(corrections));
  ok('corrections log has entries and they say what was previously wrong',
     !/Nothing has been corrected yet/.test(corrections)
     && /no matter which country they come from/.test(corrections));

  const fileState = (await text('#fileState')) || '';
  ok('freshness readout is computed, not typed (' + fileState.trim() + ')', fileState.length > 3);

  /* ------------------------------------------------------------------ */
  g('FACTS: corrections that were made must stay made');

  await go('business.html');
  const business = await text('#cards');
  ok('cabinets safeguard does NOT claim it applies regardless of origin',
     !/regardless of origin/.test(business));
  ok('cabinets safeguard names the excluded origins',
     /Mexico/.test(business) && /developing countries/i.test(business));
  ok('cabinets safeguard is described as provisional', /200 days/.test(business));

  await go('policy.html');
  const policy = await text('#cards');
  ok('steel surtax carries its instrument number', /SOR\/2025-95/.test(policy));
  ok('steel surtax states the consolidation limitation openly', /17 June 2026/.test(policy));

  /* ------------------------------------------------------------------ */
  g('SEASONS: they filter steps, never facts');

  await go('index.html');
  const shockCounts = new Set(), stepLists = {}, stepCounts = {};
  for (const s of ['entering', 'working', 'approaching', 'past']) {
    await page.check(`input[value="${s}"]`); await page.waitForTimeout(70);
    shockCounts.add(await cards());
    stepLists[s] = (await stepText()).join('|');
    stepCounts[s] = await steps();
  }
  ok('shock count is identical across all four seasons', shockCounts.size === 1);
  ok('all four seasons produce distinct step lists', new Set(Object.values(stepLists)).size === 4);
  ok('every season carries at least four steps ' + JSON.stringify(stepCounts),
     Object.values(stepCounts).every(n => n >= 4));

  await page.check('input[value="working"]'); await page.waitForTimeout(70);
  const before = await stepText();
  await page.check('#familyLens'); await page.waitForTimeout(70);
  const after = await stepText();
  ok('household lens adds steps', after.length > before.length);
  ok('household lens removes nothing', before.every(x => after.includes(x)));
  await page.uncheck('#familyLens'); await page.waitForTimeout(70);

  /* ------------------------------------------------------------------ */
  g('REFERRALS: name the question, never answer it');

  await page.check('input[value="approaching"]'); await page.waitForTimeout(70);
  const advisor = await page.locator('#actions .action:not([hidden]) .refer').allTextContents();
  ok('both near-retirement steps carry an advisor referral',
     advisor.length === 2 && advisor.every(r => /licensed advisor/.test(r)));
  await page.check('input[value="working"]'); await page.waitForTimeout(70);
  ok('working season carries the employment-standards referral',
     (await page.locator('#actions .action:not([hidden]) .refer').allTextContents())
       .some(r => /employment standards/.test(r)));

  /* ------------------------------------------------------------------ */
  g('STRUCTURE: doors, pages and navigation');

  for (const [d, file] of [['people', 'index.html'], ['business', 'business.html'],
                           ['place', 'place.html'], ['policy', 'policy.html']]) {
    await go(file);
    ok(`${d} door renders cards and steps`, (await cards()) > 0 && (await steps()) > 0);
  }

  await go('business.html');
  ok('season control appears on the People door only', await page.locator('#seasons').isHidden());
  const cardsAll = await cards();
  await page.selectOption('#sectorSel', 'steel'); await page.waitForTimeout(80);
  ok('sector filter narrows the business door', (await cards()) < cardsAll);

  ok('three standing pages are linked', (await count('.pagelink:not(.download)')) === 3);
  for (const [file, probe] of [['about.html', /not a government site/i],
                               ['promises.html', /will not always be current/],
                               ['corrections.html', /Known gaps/]]) {
    await go(file);
    ok(`${file} opens and carries its key statement`, probe.test(await text('#pageview')));
  }
  ok('door view is hidden while a standing page is open', await page.locator('#doorview').isHidden());
  ok('no door reads as selected while a page is open',
     (await count('.door[aria-current="page"]')) === 0);
  await page.click('#pageview .back'); await page.waitForTimeout(150);
  ok('back returns to the desk', await page.locator('#doorview').isVisible());

  /* ------------------------------------------------------------------ */
  g('ACCESS: it has to work on a phone and degrade quietly');

  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(120);
  ok('no horizontal overflow at 360px',
     await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await go('about.html');
  ok('standing pages do not overflow at 360px',
     await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  ok('no page errors and no console errors', errors.length === 0);

  /* ==================================================================
     Everything below here is new. These are checks about the build, and
     none of them could have been written against a single hand-edited
     file, which is the reason the build exists.
  ================================================================== */

  await page.setViewportSize({ width: 1280, height: 900 });

  g('OFFLINE: one file somebody can be handed and keep');

  const offline = readFileSync(path.join(DIST, 'plain-trade-desk-offline.html'), 'utf8');
  ok('offline file carries all three standing pages',
     /data-page="about"/.test(offline) && /data-page="promise"/.test(offline)
     && /data-page="corrections"/.test(offline));
  ok('offline file carries all four doors',
     ['people', 'business', 'place', 'policy'].every(d => offline.includes(`data-door="${d}"`)));
  // Source links and the canonical link are the two absolute URLs allowed on a
  // page. Neither is fetched: one is a link a reader chooses to follow, the
  // other declares where this page lives. Everything else is inline.
  ok('offline file inlines its stylesheet and script and links to no host',
     offline.includes('<style>') && offline.includes('<script>')
     && !/(?:src|href)="https?:\/\//.test(offline
       .replace(/<a\b[^>]*>/g, '')
       .replace(/<link rel="canonical"[^>]*>/g, '')));

  const offlineNetwork = [];
  const off = await browser.newPage();
  const offErrors = [];
  off.on('pageerror', e => offErrors.push(e.message));
  off.on('console', m => { if (m.type() === 'error') offErrors.push(m.text()); });
  off.on('request', r => { if (!r.url().startsWith('file:')) offlineNetwork.push(r.url()); });
  await off.goto(url('plain-trade-desk-offline.html'));
  await off.waitForTimeout(200);
  const offCards = () => off.locator('.doorpanel:not([hidden]) .cards .card:not([hidden])').count();
  ok('offline file opens on the People door with the other three put away',
     (await off.locator('.doorpanel:not([hidden])').count()) === 1
     && (await off.locator('.doorpanel:not([hidden])').getAttribute('data-door')) === 'people');
  const offPeople = await offCards();
  await off.click('.door[data-door="policy"]'); await off.waitForTimeout(150);
  ok('offline door switching works without leaving the file',
     (await off.locator('.doorpanel:not([hidden])').getAttribute('data-door')) === 'policy'
     && (await offCards()) !== offPeople);
  await off.click('.pagelink[data-page="promise"]'); await off.waitForTimeout(150);
  ok('offline standing pages open and the door view goes away',
     /will not always be current/.test(await off.textContent('#pageview'))
     && await off.locator('#doorview').isHidden());
  ok('offline file makes no request and raises nothing',
     offlineNetwork.length === 0 && offErrors.length === 0);
  await off.close();

  /* ------------------------------------------------------------------ */
  g('PUBLICATION: what a page needs in public that a file on disk does not');

  const distFile = n => readFileSync(path.join(DIST, n), 'utf8');
  const htmlFiles = readdirSync(DIST).filter(n => n.endsWith('.html'));
  const head = n => { const h = distFile(n); return h.slice(0, h.indexOf('</head>')); };
  const attr = (html, rx) => { const m = html.match(rx); return m ? m[1] : ''; };
  const findable = ['index.html', 'business.html', 'place.html', 'policy.html',
                    'about.html', 'promises.html', 'corrections.html'];

  ok('every built page carries a canonical URL',
     htmlFiles.every(n => /<link rel="canonical" href="https?:\/\/[^"]+">/.test(head(n))));
  ok('every built page carries a meta description',
     htmlFiles.every(n => attr(head(n), /<meta name="description" content="([^"]*)">/).length > 20));
  ok('no two pages share a title',
     new Set(htmlFiles.map(n => attr(head(n), /<title>([^]*?)<\/title>/))).size === htmlFiles.length);
  // A municipality has to cite this address inside their own approval process.
  ok('the commitment page canonical is its own stable address',
     attr(head('promises.html'), /<link rel="canonical" href="([^"]+)">/).endsWith('/promises.html'));
  ok('the front page canonical is the site root',
     /canonical" href="https?:\/\/[^"]+\/">/.test(head('index.html')));
  ok('the favicon is inline, and is a wordmark rather than a crest or a flag',
     /<link rel="icon" href="data:image\/svg\+xml,[^"]*PTD/.test(head('index.html')));

  const sitemap = distFile('sitemap.xml');
  ok('the sitemap lists the seven pages meant to be found',
     (sitemap.match(/<loc>/g) || []).length === findable.length);
  ok('the sitemap leaves out the 404 and the offline copy of everything',
     !sitemap.includes('404.html') && !sitemap.includes('offline'));
  ok('robots.txt allows indexing and names the sitemap',
     /Allow: \//.test(distFile('robots.txt'))
     && /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(distFile('robots.txt')));
  ok('the pages meant to be found do not ask not to be',
     findable.every(n => !/name="robots"/.test(head(n))));
  ok('the 404 and the offline copy do ask not to be indexed',
     /noindex/.test(head('404.html')) && /noindex/.test(head('plain-trade-desk-offline.html')));

  await go('404.html');
  ok('the 404 carries the same unofficial banner as every other page',
     /Not a government website/.test(await text('.notice')));
  ok('the 404 says plainly that the address does not exist',
     /does not exist/i.test(await text('#pageview')));
  ok('the 404 links to all four doors, absolutely, because it is served anywhere',
     (await count('.notfound .doorlist a')) === 4
     && /^https?:\/\//.test(await page.locator('.notfound .doorlist a').first().getAttribute('href')));

  await go('about.html');
  ok('the About page offers the offline file as a download', (await count('a.dl[download]')) === 1);
  ok('the download is described as a file you can keep and hand to somebody',
     /keep a copy/.test(await text('.download')) && /pass it to somebody/.test(await text('.download')));
  ok('every page footer links to the offline file',
     htmlFiles.filter(n => n !== 'plain-trade-desk-offline.html')
       .every(n => /class="pagelink download" href="[^"]*plain-trade-desk-offline\.html" download/.test(distFile(n))));
  ok('the offline file does not offer itself as a download',
     !/pagelink download/.test(distFile('plain-trade-desk-offline.html')));

  /* ------------------------------------------------------------------ */
  g('ARCHIVE: the promise to stop honestly has to be executable');

  {
    const dir = tempRepo();
    const r = build(dir, ['--no-browser', '--archived=2027-03-01']);
    const out = n => readFileSync(path.join(dir, 'dist', n), 'utf8');
    const built = readdirSync(path.join(dir, 'dist')).filter(n => n.endsWith('.html'));
    ok('an archived build stamps a notice on every page, the 404 included',
       r.code === 0 && built.length === htmlFiles.length
       && built.every(n => /class="archived"/.test(out(n)) && /No longer maintained/.test(out(n))));
    ok('an archived build gives the date of the last check',
       built.every(n => /March 1, 2027/.test(out(n))));
    ok('an archived build turns off the freshness readout so it cannot read as live',
       built.every(n => !/id="fileDot"/.test(out(n)) && !/Next review/.test(out(n))));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // The whole point of the flag. A site whose records have aged out can still
    // be rebuilt on purpose, which is what archiving in place means. Without
    // this, the promise to leave the pages up and marked would need somebody to
    // hand-edit nine pages in the week they decided to stop.
    const dir = tempRepo();
    const stale = build(dir, ['--no-browser'], { PTD_TODAY: '2027-03-05' });
    const archived = build(dir, ['--no-browser', '--archived=2027-03-01'], { PTD_TODAY: '2027-03-05' });
    ok('gate 2 refuses stale records normally, and is suppressed for an archived build',
       stale.code !== 0 && /gate 2/.test(stale.out) && archived.code === 0);
    rmSync(dir, { recursive: true, force: true });
  }

  /* ------------------------------------------------------------------ */
  g('GATES: the build has to refuse, not warn');

  {
    const dir = tempRepo();
    editJson(dir, 'shocks.json', d => { d.shocks[0].sources = []; });
    const r = build(dir);
    ok('gate 1 fails the build on an unsourced record, and names it',
       r.code !== 0 && /gate 1/.test(r.out) && r.out.includes(shockData[0].id));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    editJson(dir, 'shocks.json', d => { d.shocks[1].verified = '2020-01-01'; });
    const r = build(dir);
    ok('gate 2 fails the build on a stale record, and says how stale',
       r.code !== 0 && /gate 2/.test(r.out) && r.out.includes(shockData[1].id)
       && /days ago/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    editJson(dir, 'shocks.json', d => { d.shocks[2].status = 'forecast'; });
    const r = build(dir);
    ok('gate 5 fails the build when a status is wrong for its evidence class',
       r.code !== 0 && /gate 5/.test(r.out) && r.out.includes(shockData[2].id));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // The direct regression guard for the webfont defect. The template is the
    // only place an external reference could be introduced, because everything
    // that comes from data is escaped before it reaches the page.
    const dir = tempRepo();
    editSource(dir, 'src/templates/layout.mjs',
      '<title>${esc(meta.title)}</title>',
      '<title>${esc(meta.title)}</title>\n<script src="https://example.com/analytics.js"></script>');
    const r = build(dir);
    ok('gate 7 fails the build on an injected external script tag',
       r.code !== 0 && /gate 7/.test(r.out) && /example\.com/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // The failure this repository exists to prevent: a file truncated inside an
    // unterminated string literal, which a browser renders without complaint.
    const dir = tempRepo();
    const js = path.join(dir, 'src', 'assets', 'site.js');
    writeFileSync(js, readFileSync(js, 'utf8').slice(0, 1200) + '\n  var half = "and then the file just stop');
    const r = build(dir);
    ok('gate 8 fails the build on a truncated script, which is why this repo exists',
       r.code !== 0 && /gate 8/.test(r.out) && /does not parse/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    editJson(dir, 'actions.json', d => { d.actions[0].doors = []; });
    const r = build(dir);
    ok('gate 4 fails the build on an action that is on no door',
       r.code !== 0 && /gate 4/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // Added on review. An action tied to no shock is advice standing free of any
    // evidence, which is the specific thing this site exists not to publish.
    const dir = tempRepo();
    editJson(dir, 'actions.json', d => { d.actions[0].shocks = []; });
    const r = build(dir);
    ok('gate 4 fails the build on an action that responds to no shock',
       r.code !== 0 && /gate 4/.test(r.out) && /no shock/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // Collapse three seasons into one action set and the selector becomes fake
    // personalisation, which costs more trust than having no selector.
    const dir = tempRepo();
    editJson(dir, 'actions.json', d => {
      for (const a of d.actions) if (a.doors.includes('people')) a.seasons = ['entering', 'working', 'approaching', 'past'];
    });
    const r = build(dir);
    ok('gate 6 fails the build when two seasons produce the same steps',
       r.code !== 0 && /gate 6/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    editJson(dir, 'actions.json', d => {
      const a = d.actions.find(x => x.refer === 'financial_advisor');
      a.text = 'You should sell before the list is published.';
    });
    const r = build(dir);
    ok('gate 9 warns on directive language under a financial referral, and does not fail',
       r.code === 0 && /warning\s+gate 9/.test(r.out) && /you should/i.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // A deterministic build means a diff in dist/ is always a real change, which
    // is what makes the changelog worth reading.
    const dir = tempRepo();
    const first = build(dir);
    const a = readdirSync(path.join(dir, 'dist')).sort()
      .map(f => [f, readFileSync(path.join(dir, 'dist', f))]);
    build(dir);
    const b = readdirSync(path.join(dir, 'dist')).sort()
      .map(f => [f, readFileSync(path.join(dir, 'dist', f))]);
    ok('two builds from unchanged input are byte-identical',
       first.code === 0 && a.length === b.length
       && a.every(([name, buf], i) => b[i][0] === name && buf.equals(b[i][1])));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    const r = build(dir, ['--validate-only']);
    ok('validation can run on its own, which is what the weekly check calls',
       r.code === 0 && /Nothing rendered, nothing written/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // Impossible to get wrong with one page. Easy with nine, and a dead link on
    // the commitment page in front of a municipality is a small disaster.
    const dir = tempRepo();
    editSource(dir, 'src/templates/layout.mjs',
      '<footer>', '<footer>\n<a href="programmes.html">Programmes</a>');
    const r = build(dir);
    ok('gate 10 fails the build on a link to a page that was never built',
       r.code !== 0 && /gate 10/.test(r.out) && /programmes\.html/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    editSource(dir, 'src/templates/layout.mjs',
      '<footer>', '<footer>\n<a href="#nowhere">Nowhere</a>');
    const r = build(dir);
    ok('gate 10 fails the build on a fragment that is not on the page',
       r.code !== 0 && /gate 10/.test(r.out) && /id "nowhere"/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // Two pages with one title are two pages a reader cannot tell apart in a
    // tab, a bookmark or a search result.
    const dir = tempRepo();
    editJson(dir, 'doors.json', d => { d.doors[1].title = d.doors[2].title; });
    const r = build(dir);
    ok('gate 11 fails the build when two pages share a title',
       r.code !== 0 && /gate 11/.test(r.out) && /same title/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tempRepo();
    editJson(dir, 'doors.json', d => { d.doors[1].description = ''; });
    const r = build(dir);
    ok('gate 11 fails the build on a page with no description',
       r.code !== 0 && /gate 11/.test(r.out) && /no meta description/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // A card that is named but never drawn is the same broken link seen from
    // further away: it fails inside somebody else's app, on the copy of this
    // that travels furthest, where nobody will report it.
    const dir = tempRepo();
    editSource(dir, 'src/templates/layout.mjs',
      "tags.push(['og:image', meta.image]", "tags.push(['og:image', 'share-nobody-drew.png']");
    const r = build(dir);
    ok('gate 10 fails the build on a share card that is named but not drawn',
       r.code !== 0 && /gate 10/.test(r.out) && /share-nobody-drew\.png/.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // The slow one: gate 12 runs in the browser, so this build opens one.
    // WCAG 2.1 AA was required from the start and was a hope until this gate.
    const dir = tempRepo();
    editSource(dir, 'src/templates/layout.mjs', '<html lang="${escAttr(lang)}">', '<html>');
    const r = build(dir, []);
    ok('gate 12 fails the build on a serious accessibility violation',
       r.code !== 0 && /gate 12/.test(r.out) && /lang/i.test(r.out));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // Changing the domain is meant to be a one-line edit, and everything that
    // carries the address has to follow it in the same build.
    const dir = tempRepo();
    writeFileSync(path.join(dir, 'site.config.json'),
      JSON.stringify({ site: { baseUrl: 'https://plaintradedesk.example' } }, null, 2));
    const r = build(dir);
    const dist = n => readFileSync(path.join(dir, 'dist', n), 'utf8');
    ok('a configured domain writes CNAME and reaches every canonical URL and the sitemap',
       r.code === 0
       && dist('CNAME').trim() === 'plaintradedesk.example'
       && /canonical" href="https:\/\/plaintradedesk\.example\/promises\.html"/.test(dist('promises.html'))
       && dist('sitemap.xml').includes('https://plaintradedesk.example/promises.html'));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // The Pages subdomain is given to us and answers on its own name.
    const dir = tempRepo();
    writeFileSync(path.join(dir, 'site.config.json'),
      JSON.stringify({ site: { baseUrl: 'https://example.github.io/plain-trade-desk' } }, null, 2));
    const r = build(dir);
    ok('the Pages subdomain publishes without a CNAME',
       r.code === 0 && !existsSync(path.join(dir, 'dist', 'CNAME')));
    rmSync(dir, { recursive: true, force: true });
  }

  /* ------------------------------------------------------------------ */
  g('SHARE CARDS: the copy of this that travels furthest');

  {
    const doors = JSON.parse(readFileSync(path.join(ROOT, 'data', 'doors.json'), 'utf8')).doors;
    const files = doors.map(d => `share-${d.id}.png`);
    ok('a card is drawn for every door', files.every(n => existsSync(path.join(DIST, n))));
    ok('the cards are real PNGs',
       files.every(n => readFileSync(path.join(DIST, n)).slice(1, 4).toString() === 'PNG'));

    // A card arriving without the unofficial line is the one piece of this
    // project that could be read as a government notice.
    const site = JSON.parse(readFileSync(path.join(ROOT, 'data', 'pages.json'), 'utf8')).site;
    const svg = shareCard({ door: doors[0], site, host: 'example.org' });
    ok('the card says it is independent and unofficial, in the banner\'s own words',
       svg.includes('Independent and unofficial.') && svg.includes('Not a government website.'));
    ok('the card carries the door\'s question and the site name, from the data',
       svg.includes('caught up in this?') && svg.includes(site.title));
    // A card is a still image that keeps circulating after the record behind it
    // has changed, so it must carry nothing that can go out of date.
    const words = (svg.match(/>([^<>]+)</g) || []).join(' ');
    ok('the card carries no number at all, so no fact, rate or date',
       words.length > 40 && !/\d/.test(words));

    const doorPages = [['index.html', 'people'], ['business.html', 'business'],
                       ['place.html', 'place'], ['policy.html', 'policy']];
    ok('every door page names its own card, absolutely',
       doorPages.every(([file, id]) =>
         new RegExp(`<meta property="og:image" content="https?://[^"]+/share-${id}\\.png">`)
           .test(distFile(file))));
    ok('the standing pages and the 404 name no card, because none is drawn for them',
       ['about.html', 'promises.html', 'corrections.html', '404.html']
         .every(n => !/og:image/.test(distFile(n))));
  }

  /* ------------------------------------------------------------------ */
  g('LANGUAGE: room for a translation that does not exist yet');

  {
    const langs = readdirSync(path.join(ROOT, 'data', 'i18n')).filter(n => n.endsWith('.json'));
    ok('every language named in the plan has a file', langs.length === 4
       && ['fr.json', 'hi.json', 'pa.json', 'ur.json'].every(n => langs.includes(n)));

    const fr = JSON.parse(readFileSync(path.join(ROOT, 'data', 'i18n', 'fr.json'), 'utf8'));
    const pa = JSON.parse(readFileSync(path.join(ROOT, 'data', 'i18n', 'pa.json'), 'utf8'));
    ok('French has room for every string, including the policy register',
       Object.keys(fr.strings).length > 250
       && Object.keys(fr.strings).some(k => k.endsWith('.policy')));
    // Only the plain register is worth translating for reach. A half-translated
    // legal instrument is worse than none.
    ok('Punjabi, Hindi and Urdu carry the plain register and not the policy one',
       Object.keys(pa.strings).length > 200
       && !Object.keys(pa.strings).some(k => k.endsWith('.policy')));
    ok('every translation is empty, and every entry carries the English it is for',
       Object.values(fr.strings).every(r => r.t === '' && typeof r.en === 'string' && r.en.length > 0));
    ok('a source label is never offered for translation, because it is a document name',
       !Object.keys(fr.strings).some(k => /sources\[/.test(k)));
  }

  {
    const dir = tempRepo();
    const r = build(dir, ['--no-browser', '--lang=fr']);
    ok('a language that is not translated refuses to build rather than emitting half of one',
       r.code !== 0 && /Refusing to build French/.test(r.out) && !existsSync(path.join(dir, 'dist', 'fr')));
    rmSync(dir, { recursive: true, force: true });
  }

  {
    // Nothing is translated, so the only honest way to know the scaffolding
    // works is to fill a language in and build it. This translation is a
    // marker, thrown away at the end of the check. It proves the pipeline, not
    // the French.
    const dir = tempRepo();
    const file = path.join(dir, 'data', 'i18n', 'fr.json');
    const table = JSON.parse(readFileSync(file, 'utf8'));
    for (const row of Object.values(table.strings)) row.t = 'fr:' + row.en;
    writeFileSync(file, JSON.stringify(table, null, 2));

    const r = build(dir, ['--no-browser', '--lang=fr']);
    const out = existsSync(path.join(dir, 'dist', 'fr', 'index.html'))
      ? readFileSync(path.join(dir, 'dist', 'fr', 'index.html'), 'utf8') : '';
    ok('a complete language builds into its own directory and says which language it is',
       r.code === 0 && /<html lang="fr">/.test(out));
    ok('a complete language reaches the interface, the doors and the fact base',
       out.includes('fr:Independent and unofficial.')
       && out.includes('fr:Is my job or my grocery bill caught up in this?')
       && out.includes('fr:What is happening'));
    ok('a translated build leaves the sitemap and robots.txt to the site root',
       !existsSync(path.join(dir, 'dist', 'fr', 'sitemap.xml'))
       && !existsSync(path.join(dir, 'dist', 'fr', 'robots.txt')));

    // The failure that actually happens: somebody edits a sentence that has
    // already been translated, and nothing says so.
    editJson(dir, 'doors.json', d => { d.doors[0].question = 'A different question entirely?'; });
    const drifted = build(dir, ['--no-browser', '--lang=fr']);
    ok('a source string that changed after translation makes the language stale, and it refuses',
       drifted.code !== 0 && /stale/.test(drifted.out));
    const english = build(dir, ['--no-browser']);
    ok('the English build only warns about it, because English is what it emits',
       english.code === 0 && /warning/.test(english.out) && /i18n\/fr\.json/.test(english.out));
    rmSync(dir, { recursive: true, force: true });
  }

  /* ------------------------------------------------------------------ */
  g('DEPLOY: a failed build must never publish');

  const deployYml = readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  ok('the deploy job depends on the build job', /deploy:\n\s+needs: build\b/.test(deployYml));
  ok('the build job gates and tests before anything is packaged',
     /npm run build/.test(deployYml) && /npm test/.test(deployYml)
     && deployYml.indexOf('npm test') < deployYml.indexOf('upload-pages-artifact'));
  ok('publishing can be triggered by hand on the day it matters',
     /workflow_dispatch:/.test(deployYml));
  ok('the deployed site is checked for third-party requests after it goes out',
     /live-check\.mjs/.test(deployYml));

  /* ------------------------------------------------------------------ */
  let failed = 0;
  for (const r of results) {
    if (r[0] === 'GROUP') { console.log('\n' + r[1]); continue; }
    if (r[0] === 'FAIL') failed++;
    console.log('  ' + r[0] + '  ' + r[1]);
  }
  const total = results.filter(r => r[0] !== 'GROUP').length;
  console.log('\nnetwork requests: ' + (network.length ? network.join(', ') : 'none'));
  console.log('errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  console.log(failed ? `\nFAILED ${failed} of ${total}` : `\nAll ${total} checks passed.`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
