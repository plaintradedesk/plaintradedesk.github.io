/**
 * What the watcher reads, what counts as relevant, and which record an item
 * might belong to.
 *
 * Nothing about the fact base is hardcoded here. The cited URLs, the instrument
 * names and the notice numbers are all derived from `data/shocks.json` when the
 * watcher runs. That is deliberate and it has already earned itself once: an
 * earlier draft of this brief said there were fifteen cited URLs, the weekly
 * update replaced several placeholders with real sources, and the true count is
 * now thirteen. A number written into this file, a comment or a fixture would
 * have been wrong within days and wrong silently.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseFeed, parseFederalRegister, parseIndex,
  parseGazetteIssue, parseNoticeTable, parseCanadaNews, parseDrupalAjax
} from './extract.mjs';

/**
 * The six places worth reading, in the order the brief lists them.
 *
 * `weight` is not a score. It only marks the two Part I style sources whose
 * items are proposals rather than instruments, so the report can say so.
 *
 * The two Gazette URLs were guesses until 2026-08-27, and both were wrong: the
 * first live run returned 404 for each. The real feeds are linked from the
 * Gazette's own RSS index at gazette.gc.ca/rss/sc-rb-eng.html, which is an HTML
 * page listing them and not a feed itself, and that is where the guess came
 * from. Worth noting that the watcher reported this as unread rather than as a
 * quiet feed with nothing in it, which is the distinction the whole design
 * turns on: a wrong URL and a calm week look identical to anything that
 * collapses the two.
 */
export const FEEDS = [
  {
    key: 'gazette2',
    name: 'Canada Gazette Part II',
    url: 'https://gazette.gc.ca/rss/p2-eng.xml',
    parse: parseFeed,
    // An item here is an issue, not an instrument. `expand` says so: read the
    // issue's contents page before deciding whether anything in it matters.
    expand: parseGazetteIssue,
    note: 'where a surtax order actually appears'
  },
  {
    key: 'gazette1',
    name: 'Canada Gazette Part I',
    url: 'https://gazette.gc.ca/rss/p1-eng.xml',
    parse: parseFeed,
    expand: parseGazetteIssue,
    weight: 'proposal',
    note: 'proposals and notices of intent'
  },
  {
    key: 'cbsa',
    name: 'CBSA customs notices',
    url: 'https://www.cbsa-asfc.gc.ca/publications/cn-ad/menu-eng.html',
    parse: (body, url) => parseNoticeTable(body, url, /\/cn-ad\/cn\d{2}-\d{2}/i),
    note: 'declaration mechanics and remission'
  },
  {
    key: 'finance',
    name: 'Finance Canada news',
    // Not the news page a person would open. That page lists nothing any more;
    // it fills itself from this after load. See parseCanadaNews.
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2'
      + '?dept=departmentfinance&sort=publishedDate&orderBy=desc&pick=25',
    parse: parseCanadaNews,
    note: 'announcements; status stays announced until Gazette or CBSA catches up'
  },
  {
    key: 'pmo',
    name: "Prime Minister's statements",
    // Likewise rendered in the browser. `view_args=all` is the argument the
    // site's own listing uses to mix releases, statements, readouts, speeches
    // and media advisories rather than one kind at a time.
    url: 'https://www.pm.gc.ca/views/ajax',
    method: 'POST',
    body: 'view_name=news&view_display_id=page_1&view_args=all&page=0',
    parse: (body, url) => parseDrupalAjax(body, url, /\/news\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\//i),
    note: 'announcements; same caveat as Finance'
  },
  {
    key: 'fedreg',
    name: 'US Federal Register',
    url: 'https://www.federalregister.gov/api/v1/documents.json'
      + '?per_page=40&order=newest'
      + '&conditions[term]=Canada%20tariff'
      + '&fields[]=document_number&fields[]=title&fields[]=html_url&fields[]=publication_date',
    parse: parseFederalRegister,
    note: 'proclamations under Section 338 and Section 232'
  }
];

/**
 * The standing vocabulary from the brief. Instrument names and notice numbers
 * are not in this list because they come out of the data instead.
 */
export const VOCABULARY = [
  'surtax', 'counter-tariff', 'counter tariff', 'countertariff', 'countermeasure',
  'tariff', 'remission', 'safeguard', 'section 338', 'section 232'
];

/** Load the fact base's own view of itself: cited URLs and instrument names. */
export function loadFactBase(root) {
  const file = path.join(root, 'data', 'shocks.json');
  const shocks = JSON.parse(readFileSync(file, 'utf8')).shocks;

  // url -> [record ids], preserving the order the file lists them in.
  const citedBy = new Map();
  for (const s of shocks) {
    for (const src of s.sources || []) {
      if (!citedBy.has(src.url)) citedBy.set(src.url, { label: src.label, ids: [] });
      const entry = citedBy.get(src.url);
      if (!entry.ids.includes(s.id)) entry.ids.push(s.id);
    }
  }

  // Instrument tokens, read out of whatever the records actually say.
  const instruments = new Map();   // lowercase token -> [record ids]
  for (const s of shocks) {
    const blob = JSON.stringify(s);
    for (const token of instrumentTokens(blob)) {
      if (!instruments.has(token)) instruments.set(token, []);
      if (!instruments.get(token).includes(s.id)) instruments.get(token).push(s.id);
    }
  }

  return { shocks, citedBy, instruments };
}

/**
 * Instrument names as the records write them: `SOR/2025-95`, and customs notice
 * numbers in either the prose form ("Customs Notice 25-11") or the URL form
 * ("cn25-11-eng.html"). Both are normalised to the same token.
 */
export function instrumentTokens(text) {
  const out = new Set();
  const s = String(text);
  for (const m of s.matchAll(/\bSOR\/\d{4}-\d+\b/gi)) out.add(m[0].toLowerCase());
  for (const m of s.matchAll(/\bSI\/\d{4}-\d+\b/gi)) out.add(m[0].toLowerCase());
  for (const m of s.matchAll(/customs\s+notice\s+(\d{2}-\d{2})\b/gi)) out.add('cn' + m[1]);
  for (const m of s.matchAll(/\bcn(\d{2}-\d{2})\b/gi)) out.add('cn' + m[1]);
  return out;
}

/** Words worth matching on, from a record title. Short words carry no signal. */
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'that', 'this', 'united',
  'states', 'canada', 'canadian', 'percent', 'selected', 'imported', 'affected',
  'federal', 'global', 'matching', 'suspended', 'package']);

