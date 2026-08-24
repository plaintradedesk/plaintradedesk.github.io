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
import { readFileSync, readdirSync, cpSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
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

function tempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ptd-'));
  cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  return dir;
}

function build(dir, args = ['--no-browser']) {
  const r = spawnSync(process.execPath, [path.join(dir, 'src', 'build.mjs'), ...args],
    { cwd: dir, encoding: 'utf8' });
  // Failures print to stderr and warnings to stdout, and a check may be looking
  // for either, so both are returned as one stream.
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

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

  ok('three standing pages are linked', (await count('.pagelink')) === 3);
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
  ok('offline file inlines its stylesheet and script and links to no host',
     offline.includes('<style>') && offline.includes('<script>')
     && !/(?:src|href)="https?:\/\//.test(offline.replace(/<a\b[^>]*>/g, '')));

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
    const layout = path.join(dir, 'src', 'templates', 'layout.mjs');
    writeFileSync(layout, readFileSync(layout, 'utf8').replace(
      '<title>${esc(site.title)}</title>',
      '<title>${esc(site.title)}</title>\n<script src="https://example.com/analytics.js"></script>'
    ));
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
