/**
 * The document shell: the unofficial banner, the masthead with its computed
 * freshness readout, the door nav, and the footer.
 *
 * Two layouts come out of here. `site` is the published set of pages, where the
 * doors are links and each page holds one door. `offline` is the single file,
 * where the doors are tabs over panels that are all present in the document.
 * No copy is written here; every string arrives from pages.json.
 */
import { esc, escAttr, fmtShort, addDays, dayDiff, plural } from '../util.mjs';

/** The masthead readout, worked out from the records and never typed. */
export function freshness(shocks, ctx) {
  const ages = shocks.map(s => Math.max(0, dayDiff(s.verified, ctx.today)));
  const oldest = ages.length ? Math.max(...ages) : 0;
  return {
    oldest,
    dot: oldest > ctx.recheckAfter ? 'bad' : oldest > ctx.cadenceDays ? 'warn' : 'ok',
    label: oldest === 0
      ? 'All records checked today'
      : `Oldest record checked ${plural(oldest, 'day')} ago`,
    next: addDays(ctx.today, ctx.cadenceDays)
  };
}

const href = (door, mode) =>
  mode === 'offline' ? '' : (door === 'people' ? 'index.html' : door + '.html');

function doorNav(doors, activeDoor, site, mode) {
  const items = doors.map(d => {
    const inner =
      `<span class="who">${esc(d.who)}</span>` +
      `<span class="q">${esc(d.question)}</span>`;
    if (mode === 'offline') {
      return `        <button class="door" type="button" role="tab" data-door="${escAttr(d.id)}"` +
        ` aria-selected="${d.id === activeDoor ? 'true' : 'false'}">${inner}</button>`;
    }
    return `        <a class="door" href="${escAttr(href(d.id, mode))}" data-door="${escAttr(d.id)}"` +
      (d.id === activeDoor ? ' aria-current="page"' : '') + `>${inner}</a>`;
  }).join('\n');

  return mode === 'offline'
    ? `      <div class="doors" role="tablist" aria-label="${escAttr(site.doors_label)}">\n${items}\n      </div>`
    : `      <nav class="doors" aria-label="${escAttr(site.doors_label)}">\n${items}\n      </nav>`;
}

function pageNav(pages, site, mode, activePage) {
  const links = Object.entries(pages).map(([id, pg]) => {
    const target = mode === 'offline' ? '#' + id : pg.path;
    return `        <a class="pagelink" href="${escAttr(target)}" data-page="${escAttr(id)}"` +
      (id === activePage ? ' aria-current="page"' : '') + `>${esc(pg.title)}</a>`;
  }).join('\n');
  return `      <nav class="sitenav" aria-label="${escAttr(site.nav_label)}">\n${links}\n      </nav>`;
}

export function layout({ site, doors, pages, activeDoor, activePage, mode, css, js, fresh, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title)}</title>
<style>
${css}</style>
</head>
<body>

<div class="notice">
  <div class="wrap">
    <span><b>${esc(site.notice.lead)}</b> ${esc(site.notice.text)}</span>
  </div>
</div>

<header>
  <div class="wrap">
    <div class="masthead">
      <div class="brand">
        <span class="eyebrow">${esc(site.eyebrow)}</span>
        <h1>${esc(site.title)}</h1>
        <p>${esc(site.tagline)}</p>
      </div>
      <div class="filestate">
        <div class="row"><span class="dot ${fresh.dot}" id="fileDot"></span><span id="fileState">${esc(fresh.label)}</span></div>
        <div class="row mono" id="fileCadence">${esc(site.cadence_label)} &middot; Next review ${esc(fmtShort(fresh.next))}</div>
      </div>
    </div>

${doorNav(doors, activeDoor, site, mode)}
  </div>
</header>

<main>
  <div class="wrap">
${body}
  </div>
</main>

<footer>
  <div class="wrap">
${pageNav(pages, site, mode, activePage)}
    <p><b>${esc(site.footer.lead)}</b> ${esc(site.footer.paragraphs[0])}</p>
${site.footer.paragraphs.slice(1).map(p => `    <p>${esc(p)}</p>`).join('\n')}
  </div>
</footer>

<script>
${js}</script>

</body>
</html>
`;
}
