/**
 * Plain Trade Desk: checks on the source watcher.
 *
 *   npm test        runs the site suite first, then this
 *
 * The watcher is not the site, so it does not go through the build gates. It
 * needs its own checks and they run in the same suite.
 *
 * The ones under BOUNDARY are the ones that matter. The whole brief for this
 * component is downstream of a single rule, that nothing under data/ is ever
 * written by a script, and the strongest form of that rule is a check that
 * fails if somebody later makes the watcher "helpfully" update a verified date.
 * Two of these checks read the workflow file itself, because the path filter
 * lives there and an intention expressed only in a comment is not a filter.
 *
 * Nothing here touches the network. Every response comes from a fixture, since
 * a suite that fails because a government site is slow is a suite that gets
 * disabled.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

import { run, refuseDataPath, fixtureFetch, loadState, emptyState } from '../watch/watch.mjs';
import { Client, parseRobots, robotsAllow, USER_AGENT } from '../watch/net.mjs';
import {
  contentHash, meaningfulText, parseFeed, parseFederalRegister, parseIndex,
  parseGazetteIssue, parseNoticeTable, parseCanadaNews, parseDrupalAjax
} from '../watch/extract.mjs';
import { FEEDS, loadFactBase, instrumentTokens, isRelevant, relatedRecords } from '../watch/sources.mjs';
import { composeBody, hasSomethingToSay } from '../watch/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const FIX = path.join(here, 'fixtures', 'watch');

const results = [];
let group = '';
const g = name => { group = name; results.push(['GROUP', name]); };
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name, group]);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */

const tmpDirs = [];
function tempRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptd-watch-'));
  tmpDirs.push(dir);
  // Only data/ and watch/ are needed: the watcher reads the fact base for the
  // cited URLs and instrument names, and writes state.
  cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  mkdirSync(path.join(dir, 'watch'), { recursive: true });
  return dir;
}

/** Fingerprint every file under a directory, so "untouched" can be proven. */
function treeHash(dir) {
  const out = [];
  const walk = d => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/') + ':'
        + createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return createHash('sha256').update(out.join('\n')).digest('hex');
}

/** The cited URLs, read from the data rather than counted into this file. */
function citedUrls() {
  const shocks = JSON.parse(readFileSync(path.join(ROOT, 'data', 'shocks.json'), 'utf8')).shocks;
  const map = new Map();
  for (const s of shocks) {
    for (const src of s.sources || []) {
      if (!map.has(src.url)) map.set(src.url, []);
      if (!map.get(src.url).includes(s.id)) map.get(src.url).push(s.id);
    }
  }
  return map;
}

const FEED_BODY = {
  gazette2: 'gazette2-baseline.xml',
  gazette1: 'gazette1-baseline.xml',
  cbsa: 'cbsa-index.html',
  finance: 'finance-news.json',
  pmo: 'pmo-news.json',
  fedreg: 'fedreg.json'
};

/**
 * The issue contents pages the two Gazette feeds link to.
 *
 * These exist because reading the Gazette takes two requests, not one. The
 * feed announces an issue and this is what the watcher opens to find out
 * whether anything in it matters. A fixture set without them would test a
 * shape the watcher never meets.
 */
const ISSUE_BODY = {
  'https://gazette.gc.ca/rp-pr/p2/2026/2026-08-19/html/index-eng.html': 'gazette2-issue-baseline.html',
  'https://gazette.gc.ca/rp-pr/p2/2026/2026-08-05/html/index-eng.html': 'gazette2-issue-baseline.html',
  'https://gazette.gc.ca/rp-pr/p2/2026/2026-09-02/html/index-eng.html': 'gazette2-issue-new.html',
  'https://gazette.gc.ca/rp-pr/p1/2026/2026-08-22/html/index-eng.html': 'gazette1-issue-baseline.html',
  'https://gazette.gc.ca/rp-pr/p1/2026/2026-08-08/html/index-eng.html': 'gazette1-issue-baseline.html',
  'https://gazette.gc.ca/rp-pr/p1/2026/2026-09-05/html/index-eng.html': 'gazette1-issue-new.html'
};

