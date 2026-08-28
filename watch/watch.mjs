/**
 * The source watcher.
 *
 *   node watch/watch.mjs                 read the real sources, update state
 *   node watch/watch.mjs --dry-run       read them, write nothing
 *   node watch/watch.mjs --fixtures DIR  read fixtures instead of the internet
 *
 * Detect and draft, never apply. This process has no code path that writes
 * under `data/`, and `refuseDataPath` below turns that from an intention into
 * something the test suite can prove. The reason is in the repository's own
 * history: the cabinets record was wrong for several builds because nobody had
 * read the instrument, and no feed would have caught it because the source
 * never changed. A watcher that edited records would have propagated that
 * mistake faster rather than catching it.
 *
 * It reports two different kinds of silence and never confuses them. "This page
 * is the same as last time" and "I could not read this page" are separate
 * outcomes all the way through, because a watcher that goes quiet exactly when
 * a site is having trouble is worse than no watcher at all.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from './net.mjs';
import { contentHash } from './extract.mjs';
import { FEEDS, loadFactBase, isRelevant, relatedRecords } from './sources.mjs';
import { composeBody, hasSomethingToSay, summarise } from './report.mjs';
import { today } from '../src/util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(here, '..');
const STATE_VERSION = 1;
/**
 * Per feed. This has to stay larger than the longest feed, or the oldest ids
 * fall off the end and look new again on the next run: Canada Gazette Part I
 * carries 431 issues in a single response today, so 300 was already too small
 * for it the moment that feed started being read properly.
 */
const KEEP_SEEN = 800;

/**
 * How many issues one run will open and read in detail.
 *
 * Ordinarily this is never reached; the Gazette publishes an issue a week or a
 * fortnight. It is here so that a feed being reordered, re-dated or re-issued
 * upstream cannot turn one run into hundreds of requests against gazette.gc.ca.
 * Anything over the limit is reported as unread and left unmarked, so the next
 * run picks it up rather than it being silently dropped.
 */
const MAX_EXPAND_PER_RUN = 6;

/* ------------------------------------------------------------------ */
/* The boundary that is the product                                    */

/**
 * Refuse to write anywhere near the fact base.
 *
 * This is not defensive programming for its own sake. It is the one rule the
 * whole brief is downstream of, and it is here as an executable statement so
 * that a later change which "helpfully" makes the watcher update a `verified`
 * date fails loudly instead of quietly working.
 */
export function refuseDataPath(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  const norm = rel.split(path.sep).join('/');
  if (norm === 'data' || norm.startsWith('data/')) {
    throw new Error(
      `the watcher refuses to write ${norm}: nothing under data/ is ever written by a script. `
      + 'A verified date means a person opened the primary instrument.');
  }
  return file;
}

/** State may only ever live under watch/. */
function assertStatePath(root, file) {
  refuseDataPath(root, file);
  const norm = path.relative(path.resolve(root), path.resolve(file)).split(path.sep).join('/');
  if (norm !== 'watch/state.json' && !norm.startsWith('watch/')) {
    throw new Error(`state must live under watch/, got ${norm}`);
  }
  return file;
}

function writeGuarded(root, file, text) {
  refuseDataPath(root, file);
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, text);
}

/* ------------------------------------------------------------------ */
/* State                                                               */

export function emptyState() {
  return { version: STATE_VERSION, lastRun: null, feeds: {}, sources: {} };
}

export function loadState(file) {
  if (!existsSync(file)) return emptyState();
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return {
      version: STATE_VERSION,
      lastRun: s.lastRun || null,
      feeds: s.feeds || {},
      sources: s.sources || {}
    };
  } catch (e) {
    // A corrupt state file means "start again from baseline", which reports
    // nothing this run rather than reporting everything as new.
    process.stderr.write(`watch: state unreadable (${e.message}), starting from baseline\n`);
    return emptyState();
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */

/**
 * A fetch-compatible function backed by a directory of files and a manifest.
 * The test suite uses this instead of the live internet, because a suite that
 * fails when a government site is slow is a suite that gets disabled.
 */
export function fixtureFetch(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return async (url, opts = {}) => {
    // A "*" entry stands in for every URL the manifest does not name, so a
    // fixture set does not have to be rewritten each time a record gains or
    // loses a source. Without one, an unnamed URL is a 404.
    const entry = manifest[url] || manifest['*'];
    if (!entry) return response(404, '', {});
    if (entry.status && entry.status !== 200) return response(entry.status, '', {});
    if (entry.error) { const e = new Error(entry.error); e.name = entry.errorName || 'Error'; throw e; }
    const headers = opts.headers || {};
    // Honour a conditional request the way a well-configured server would.
    if (entry.etag && headers['if-none-match'] === entry.etag) return response(304, '', {});
    const body = entry.body === undefined ? '' : readFileSync(path.join(dir, entry.body), 'utf8');
    return response(200, body, { etag: entry.etag, 'last-modified': entry.lastModified });
  };
}

function response(status, body, headers) {
  const map = new Map(Object.entries(headers).filter(([, v]) => v != null)
    .map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: k => map.get(String(k).toLowerCase()) ?? null }, text: async () => body };
}