export function titleWords(title) {
  return String(title).toLowerCase().match(/[a-z]{4,}/g)?.filter(w => !STOP.has(w)) || [];
}

/** True when an item is about the things this fact base is about. */
export function isRelevant(item, factBase) {
  const hay = `${item.title} ${item.link}`.toLowerCase();
  if (VOCABULARY.some(v => hay.includes(v))) return true;
  for (const token of factBase.instruments.keys()) if (hay.includes(token)) return true;
  return false;
}

/**
 * Which records an item looks related to.
 *
 * Instrument name first, because that is an identification rather than a guess.
 * Keyword overlap second, and only when two or more distinct words from a
 * record's title appear, which keeps "tariff" alone from matching everything.
 *
 * Returning an empty array is a real answer and the report says so out loud:
 * new material that matches no existing record is the signal that a record may
 * need to be written.
 */
export function relatedRecords(item, factBase) {
  const hay = `${item.title} ${item.link}`.toLowerCase();
  const byInstrument = new Set();
  for (const [token, ids] of factBase.instruments) {
    if (hay.includes(token)) ids.forEach(id => byInstrument.add(id));
  }
  if (byInstrument.size) return [...byInstrument];

  const byWords = [];
  for (const s of factBase.shocks) {
    const words = titleWords(s.title);
    const hits = words.filter(w => [...wordForms(w)].some(f => hay.includes(f)));
    if (new Set(hits).size >= 2) byWords.push(s.id);
  }
  return byWords;
}

/**
 * A record's title word and an item's text, matched across an ordinary plural.
 *
 * The Gazette names an instrument "Certain Wood Cabinet and Vanity Goods
 * Surtax Order", singular, and the record it belongs to is titled "Global
 * safeguard on imported cabinets and vanities", plural. Two words in common
 * and neither of them matched, so the order was reported with no record
 * attached, on a record that exists precisely because of that order.
 *
 * Deliberately only ordinary plurals. No stemmer and no other inflections:
 * this is the one gap that has actually been observed, and widening what
 * counts as a word is only safe while it stays this dull. The two-word
 * threshold above is untouched, because that is what stops "tariff" alone
 * from matching everything.
 */
export function wordForms(w) {
  const forms = new Set([w]);
  if (w.endsWith('ies') && w.length > 4) forms.add(w.slice(0, -3) + 'y');
  else if (w.endsWith('y')) forms.add(w.slice(0, -1) + 'ies');
  if (w.endsWith('s') && !w.endsWith('ss')) forms.add(w.slice(0, -1));
  else if (!w.endsWith('s')) forms.add(w + 's');
  return forms;
}
