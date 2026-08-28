/**
 * Composing the issue.
 *
 * Same register as `weekly-check.yml`: plain, specific, and telling the
 * maintainer what to go and read. The hardest discipline here is what the
 * report refuses to do. It never summarises what changed on a page, because a
 * wrong summary is worse than none and would invite acting on the summary
 * instead of on the source. It names the page and the records, and stops.
 *
 * The brief describes three sections. There are three here, but the third is
 * sources that could not be read rather than "nothing to report", because
 * nothing to report is the case where no issue exists at all. Reporting an
 * unread source is required by the coverage doctrine in section 6 of the brief
 * and by its own line in the definition of done, so it needs somewhere to go.
 */

const RECORDS = ids => ids.length
  ? ids.map(id => `\`${id}\``).join(', ')
  : '_no existing record matched_';

/**
 * @param {object} r
 * @param {Array}  r.newItems   { feed, name, title, link, date, records, proposal, issue }
 * @param {Array}  r.moved      { url, label, ids }
 * @param {Array}  r.unread     { what, url, reason }
 * @param {Array}  r.emptyParse { what, url }
 * @param {string} r.runDate
 */
export function composeBody(r) {
  const out = [];
  const { newItems = [], moved = [], unread = [], emptyParse = [], runDate = '' } = r;

  out.push(`The source watcher ran${runDate ? ` on ${runDate}` : ''} and has something to report.`);
  out.push('');
  out.push('It never edits a record. Everything below is a pointer to a document '
    + 'somebody has to read. Moving a `verified` date is a person\'s act, after '
    + 'reading the instrument, and stays that way.');
  out.push('');

  if (newItems.length) {
    out.push('## New material');
    out.push('');
    const unmatched = newItems.filter(i => !i.records.length).length;
    for (const i of newItems) {
      const bits = [i.name];
      // Where it was found, when it came out of an issue rather than a feed.
      if (i.issue) bits.push(i.issue);
      if (i.date) bits.push(i.date);
      if (i.proposal) bits.push('a proposal, not an instrument');
      out.push(`- **${i.title}**`);
      out.push(`  ${bits.join(' · ')}`);
      if (i.link) out.push(`  ${i.link}`);
      out.push(`  Related records: ${RECORDS(i.records)}`);
    }
    out.push('');
    if (unmatched) {
      out.push(`${unmatched === 1 ? 'One item' : `${unmatched} items`} above matched no `
        + 'existing record. That is the signal that a new record may be needed, '
        + 'not a reason to ignore it.');
      out.push('');
    }
  }

  if (moved.length) {
    out.push('## Sources that moved');
    out.push('');
    out.push('A page already cited by a record has changed since the last run. '
      + 'A record can become wrong without anything new being published anywhere, '
      + 'which is exactly the failure this half exists to catch.');
    out.push('');
    for (const m of moved) {
      out.push(`- ${m.url}`);
      if (m.label) out.push(`  cited as "${m.label}"`);
      out.push(`  Cited by: ${RECORDS(m.ids)}`);
    }
    out.push('');
  }

  if (unread.length) {
    out.push('## Sources that could not be read');
    out.push('');
    out.push('These are reported as unread, not as unchanged. No new hash was '
      + 'recorded for any of them, so the next run compares against the last '
      + 'reading that actually succeeded.');
    out.push('');
    for (const u of unread) {
      out.push(`- ${u.url}`);
      out.push(`  ${u.what}${u.ids && u.ids.length ? ` · cited by ${RECORDS(u.ids)}` : ''}`);
      out.push(`  ${u.reason}`);
    }
    out.push('');
  }

  if (emptyParse.length) {
    out.push('## Sources that read fine but parsed to nothing');
    out.push('');
    out.push('These answered normally and were read in full. Nothing was wrong '
      + 'with the request. What came back produced no items at all, which is '
      + 'not the same claim as "nothing new here": none of these sources asks '
      + 'for a date range, so each one is a standing list that should never be '
      + 'empty. Read this as the page having changed shape under a parser that '
      + 'no longer fits it, until somebody has opened it and found otherwise.');
    out.push('');
    for (const e of emptyParse) {
      out.push(`- ${e.url}`);
      out.push(`  ${e.what}`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('Run `node watch/watch.mjs --help` to see how this is produced. '
    + 'The watcher writes nothing under `data/`; its only commit is `watch/state.json`.');
  return out.join('\n') + '\n';
}

/** Anything to say at all? Drives whether an issue is opened or closed. */
export const hasSomethingToSay = r =>
  Boolean((r.newItems && r.newItems.length)
    || (r.moved && r.moved.length)
    || (r.unread && r.unread.length)
    // A structural break has to open the issue too. Left out of this, a parser
    // that stopped reading its page would close the issue and report a quiet
    // week, which is the whole failure this category exists to make visible.
    || (r.emptyParse && r.emptyParse.length));

/** One line for the run log, so a quiet run still says what it did. */
export function summarise(r) {
  const n = (r.newItems || []).length;
  const m = (r.moved || []).length;
  const u = (r.unread || []).length;
  const e = (r.emptyParse || []).length;
  if (!n && !m && !u && !e) return 'nothing new, nothing moved, everything readable';
  return `${n} new item${n === 1 ? '' : 's'}, `
    + `${m} source${m === 1 ? '' : 's'} moved, `
    + `${u} unread`
    + (e ? `, ${e} read but parsed to nothing` : '');
}
