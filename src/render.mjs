/**
 * Data plus templates to HTML strings. Nothing here writes to disk and nothing
 * here decides whether the data is fit to publish; that is validate.mjs, and it
 * has already run by the time this does.
 *
 * Two shapes come out of one pass:
 *
 *   the site      index.html and one page per door, plus the three standing
 *                 pages at stable addresses. Every page carries the whole of
 *                 its own content, so it reads with JavaScript switched off.
 *
 *   the one file  plain-trade-desk-offline.html, everything inlined including
 *                 the standing pages. This is the copy somebody can be handed on
 *                 a memory stick, and a file people can keep is a file that
 *                 survives the site going away.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { esc } from './util.mjs';
import { layout, freshness } from './templates/layout.mjs';
import { doorPanel } from './templates/door.mjs';
import { standingPage, knownGaps } from './templates/standing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Line endings are normalised on the way in. These two files are inlined into
// every page, so a checkout that rewrote them to CRLF would otherwise change
// every byte of the output without changing anything a reader sees.
const asset = name => readFileSync(path.join(here, 'assets', name), 'utf8').replace(/\r\n/g, '\n');

/** Sector options, in label order, from the sectors actually used anywhere. */
function usedSectors(data) {
  const used = new Set();
  for (const s of data.shocks) for (const k of s.sectors) used.add(k);
  for (const a of data.actions) for (const k of a.sectors) used.add(k);
  return [...used]
    .map(k => [k, data.sectors[k]])
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

export function render(data, ctx) {
  const css = asset('site.css');
  const js = asset('site.js');
  const { site, pages } = data;
  const sectors = usedSectors(data);
  const fresh = freshness(data.shocks, ctx);
  const files = {};

  const panelFor = (door, opts) => doorPanel({
    door,
    shocks: data.shocks.filter(s => s.doors.includes(door.id)),
    actions: data.actions.filter(a => a.doors.includes(door.id)),
    sectors,
    seasons: data.seasons,
    site,
    vocab: data.statuses,
    referrals: data.referrals,
    defaultSeason: data.defaultSeason,
    totalShocks: data.shocks.length,
    ctx,
    ...opts
  });

  /* ---------- the site: one page per door ---------- */
  for (const door of data.doors) {
    const name = door.id === data.doors[0].id ? 'index.html' : door.id + '.html';
    files[name] = layout({
      site, doors: data.doors, pages, activeDoor: door.id, mode: 'site', css, js, fresh,
      body: `    <div id="doorview">\n${panelFor(door, { ids: true, hidden: false })}\n    </div>`
    });
  }

  /* ---------- the site: the three standing pages ---------- */
  // The commitment page in particular has an address that does not change,
  // because a municipality deciding whether to link needs to cite it inside
  // their own approval process.
  for (const [id, page] of Object.entries(pages)) {
    files[page.path] = layout({
      site, doors: data.doors, pages, activeDoor: null, activePage: id, mode: 'site', css, js, fresh,
      body: `    <section class="page" id="pageview">\n` +
        standingPage({ id, page, corrections: data.corrections, shocks: data.shocks, site, ctx, mode: 'site' }) +
        `\n    </section>`
    });
  }

  /* ---------- the one file ---------- */
  // Nothing is hidden in the markup here. The script hides what the current door
  // does not need as soon as it runs, so with JavaScript on this behaves exactly
  // like the site, and with it off the whole thing reads top to bottom instead
  // of leaving the reader with three pages they cannot reach.
  const panels = data.doors.map(d => panelFor(d, { ids: false, hidden: false })).join('\n');
  const standing = Object.entries(pages).map(([id, page]) =>
    standingPage({ id, page, corrections: data.corrections, shocks: data.shocks, site, ctx, mode: 'offline' })
  ).join('\n');

  files['plain-trade-desk-offline.html'] = layout({
    site, doors: data.doors, pages, activeDoor: data.doors[0].id, mode: 'offline', css, js, fresh,
    body: `    <noscript><p class="noscript">${esc(site.offline_noscript)}</p></noscript>
    <section class="page" id="pageview">
${standing}
    </section>
    <div id="doorview">
${panels}
    </div>`
  });

  return { files, fresh, gaps: knownGaps(data.shocks, pages.corrections.copy, ctx) };
}
