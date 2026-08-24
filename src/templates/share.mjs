/**
 * One share image per door.
 *
 * The People layer is meant to travel as an image forwarded through WhatsApp
 * rather than as a link, because that is how it actually reaches the people it
 * is for. A card that arrives without the unofficial line would be the one
 * piece of this project that could be mistaken for a government notice, so the
 * line is on the card, at the top, in the same words as the banner.
 *
 * Every word on the card comes from the data files. There are no facts here and
 * there never should be: a card is a still image that keeps circulating after
 * the record behind it has changed, so it carries the door's question and
 * nothing that could go out of date.
 *
 * Drawn as SVG and rendered to PNG by the browser the build already opens for
 * gates 8 and 12, so this adds no dependency and calls no service.
 */
import { esc } from '../util.mjs';

export const WIDTH = 1200;
export const HEIGHT = 630;

export const shareFile = doorId => `share-${doorId}.png`;

/**
 * Wrap on words at a character budget. The browser does not wrap SVG text and
 * there is no font metric here, so the budget is deliberately conservative: a
 * card with a short last line is fine, a card with a line running off the edge
 * is not.
 */
function wrap(text, perLine, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[,.;:]?$/, '') + '...';
    return kept;
  }
  return lines;
}

const tspans = (lines, x, y, step) => lines
  .map((l, i) => `<tspan x="${x}" y="${y + i * step}">${esc(l)}</tspan>`)
  .join('');

/**
 * The light palette from the stylesheet, written out rather than imported. A
 * share card is not themed: it is one image, seen inside somebody else's app,
 * and it has to be legible there whatever they have their phone set to.
 */
const INK = '#14222A';
const GROUND = '#F1F5F5';
const SURFACE = '#FFFFFF';
const MUTED = '#56696F';
const ACCENT = '#0E5A6A';

export function shareCard({ door, site, host }) {
  const question = wrap(door.question, 30, 3);
  const notice = wrap(site.notice.lead + ' ' + firstSentence(site.notice.text), 96, 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(door.who)}. ${esc(door.question)}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${GROUND}"/>
  <rect x="0" y="0" width="${WIDTH}" height="86" fill="${INK}"/>
  <text font-family="Helvetica, Arial, sans-serif" font-size="23" fill="${GROUND}">
    ${tspans(notice, 64, 40, 30)}
  </text>

  <rect x="64" y="150" width="1072" height="392" rx="18" fill="${SURFACE}" stroke="#D2DDDE" stroke-width="2"/>

  <text x="104" y="216" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="3" font-weight="600" fill="${MUTED}">${esc(door.who.toUpperCase())}</text>

  <text font-family="Georgia, 'Times New Roman', serif" font-size="60" font-weight="600" fill="${INK}">
    ${tspans(question, 104, 300, 76)}
  </text>

  <text x="104" y="${question.length >= 3 ? 500 : 470}" font-family="Georgia, 'Times New Roman', serif" font-size="34" fill="${ACCENT}">${esc(site.title)}</text>
  <text x="1096" y="${question.length >= 3 ? 500 : 470}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="${MUTED}">${esc(host)}</text>
</svg>`;
}

/** The banner text is one paragraph. A card has room for its first sentence. */
function firstSentence(text) {
  const stop = text.indexOf('. ');
  return stop === -1 ? text : text.slice(0, stop + 1);
}
