/**
 * One shock card. The register shown is chosen by the door; the record itself is
 * identical on every door, which is the rule the whole project rests on.
 *
 * A trend record carries a dimmer treatment and says its evidence class in words
 * as well. A forecast that renders like an in-force instrument borrows authority
 * it does not have, so the two vocabularies are kept apart here and in the
 * stylesheet.
 */
import { esc, escAttr, fmtDate, dayDiff } from '../util.mjs';

/**
 * A fact longer than this sits under the register text; a shorter one goes in
 * the "at a glance" panel beside it on a wide screen.
 *
 * Length rather than a field on each fact, because it is the property that
 * actually decides whether a value fits an 18.5rem panel, and a field would be
 * one more thing to keep right on every fact of every record. Without the split
 * the panel runs far taller than the text beside it: "Confirmed active" on the
 * support package was over a thousand characters until it was split into short
 * facts on 25 October 2026. The mockups drew the line at
 * about ninety, but two October values sat within a character of that (91 and
 * 90), and the 90-character one left the cabinets panel three lines taller
 * than its text. Eighty has nothing within six characters of it either side.
 */
export const LONG_FACT = 80;

export const splitFacts = facts => ({
  side: facts.filter(f => String(f.value).length <= LONG_FACT),
  long: facts.filter(f => String(f.value).length > LONG_FACT)
});

const factList = (facts, cls, pad) => facts.length
  ? `\n${pad}<dl class="facts ${cls}">\n` +
    facts.map(f => `${pad}  <dt>${esc(f.label)}</dt>\n${pad}  <dd>${esc(f.value)}</dd>`).join('\n') +
    `\n${pad}</dl>`
  : '';

export function shockCard(s, register, vocab, labels, ctx) {
  const age = dayDiff(s.verified, ctx.today);
  // An archived site says once, at the top of every page, that it is no longer
  // being checked. Flagging every record as overdue as well would only be noise.
  const needsCheck = s.unverified || (!ctx.archived && age > ctx.recheckAfter);
  const trend = s.evidence_class === 'trend';

  const flag = needsCheck
    ? `\n          <span class="flag">${esc(s.unverified ? labels.needs_verification : labels.recheck_overdue)}</span>`
    : '';

  const evidence = trend
    ? `\n          <span class="evidence">${esc(labels.trend)}</span>`
    : '';

  // Definition lists, because a fact is a label and a value, and because dt/dd
  // pairs fall into grid rows in DOM order without any wrapper. Long facts stay
  // with the text they explain; short ones form the side panel, which comes
  // after the text in the markup so a screen reader reads the text first.
  const { side, long } = splitFacts(s.facts);

  const links = s.sources.map(src =>
    `          <a href="${escAttr(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.label)}</a>`
  ).join('\n');
  // Up to three sources stay in view. Past that they fold behind a native
  // disclosure, which needs no script and works in the offline file, while the
  // checked date stays outside it: that line is the trust signal and should
  // never cost a click.
  const sources = !s.sources.length
    ? `          <span class="nosource">${esc(labels.no_source)}</span>`
    : s.sources.length > 3
      ? `          <details class="srcmore">\n` +
        `            <summary>${esc(labels.sources_count.replace('{n}', s.sources.length))}</summary>\n` +
        `            <div class="srclist">\n${links.replace(/^/gm, '    ')}\n            </div>\n` +
        `          </details>`
      : links;

  // A register may carry a paragraph break, written as a blank line in the
  // data. Every piece gets the same class, so a register without one renders
  // exactly as it always has.
  const paragraphs = String(s[register]).split(/\n\n+/).map(piece =>
    `            <p class="register${register === 'plain' ? ' plain' : ''}">${esc(piece.trim())}</p>`
  ).join('\n');

  return `        <article class="card${trend ? ' trend' : ''}" data-id="${escAttr(s.id)}" data-sectors="${escAttr(s.sectors.join(' '))}">
          <div class="card-top">
            <h3>${esc(s.title)}</h3>
            <span class="status ${escAttr(s.status)}">${esc(vocab[s.evidence_class][s.status])}</span>${evidence}${flag}
          </div>
          <div class="cardbody">
${paragraphs}${factList(long, 'long', '            ')}
          </div>${factList(side, 'side', '          ')}
          <div class="srcs">
${sources}
            <span class="verif mono">${esc(labels.checked.replace('{date}', fmtDate(s.verified)))}</span>
          </div>
        </article>`;
}
