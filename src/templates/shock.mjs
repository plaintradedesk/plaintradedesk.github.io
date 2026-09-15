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

  // A definition list, because a fact is a label and a value, and because dt/dd
  // pairs fall into grid rows in DOM order without any wrapper. A one-line
  // value reads as a chip; a two-sentence value gets its own labelled block.
  const facts = s.facts.length
    ? `\n        <dl class="facts">\n` +
      s.facts.map(f => `          <dt>${esc(f.label)}</dt>\n          <dd>${esc(f.value)}</dd>`).join('\n') +
      `\n        </dl>`
    : '';

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
    `          <p class="register${register === 'plain' ? ' plain' : ''}">${esc(piece.trim())}</p>`
  ).join('\n');

  return `        <article class="card${trend ? ' trend' : ''}" data-id="${escAttr(s.id)}" data-sectors="${escAttr(s.sectors.join(' '))}">
          <div class="card-top">
            <h3>${esc(s.title)}</h3>
            <span class="status ${escAttr(s.status)}">${esc(vocab[s.evidence_class][s.status])}</span>${evidence}${flag}
          </div>
${paragraphs}${facts}
          <div class="srcs">
${sources}
            <span class="verif mono">${esc(labels.checked.replace('{date}', fmtDate(s.verified)))}</span>
          </div>
        </article>`;
}
