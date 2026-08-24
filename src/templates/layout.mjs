/**
 * The document shell: the head a published page needs, the archive notice when
 * there is one, the unofficial banner, the masthead with its computed freshness
 * readout, the door nav, and the footer.
 *
 * Two layouts come out of here. `site` is the published set of pages, where the
 * doors are links and each page holds one door. `offline` is the single file,
 * where the doors are tabs over panels that are all present in the document.
 * No copy is written here; every string arrives from pages.json.
 *
 * `linkBase` exists for one page. The 404 is served at whatever address the
 * reader mistyped, so relative links in its nav would resolve against a
 * directory that does not exist. It gets absolute links; every other page keeps
 * relative ones, which is what lets the built site be opened from a folder.
 */
import { esc, escAttr, fmtShort, fmtDate, addDays, dayDiff, plural } from '../util.mjs';

/* A wordmark, three letters, no crest and no flag. The site must not resemble
   an official one, and a favicon is the smallest thing a reader reads as a
   badge. Inline as a data URI because the pages fetch nothing from anywhere,
   which includes their own icon. */
export const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
  "%3Crect width='64' height='64' rx='9' fill='%230E5A6A'/%3E" +
  "%3Ctext x='32' y='41' text-anchor='middle' font-family='Georgia,serif' " +
  "font-size='25' font-weight='600' fill='%23ffffff'%3EPTD%3C/text%3E%3C/svg%3E";

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

function doorNav(doors, activeDoor, site, mode, linkBase) {
  const items = doors.map(d => {
    const inner =
      `<span class="who">${esc(d.who)}</span>` +
      `<span class="q">${esc(d.question)}</span>`;
    if (mode === 'offline') {
      return `        <button class="door" type="button" role="tab" id="tab-${escAttr(d.id)}"` +
        ` aria-controls="panel-${escAttr(d.id)}" data-door="${escAttr(d.id)}"` +
        ` aria-selected="${d.id === activeDoor ? 'true' : 'false'}">${inner}</button>`;
    }
    return `        <a class="door" href="${escAttr(linkBase + href(d.id, mode))}" data-door="${escAttr(d.id)}"` +
      (d.id === activeDoor ? ' aria-current="page"' : '') + `>${inner}</a>`;
  }).join('\n');

  return mode === 'offline'
    ? `      <div class="doors" role="tablist" aria-label="${escAttr(site.doors_label)}">\n${items}\n      </div>`
    : `      <nav class="doors" aria-label="${escAttr(site.doors_label)}">\n${items}\n      </nav>`;
}

function pageNav(pages, site, mode, activePage, linkBase) {
  const links = Object.entries(pages).map(([id, pg]) => {
    const target = mode === 'offline' ? '#' + id : linkBase + pg.path;
    return `        <a class="pagelink" href="${escAttr(target)}" data-page="${escAttr(id)}"` +
      (id === activePage ? ' aria-current="page"' : '') + `>${esc(pg.title)}</a>`;
  });
  // The offline file is the download, so it does not link to itself.
  if (mode !== 'offline') {
    links.push(`        <a class="pagelink download" href="${escAttr(linkBase + site.offline.filename)}"` +
      ` download>${esc(site.offline.label)}</a>`);
  }
  return `      <nav class="sitenav" aria-label="${escAttr(site.nav_label)}">\n${links.join('\n')}\n      </nav>`;
}

/**
 * The promise page says a notice will appear at the top of every page within
 * thirty days of this site ceasing to be maintained. This is that notice, and
 * it is a build flag rather than eight hand edits made during the week somebody
 * has decided to stop, because that is a week in which hand edits do not happen.
 */
function archiveNotice(site, archived) {
  if (!archived) return '';
  return `<div class="archived">
  <div class="wrap">
    <span><b>${esc(site.archived.lead)}</b> ${esc(site.archived.text.replace('{date}', fmtDate(archived)))}</span>
  </div>
</div>

`;
}

/** Live, this reads the freshness out of the records. Archived, it must not. */
function fileState(site, fresh, archived) {
  if (archived) {
    return `      <div class="filestate">
        <div class="row mono" id="fileState">${esc(site.archived.stamp.replace('{date}', fmtDate(archived)))}</div>
      </div>`;
  }
  return `      <div class="filestate">
        <div class="row"><span class="dot ${fresh.dot}" id="fileDot"></span><span id="fileState">${esc(fresh.label)}</span></div>
        <div class="row mono" id="fileCadence">${esc(site.cadence_label)} &middot; Next review ${esc(fmtShort(fresh.next))}</div>
      </div>`;
}

export function layout({ site, doors, pages, activeDoor, activePage, mode, css, js, fresh, body, meta, archived, lang = 'en', linkBase = '' }) {
  return `<!doctype html>
<html lang="${escAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${escAttr(meta.description)}">
<link rel="canonical" href="${escAttr(meta.canonical)}">
${meta.noindex ? '<meta name="robots" content="noindex, follow">\n' : ''}<link rel="icon" href="${escAttr(FAVICON)}">
<style>
${css}</style>
</head>
<body>

${archiveNotice(site, archived)}<div class="notice">
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
${fileState(site, fresh, archived)}
    </div>

${doorNav(doors, activeDoor, site, mode, linkBase)}
  </div>
</header>

<main>
  <div class="wrap">
${body}
  </div>
</main>

<footer>
  <div class="wrap">
${pageNav(pages, site, mode, activePage, linkBase)}
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
