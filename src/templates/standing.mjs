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

/**
 * Derived from the records themselves, so a gap cannot survive by being
 * forgotten.
 *
 * An archived build drops the overdue reason. Every record is overdue by then,
 * the banner at the top of every page says exactly that, and repeating it once
 * per record would bury the gaps that are about sourcing rather than about time.
 */
export function knownGaps(shocks, copy, ctx) {
  const gaps = [];
  for (const s of shocks) {
    if (s.unverified) {
      gaps.push([copy.reasons.unverified.why, s.title, copy.reasons.unverified.detail]);
    } else if (!ctx.archived && dayDiff(s.verified, ctx.today) > ctx.recheckAfter) {
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

function prose(body, site, mode) {
  return body.map(b => {
    if (b.tag === 'download') return downloadBlock(site, mode);
    const cls = b.class ? ` class="${escAttr(b.class)}"` : '';
    return `        <${b.tag}${cls}>${esc(b.text)}</${b.tag}>`;
  }).join('\n');
}

/**
 * The offline file, offered as what it is.
 *
 * This is how somebody with no reliable connection is handed this at all, which
 * is why it is described as a file you can keep and give away rather than as a
 * technical curiosity. It is also why the site surviving and this information
 * surviving are two different questions.
 *
 * Where it goes on the page is decided in pages.json, like every other piece of
 * copy. The offline file does not offer a download of itself.
 */
function downloadBlock(site, mode) {
  const o = site.offline;
  const lead = mode === 'offline'
    ? `        <p class="q">${esc(o.this_is_it)}</p>`
    : `        <p><a class="dl" href="${escAttr(o.filename)}" download>${esc(o.label)}</a></p>`;
  return `        <div class="download">
${lead}
          <p>${esc(o.note)}</p>
        </div>`;
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
    : prose(page.body, site, mode);

  const inner = `${back}
        <h2>${esc(page.title)}</h2>
        <p class="stamp">${esc(page.stamp)}</p>
${body}`;

  // The id is what the offline file's own page links point at, so that they
  // work as ordinary anchors with scripting switched off as well.
  return mode === 'offline'
    ? `      <div class="standing" id="${escAttr(id)}" data-page="${escAttr(id)}">\n${inner}\n      </div>`
    : inner;
}
