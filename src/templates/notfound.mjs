/**
 * The 404.
 *
 * A stray inbound link is the one context where somebody arrives here with no
 * idea what this is, which is why this page carries the same unofficial banner
 * as every other page rather than being a bare stub. It is also the page most
 * likely to be served from an address that never existed, so its links are
 * absolute; see the note on linkBase in layout.mjs.
 */
import { esc, escAttr } from '../util.mjs';

export function notFoundBody({ site, doors, linkBase }) {
  const nf = site.notfound;
  const items = doors.map(d =>
    `          <li><a href="${escAttr(linkBase + (d.id === 'people' ? 'index.html' : d.id + '.html'))}">` +
    `${esc(d.who)}</a>. ${esc(d.question)}</li>`
  ).join('\n');

  return `    <section class="page notfound" id="pageview">
        <h2>${esc(nf.heading)}</h2>
        <p>${esc(nf.text)}</p>
        <p>${esc(nf.doors_lead)}</p>
        <ul class="doorlist">
${items}
        </ul>
    </section>`;
}
