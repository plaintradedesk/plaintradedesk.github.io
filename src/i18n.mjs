/**
 * Room for a second language beside every string a reader sees.
 *
 * Nothing is translated yet and the build emits English only. This exists now
 * because retrofitting it once the fact base has grown is the expensive
 * version, and because two things are already true: federal adoption would
 * effectively require French, and for reach in Brampton specifically Punjabi,
 * Hindi and Urdu matter more than French does.
 *
 * The shape is a file per language keyed by a stable path, rather than
 * `{ en, fr }` on every field in the data files. Two reasons. The fact base is
 * hand-edited, and the README teaches people to open shocks.json and add an
 * object; burying every string one level deeper makes the file that has to stay
 * easy to edit harder to edit for the benefit of translations that do not exist
 * yet. And a translation carries its own English beside it, so when a source
 * string changes the translation can be told it is stale, which is the failure
 * that actually happens.
 *
 *   data/i18n/fr.json      every string
 *   data/i18n/pa.json      the plain register and the interface only
 *   data/i18n/hi.json      the same
 *   data/i18n/ur.json      the same
 *
 * Only the plain register is ever worth translating for reach. The policy
 * register is read by people who read policy in English, and a half-translated
 * legal instrument is worse than none.
 *
 * Source labels are deliberately not translatable. "CBSA Customs Notice 26-99"
 * is the name of a document, and a translated name does not find it.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Which scopes a language file carries. */
export const SCOPES = ['ui', 'plain', 'operator', 'policy'];
export const FULL = SCOPES;
export const PLAIN_ONLY = ['ui', 'plain'];

export const LANGUAGES = {
  fr: { name: 'French', scopes: FULL },
  pa: { name: 'Punjabi', scopes: PLAIN_ONLY },
  hi: { name: 'Hindi', scopes: PLAIN_ONLY },
  ur: { name: 'Urdu', scopes: PLAIN_ONLY }
};

/* Strings inside the site copy block that are not prose. */
const NOT_PROSE = new Set(['site.offline.filename']);

const isText = v => typeof v === 'string' && v.trim().length > 0;

/**
 * Visit every reader-facing string in a loaded data object.
 *
 * The visitor is given the key, the text, the register the string belongs to,
 * and a setter, so the same walk both collects the English and writes a
 * translation back.
 */
export function walk(data, visit) {
  const see = (key, obj, prop, scope) => {
    if (!isText(obj[prop])) return;
    visit({ key, text: obj[prop], scope, set: v => { obj[prop] = v; } });
  };

  /* ---------- the interface, the masthead, the footer ---------- */
  const recurse = (obj, prefix, scope) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = `${prefix}.${k}`;
      if (NOT_PROSE.has(key)) continue;
      if (typeof v === 'string') see(key, obj, k, scope);
      else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'string') see(`${key}[${i}]`, v, i, scope);
          else if (item && typeof item === 'object') recurse(item, `${key}[${i}]`, scope);
        });
      } else if (v && typeof v === 'object') recurse(v, key, scope);
    }
  };
  recurse(data.site, 'site', 'ui');

  /* ---------- the standing pages ---------- */
  for (const [id, page] of Object.entries(data.pages)) {
    for (const prop of ['title', 'stamp', 'description']) see(`pages.${id}.${prop}`, page, prop, 'plain');
    if (Array.isArray(page.body)) {
      page.body.forEach((block, i) => see(`pages.${id}.body[${i}].text`, block, 'text', 'plain'));
    }
    // The generated corrections page carries its own copy block.
    if (page.copy) recurse(page.copy, `pages.${id}.copy`, 'plain');
  }

  /* ---------- the doors ---------- */
  // A door's register decides what its own copy is. The policy door is written
  // for people who read policy in English.
  for (const door of data.doors) {
    const scope = door.register === 'plain' ? 'plain' : door.register;
    for (const prop of ['who', 'question', 'title', 'lede', 'description']) {
      see(`doors.${door.id}.${prop}`, door, prop, scope);
    }
  }
  for (const [cls, vocab] of Object.entries(data.statuses)) {
    for (const status of Object.keys(vocab)) see(`statuses.${cls}.${status}`, vocab, status, 'ui');
  }
  for (const key of Object.keys(data.referrals)) see(`referrals.${key}`, data.referrals, key, 'plain');
  for (const key of Object.keys(data.sectors)) see(`sectors.${key}`, data.sectors, key, 'ui');

  /* ---------- the seasons ---------- */
  for (const s of data.seasons) {
    for (const prop of ['label', 'hint']) see(`seasons.${s.id}.${prop}`, s, prop, 'plain');
  }

  /* ---------- the fact base ---------- */
  for (const s of data.shocks) {
    // A title and its facts are read on every door, so they belong to the
    // shallowest register that shows them.
    see(`shocks.${s.id}.title`, s, 'title', 'plain');
    see(`shocks.${s.id}.plain`, s, 'plain', 'plain');
    see(`shocks.${s.id}.operator`, s, 'operator', 'operator');
    see(`shocks.${s.id}.policy`, s, 'policy', 'policy');
    (s.facts || []).forEach((f, i) => {
      see(`shocks.${s.id}.facts[${i}].label`, f, 'label', 'plain');
      see(`shocks.${s.id}.facts[${i}].value`, f, 'value', 'plain');
    });
  }

  /* ---------- the steps ---------- */
  for (const a of data.actions) {
    const scope = a.doors.includes('people') ? 'plain' : 'operator';
    for (const prop of ['text', 'note', 'by']) see(`actions.${a.id}.${prop}`, a, prop, scope);
  }

  /* ---------- the corrections log ---------- */
  data.corrections.forEach((c, i) => {
    for (const prop of ['what', 'detail']) see(`corrections[${i}].${prop}`, c, prop, 'plain');
  });
}