/* ------------------------------------------------------------------ */
/* Reading one issue                                                   */

/**
 * Open an issue a feed has just announced, and return the entries in it that
 * are worth a person's attention.
 *
 * This is the second request, and it is the whole reason the Gazette is worth
 * watching at all. The feed says "Part II, volume 159, number 17" and the
 * contents page says "Customs Tariff — Order Amending the Schedule to the
 * Customs Tariff, SOR/2026-173". Only the second of those can be matched
 * against a fact base, so relevance is decided here rather than on the feed
 * item, and an issue containing nothing relevant correctly produces nothing.
 *
 * A failure to open the issue is returned rather than thrown, because the
 * caller has to be able to tell it apart from an issue that held nothing.
 */
async function readIssue(client, feed, issue, factBase) {
  const res = await client.get(issue.link);
  if (res.kind === 'unread') return { ok: false, reason: res.reason };
  if (res.kind === 'unchanged') return { ok: true, items: [] };

  const entries = feed.expand(res.body, issue.link);
  // An issue of the Gazette always contains at least one instrument. Opening
  // one and finding none means the contents page no longer has the shape the
  // parser expects, not that the issue was empty.
  if (!entries.length) return { ok: true, items: [], empty: true };

  const items = [];
  for (const entry of entries) {
    if (!isRelevant(entry, factBase)) continue;
    items.push({
      feed: feed.key,
      name: feed.name,
      title: entry.title || entry.id,
      link: entry.link,
      date: entry.date || issue.date,
      proposal: feed.weight === 'proposal',
      records: relatedRecords(entry, factBase),
      issue: issue.title
    });
  }
  return { ok: true, items };
}

/* ------------------------------------------------------------------ */
/* The run                                                             */

