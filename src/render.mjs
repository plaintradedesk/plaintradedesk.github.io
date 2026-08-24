/**
 * Data plus templates to HTML strings. Nothing here writes to disk and nothing
 * here decides whether the data is fit to publish; that is validate.mjs, and it
 * has already run by the time this does.
 *
 * Three shapes come out of one pass:
 *
 *   the site      index.html and one page per door, plus the three standing
 *                 pages at stable addresses and a 404. Every page carries the
 *                 whole of its own content, so it reads with JavaScript off.
 *
 *   the one file  plain-trade-desk-offline.html, everything inlined including
 *                 the standing pages. This is the copy somebody can be handed on
 *                 a memory stick, and a file people can keep is a file that
 *                 survives the site going away.
 *
 *   the plumbing  sitemap.xml, robots.txt and, when a domain is configured,
 *                 CNAME. These are not pages and are not gated as pages. They
 *                 are addressed from the same base as the canonical links, so
 *                 they cannot contradict them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { esc } from './util.mjs';
import { pageUrl } from './config.mjs';
import { layout, freshness } from './templates/layout.mjs';
import { doorPanel } from './templates/door.mjs';
import { standingPage, knownGaps } from './templates/standing.mjs';
import { notFoundBody } from './templates/notfound.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Line endings are normalised on the way in. These two files are inlined into
// every page, so a checkout that rewrote them to CRLF would otherwise change
// every byte of the output without changing anything a reader sees.
const asset = name => readFileSync(path.join(here, 'assets', name), 'utf8').replace(/\r\n/g, '\n');

export const OFFLINE_FILE = 'plain-trade-desk-offline.html';
export const NOT_FOUND_FILE = '404.html';

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
  const meta = {};
  const archived = ctx.archived || null;

  /* The front page is the People door, so the site's address is its address and
     its canonical is the bare base rather than index.html. */
  const canonical = name => name === 'index.html' ? ctx.baseUrl + '/' : pageUrl(ctx.baseUrl, name);

  const add = (name, m, html) => {
    meta[name] = {
      title: m.title,
      description: m.description,
      canonical: canonical(name),
      noindex: !!m.noindex,
      inSitemap: !m.noindex
    };
    files[name] = html;
  };

  // Titles say what the page is. The site name goes on the end of all but the
  // front page, where it would only repeat itself.
  const titled = t => t + ' | ' + site.title;

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

  const shell = (name, m, opts) => add(name, m, layout({
    site, doors: data.doors, pages, mode: 'site', css, js, fresh, archived,
    meta: { title: m.title, description: m.description, noindex: !!m.noindex, canonical: canonical(name) },
    ...opts
  }));

  /* ---------- the site: one page per door ---------- */
  for (const door of data.doors) {
    const front = door.id === data.doors[0].id;
    const name = front ? 'index.html' : door.id + '.html';
    shell(name, {
      title: front ? site.title : titled(door.title),
      description: door.description
    }, {
      activeDoor: door.id,
      body: '    <div id="doorview">\n' + panelFor(door, { ids: true, hidden: false }) + '\n    </div>'
    });
  }

  /* ---------- the site: the three standing pages ---------- */
  // The commitment page in particular has an address that does not change,
  // because a municipality deciding whether to link needs to cite it inside
  // their own approval process. That is also why every page carries a canonical
  // link: the address they cite has to be the address the page claims.
  for (const [id, page] of Object.entries(pages)) {
    shell(page.path, { title: titled(page.title), description: page.description }, {
      activeDoor: null,
      activePage: id,
      body: '    <section class="page" id="pageview">\n' +
        standingPage({ id, page, corrections: data.corrections, shocks: data.shocks, site, ctx, mode: 'site' }) +
        '\n    </section>'
    });
  }

  /* ---------- the site: the 404 ---------- */
  // Its links are absolute because it is served at whatever address was
  // mistyped, and it carries the unofficial banner like every other page,
  // because a stray inbound link is exactly the context where somebody could
  // mistake this for a government site.
  const linkBase = ctx.baseUrl + '/';
  shell(NOT_FOUND_FILE, {
    title: titled(site.notfound.title),
    description: site.notfound.description,
    noindex: true
  }, {
    activeDoor: null,
    linkBase,
    body: notFoundBody({ site, doors: data.doors, linkBase })
  });

  /* ---------- the one file ---------- */
  // Nothing is hidden in the markup here. The script hides what the current door
  // does not need as soon as it runs, so with JavaScript on this behaves exactly
  // like the site, and with it off the whole thing reads top to bottom instead
  // of leaving the reader with three pages they cannot reach.
  //
  // Kept out of the sitemap on purpose: it is a copy of every other page, and a
  // search engine ranking it instead of them helps nobody.
  const panels = data.doors.map(d => panelFor(d, { ids: false, hidden: false })).join('\n');
  const standing = Object.entries(pages).map(([id, page]) =>
    standingPage({ id, page, corrections: data.corrections, shocks: data.shocks, site, ctx, mode: 'offline' })
  ).join('\n');

  const offlineMeta = {
    title: titled(site.offline.title),
    description: site.offline.description,
    noindex: true
  };
  add(OFFLINE_FILE, offlineMeta, layout({
    site, doors: data.doors, pages, activeDoor: data.doors[0].id, mode: 'offline',
    css, js, fresh, archived,
    meta: Object.assign({}, offlineMeta, { canonical: canonical(OFFLINE_FILE) }),
    body: '    <noscript><p class="noscript">' + esc(site.offline_noscript) + '</p></noscript>\n' +
      '    <section class="page" id="pageview">\n' + standing + '\n    </section>\n' +
      '    <div id="doorview">\n' + panels + '\n    </div>'
  }));

  return {
    files,
    meta,
    assets: siteAssets(meta, ctx),
    fresh,
    gaps: knownGaps(data.shocks, pages.corrections.copy, ctx)
  };
}

/**
 * The files a site needs that are not pages.
 *
 * There is no lastmod in the sitemap. The build knows when each record was last
 * checked against its source, which is not the same as when a page last
 * changed, and a date that says "changed" while meaning "checked" is exactly
 * the small lie the rest of this repository exists to prevent.
 */
function siteAssets(meta, ctx) {
  const urls = Object.values(meta).filter(m => m.inSitemap).map(m => m.canonical).sort();

  const assets = {
    'sitemap.xml':
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => '  <url><loc>' + esc(u) + '</loc></url>').join('\n') +
      '\n</urlset>\n',

    'robots.txt':
      '# Indexing is allowed. There is no attempt at search optimisation here\n' +
      '# beyond honest titles. This site is not trying to outrank canada.ca.\n' +
      'User-agent: *\n' +
      'Allow: /\n\n' +
      'Sitemap: ' + ctx.baseUrl + '/sitemap.xml\n'
  };

  // Written from site.baseUrl rather than by hand, so the domain cannot be
  // changed in one place and left stale in the other.
  if (ctx.cname) assets.CNAME = ctx.cname + '\n';

  return assets;
}
