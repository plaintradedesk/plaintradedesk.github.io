/**
 * Turning a fetched page into something worth hashing, and turning a feed into
 * a list of items.
 *
 * The hashing half is the fiddly one and the brief is right that it needs care.
 * A government page carries a "Date modified" stamp, a rotating set of
 * promotional banners, analytics blobs and sometimes a session token in a form.
 * Hash the raw body and the watcher reports drift every single run, which
 * trains the maintainer to ignore it, which is worse than not having built it.
 *
 * So: find the main content region, throw away the machinery, reduce what is
 * left to words, and hash that. This is expected to need tuning against real
 * pages over time, and the tuning belongs here rather than spread around.
 */
import { createHash } from 'node:crypto';

/* Elements whose content is never part of what a page says. */
const DROP_ELEMENTS = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const SELF_CLOSING_NOISE = /<(link|meta|input|img|source|track)\b[^>]*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

/**
 * Regions that are chrome rather than content: navigation, the masthead, the
 * footer, the "report a problem" widget every canada.ca page carries.
 */
const CHROME = [
  /<header\b[^>]*>[\s\S]*?<\/header>/gi,
  /<nav\b[^>]*>[\s\S]*?<\/nav>/gi,
  /<footer\b[^>]*>[\s\S]*?<\/footer>/gi
];

/**
 * Text that changes on its own schedule and says nothing about the instrument.
 * Each of these is a real thing seen on the sites this watches.
 */
const VOLATILE_TEXT = [
  /date\s*modified\s*:?\s*\d{4}-\d{2}-\d{2}/gi,
  /last\s*updated\s*:?\s*\d{4}-\d{2}-\d{2}/gi,
  /screen\s*reader\s*users?[^.]*\./gi
];

/** Prefer a real content region when the page offers one. */
export function mainRegion(html) {
  const candidates = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*\bid=["']?(?:main-content|wb-cont|content)["']?[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>)*\s*<footer/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i
  ];
  for (const re of candidates) {
    const m = html.match(re);
    if (m && m[1] && m[1].trim().length > 200) return m[1];
  }
  return html;
}

/** Everything above, applied in order, ending in a single line of words. */
export function meaningfulText(html) {
  let s = String(html);
  s = s.replace(COMMENTS, ' ');
  s = s.replace(DROP_ELEMENTS, ' ');
  for (const re of CHROME) s = s.replace(re, ' ');
  s = mainRegion(s);
  s = s.replace(DROP_ELEMENTS, ' ');
  s = s.replace(SELF_CLOSING_NOISE, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  for (const re of VOLATILE_TEXT) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#39': "'", '#160': ' ', mdash: '—', ndash: '–'
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    const key = code.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ENTITIES, key)) return ENTITIES[key];
    if (key[0] === '#') {
      const n = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (Number.isFinite(n) && n > 0 && n < 0x110000) {
        try { return String.fromCodePoint(n); } catch { return m; }
      }
    }
    return m;
  });
}

/** The stored fingerprint of a page's meaning. */
export function contentHash(html) {
  return createHash('sha256').update(meaningfulText(html), 'utf8').digest('hex').slice(0, 32);
}

/* ------------------------------------------------------------------ */
/* Feeds and indexes                                                   */

/** Markup to the words it renders as: tags out, entities decoded, spaces collapsed. */
const clean = html =>
  decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const tagText = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : '';
};

/**
 * RSS 2.0 and Atom, which is all the Gazette and the departmental feeds emit.
 * A hand-rolled reader rather than a dependency: the shapes are small, and the
 * project has kept its dependency list to the two things that genuinely need a
 * browser.
 */
export function parseFeed(xml) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    let link = tagText(block, 'link');
    if (!link) {
      const m = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      if (m) link = decodeEntities(m[1]);
    }
    const id = tagText(block, 'guid') || tagText(block, 'id') || link || title;
    const date = tagText(block, 'pubDate') || tagText(block, 'updated')
      || tagText(block, 'published') || tagText(block, 'dc:date') || '';
    if (title || link) out.push({ id: id || title, title, link, date });
  }
  return out;
}

/**
 * One issue of the Canada Gazette, from the table of contents page its feed
 * item links to.
 *
 * This is the second half of reading the Gazette, and it is needed because a
 * feed item is only an announcement that an issue exists. Its title is
 * "Canada Gazette - Part II, August 26, 2026, volume 159, number 17" and its
 * description is the same boilerplate paragraph on every item, so no filter
 * looking at the item alone can ever tell a surtax order from a fisheries
 * regulation. The instruments are on the linked page, one list entry each:
 *
 *   <li> <a href="sor-dors173-eng.html"> Customs Tariff — Order Amending the
 *        Schedule to the Customs Tariff </a> <br> SOR/2026-173 <br> 07/08/26 </li>
 *
 * The registration number sits after the anchor rather than inside it, and it
 * is the half that names the instrument, so both go into the title. That is
 * what lets `isRelevant` match a record citing SOR/2025-95 by its number as
 * well as by its words.
 */