/** Every reader-facing string, in walk order. */
export function collect(data, scopes = SCOPES) {
  const out = [];
  walk(data, e => { if (scopes.includes(e.scope)) out.push({ key: e.key, text: e.text, scope: e.scope }); });
  return out;
}

/**
 * What a language file is missing, carrying that nobody knows about, or holding
 * a translation of English that has since changed.
 */
export function coverage(entries, table) {
  const strings = (table && table.strings) || {};
  const missing = [], stale = [], done = [];
  for (const e of entries) {
    const row = strings[e.key];
    if (!row) { missing.push(e.key); continue; }
    if (row.en !== e.text) stale.push(e.key);
    if (isText(row.t)) done.push(e.key);
  }
  const known = new Set(entries.map(e => e.key));
  const unknown = Object.keys(strings).filter(k => !known.has(k));
  return {
    total: entries.length,
    translated: done.length,
    missing, stale, unknown,
    complete: entries.length > 0 && done.length === entries.length && !missing.length && !stale.length
  };
}

/**
 * A copy of the data with every non-empty translation applied. An empty
 * translation is ignored entirely, which is what keeps a half-finished language
 * file from producing a half-English page.
 */
export function apply(data, table) {
  const copy = structuredClone(data);
  const strings = (table && table.strings) || {};
  walk(copy, e => {
    const row = strings[e.key];
    if (row && isText(row.t) && row.en === e.text) e.set(row.t);
  });
  return copy;
}

/* ---------- the files themselves ---------- */

export const i18nDir = root => path.join(root, 'data', 'i18n');
export const tablePath = (root, lang) => path.join(i18nDir(root), lang + '.json');

export function readTable(root, lang) {
  const file = tablePath(root, lang);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read data/i18n/${lang}.json: ${e.message}`);
  }
}

export function writeTable(root, lang, table) {
  mkdirSync(i18nDir(root), { recursive: true });
  writeFileSync(tablePath(root, lang), JSON.stringify(table, null, 2) + '\n');
}

/** The languages that have a file, whether or not anything is translated. */
export function present(root) {
  const dir = i18nDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort();
}

/**
 * A language file, regenerated from the current source, keeping every
 * translation anybody has already written.
 */
export function makeTable(lang, entries, existing) {
  const previous = (existing && existing.strings) || {};
  const strings = {};
  for (const e of entries) {
    const had = previous[e.key];
    strings[e.key] = {
      en: e.text,
      // A translation of text that has since changed is kept rather than
      // thrown away, and reported as stale, because rewriting it is usually
      // cheaper than starting again.
      t: had && typeof had.t === 'string' ? had.t : ''
    };
  }
  return {
    language: lang,
    name: LANGUAGES[lang] ? LANGUAGES[lang].name : lang,
    scopes: LANGUAGES[lang] ? LANGUAGES[lang].scopes : SCOPES,
    note: 'Generated by "npm run i18n". "en" is the English this was translated ' +
      'from; if the English changes, the entry is reported as stale. An empty "t" ' +
      'is ignored by the build, which emits English only until a language is complete.',
    strings
  };
}
