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

import { spawnSync } from 'node:child_process';
import { run, refuseDataPath, fixtureFetch, loadState, emptyState, formatDropped } from '../watch/watch.mjs';
import { Client, parseRobots, robotsAllow, USER_AGENT } from '../watch/net.mjs';
import {
  contentHash, meaningfulText, parseFeed, parseFederalRegister, parseIndex,
  parseGazetteIssue, parseNoticeTable, parseCanadaNews, parseDrupalAjax
} from '../watch/extract.mjs';
import {
  FEEDS, VOCABULARY, US_VOCABULARY, loadFactBase, instrumentTokens, instrumentNames,
  isRelevant, relatedRecords, wordForms
} from '../watch/sources.mjs';
import { composeBody, hasSomethingToSay, needsAPerson, NEEDS_A_PERSON } from '../watch/report.mjs';
import { dateEvents } from '../watch/dates.mjs';

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
  fedreg: 'fedreg.json',
  fedregpres: 'fedreg-pres.json'
};

const feed = key => FEEDS.find(f => f.key === key);

/** A copy of the data with one record's JSON text edited, for fact-base cases. */
function editedFactBase(edit) {
  const root = tempRoot();
  const file = path.join(root, 'data', 'shocks.json');
  const d = JSON.parse(readFileSync(file, 'utf8'));
  edit(d);
  writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  return { root, fb: loadFactBase(root) };
}

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
    // The same check against the shape that actually cried wolf in production.
    // A trade blog cited by US_S338_2026-08 reported drift on four of five
    // consecutive runs while its article sat untouched, because the hashed
    // region held a "Recent Posts" sidebar that turns over every few days.
    const a = contentHash(readFileSync(path.join(FIX, 'blog-post.html'), 'utf8'));
    const b = contentHash(readFileSync(path.join(FIX, 'blog-post-noise.html'), 'utf8'));
    const c = contentHash(readFileSync(path.join(FIX, 'blog-post-changed.html'), 'utf8'));
    ok('a rotating sidebar does not count as drift', a === b);
    ok('an edit to the headings the record cites does count as drift', a !== c);

    const text = meaningfulText(readFileSync(path.join(FIX, 'blog-post.html'), 'utf8'));
    ok('a sidebar is not part of what a page says',
       !text.includes('recent posts') && !text.includes('archives'));
    ok('the article itself survives the sidebar being dropped',
       text.includes('9903.03.12') && text.includes('554 tariff subheadings'));

    // The one that guards the fix from being widened. The same blog carries
    // "Published July 20, 2026 | Updated Aug. 25, 2026", and stripping that
    // shape is tempting. On a customs notice the identical words are the
    // notice's own amendment history, and a new line appearing there is the
    // most valuable thing this watcher reports: it is how SOR/2026-187 was
    // found. Anything that silences the second to quieten the first is a bad
    // trade, so both of these must keep passing.
    const notice = meaningfulText(readFileSync(path.join(FIX, 'customs-notice-amended.html'), 'utf8'));
    ok("a customs notice's amendment history is content, not a date stamp",
       notice.includes('updated: march 27, 2025') && notice.includes('updated: september 7, 2026'));
    const amended = readFileSync(path.join(FIX, 'customs-notice-amended.html'), 'utf8');
    ok('a newly added amendment line on a notice does count as drift',
       contentHash(amended) !== contentHash(amended.replace('<p>Updated: September 7, 2026</p>', '')));
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
  g('EMPTY PARSE: read cleanly, and nothing came out');

  // The gap that let four parsers read nothing for a week while every run
  // reported "everything readable". A 200 that yields zero raw items is a
  // parser that has stopped fitting its page, and it now says so itself
  // instead of waiting for somebody to find a zero-item baseline suspicious.
  {
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'), { feeds: { cbsa: 'cbsa-empty.html' } });
    const r = await runWith(root, dir);

    ok('a source that reads cleanly and parses to nothing is reported',
       r.report.emptyParse.some(e => /CBSA/i.test(e.what)));
    ok('it is not reported as unread, because the page was read',
       !r.report.unread.some(u => /CBSA/i.test(u.what)));
    ok('an empty parse opens the issue rather than closing it as a quiet run', r.raise);
    ok('the issue states it as its own claim, not as nothing-to-report',
       /read fine but parsed to nothing/i.test(r.body));
    ok('the run log counts it apart from unread', /parsed to nothing/.test(r.summary));
  }

  {
    // The case this must never fire on. Items were found and none of them
    // mattered, which is an ordinary quiet week and says nothing is broken.
    const root = tempRoot();
    const dir = fixtures(path.join(root, 'fx'), { feeds: { pmo: 'pmo-nothing-relevant.json' } });
    const r = await runWith(root, dir);
    ok('a feed with items but none relevant is not an empty parse',
       !r.report.emptyParse.some(e => /Prime Minister/i.test(e.what)));
    ok('and a run where that is all that happened stays quiet', !r.raise);
  }

  {
    // The same signal one level down: the Gazette's second request.
    const root = tempRoot();
    await runWith(root, fixtures(path.join(root, 'fx')));
    const dir2 = fixtures(path.join(root, 'fx2'), {
      feeds: { gazette2: 'gazette2-new.xml' },
      overrides: {
        'https://gazette.gc.ca/rp-pr/p2/2026/2026-09-02/html/index-eng.html':
          { status: 200, body: 'gazette2-issue-empty.html' }
      }
    });
    const r = await runWith(root, dir2);
    ok('an issue that opens but yields no instruments is reported as an empty parse',
       r.report.emptyParse.some(e => /2026-09-02/.test(e.url)));
    ok('an empty issue is not reported as new material', r.report.newItems.length === 0);
    ok('an empty issue is not reported as unread either',
       !r.report.unread.some(u => /2026-09-02/.test(u.url)));
  }

  /* ---------------------------------------------------------------- */
  g('THIN PARSE: read fine, and read far less than usual');

  // The gap emptyParse left: a source that halves rather than empties. The
  // baseline CBSA fixture carries four notices, so three prior readings of
  // four make the floor four, and one notice is under half of it.
  {
    const root = tempRoot();
    for (let i = 0; i < 3; i++) await runWith(root, fixtures(path.join(root, `fx${i}`)));
    const r = await runWith(root, fixtures(path.join(root, 'thin'), { feeds: { cbsa: 'cbsa-thin.html' } }));

    const t = r.report.thinParse.find(x => /CBSA/i.test(x.what));
    ok('a source that reads far fewer items than usual is reported', Boolean(t));
    ok('it says what it read and what it usually reads',
       Boolean(t) && t.count === 1 && t.usual === 4);
    ok('it is not reported as an empty parse, because items came back',
       !r.report.emptyParse.some(e => /CBSA/i.test(e.what)));
    ok('it is not reported as unread, because the page was read',
       !r.report.unread.some(u => /CBSA/i.test(u.what)));
    ok('a thin read opens the issue rather than closing it as a quiet run', r.raise);
    ok('the issue states it as its own claim',
       /read noticeably fewer items than usual/i.test(r.body));
    ok('the run log counts it apart from the others', /read unusually thin/.test(r.summary));
  }

  {
    // Too little history to judge. Two readings is one bad reading away from
    // calling an upstream hiccup a collapse, so it must stay quiet.
    const root = tempRoot();
    for (let i = 0; i < 2; i++) await runWith(root, fixtures(path.join(root, `fx${i}`)));
    const r = await runWith(root, fixtures(path.join(root, 'thin'), { feeds: { cbsa: 'cbsa-thin.html' } }));
    ok('a feed without enough history is not judged, however low the count',
       !r.report.thinParse.some(x => /CBSA/i.test(x.what)));
  }

  {
    // Moved, but within range. A threshold that fires on ordinary movement is
    // one that gets ignored.
    const root = tempRoot();
    for (let i = 0; i < 3; i++) await runWith(root, fixtures(path.join(root, `fx${i}`)));
    const r = await runWith(root, fixtures(path.join(root, 'two'), { feeds: { cbsa: 'cbsa-two.html' } }));
    ok('a count that moved but stayed in range is not reported',
       !r.report.thinParse.some(x => /CBSA/i.test(x.what)));
  }

  {
    // Zero is emptyParse's to report. Saying it twice helps nobody.
    const root = tempRoot();
    for (let i = 0; i < 3; i++) await runWith(root, fixtures(path.join(root, `fx${i}`)));
    const r = await runWith(root, fixtures(path.join(root, 'empty'), { feeds: { cbsa: 'cbsa-empty.html' } }));
    ok('a count of zero is reported once, as an empty parse and not also as thin',
       r.report.emptyParse.some(e => /CBSA/i.test(e.what))
       && !r.report.thinParse.some(x => /CBSA/i.test(x.what)));
  }

  {
    // The history itself, which is what any of this rests on.
    const root = tempRoot();
    await runWith(root, fixtures(path.join(root, 'fx')));
    const st = loadState(path.join(root, 'watch', 'state.json'));
    ok('a feed records the raw count it read, not the relevant one',
       st.feeds.cbsa.counts[0] === 4);
    // The Gazette's own feed is a standing list of issues and is compared like
    // any other. What is deliberately not compared is the size of one issue,
    // which varies honestly and has no floor worth inventing.
    ok('the Gazette feed records its issue count like any other feed',
       st.feeds.gazette2.counts[0] === 2);
    ok('history is kept newest first and bounded',
       Array.isArray(st.feeds.cbsa.counts) && st.feeds.cbsa.counts.length <= 8);
  }

  {
    // The Gazette's second request stays out of it: a thin issue is reported
    // only when it is empty, and never as a count compared to other issues.
    const root = tempRoot();
    for (let i = 0; i < 3; i++) await runWith(root, fixtures(path.join(root, `fx${i}`)));
    const r = await runWith(root, fixtures(path.join(root, 'g'), {
      feeds: { gazette2: 'gazette2-new.xml' },
      overrides: {
        'https://gazette.gc.ca/rp-pr/p2/2026/2026-09-02/html/index-eng.html':
          { status: 200, body: 'gazette1-issue-new.html' }
      }
    }));
    ok('a smaller-than-usual issue is not reported as thin',
       !r.report.thinParse.some(x => /2026-09-02/.test(x.url || '')));
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

    // The real case: the Gazette titles this instrument in the singular and
    // the record it belongs to is titled in the plural, so two words in common
    // matched neither, and the order that created the record was reported
    // with no record attached.
    ok('a singular in the item matches a plural in the record title',
       relatedRecords({
         title: 'Certain Wood Cabinet and Vanity Goods Surtax Order',
         link: 'https://gazette.gc.ca/rp-pr/p2/2026/2026-08-12/html/sor-dors169-eng.html'
       }, fb).includes('CA_CABINETS_2026-07'));
    ok('cabinets matches cabinet, both directions', wordForms('cabinets').has('cabinet')
       && wordForms('cabinet').has('cabinets'));
    ok('vanities matches vanity, both directions', wordForms('vanities').has('vanity')
       && wordForms('vanity').has('vanities'));
    ok('a double s is not mistaken for a plural', !wordForms('address').has('addres'));
    ok('the widening is only plurals, not stemming',
       !wordForms('imported').has('import') && !wordForms('safeguard').has('safeguarding'));
  }

  /* ---------------------------------------------------------------- */
  g('RELEVANCE: what the US side and the Prime Minister actually call things');

  // The real titles that every one returned false in the October quarterly
  // review, and the Section 232 guidance the watcher found on 14 October.
  // Judged twice: against the fact base as it is, and against one with no
  // instrument tokens at all, because the next US instrument will not be cited
  // by any record yet and the words alone have to carry it.
  {
    const FR = 'https://www.federalregister.gov/documents/';
    const POSITIVE = [
      ['fedreg', 'Excluding Certain Canadian Products From Importation Into the United States in Response to Continued Discrimination Against the Commerce of the United States With Respect to Alcoholic Beverages',
        FR + '2026/09/14/2026-18835/excluding-certain-canadian-products-from-importation-into-the-united-states-in-response-to-continued'],
      ['fedreg', 'Modifying the Scope of Products of Canada Subject to the Additional Duties Imposed To Offset Canadian Discrimination Against the Commerce of the United States With Respect to Motor Vehicles',
        FR + '2026/09/14/2026-18839/modifying-the-scope-of-products-of-canada-subject-to-the-additional-duties-imposed-to-offset'],
      ['fedregpres', 'Restoring Reciprocity in Government Procurement',
        FR + '2026/09/21/2026-19336/restoring-reciprocity-in-government-procurement'],
      ['pmo', 'Statement by Prime Minister Carney on Canada-U.S. trade negotiations',
        'https://www.pm.gc.ca/en/news/statements/2026/08/21/statement-prime-minister-carney-canada-us-trade-negotiations'],
      ['pmo', 'Prime Minister Carney delivers remarks on Canada-U.S. trade negotiations',
        'https://www.pm.gc.ca/en/news/speeches/2026/08/22/prime-minister-carney-delivers-remarks-canada-us-trade-negotiations'],
      ['fedreg', "Guidance to U.S. Customs and Border Protection Regarding the Assessment of “U.S. Content” for Purposes of Implementing Tariffs Pursuant to Clause (2)(D) of Proclamation 11032 of June 1, 2026",
        FR + '2026/10/14/2026-20938/guidance-to-us-customs-and-border-protection-regarding-the-assessment-of-us-content']
    ];
    const fb = loadFactBase(ROOT);
    const bare = { ...fb, instruments: new Map() };
    for (const [key, title, link] of POSITIVE) {
      ok(`relevant: ${title.slice(0, 70)}`, isRelevant({ title, link }, fb, feed(key)));
      ok(`relevant with no record citing it: ${title.slice(0, 50)}`, isRelevant({ title, link }, bare, feed(key)));
    }
    ok('the Section 232 wording is accepted on the Federal Register feeds',
       isRelevant({ title: 'Adjusting Imports of Copper Into the United States', link: FR + 'x' }, bare, feed('fedreg'))
       && isRelevant({ title: 'Adjusting Imports of Copper Into the United States', link: FR + 'x' }, bare, feed('fedregpres')));
    ok('the procurement memorandum is not even returned by the tariff query, which is why there is a second one',
       /PRESDOCU/.test(feed('fedregpres').url) && /conditions\[term\]=Canada&/.test(feed('fedregpres').url)
       && /Canada%20tariff/.test(feed('fedreg').url));

    const NEGATIVE = [
      // The Federal Register vocabulary, on real titles from the Canada query.
      ['fedreg', 'Large Diameter Welded Pipe From Canada: Preliminary Results of Changed Circumstances Review'],
      ['fedreg', 'Initiation of Antidumping and Countervailing Duty Administrative Reviews'],
      ['fedreg', 'Advance Traveler Information for Rail'],
      // The presidential query, which names Canada in everything it returns.
      ['fedregpres', 'Honoring the American History of the Great Lakes and Renaming Lake Ontario as Lake America'],
      ['fedregpres', 'Presidential Determination on Major Drug Transit or Major Illicit Drug Producing Countries for Fiscal Year 2027'],
      ['fedregpres', 'National Forest Products Week, 2026'],
      // The Prime Minister: trade without the United States, and visits abroad.
      ['pmo', 'Prime Minister Carney speaks with Prime Minister of India Narendra Modi',
        'https://www.pm.gc.ca/en/news/readouts/2026/10/13/prime-minister-carney-speaks-prime-minister-india-narendra-modi'],
      ['pmo', 'Prime Minister Carney announces new trade and security partnership with the European Union',
        'https://www.pm.gc.ca/en/news/news-releases/2026/10/20/prime-minister-carney-announces-new-trade-and-security-partnership-european-union'],
      ['pmo', 'Prime Minister Carney travels to Brussels for the Canada-EU Summit',
        'https://www.pm.gc.ca/en/news/news-releases/2026/10/21/prime-minister-carney-travels-brussels-canada-eu-summit'],
      ['pmo', 'Statement by Prime Minister Carney on Thanksgiving',
        'https://www.pm.gc.ca/en/news/statements/2026/10/12/statement-prime-minister-carney-thanksgiving'],
      // Finance, whose rule did not change, on real titles from its feed.
      ['finance', 'Canada successfully prices seventh green bond issuance, raising $2 billion'],
      ['finance', 'Minister Champagne to travel to the United Kingdom and Ireland to strengthen economic and security ties with Europe'],
      ['finance', 'Minister Champagne introduces legislation to extend the federal fuel excise tax relief for Canadians'],
      // And the reason the US words stay off the shared list: a real CBSA notice.
      ['cbsa', '22-21 Customs Notice 22-21: New Measure Prohibiting the Importation of all Commercial Dogs from Countries at High Risk for Dog Rabies']
    ];
    for (const [key, title, link = 'https://example.test/item'] of NEGATIVE) {
      ok(`not relevant (${key}): ${title.slice(0, 60)}`, !isRelevant({ title, link }, fb, feed(key)));
    }

    ok('a readout of a call with the President of the United States is relevant on its own',
       isRelevant({ title: 'Prime Minister Carney speaks with President of the United States Donald J. Trump',
         link: 'https://www.pm.gc.ca/en/news/readouts/2026/10/11/prime-minister-carney-speaks-president-united-states-donald-j-t' },
         bare, feed('pmo')));
    ok('the Prime Minister rule is the feed\'s own and widens no other feed',
       !isRelevant({ title: 'Canada-U.S. trade negotiations', link: 'https://x/y' }, bare, feed('finance')));
    ok('the US words are not in the shared vocabulary',
       US_VOCABULARY.every(w => !VOCABULARY.includes(w)));
    ok('only the two Federal Register feeds carry the US words',
       FEEDS.filter(f => f.vocabulary).map(f => f.key).sort().join(',') === 'fedreg,fedregpres');
  }

  /* ---------------------------------------------------------------- */
  g('INSTRUMENTS: what a record names, as well as what it numbers');

  {
    ok('a proclamation number in a record is an instrument token',
       instrumentTokens('under Proclamation 11061 and Proclamation No. 11032').has('proclamation 11061')
       && instrumentTokens('Proclamation No. 11032').has('proclamation 11032'));
    ok('a cited Federal Register document number is a token that only a Federal Register link can match',
       instrumentTokens('https://www.federalregister.gov/documents/2026/09/14/2026-18835/excluding').has('/2026-18835/'));
    const fb = loadFactBase(ROOT);
    ok('a new Federal Register item that a record cites is matched to it by number',
       relatedRecords({ title: 'Something', link: 'https://www.federalregister.gov/documents/2026/09/14/2026-18835/x' }, fb)
         .includes('US_S338_BAN_2026-09'));

    // Issue #13. CA_RETAL_2026-09 named the order in words before its number
    // was cited, and only numbers could match, so the Gazette entry for it was
    // reported as matching no record. Rebuilt here: the number taken out of
    // the record, the words left in.
    const { fb: early } = editedFactBase(d => {
      const r = d.shocks.find(s => s.id === 'CA_RETAL_2026-09');
      const text = JSON.stringify(r).replaceAll('SOR/2026-186', 'SOR/2026-XXX').replaceAll('sor-dors186', 'sor-dorsXXX');
      Object.assign(r, JSON.parse(text));
    });
    ok('the case is real: without the number, no numeric token names this order',
       !early.instruments.has('sor/2026-186'));
    const sor186 = {
      title: 'United States Surtax Order (2026) Customs Tariff SOR/2026-186',
      link: 'https://gazette.gc.ca/rp-pr/p2/2026/2026-09-23/html/sor-dors186-eng.html'
    };
    ok('an instrument a record names in words is matched to it (SOR/2026-186, issue #13)',
       relatedRecords(sor186, early).includes('CA_RETAL_2026-09'));
    ok('the bracket keeps two orders of the same name apart',
       !relatedRecords({ title: 'United States Surtax Order (Steel and Aluminum 2025) — Order Amending the Customs Tariff SOR/2026-187', link: 'https://x/y' }, early)
         .includes('CA_RETAL_2026-09'));
    ok('CBSA\'s spacing inside the bracket is the same instrument',
       relatedRecords({ title: '26-23 Customs Notice 26-23: United States Surtax Order ( 2026 )', link: 'https://x/y' }, early)
         .includes('CA_RETAL_2026-09'));

    // The EI regulation, 7 October. Not tariff vocabulary, so only the record
    // naming the regulation it amends could have surfaced it.
    const eiAmendment = {
      title: 'Employment Insurance Act — Regulations Amending the Employment Insurance Regulations SOR/2027-15',
      link: 'https://gazette.gc.ca/rp-pr/p2/2027/2027-02-10/html/sor-dors15-eng.html'
    };
    ok('an amendment to a regulation a record already cites is relevant on the Gazette',
       isRelevant(eiAmendment, fb, feed('gazette2')));
    ok('and it names the record that cites the regulation', relatedRecords(eiAmendment, fb).includes('CA_SUPPORT_2026-08'));
    ok('"Regulations Amending the X Regulations" yields X Regulations as a name',
       instrumentNames('SOR/2026-64, Regulations Amending the Employment Insurance Regulations').has('employment insurance regulations'));
    ok('"the Order" in a sentence is not a name',
       instrumentNames('The Order was made on 4 September. The Order sets three rates.').size === 0);
    ok('an unrelated amending regulation is still not relevant',
       !isRelevant({ title: 'Regulations Amending the Food and Drug Regulations', link: 'https://x/y' }, fb, feed('gazette2')));
  }

  /* ---------------------------------------------------------------- */
  g('INSPECTION: what was set aside can be seen, and a blind feed says so');

  {
    const root = tempRoot();
    const r = await runWith(root, fixtures(path.join(root, 'fx'), { feeds: { pmo: 'pmo-nothing-relevant.json' } }));
    const pmoDropped = r.dropped.find(d => d.key === 'pmo');
    ok('a run returns what each feed read and judged not relevant',
       Boolean(pmoDropped) && pmoDropped.items.some(i => /Chancellor of Germany/.test(i.title)));
    ok('--show-dropped prints it feed by feed', /Chancellor of Germany/.test(formatDropped(r.dropped))
       && formatDropped(r.dropped).includes("Prime Minister's statements"));
    ok('what was dropped never goes into the issue', !/Chancellor of Germany/.test(r.body));
    const help = spawnSync(process.execPath, [path.join(ROOT, 'watch', 'watch.mjs'), '--help'], { encoding: 'utf8' });
    ok('--show-dropped is a documented option', /--show-dropped/.test(help.stdout));
  }

  {
    // Four weeks of reading fine and accepting nothing, which is what the
    // Prime Minister's feed did after launch with nobody able to tell.
    const root = tempRoot();
    const quietDir = fixtures(path.join(root, 'fx'), { feeds: { pmo: 'pmo-nothing-relevant.json' } });
    await runWith(root, quietDir, { runDate: '2026-08-01' });
    const d27 = await runWith(root, quietDir, { runDate: '2026-08-28' });
    ok('a feed quiet for 27 days is not reported', !d27.report.quietFeeds.length);
    const d28 = await runWith(root, quietDir, { runDate: '2026-08-29' });
    const q = d28.report.quietFeeds.find(x => /Prime Minister/.test(x.what));
    ok('a feed that reads fine and accepts nothing for 28 days is reported', Boolean(q));
    ok('only that feed: the others had something relevant in their lists',
       d28.report.quietFeeds.length === 1);
    ok('it is its own section of the issue', /offered nothing relevant for weeks/.test(d28.body));
    ok('it raises the issue, and does not hold it open', d28.raise && !d28.sticky);
    const d29 = await runWith(root, quietDir, { runDate: '2026-08-30' });
    ok('and it is said once a month at most, not every run', !d29.report.quietFeeds.length);
  }

  {
    // Both Federal Register queries return the same proclamation when it names
    // Canada and says "tariff". It is one document and it arrives once.
    const root = tempRoot();
    await runWith(root, fixtures(path.join(root, 'fx')));
    const r = await runWith(root, fixtures(path.join(root, 'fx2'),
      { feeds: { fedreg: 'fedreg-new.json', fedregpres: 'fedreg-pres-new.json' } }));
    const hits = r.report.newItems.filter(i => /2026-99901/.test(i.link));
    ok('a document both Federal Register queries return is reported once', hits.length === 1);
    const again = await runWith(root, fixtures(path.join(root, 'fx3'),
      { feeds: { fedreg: 'fedreg-new.json', fedregpres: 'fedreg-pres-new.json' } }));
    ok('and not again on the next run, from either', !again.report.newItems.some(i => /2026-99901/.test(i.link)));
  }

  /* ---------------------------------------------------------------- */
  g('DATES: a date in a record arriving is something to say');

  {
    const rec = (dates, verified = '2026-10-01') => [{ id: 'X', title: 'A record', verified, dates }];
    const ev = (date, kind = 'starts') => ({ date, kind, what: `something on ${date}` });

    ok('a date seven days out is reported as coming up',
       dateEvents(rec([ev('2026-10-10')]), '2026-10-03').comingUp.length === 1);
    ok('a date eight days out is not',
       dateEvents(rec([ev('2026-10-11')]), '2026-10-03').comingUp.length === 0);
    ok('a passed date with the record checked before it is reported as arrived',
       dateEvents(rec([ev('2026-10-02', 'ends')], '2026-09-30'), '2026-10-03').arrived.length === 1);
    ok('a passed date with the record checked on that day is not',
       dateEvents(rec([ev('2026-10-02', 'ends')], '2026-10-02'), '2026-10-03').arrived.length === 0);
    ok('a passed date with the record checked after it is not',
       dateEvents(rec([ev('2026-10-02', 'ends')], '2026-10-03'), '2026-10-03').arrived.length === 0);
    ok('a date that is today, unchecked, has arrived (the ban took effect on a Tuesday)',
       dateEvents(rec([ev('2026-10-03')], '2026-10-01'), '2026-10-03').arrived.length === 1);

    const first = dateEvents(rec([ev('2026-10-08')]), '2026-10-03');
    const second = dateEvents(rec([ev('2026-10-08')]), '2026-10-04', first.next);
    ok('coming up is said once, not on every run of the week', first.comingUp.length === 1 && second.comingUp.length === 0);
    const day = dateEvents(rec([ev('2026-10-08')]), '2026-10-08', second.next);
    ok('the same event is said again when it arrives', day.arrived.length === 1);
    const after = dateEvents(rec([ev('2026-10-08')]), '2026-10-09', day.next);
    ok('and arrived is said once too', after.arrived.length === 0);
    ok('a record with no dates says nothing', dateEvents([{ id: 'Y', verified: '2026-10-01' }], '2026-10-03').arrived.length === 0);
  }

  {
    // Through the whole run, with the dates sitting in a copy of the real data.
    const root = tempRoot();
    const file = path.join(root, 'data', 'shocks.json');
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const target = d.shocks.find(s => s.id === 'CA_CABINETS_2026-07');
    target.verified = '2026-08-20';
    target.dates = [
      { date: '2026-08-25', kind: 'ends', what: 'a window that closed' },
      { date: '2026-09-03', kind: 'review', what: 'a report due in a week' }
    ];
    writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
    const before = treeHash(path.join(root, 'data'));
    const dir = fixtures(path.join(root, 'fx'));
    const r = await runWith(root, dir);
    ok('a run reports a date that arrived unchecked', r.report.arrived.some(a => a.what === 'a window that closed'));
    ok('and one coming up', r.report.comingUp.some(c => c.what === 'a report due in a week'));
    ok('under their own heading, naming the record',
       /## Dates in the records/.test(r.body) && r.body.includes('`CA_CABINETS_2026-07`'));
    ok('an arrived date holds the issue open for a person', r.sticky && r.body.includes(NEEDS_A_PERSON));
    ok('the date watch changes nothing under data/, verified dates included',
       treeHash(path.join(root, 'data')) === before);
    const again = await runWith(root, dir);
    ok('the next run does not say either again', !again.report.arrived.length && !again.report.comingUp.length);
  }

  {
    // The real records, on the brief's own date: nothing is due within a week
    // of 15 October 2026, and nothing already handled is reported as arrived.
    const fb = loadFactBase(ROOT);
    const now = dateEvents(fb.shocks, '2026-10-15');
    ok('the dates in the real records are quiet today', !now.comingUp.length && !now.arrived.length);
    const cab = dateEvents(fb.shocks, '2027-01-08');
    ok('the cabinet inquiry date is announced a week ahead',
       cab.comingUp.some(e => e.id === 'CA_CABINETS_2026-07' && e.date === '2027-01-15'));
  }

  /* ---------------------------------------------------------------- */
  g('CLOSING: what was reported once stays open until a person closes it');

  {
    const item = { name: 'Canada Gazette Part II', title: 'An order', link: 'https://x/y', date: '', records: [] };
    ok('new material holds the issue open', needsAPerson({ newItems: [item] }));
    ok('a moved source holds the issue open', needsAPerson({ moved: [{ url: 'u', ids: [] }] }));
    ok('an arrived date holds the issue open', needsAPerson({ arrived: [{}] }));
    ok('an unread source does not, because it is said again until it clears',
       !needsAPerson({ unread: [{ what: 'f', url: 'u', reason: 'r', ids: [] }] }));
    ok('nor does a misparse, a thin read, a quiet feed or a date coming up',
       !needsAPerson({ emptyParse: [{}], thinParse: [{}], quietFeeds: [{}], comingUp: [{}] }));
    ok('the body carries the marker when, and only when, a person is needed',
       composeBody({ newItems: [item] }).includes(NEEDS_A_PERSON)
       && !composeBody({ unread: [{ what: 'f', url: 'u', reason: 'r', ids: [] }] }).includes(NEEDS_A_PERSON));

    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'watch.yml'), 'utf8');
    ok('the workflow looks for exactly that marker before closing', yml.includes(NEEDS_A_PERSON));
    ok('it looks in the comments as well as the body, since later runs comment',
       /--json body,comments/.test(yml) && /\.comments\[\]\.body/.test(yml));
    const quietBranch = yml.slice(yml.indexOf('outputs.raise'), yml.indexOf('gh issue close'));
    ok('the check comes before the close, and leaves the issue open when the marker is there',
       quietBranch.includes(NEEDS_A_PERSON)
       && /held=\$\(gh issue view[\s\S]*?\)\s*\n\s*if \[ "\$held" != "0" \]; then\s*\n[^\n]*\n\s*exit 0\s*\n\s*fi/.test(quietBranch));
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
