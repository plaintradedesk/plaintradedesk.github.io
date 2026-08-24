/**
 * The three standing pages. About and the commitment page are copy. The
 * corrections page is half copy and half computed: the log is appended to by
 * hand, and the known-gaps list underneath it is worked out from the records
 * every time this runs.
 *
 * That second half is the point. A known uncorrected gap is where negligence
 * actually bites, so it is the one list that must not depend on the maintainer
 * remembering to write it down.
 */
import { esc, escAttr, fmtDate, dayDiff } from '../util.mjs';

/** Derived from the records themselves, so a gap cannot survive by being forgotten. */
export function knownGaps(shocks, copy, ctx) {
  const gaps = [];
  for (const s of shocks) {
    if (s.unverified) {
      gaps.push([copy.reasons.unverified.why, s.title, copy.reasons.unverified.detail]);
    } else if (dayDiff(s.verified, ctx.today) > ctx.recheckAfter) {
      gaps.push([copy.reasons.overdue.why, s.title, copy.reasons.overdue.detail
        .replace('{date}', fmtDate(s.verified)).replace('{days}', ctx.recheckAfter)]);
    }
    if (!s.sources.length) {
      gaps.push([copy.reasons.nosource.why, s.title, copy.reasons.nosource.detail]);
    }
  }
  return gaps;
}

const gapList = rows => `        <div class="gaps">
${rows.map(([why, what, detail]) => `          <div class="gap">
            <div class="why">${esc(why)}</div>
            <div class="what">${esc(what)}<small>${esc(detail)}</small></div>
          </div>`).join('\n')}
        </div>`;

function correctionsBody(page, corrections, shocks, ctx) {
  const c = page.copy;
  const log = corrections.length
    ? gapList(corrections.map(x => [x.date, x.what, x.detail]))
    : `        <div class="emptylog">${esc(c.empty_log)}</div>`;

  const gaps = knownGaps(shocks, c, ctx);
  const gapsBlock = gaps.length
    ? gapList(gaps)
    : `        <div class="emptylog">${esc(c.gaps_none.replace('{days}', ctx.recheckAfter))}</div>`;

  return `        <h3>${esc(c.corrections_heading)}</h3>
${log}
        <h3>${esc(c.gaps_heading)}</h3>
        <p>${esc(c.gaps_intro)}</p>
${gapsBlock}`;
}

function prose(body) {
  return body.map(b => {
    const cls = b.class ? ` class="${escAttr(b.class)}"` : '';
    return `        <${b.tag}${cls}>${esc(b.text)}</${b.tag}>`;
  }).join('\n');
}

/**
 * `mode` decides what "back to the desk" is. On the site it is a link to the
 * front page. In the offline file there is nowhere to navigate to, so it is a
 * button that puts the door view back.
 */
export function standingPage({ id, page, corrections, shocks, site, ctx, mode }) {
  const back = mode === 'offline'
    ? `        <button type="button" class="back">${esc(site.back)}</button>`
    : `        <a class="back" href="index.html">${esc(site.back)}</a>`;

  const body = page.body === 'CORRECTIONS_DYNAMIC'
    ? correctionsBody(page, corrections, shocks, ctx)
    : prose(page.body);

  const inner = `${back}
        <h2>${esc(page.title)}</h2>
        <p class="stamp">${esc(page.stamp)}</p>
${body}`;

  return mode === 'offline'
    ? `      <div class="standing" data-page="${escAttr(id)}">\n${inner}\n      </div>`
    : inner;
}