export async function run(opts = {}) {
  const root = opts.root || DEFAULT_ROOT;
  const statePath = assertStatePath(root, opts.state || path.join(root, 'watch', 'state.json'));
  const runDate = opts.runDate || today();

  const factBase = loadFactBase(root);
  const state = loadState(statePath);
  const next = { version: STATE_VERSION, lastRun: runDate, feeds: {}, sources: {} };

  const client = opts.client || new Client({
    fetchImpl: opts.fetchImpl,
    delayMs: opts.delayMs ?? 1000,
    checkRobots: opts.checkRobots !== false
  });

  const newItems = [];
  const moved = [];
  const unread = [];
  /**
   * Read cleanly, and produced nothing at all.
   *
   * Its own category rather than a kind of `unread`, because these pages were
   * read: the request was fine and the body arrived. `unread` means the client
   * could not get the page, and folding this into it would repeat one layer up
   * the confusion this project spent a whole round removing one layer down.
   *
   * Counted before relevance, never after. Zero relevant items is an ordinary
   * quiet week and says nothing is wrong. Zero raw items is a parser that has
   * stopped fitting its page, which is what four of these six sources were
   * doing while every run reported everything readable.
   */
  const emptyParse = [];

  /* ---- half one: new material ---- */
  for (const feed of (opts.feeds || FEEDS)) {
    const prev = state.feeds[feed.key] || {};
    const res = feed.method === 'POST'
      ? await client.post(feed.url, feed.body, prev)
      : await client.get(feed.url, prev);

    if (res.kind === 'unread') {
      // Carry the previous state forward untouched. Not knowing what a feed
      // says must never look like the feed having gone quiet.
      next.feeds[feed.key] = prev;
      unread.push({ what: feed.name, url: feed.url, reason: res.reason, ids: [] });
      continue;
    }
    if (res.kind === 'unchanged') { next.feeds[feed.key] = prev; continue; }

    const parsed = feed.parse(res.body, feed.url);
    // Before the relevance filter, deliberately. None of these six sources is
    // asked for a date range; every one is a standing list of the most recent
    // items of its kind, so an empty parse is a broken reader rather than a
    // quiet week, and it is worth saying out loud on its own.
    if (!parsed.length) emptyParse.push({ what: feed.name, url: feed.url });
    // An expanding feed lists issues rather than instruments, and an issue's
    // own title can never match a record. Every issue is tracked so it is
    // opened once; whether anything in it matters is decided on its contents.
    const items = feed.expand ? parsed : parsed.filter(i => isRelevant(i, factBase));
    const seen = Array.isArray(prev.seen) ? prev.seen : null;
    const ids = [];

    if (seen) {
      let opened = 0;
      for (const item of items) {
        if (seen.includes(item.id)) { ids.push(item.id); continue; }

        if (feed.expand) {
          if (opened >= MAX_EXPAND_PER_RUN) {
            // Not marked seen, so this is picked up next run rather than lost.
            unread.push({
              what: `${feed.name}, ${item.title || item.id}`,
              url: item.link,
              reason: `more new issues than one run opens (limit ${MAX_EXPAND_PER_RUN})`,
              ids: []
            });
            continue;
          }
          opened++;
          const read = await readIssue(client, feed, item, factBase);
          if (!read.ok) {
            // An issue that could not be opened is not an issue with nothing
            // in it, and it stays unmarked so the next run tries again.
            unread.push({ what: `${feed.name}, ${item.title || item.id}`,
                          url: item.link, reason: read.reason, ids: [] });
            continue;
          }
          if (read.empty) {
            emptyParse.push({ what: `${feed.name}, ${item.title || item.id}`, url: item.link });
          }
          newItems.push(...read.items);
        } else {
          newItems.push({
            feed: feed.key,
            name: feed.name,
            title: item.title || item.id,
            link: item.link,
            date: item.date,
            proposal: feed.weight === 'proposal',
            records: relatedRecords(item, factBase)
          });
        }
        ids.push(item.id);
      }
    } else {
      // A first sighting of a feed is a baseline, not a hundred new items.
      ids.push(...items.map(i => i.id));
    }

    next.feeds[feed.key] = {
      seen: [...new Set([...ids, ...(seen || [])])].slice(0, KEEP_SEEN),
      etag: res.etag || prev.etag,
      lastModified: res.lastModified || prev.lastModified,
      lastRead: runDate
    };
  }

  /* ---- half two: drift in sources already cited ---- */
  for (const [url, { label, ids }] of factBase.citedBy) {
    const prev = state.sources[url] || {};
    const res = await client.get(url, prev);

    if (res.kind === 'unread') {
      // No new hash is recorded. The next run compares against the last
      // reading that actually succeeded, which is the only honest baseline.
      next.sources[url] = prev;
      unread.push({ what: label || 'cited source', url, reason: res.reason, ids });
      continue;
    }
    if (res.kind === 'unchanged') { next.sources[url] = prev; continue; }

    const hash = contentHash(res.body);
    if (prev.hash && prev.hash !== hash) moved.push({ url, label, ids });
    next.sources[url] = {
      hash,
      etag: res.etag || undefined,
      lastModified: res.lastModified || undefined,
      lastRead: runDate
    };
  }

  const report = { newItems, moved, unread, emptyParse, runDate };
  const result = {
    report,
    state: next,
    raise: hasSomethingToSay(report),
    summary: summarise(report),
    body: hasSomethingToSay(report) ? composeBody(report) : '',
    counts: { cited: factBase.citedBy.size, feeds: (opts.feeds || FEEDS).length }
  };

  if (!opts.dryRun) writeGuarded(root, statePath, JSON.stringify(next, null, 2) + '\n');
  if (opts.out) writeGuarded(root, opts.out, result.body);
  if (opts.json) writeGuarded(root, opts.json, JSON.stringify(result.report, null, 2) + '\n');

  return result;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */

const HELP = `The Plain Trade Desk source watcher.

  node watch/watch.mjs [options]

  --fixtures DIR   read from a fixture manifest instead of the network
  --state PATH     state file (default watch/state.json)
  --out PATH       write the issue body here when there is something to say
  --json PATH      write the machine-readable report here
  --dry-run        do not write state
  --no-robots      skip the robots.txt check (fixtures only)
  --delay MS       pause between requests (default 1000)
  --help

It reads government sources and reports what a person should go and read.
It never writes anything under data/ and never sets a verified date.
`;

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--fixtures') o.fixtures = val();
    else if (a === '--state') o.state = val();
    else if (a === '--out') o.out = val();
    else if (a === '--json') o.json = val();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-robots') o.checkRobots = false;
    else if (a === '--delay') o.delayMs = Number(val());
    else if (a === '--root') o.root = val();
  }
  return o;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); process.exit(0); }
  if (o.fixtures) {
    o.fetchImpl = fixtureFetch(o.fixtures);
    o.delayMs = o.delayMs ?? 0;
    if (o.checkRobots === undefined) o.checkRobots = false;
  }
  run(o).then(r => {
    process.stdout.write(`Plain Trade Desk watcher, ${r.report.runDate}\n`);
    process.stdout.write(`  ${r.counts.feeds} feeds, ${r.counts.cited} cited sources\n`);
    process.stdout.write(`  ${r.summary}\n`);
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, `raise=${r.raise ? 'yes' : 'no'}\n`, { flag: 'a' });
    }
    process.exit(0);
  }).catch(e => {
    process.stderr.write(`watch failed: ${e.stack || e.message}\n`);
    process.exit(1);
  });
}
