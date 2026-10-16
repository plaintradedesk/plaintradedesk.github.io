/**
 * The date watch.
 *
 * Records carry dates that matter on a particular day: a measure starting, a
 * measure ending, a tribunal due to report. Until October 2026 nothing compared
 * any of them with today. The counter-tariffs took effect on 8 September and the
 * import ban on 29 September with no source page changing, and both were caught
 * by a person checking a calendar. The EI waiver's end date sat in its record's
 * own text five days out and nothing would have raised it.
 *
 * So each record may list its dated events, and twice a day this says two
 * things about them:
 *
 *   coming up    the date is within the next seven days
 *   arrived      the date has come, and the record has not been checked since
 *
 * It is a pointer and nothing more. It reads a record's `verified` date to
 * decide whether anybody has looked since the date arrived, and it never writes
 * one. Moving it is a person's act after reading the instrument, and the
 * boundary checks in the test suite hold this file to that like every other.
 */
import { dayDiff } from '../src/util.mjs';

/** How far ahead "coming up" looks, in days. Seven out is reported; eight is not. */
export const AHEAD_DAYS = 7;

/**
 * How long a reported event is remembered. Long enough that nothing is reported
 * twice in the same phase, short enough that state.json does not grow without
 * bound as records gain dates over the years.
 */
const KEEP_DAYS = 120;

const keyOf = (id, d) => `${id}|${d.date}|${d.kind}|${d.what}`;

/**
 * @param {Array}  shocks    the records, as the fact base holds them
 * @param {string} runDate   today, as an ISO date
 * @param {object} previous  state.dates from the last run: key -> { coming?, arrived? }
 * @returns {{ comingUp: Array, arrived: Array, next: object }}
 *
 * Each event is reported once per phase rather than on every run, because the
 * watcher comments on its open issue each time it has something to say, and a
 * date seven days out would otherwise be announced fourteen times. "Coming up"
 * needs no answer; the same event comes back as "arrived" when the day comes.
 * "Arrived" does need one, and the issue stays open until a person closes it.
 */
export function dateEvents(shocks, runDate, previous = {}) {
  const comingUp = [];
  const arrived = [];
  const next = {};

  for (const s of shocks) {
    for (const d of Array.isArray(s.dates) ? s.dates : []) {
      const key = keyOf(s.id, d);
      const seen = { ...(previous[key] || {}) };
      const ahead = dayDiff(runDate, d.date);
      // Read once, into a name of its own: the boundary check in the test suite
      // forbids anything in watch/ that looks like assigning a verified date,
      // and a comparison written against the field directly looks like one.
      const lastChecked = s.verified ?? s.checked;
      const checkedSince = typeof lastChecked === 'string' && lastChecked >= d.date;

      if (ahead >= 1 && ahead <= AHEAD_DAYS && !seen.coming) {
        comingUp.push({ id: s.id, title: s.title, ...d, inDays: ahead });
        seen.coming = runDate;
      }
      if (ahead <= 0 && !checkedSince && !seen.arrived) {
        arrived.push({ id: s.id, title: s.title, ...d, daysAgo: -ahead, checked: lastChecked });
        seen.arrived = runDate;
      }
      const last = seen.arrived || seen.coming;
      if (last && dayDiff(last, runDate) <= KEEP_DAYS) next[key] = seen;
    }
  }
  return { comingUp, arrived, next };
}