/**
 * Write a fixture manifest into `dir`. Every cited URL is served the same page
 * unless `overrides` says otherwise, and the set of cited URLs comes from the
 * live data file, so this does not have to know how many there are.
 */
function fixtures(dir, { feeds = {}, source = 'source-page.html', overrides = {} } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(FIX)) cpSync(path.join(FIX, name), path.join(dir, name));
  const manifest = {};
  for (const f of FEEDS) {
    const body = feeds[f.key] || FEED_BODY[f.key];
    manifest[f.url] = { status: 200, body };
  }
  for (const [url, body] of Object.entries(ISSUE_BODY)) manifest[url] = { status: 200, body };
  for (const url of citedUrls().keys()) manifest[url] = { status: 200, body: source };
  for (const [url, entry] of Object.entries(overrides)) manifest[url] = entry;
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

const runWith = (root, dir, extra = {}) => run({
  root,
  state: path.join(root, 'watch', 'state.json'),
  fetchImpl: fixtureFetch(dir),
  delayMs: 0,
  checkRobots: false,
  runDate: '2026-08-27',
  ...extra
});

/* ================================================================== */
(async () => {

  /* ---------------------------------------------------------------- */
  g('BOUNDARY: the watcher cannot touch the fact base');

  {
    const root = tempRoot();
    let threwShocks = false, threwNested = false, allowedState = true, threwOutside = false;
    try { refuseDataPath(root, path.join(root, 'data', 'shocks.json')); } catch { threwShocks = true; }
    try { refuseDataPath(root, path.join(root, 'data', 'i18n', 'fr.json')); } catch { threwNested = true; }
    try { refuseDataPath(root, path.join(root, 'watch', 'state.json')); } catch { allowedState = false; }

    ok('writing data/shocks.json is refused', threwShocks);
    ok('writing anything nested under data/ is refused', threwNested);
    ok('writing watch/state.json is allowed', allowedState);

    // The state file is the only thing the watcher may write, so it may not be
    // talked into writing state somewhere else either.
    try {
      await run({ root, state: path.join(root, 'data', 'state.json'), fetchImpl: async () => { throw new Error('x'); } });
    } catch { threwOutside = true; }
    ok('a state path under data/ is refused before any request is made', threwOutside);
  }

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    const before = treeHash(path.join(root, 'data'));
    await runWith(root, dir);
    await runWith(root, fixtures(path.join(root, 'fx2'), { source: 'source-page-changed.html' }));
    const after = treeHash(path.join(root, 'data'));
    ok('a full run leaves every file under data/ byte-identical', before === after);
  }

  {
    // The path filter is in the workflow, not in a comment. If somebody widens
    // it so the watcher could commit a record, these two fail.
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'watch.yml'), 'utf8');
    ok('the commit step stages only watch/state.json',
       /git add -- watch\/state\.json/.test(yml)
       && !/git add\s+(-A|--all|\.)\s*$/m.test(yml));
    ok('the commit step refuses if anything under data/ reached the index',
       /git diff --cached --name-only \| grep -q '\^data\/'/.test(yml)
       && /exit 1/.test(yml));
    ok('the watcher never writes a verified date anywhere in its source',
       !readdirSync(path.join(ROOT, 'watch'))
         .filter(n => n.endsWith('.mjs'))
         .some(n => /verified\s*[:=]/.test(readFileSync(path.join(ROOT, 'watch', n), 'utf8'))));
  }

  /* ---------------------------------------------------------------- */
  g('STATE: what "since last time" means');

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    const first = await runWith(root, dir);
    ok('a first run reports nothing, because everything is a baseline',
       !first.raise && first.report.newItems.length === 0 && first.report.moved.length === 0);

    const cited = citedUrls();
    const state = loadState(path.join(root, 'watch', 'state.json'));
    ok('a first run records a hash for every cited source, however many there are',
       Object.keys(state.sources).length === cited.size
       && Object.values(state.sources).every(s => typeof s.hash === 'string' && s.hash.length > 0));

    const second = await runWith(root, dir);
    ok('a second run with unchanged sources reports nothing', !second.raise);

    const third = await runWith(root, fixtures(path.join(root, 'fx2'), { source: 'source-page-changed.html' }));
    ok('a run with a changed cited source reports it', third.report.moved.length > 0);
    ok('every cited source that changed is named, and nothing else is',
       third.report.moved.length === cited.size);
    const anyMoved = third.report.moved[0];
    ok('a moved source names the record ids that cite it',
       Array.isArray(anyMoved.ids) && anyMoved.ids.length > 0
       && anyMoved.ids.every(id => cited.get(anyMoved.url).includes(id)));
  }

  {
    // The cry-wolf check. A page whose date stamp, session token, analytics
    // blob and promotional banner all changed, but whose content did not.
    const a = contentHash(readFileSync(path.join(FIX, 'source-page.html'), 'utf8'));
    const b = contentHash(readFileSync(path.join(FIX, 'source-page-noise.html'), 'utf8'));
    const c = contentHash(readFileSync(path.join(FIX, 'source-page-changed.html'), 'utf8'));
    ok('a changed date stamp, token and banner do not count as drift', a === b);
    ok('a changed rate in the body does count as drift', a !== c);
    const text = meaningfulText(readFileSync(path.join(FIX, 'source-page.html'), 'utf8'));
    ok('the hashed text excludes scripts, styles, nav and footer',
       !text.includes('sessiontoken') && !text.includes('analytics')
       && !text.includes('justice laws website') && !text.includes('date modified'));
    ok('the hashed text keeps what the page actually says',
       text.includes('sor/2025-95') && text.includes('25 percent of the value for duty'));
  }

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    await runWith(root, dir);
    const before = loadState(path.join(root, 'watch', 'state.json'));
    // A source that answers 304 must be left exactly as it was.
    const url = [...citedUrls().keys()][0];
    const dir2 = fixtures(path.join(root, 'fx2'), {
      overrides: { [url]: { status: 200, body: 'source-page.html', etag: 'W/"v1"' } }
    });
    await runWith(root, dir2);
    const mid = loadState(path.join(root, 'watch', 'state.json'));
    ok('an etag offered by the server is stored for the next request', mid.sources[url].etag === 'W/"v1"');
    const third = await runWith(root, dir2);
    ok('a 304 is treated as unchanged and reported as nothing', !third.report.moved.some(m => m.url === url));
    ok('a 304 leaves the stored hash alone',
       loadState(path.join(root, 'watch', 'state.json')).sources[url].hash === before.sources[url].hash);
  }

  /* ---------------------------------------------------------------- */
  g('NEW MATERIAL: something has been published');

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    await runWith(root, dir);
    const dir2 = fixtures(path.join(root, 'fx2'), { feeds: { gazette2: 'gazette2-new.xml' } });
    const r = await runWith(root, dir2);

    const item = r.report.newItems.find(i => /sor-dors203/.test(i.link || ''));
    ok('a new Gazette item is reported', Boolean(item));
    ok('the item is named and linked',
       Boolean(item && item.title && /gazette\.gc\.ca/.test(item.link)));
    ok('the item names the record it relates to, matched by instrument name',
       Boolean(item && item.records.includes('CA_STEEL_ALU_2025')));
    ok('the unrelated item in the same feed is not reported',
       !r.report.newItems.some(i => /potassium/i.test(i.title)));
    ok('the issue body names and links the item',
       r.body.includes(item.title) && r.body.includes(item.link));
  }

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    await runWith(root, dir);
    const dir2 = fixtures(path.join(root, 'fx2'), { feeds: { gazette1: 'gazette1-unmatched.xml' } });
    const r = await runWith(root, dir2);
    const item = r.report.newItems.find(i => /solar/i.test(i.title));
    ok('relevant new material that matches no record is still reported', Boolean(item));
    ok('it says plainly that nothing matched, which is the new-record signal',
       Boolean(item) && item.records.length === 0
       && /matched no\s+existing record/.test(r.body.replace(/\s+/g, ' ')));
    ok('a Part I item is marked as a proposal rather than an instrument',
       Boolean(item) && item.proposal === true);
  }

  /* ---------------------------------------------------------------- */
  g('UNREAD: a source that could not be read');

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    await runWith(root, dir);
    const before = loadState(path.join(root, 'watch', 'state.json'));

    const url = [...citedUrls().keys()][0];
    const dir2 = fixtures(path.join(root, 'fx2'), { overrides: { [url]: { status: 403 } } });
    const r = await runWith(root, dir2);

    ok('a 403 is reported as unread', r.report.unread.some(u => u.url === url));
    ok('a 403 is not reported as unchanged', !r.report.moved.some(m => m.url === url));
    ok('an unread source raises the issue rather than passing in silence', r.raise);
    ok('an unread source names the records that cite it',
       r.report.unread.find(u => u.url === url).ids.length > 0);
    ok('no new hash is recorded for a source that could not be read',
       loadState(path.join(root, 'watch', 'state.json')).sources[url].hash === before.sources[url].hash);
    ok('the issue body says it could not be read, not that it was unchanged',
       /could not be read/i.test(r.body) && r.body.includes(url));
  }

  {
    const root = tempRoot();
    const url = [...citedUrls().keys()][0];
    const dir = fixtures(path.join(root, 'fx'), {
      overrides: { [url]: { error: 'socket hang up' } }
    });
    const r = await runWith(root, dir);
    ok('a network failure is reported as unread', r.report.unread.some(u => u.url === url));
    ok('a feed that cannot be read is reported too, not skipped',
       (await runWith(tempRoot(), fixtures(path.join(tempRoot(), 'fx'), {
         overrides: { [FEEDS[0].url]: { status: 500 } }
       }))).report.unread.some(u => u.url === FEEDS[0].url));
  }

  /* ---------------------------------------------------------------- */
  g('THE ISSUE: what the maintainer actually receives');

  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'));
    const quiet = await runWith(root, dir);
    ok('a run with nothing to say raises no issue and writes no body',
       !quiet.raise && quiet.body === '');
    ok('hasSomethingToSay agrees with the empty case',
       !hasSomethingToSay({ newItems: [], moved: [], unread: [] }));

    const body = composeBody({
      newItems: [{ name: 'Canada Gazette Part II', title: 'An order', link: 'https://x/y', date: '', records: ['CA_STEEL_ALU_2025'] }],
      moved: [{ url: 'https://x/z', label: 'A page', ids: ['CA_RETAL_2026-09'] }],
      unread: [{ what: 'A feed', url: 'https://x/q', reason: 'HTTP 403', ids: [] }],
      runDate: '2026-08-27'
    });
    ok('the body carries all three sections when all three have content',
       /## New material/.test(body) && /## Sources that moved/.test(body)
       && /## Sources that could not be read/.test(body));
    ok('a section with nothing in it is omitted',
       !/## Sources that moved/.test(composeBody({ newItems: [], moved: [], unread: [{ what: 'f', url: 'u', reason: 'r', ids: [] }] })));
    ok('the report never claims to summarise what changed on a page',
       !/summary of changes|what changed:/i.test(body));
    ok('the body restates that a verified date is a person\'s act',
       /verified.*person|person.*verified/is.test(body));

    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'watch.yml'), 'utf8');
    ok('the workflow reuses an open issue rather than opening a new one each run',
       /gh issue list --state open --search/.test(yml) && /gh issue comment/.test(yml));
    ok('the workflow closes the issue when there is nothing to say',
       /gh issue close/.test(yml));
    ok('the workflow runs twice a day and can be triggered by hand',
       /cron: '[^']*7,19/.test(yml) && /workflow_dispatch:/.test(yml));
    ok('the workflow is offset from the Monday weekly check',
       !/cron: '0 12 \* \* 1'/.test(yml));
  }

  /* ---------------------------------------------------------------- */
  g('POLITENESS: being a well behaved client');

  {
    ok('the User-Agent names the project', /PlainTradeDesk/i.test(USER_AGENT));
    ok('the User-Agent carries a contact address a person reads',
       USER_AGENT.includes('dasoftworks@gmail.com'));
    ok('the contact address is the one the About page publishes',
       readFileSync(path.join(ROOT, 'data', 'pages.json'), 'utf8').includes('dasoftworks@gmail.com'));

    const rules = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/ok/\n');
    ok('robots.txt disallow is understood', !robotsAllow(rules, '/private/thing'));
    ok('a longer Allow beats a shorter Disallow', robotsAllow(rules, '/private/ok/thing'));
    ok('anything not mentioned is allowed', robotsAllow(rules, '/public/thing'));
    ok('an empty Disallow means nothing is disallowed',
       robotsAllow(parseRobots('User-agent: *\nDisallow:\n'), '/anything'));

    // A disallowed path is reported as unread, never fetched and never assumed.
    let fetched = 0;
    const client = new Client({
      delayMs: 0,
      fetchImpl: async (url) => {
        fetched++;
        if (url.endsWith('/robots.txt')) {
          return { status: 200, headers: { get: () => null }, text: async () => 'User-agent: *\nDisallow: /blocked/\n' };
        }
        return { status: 200, headers: { get: () => null }, text: async () => 'hello' };
      }
    });
    const blocked = await client.get('https://example.test/blocked/page.html');
    ok('a path robots.txt disallows is not fetched', blocked.kind === 'unread' && fetched === 1);
    ok('and it is reported as unread rather than unchanged', /robots/i.test(blocked.reason));

    const allowed = await client.get('https://example.test/open/page.html');
    ok('an allowed path is fetched, and robots.txt is only read once',
       allowed.kind === 'ok' && fetched === 2);

    let sentHeaders = null;
    const c2 = new Client({
      delayMs: 0, checkRobots: false,
      fetchImpl: async (url, opts) => {
        sentHeaders = opts.headers;
        return { status: 304, headers: { get: () => null }, text: async () => '' };
      }
    });
    const res = await c2.get('https://example.test/a', { etag: 'W/"1"', lastModified: 'Mon, 25 Aug 2026 00:00:00 GMT' });
    ok('a conditional request sends If-None-Match and If-Modified-Since',
       sentHeaders['if-none-match'] === 'W/"1"'
       && sentHeaders['if-modified-since'] === 'Mon, 25 Aug 2026 00:00:00 GMT');
    ok('a 304 is unchanged, and nothing is re-hashed', res.kind === 'unchanged');
    ok('every request identifies itself', sentHeaders['user-agent'] === USER_AGENT);

    let order = [];
    const c3 = new Client({
      delayMs: 5, checkRobots: false, sleep: async () => { order.push('wait'); },
      fetchImpl: async () => { order.push('get'); return { status: 200, headers: { get: () => null }, text: async () => 'x' }; }
    });
    await c3.get('https://example.test/1');
    await c3.get('https://example.test/2');
    ok('requests are serial and paced, with no pause before the first',
       order.join(',') === 'get,wait,get');
  }

  /* ---------------------------------------------------------------- */
  g('PARSING: the shapes these sources actually come in');

  {
    ok('RSS items are read', parseFeed(readFileSync(path.join(FIX, 'gazette2-baseline.xml'), 'utf8')).length === 2);
    ok('the Federal Register JSON API is read',
       parseFederalRegister(readFileSync(path.join(FIX, 'fedreg.json'), 'utf8')).length === 2);
    ok('a malformed feed yields nothing rather than throwing', parseFeed('<rss><channel>').length === 0);
    ok('malformed JSON yields nothing rather than throwing', parseFederalRegister('{oops').length === 0);

    const CBSA_URL = 'https://www.cbsa-asfc.gc.ca/publications/cn-ad/menu-eng.html';
    const cbsaHtml = readFileSync(path.join(FIX, 'cbsa-index.html'), 'utf8');
    const cbsa = parseNoticeTable(cbsaHtml, CBSA_URL, /\/cn-ad\/cn\d{2}-\d{2}/i);
    ok('the CBSA index yields customs notices and not navigation', cbsa.length === 4);
    ok('index links are made absolute',
       cbsa.every(i => i.link.startsWith('https://www.cbsa-asfc.gc.ca/')));
    // The regression this whole round exists for. The anchor holds "26-17" and
    // the title is in the next cell, so a reader that trusts the anchor text
    // finds nothing, which is what shipped and what nothing here caught.
    ok('a notice title is read from the cell beside the link, not the link text',
       cbsa.some(i => /Wood Cabinet and Vanity/i.test(i.title)));
    ok('the notice number is kept, because the fact base cites notices by number',
       cbsa.some(i => /\b26-17\b/.test(i.title)));
    ok('the generic index reader cannot read this page, which is why there are two',
       parseIndex(cbsaHtml, CBSA_URL, /\/cn-ad\/cn\d{2}-\d{2}/i).length === 0);

    const issue = parseGazetteIssue(
      readFileSync(path.join(FIX, 'gazette2-issue-new.html'), 'utf8'),
      'https://gazette.gc.ca/rp-pr/p2/2026/2026-09-02/html/index-eng.html');
    ok('a Gazette issue yields the instruments in it', issue.length === 2);
    ok('an instrument carries its registration number, which sits outside the link',
       issue.some(i => /SOR\/2025-95/.test(i.title)));
    ok('an instrument link is made absolute against the issue it came from',
       issue.every(i => i.link.startsWith('https://gazette.gc.ca/rp-pr/p2/2026/2026-09-02/html/')));
    ok('site furniture on the contents page is not read as an instrument',
       !issue.some(i => /Jobs and the workplace|Contact us/i.test(i.title)));

    const finance = parseCanadaNews(readFileSync(path.join(FIX, 'finance-news.json'), 'utf8'));
    ok('the canada.ca news API is read', finance.length === 3);
    ok('a news entry carries its title, link and date',
       Boolean(finance[0].title && finance[0].link && finance[0].date));
    ok('malformed news JSON yields nothing rather than throwing',
       parseCanadaNews('{oops').length === 0);

    const pmo = parseDrupalAjax(readFileSync(path.join(FIX, 'pmo-news.json'), 'utf8'),
      'https://www.pm.gc.ca/en/news', /\/news\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\//i);
    ok('a Drupal AJAX reply is unwrapped to the listing it carries', pmo.length === 2);
    ok('the listing links are made absolute',
       pmo.every(i => i.link.startsWith('https://www.pm.gc.ca/')));
    ok('a Drupal reply that is not an array yields nothing rather than throwing',
       parseDrupalAjax('{"command":"insert"}', 'https://www.pm.gc.ca/en/news').length === 0);

    const fb = loadFactBase(ROOT);
    ok('instrument names are read out of the data, not hardcoded',
       fb.instruments.has('sor/2025-95') && fb.instruments.has('cn25-11')
       && fb.instruments.has('cn26-07') && fb.instruments.has('cn26-17'));
    ok('an instrument name maps to the records that cite it',
       fb.instruments.get('sor/2025-95').includes('CA_STEEL_ALU_2025'));
    ok('the cited URL count comes from the data',
       fb.citedBy.size === citedUrls().size);
    ok('a customs notice number is recognised in either prose or URL form',
       instrumentTokens('Customs Notice 26-17').has('cn26-17')
       && instrumentTokens('/cn-ad/cn26-17-eng.html').has('cn26-17'));

    ok('an item with no vocabulary and no instrument is not relevant',
       !isRelevant({ title: 'Regulations Amending the Food and Drug Regulations', link: 'https://x/y' }, fb));
    ok('an item naming an instrument is relevant',
       isRelevant({ title: 'Order Amending SOR/2025-95', link: 'https://x/y' }, fb));
    ok('one shared word is not enough to claim a record is related',
       relatedRecords({ title: 'A tariff on something else entirely', link: 'https://x/y' }, fb).length === 0);
  }

  /* ---------------------------------------------------------------- */
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });

  let failed = 0;
  for (const r of results) {
    if (r[0] === 'GROUP') { console.log('\n' + r[1]); continue; }
    if (r[0] === 'FAIL') failed++;
    console.log('  ' + r[0] + '  ' + r[1]);
  }
  const total = results.filter(r => r[0] !== 'GROUP').length;
  console.log(failed ? `\nFAILED ${failed} of ${total} watcher checks` : `\nAll ${total} watcher checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
