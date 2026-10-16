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
 * The places worth reading, in the order the brief lists them. Six until
 * October 2026, when the Federal Register gained a second query; see below.
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
    relevant: item => pmoRelevant(item),
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
    vocabulary: () => US_VOCABULARY,
    note: 'proclamations under Section 338 and Section 232'
  },
  {
    key: 'fedregpres',
    name: 'US Federal Register, presidential documents naming Canada',
    // A second query rather than a wider first one. The procurement memorandum
    // of 21 September never says "tariff", so the query above never returns it
    // at all; no relevance rule could have seen it. Presidential documents are
    // few (232 have named Canada, ever), so asking for all of them that do is
    // cheap. The API's abstract is empty for every one of them, and its
    // excerpts would let in the drug-transit determination and the Lake Ontario
    // renaming, so the title is still what is judged.
    url: 'https://www.federalregister.gov/api/v1/documents.json'
      + '?per_page=20&order=newest'
      + '&conditions[type][]=PRESDOCU&conditions[term]=Canada'
      + '&fields[]=document_number&fields[]=title&fields[]=html_url&fields[]=publication_date',
    parse: parseFederalRegister,
    vocabulary: () => US_VOCABULARY,
    note: 'proclamations, orders and memoranda that name Canada'
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

/**
 * The words United States instruments use about Canada, for the two Federal
 * Register feeds only.
 *
 * None of the Section 338 proclamations says "tariff" in its title. They say
 * additional duties, importation, and discrimination against the commerce of
 * the United States, and the 21 September memorandum says procurement. Section
 * 232 proclamations are all titled "Adjusting Imports of ... Into the United
 * States". Checked against the forty items the Canada query returned on
 * 15 October 2026: these let through the six Section 338 documents among them
 * and nothing else. The antidumping notices say "Countervailing Duty", singular,
 * and stay out.
 *
 * Not shared with the other feeds, deliberately. The same CBSA index lists
 * notices on the importation of firearms and of dogs, and Canadian headlines
 * say "duties" about excise. Both Federal Register queries already require
 * Canada, which is what makes broad words cheap there and nowhere else.
 */
export const US_VOCABULARY = [
  'duties', 'importation', 'discrimination against the commerce', 'procurement',
  'adjusting imports', 'section 301'
];

/**
 * The Prime Minister's feed has its own rule rather than a wider vocabulary.
 *
 * His statements on the dispute are titled "Canada-U.S. trade negotiations",
 * which no tariff word matches, so the feed accepted nothing at all for five
 * weeks. But "trade" alone would take in every trip abroad that mentions a
 * trade mission. So: trade together with the United States, in the title or
 * the link slug. And one addition of judgment: a readout of a call with the
 * President of the United States, which is how the 11 October call appears and
 * which during this dispute is never not about trade.
 */
export function pmoRelevant(item) {
  const title = norm(item.title);
  const link = String(item.link || '').toLowerCase();
  const slug = link.split('/').pop() || '';
  const trade = /\btrade\b/.test(title) || /(^|-)trade(-|$)/.test(slug);
  const us = /\bu\.\s?s\.|\bunited states\b|\bamerica\b|\bamerican\b/.test(title)
    || /(^|-)(us|u-s|united-states)(-|$)/.test(slug);
  if (trade && us) return true;
  return /\bpresident of the united states\b/.test(title)
    || /president-united-states/.test(slug);
}

/**
 * Text as it is compared: lower case, whitespace collapsed, and no space just
 * inside a bracket. CBSA prints "United States Surtax Order ( 2026 )" and the
 * records write "(2026)", and that is one instrument.
 */
export const norm = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'")
  .replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

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
 *
 * Then the United States side, which until October 2026 had none: a
 * "Proclamation 11061" anywhere in a record, and the document number in any
 * federalregister.gov URL a record cites, kept with its slashes so it can only
 * ever match another Federal Register link.
 *
 * Then instruments a record names in words, which is what missed SOR/2026-186.
 * CA_RETAL_2026-09 said "United States Surtax Order (2026)" for weeks before
 * that order's registration number was known, and only the number could match,
 * so the Gazette entry for it was reported with no record attached.
 */
export function instrumentTokens(text) {
  const out = new Set();
  const s = String(text);
  for (const m of s.matchAll(/\bSOR\/\d{4}-\d+\b/gi)) out.add(m[0].toLowerCase());
  for (const m of s.matchAll(/\bSI\/\d{4}-\d+\b/gi)) out.add(m[0].toLowerCase());
  for (const m of s.matchAll(/customs\s+notice\s+(\d{2}-\d{2})\b/gi)) out.add('cn' + m[1]);
  for (const m of s.matchAll(/\bcn(\d{2}-\d{2})\b/gi)) out.add('cn' + m[1]);
  for (const m of s.matchAll(/\bproclamation\s+(?:no\.\s*)?(\d{4,5})\b/gi)) out.add('proclamation ' + m[1]);
  for (const m of s.matchAll(/federalregister\.gov\/(?:documents|d)\/(?:\d{4}\/\d{2}\/\d{2}\/)?(\d{4}-\d{5})\b/gi)) {
    out.add(`/${m[1]}/`);
  }
  for (const name of instrumentNames(s)) out.add(name);
  return out;
}

/**
 * Canadian instruments named in words: a run of capitalised words ending in
 * "Order" or "Regulations", with an optional bracket such as "(2026)".
 *
 * The bracket is kept, because it is the difference between two instruments:
 * "United States Surtax Order (2026)" and "United States Surtax Order (Steel
 * and Aluminum 2025)" are different orders cited by different records. An
 * amending instrument also yields the instrument it amends, so a record citing
 * "Regulations Amending the Employment Insurance Regulations" matches the next
 * amendment to the Employment Insurance Regulations as well. That is how
 * SOR/2026-203 would have been surfaced on 7 October.
 *
 * At least two words before the noun, and none of them only a connective, so
 * "the Order" in a sentence about some order is never a name.
 */
const NAME_WORD = String.raw`[A-Z][A-Za-z'’-]*`;
const NAME_JOIN = String.raw`(?:and|of|on|for|the|to|in|\d{4})`;
const NAME = new RegExp(String.raw`\b(${NAME_WORD}(?:[ \t]+(?:${NAME_WORD}|${NAME_JOIN}))*?[ \t]+(?:Order|Regulations))([ \t]*\([^()\n\\]{1,40}\))?`, 'g');
const CONNECTIVE = new Set(['and', 'of', 'on', 'for', 'the', 'to', 'in', 'amending', 'certain']);

export function instrumentNames(text) {
  const out = new Set();
  const add = phrase => {
    const words = phrase.replace(/\([^()]*\)/g, ' ').trim().split(/\s+/);
    const body = words.slice(0, -1).filter(w => !CONNECTIVE.has(w.toLowerCase()) && !/^\d{4}$/.test(w));
    if (body.length >= 2) out.add(norm(phrase));
  };
  for (const m of String(text).matchAll(NAME)) {
    const phrase = (m[1] + (m[2] || '')).replace(/^(?:The|This|That|An?)\s+/, '');
    add(phrase);
    const amended = phrase.match(/\b(?:Regulations|Order)\s+Amending\s+the\s+(.+)$/);
    if (amended) add(amended[1].replace(/\s*\([^()]*\)\s*$/, ''));
  }
  return out;
}

/** Words worth matching on, from a record title. Short words carry no signal. */
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'that', 'this', 'united',
  'states', 'canada', 'canadian', 'percent', 'selected', 'imported', 'affected',
  'federal', 'global', 'matching', 'suspended', 'package']);

export function titleWords(title) {
  return String(title).toLowerCase().match(/[a-z]{4,}/g)?.filter(w => !STOP.has(w)) || [];
}

/**
 * True when an item is about the things this fact base is about.
 *
 * Three ways in, any one enough: the shared vocabulary, an instrument a record
 * cites or names, and whatever the feed itself adds. A feed adds either more
 * words (the Federal Register) or a rule of its own (the Prime Minister). The
 * feed is optional so that a caller with only an item still gets the shared
 * test, which is what the Gazette's issue entries and the old callers use.
 */
export function isRelevant(item, factBase, feed = null) {
  const hay = norm(`${item.title} ${item.link}`);
  if (VOCABULARY.some(v => hay.includes(v))) return true;
  for (const token of factBase.instruments.keys()) if (hay.includes(token)) return true;
  if (feed && feed.vocabulary && feed.vocabulary().some(v => hay.includes(v))) return true;
  if (feed && feed.relevant && feed.relevant(item)) return true;
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
  const hay = norm(`${item.title} ${item.link}`);
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
