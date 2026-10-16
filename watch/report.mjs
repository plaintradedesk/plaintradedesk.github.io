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
 * The line the workflow looks for before closing an issue.
 *
 * New material and moved sources are reported once: the next run has already
 * marked them seen, so a quiet run after them is quiet whether or not anybody
 * read them. Issue #13 reported SOR/2026-186 and was closed by the watcher's
 * own next run, twelve hours later, unread; the order reached its record three
 * weeks after that because a person happened to read the record closely. So an
 * issue that carries either of these stays open until a person closes it. This
 * marker, in the body or in any comment on the issue, is how the workflow
 * knows. An HTML comment so it costs the reader nothing.
 */
export const NEEDS_A_PERSON = '<!-- watch: needs a person to read and close -->';

const DAYS = n => `${n} day${n === 1 ? '' : 's'}`;

/**
 * @param {object} r
 * @param {Array}  r.newItems   { feed, name, title, link, date, records, proposal, issue }
 * @param {Array}  r.moved      { url, label, ids }
 * @param {Array}  r.unread     { what, url, reason }
 * @param {Array}  r.emptyParse { what, url }
 * @param {Array}  r.thinParse  { what, url, count, usual, recent }
 * @param {Array}  r.quietFeeds { what, url, since, days, read }
 * @param {Array}  r.comingUp   { id, title, date, kind, what, inDays }
 * @param {Array}  r.arrived    { id, title, date, kind, what, daysAgo, checked }
 * @param {string} r.runDate
 */
export function composeBody(r) {
  const out = [];
  const {
    newItems = [], moved = [], unread = [], emptyParse = [], thinParse = [],
    quietFeeds = [], comingUp = [], arrived = [], runDate = ''
  } = r;

  out.push(`The source watcher ran${runDate ? ` on ${runDate}` : ''} and has something to report.`);
  out.push('');
  out.push('It never edits a record. Everything below is a pointer to a document '
    + 'somebody has to read. Moving a `verified` date is a person\'s act, after '
    + 'reading the instrument, and stays that way.');
  out.push('');
  if (needsAPerson(r)) {
    out.push(NEEDS_A_PERSON);
    out.push('This issue stays open until a person closes it, because some of what is '
      + 'below is reported only once. Close it when it has been read.');
    out.push('');
  }

  if (arrived.length || comingUp.length) {
    out.push('## Dates in the records');
    out.push('');
    out.push('Dates the records themselves state. A date that has arrived is listed '
      + 'when the record has not been checked since it came: the measure may now be '
      + 'in force, or over, and the record may still say otherwise. Nothing here '
      + 'changes a status or a `verified` date.');
    out.push('');
    for (const d of arrived) {
      out.push(`- **Arrived:** ${d.date} · ${d.kind} · ${d.what}`);
      out.push(`  \`${d.id}\`, last checked ${d.checked || 'never'}; `
        + (d.daysAgo ? `the date came ${DAYS(d.daysAgo)} ago` : 'the date is today'));
    }
    for (const d of comingUp) {
      out.push(`- **Coming up, in ${DAYS(d.inDays)}:** ${d.date} · ${d.kind} · ${d.what}`);
      out.push(`  \`${d.id}\``);
    }
    out.push('');
  }

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

  if (thinParse.length) {
    out.push('## Sources that read noticeably fewer items than usual');
    out.push('');
    out.push('These read fine and did return items, just far fewer than this '
      + 'watcher has seen from them before. None of these sources is asked for '
      + 'a date range: each is either a standing index that only grows or a '
      + 'list pinned to the size the request asks for, so the count should not '
      + 'fall by itself. Read this as part of the page having changed shape '
      + 'under a parser that still fits the rest of it.');
    out.push('');
    for (const t of thinParse) {
      out.push(`- ${t.url}`);
      out.push(`  ${t.what}`);
      out.push(`  ${t.count} this run, against ${t.usual} at the lowest recently`
        + `${t.recent && t.recent.length ? ` (${t.recent.join(', ')})` : ''}`);
    }
    out.push('');
  }

  if (quietFeeds.length) {
    out.push('## Sources that read fine and have offered nothing relevant for weeks');
    out.push('');
    out.push('These were read and parsed normally, and nothing they listed has been '
      + 'judged relevant for at least four weeks. That can be an honestly quiet '
      + 'source. It can also be a relevance rule that cannot see how the source '
      + 'titles things, which is how the Prime Minister\'s feed went five weeks '
      + 'without accepting anything. `node watch/watch.mjs --dry-run --show-dropped` '
      + 'lists what was set aside. This is said once a month at most.');
    out.push('');
    for (const q of quietFeeds) {
      out.push(`- ${q.url}`);
      out.push(`  ${q.what}: nothing relevant since ${q.since} (${DAYS(q.days)}); `
        + `${q.read} item${q.read === 1 ? '' : 's'} read this run`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('Run `node watch/watch.mjs --help` to see how this is produced. '
    + 'The watcher writes nothing under `data/`; its only commit is `watch/state.json`.');
  return out.join('\n') + '\n';
}

/** Anything to say at all? Drives whether an issue is opened or commented on. */
export const hasSomethingToSay = r =>
  Boolean((r.newItems && r.newItems.length)
    || (r.moved && r.moved.length)
    || (r.unread && r.unread.length)
    // A structural break has to open the issue too. Left out of this, a parser
    // that stopped reading its page would close the issue and report a quiet
    // week, which is the whole failure this category exists to make visible.
    || (r.emptyParse && r.emptyParse.length)
    // Same reasoning as emptyParse: a source that quietly halved is a
    // structural break, and a run that found one is not a quiet run.
    || (r.thinParse && r.thinParse.length)
    || (r.quietFeeds && r.quietFeeds.length)
    || (r.comingUp && r.comingUp.length)
    || (r.arrived && r.arrived.length));

/**
 * Does what was found need a person before the issue may close?
 *
 * Yes for anything reported once and then forgotten by the watcher: new
 * material, a moved source, a date that has arrived unchecked. No for anything
 * that says itself again until it is fixed, or that needs no answer: an unread
 * or misparsed source is reported on every run while it lasts, a quiet feed is
 * a prompt rather than a finding, and a date coming up comes back as arrived.
 * An issue holding only those may close itself on the next quiet run, as before.
 */
export const needsAPerson = r =>
  Boolean((r.newItems && r.newItems.length)
    || (r.moved && r.moved.length)
    || (r.arrived && r.arrived.length));

/** One line for the run log, so a quiet run still says what it did. */
export function summarise(r) {
  const n = (r.newItems || []).length;
  const m = (r.moved || []).length;
  const u = (r.unread || []).length;
  const e = (r.emptyParse || []).length;
  const t = (r.thinParse || []).length;
  const q = (r.quietFeeds || []).length;
  const a = (r.arrived || []).length;
  const c = (r.comingUp || []).length;
  if (!n && !m && !u && !e && !t && !q && !a && !c) {
    return 'nothing new, nothing moved, everything readable, no dates due';
  }
  return `${n} new item${n === 1 ? '' : 's'}, `
    + `${m} source${m === 1 ? '' : 's'} moved, `
    + `${u} unread`
    + (e ? `, ${e} read but parsed to nothing` : '')
    + (t ? `, ${t} read unusually thin` : '')
    + (q ? `, ${q} quiet for weeks` : '')
    + (a ? `, ${a} date${a === 1 ? '' : 's'} arrived unchecked` : '')
    + (c ? `, ${c} date${c === 1 ? '' : 's'} coming up` : '');
}
