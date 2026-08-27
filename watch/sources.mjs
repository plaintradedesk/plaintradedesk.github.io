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
import { parseFeed, parseFederalRegister, parseIndex } from './extract.mjs';

/**
 * The six places worth reading, in the order the brief lists them.
 *
 * `weight` is not a score. It only marks the two Part I style sources whose
 * items are proposals rather than instruments, so the report can say so.
 */
export const FEEDS = [
  {
    key: 'gazette2',
    name: 'Canada Gazette Part II',
    url: 'https://gazette.gc.ca/rss/sc-rb-eng.xml',
    parse: parseFeed,
    note: 'where a surtax order actually appears'
  },
  {
    key: 'gazette1',
    name: 'Canada Gazette Part I',
    url: 'https://gazette.gc.ca/rss/sc-rb-p1-eng.xml',
    parse: parseFeed,
    weight: 'proposal',
    note: 'proposals and notices of intent'
  },
  {
    key: 'cbsa',
    name: 'CBSA customs notices',
    url: 'https://www.cbsa-asfc.gc.ca/publications/cn-ad/menu-eng.html',
    parse: (body, url) => parseIndex(body, url, /\/cn-ad\/cn\d{2}-\d{2}/i),
    note: 'declaration mechanics and remission'
  },
  {
    key: 'finance',
    name: 'Finance Canada news',
    url: 'https://www.canada.ca/en/department-finance/news.html',
    parse: (body, url) => parseIndex(body, url, /\/news\/\d{4}\/\d{2}\//),
    note: 'announcements; status stays announced until Gazette or CBSA catches up'
  },
  {
    key: 'pmo',
    name: "Prime Minister's statements",
    url: 'https://www.pm.gc.ca/en/news',
    parse: (body, url) => parseIndex(body, url, /\/(news|statements)\//),
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
    const hits = words.filter(w => hay.includes(w));
    if (new Set(hits).size >= 2) byWords.push(s.id);
  }
  return byWords;
}