export function parseGazetteIssue(html, baseUrl) {
  const out = [];
  const seen = new Set();
  // A contents page is a list of instruments wrapped in the standard canada.ca
  // furniture, which is also lists: the site menu, the breadcrumb, the footer.
  // Without this the parser reads "Jobs and the workplace" as an instrument.
  let s = String(html).replace(COMMENTS, ' ').replace(DROP_ELEMENTS, ' ');
  for (const re of CHROME) s = s.replace(re, ' ');
  s = mainRegion(s);
  for (const block of s.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || []) {
    const a = block.match(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = clean(a[2]);
    if (!title || title.length < 8) continue;
    let link;
    try { link = new URL(a[1], baseUrl).toString(); } catch { continue; }
    if (seen.has(link)) continue;
    // Whatever follows the link in the same entry: the registration number,
    // and the date it was registered.
    const rest = clean(block.slice(block.indexOf(a[0]) + a[0].length));
    const number = (rest.match(/\b(?:SOR|SI)\/\d{4}-\d+/i) || [''])[0];
    seen.add(link);
    out.push({
      id: link,
      title: number ? `${title} ${number}` : title,
      link,
      date: (rest.match(/\b\d{2}\/\d{2}\/\d{2}\b/) || [''])[0]
    });
  }
  return out;
}

/**
 * The CBSA customs notice index, which is a table rather than a list of links.
 *
 * `parseIndex` cannot read this page. It takes its title from the anchor text,
 * and here the anchor holds only the notice number:
 *
 *   <th scope="row"><a href="/publications/cn-ad/cn26-17-eng.html">26-17</a></th>
 *   <td><p>Customs Notice 26-17: <cite>Certain Wood Cabinet and Vanity Goods
 *       Surtax Order</cite></p></td>
 *
 * Four or five characters, so every one of the roughly 225 notices was thrown
 * away by the eight-character guard that exists to drop nav labels elsewhere.
 * The guard is not wrong in general; it is the wrong instrument for a table
 * whose link text was never meant to carry the title. So read the row: the
 * anchor for the link and the number, the cell after it for the title.
 */
export function parseNoticeTable(html, baseUrl, pattern = null) {
  const out = [];
  const seen = new Set();
  const s = String(html).replace(COMMENTS, ' ').replace(DROP_ELEMENTS, ' ');
  for (const row of s.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const a = row.match(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    let link;
    try { link = new URL(a[1], baseUrl).toString(); } catch { continue; }
    if (pattern && !pattern.test(link)) continue;
    if (seen.has(link)) continue;
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
    const number = clean(a[2]);
    const title = cells.map(clean).find(t => t.length >= 8) || '';
    if (!title && !number) continue;
    seen.add(link);
    out.push({
      id: link,
      // The number matters on its own: the fact base cites notices as "26-17",
      // and that string appears nowhere in the title cell's prose.
      title: title ? `${number} ${title}`.trim() : number,
      link,
      date: (clean(row).match(/\b\d{4}-\d{2}-\d{2}\b/) || [''])[0]
    });
  }
  return out;
}

/**
 * The canada.ca news API, which is what the Finance news page reads.
 *
 * The page itself lists nothing any more. It is filled in after load from
 * `api.io.canada.ca`, which takes a department filter and answers a plain
 * keyless GET with JSON. Found by watching what the page requests, which is
 * the only way it could have been found; there is no feed advertised on it.
 */
export function parseCanadaNews(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  const entries = (doc && doc.feed && Array.isArray(doc.feed.entry)) ? doc.feed.entry : [];
  return entries.map(e => ({
    id: e.link || e.title,
    title: e.title || '',
    link: e.link || '',
    date: e.publishedDate || ''
  })).filter(i => i.id);
}

/**
 * A Drupal AJAX response, which is how the Prime Minister's listing arrives.
 *
 * The reply is an array of commands rather than a page; the rendered HTML is
 * in the `data` of the insert commands. Pull those out, concatenate them, and
 * hand the result to the ordinary index reader, which can cope from there
 * because these anchors do carry their own titles.
 */
export function parseDrupalAjax(text, baseUrl, pattern = null) {
  let commands;
  try { commands = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(commands)) return [];
  const html = commands
    .filter(c => c && c.command === 'insert' && typeof c.data === 'string')
    .map(c => c.data)
    .join('\n');
  if (!html) return [];
  return parseIndex(html, baseUrl, pattern);
}

/** The Federal Register's JSON API, which is a proper one. */
export function parseFederalRegister(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  const results = Array.isArray(doc && doc.results) ? doc.results : [];
  return results.map(r => ({
    id: r.document_number || r.html_url || r.title,
    title: r.title || '',
    link: r.html_url || '',
    date: r.publication_date || ''
  })).filter(i => i.id);
}

/**
 * An HTML index with no feed behind it, which is the CBSA customs notice list
 * and the departmental news listings. Take the links, keep the ones that look
 * like entries rather than chrome, and let the vocabulary filter do the rest.
 */
export function parseIndex(html, baseUrl, pattern = null) {
  const out = [];
  const seen = new Set();
  let s = String(html).replace(COMMENTS, ' ').replace(DROP_ELEMENTS, ' ');
  for (const re of CHROME) s = s.replace(re, ' ');
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(s))) {
    const href = m[1].trim();
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!title || title.length < 8) continue;
    let link;
    try { link = new URL(href, baseUrl).toString(); } catch { continue; }
    if (pattern && !pattern.test(link)) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    out.push({ id: link, title, link, date: '' });
  }
  return out;
}
