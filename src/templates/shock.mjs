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
  const needsCheck = s.unverified || age > ctx.recheckAfter;
  const trend = s.evidence_class === 'trend';

  const flag = needsCheck
    ? `\n          <span class="flag">${esc(s.unverified ? labels.needs_verification : labels.recheck_overdue)}</span>`
    : '';

  const evidence = trend
    ? `\n          <span class="evidence">${esc(labels.trend)}</span>`
    : '';

  const facts = s.facts.length
    ? `\n        <div class="facts">\n` +
      s.facts.map(f => `          <span>${esc(f.label)} <b>${esc(f.value)}</b></span>`).join('\n') +
      `\n        </div>`
    : '';

  const sources = s.sources.length
    ? s.sources.map(src =>
        `          <a href="${escAttr(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.label)}</a>`
      ).join('\n')
    : `          <span class="nosource">${esc(labels.no_source)}</span>`;

  return `        <article class="card${trend ? ' trend' : ''}" data-id="${escAttr(s.id)}" data-sectors="${escAttr(s.sectors.join(' '))}">
          <div class="card-top">
            <h3>${esc(s.title)}</h3>
            <span class="status ${escAttr(s.status)}">${esc(vocab[s.evidence_class][s.status])}</span>${evidence}${flag}
          </div>
          <p class="register${register === 'plain' ? ' plain' : ''}">${esc(s[register])}</p>${facts}
          <div class="srcs">
${sources}
            <span class="verif mono">${esc(labels.checked.replace('{date}', fmtDate(s.verified)))}</span>
          </div>
        </article>`;
}
