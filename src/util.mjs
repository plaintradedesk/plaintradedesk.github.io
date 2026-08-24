/**
 * Shared helpers. Dates are formatted by hand rather than through Intl so that
 * the build produces the same bytes on any machine, including a Node built
 * without full ICU. Two builds from unchanged input have to be byte-identical,
 * which is what makes a diff in dist/ mean a real change.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Whole days from a to b. Both are ISO dates, compared at UTC midnight. */
export function dayDiff(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** ISO date plus n days, back as an ISO date. */
export function addDays(iso, n) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/**
 * "2026-08-23" becomes "August 23, 2026". A year-month value such as "2025-03"
 * becomes "March 2025", because that is all the record claims to know. Anything
 * else is passed through untouched rather than guessed at.
 */
export function fmtDate(s) {
  if (isDate(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }
  const [y, m] = String(s).split('-');
  return m && MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : String(s);
}

/** Short form for the masthead: "Aug 30, 2026". */
export function fmtShort(s) {
  const [y, m, d] = s.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

/** The build's own idea of today. PTD_TODAY exists so the gates can be tested. */
export function today() {
  const override = process.env.PTD_TODAY;
  if (override) {
    if (!isDate(override)) throw new Error(`PTD_TODAY must be YYYY-MM-DD, got "${override}"`);
    return override;
  }
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Text going into an element. */
export const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text going into a double-quoted attribute. */
export const escAttr = s => esc(s).replace(/"/g, '&quot;');

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
