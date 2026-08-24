#!/usr/bin/env node
/**
 * Keep the language files level with the fact base.
 *
 *   npm run i18n              refresh every language file and report where each stands
 *   npm run i18n -- fr pa     refresh these, creating them if they do not exist
 *
 * Regenerating never throws a translation away. A key whose English has changed
 * keeps its translation and is reported as stale, because rewriting a sentence
 * is usually cheaper than translating it again from nothing.
 *
 * Nothing here translates anything. Nothing here should ever call a machine
 * translator: a wrong sentence about somebody's job, in a language the person
 * who wrote this cannot read, is worse than an English sentence they can.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadData } from '../src/data.mjs';
import {
  LANGUAGES, collect, coverage, makeTable, readTable, writeTable, present
} from '../src/i18n.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = loadData(ROOT);

const asked = process.argv.slice(2).filter(a => !a.startsWith('-'));
const langs = asked.length ? asked : (present(ROOT).length ? present(ROOT) : Object.keys(LANGUAGES));

const unknown = langs.filter(l => !LANGUAGES[l]);
if (unknown.length) {
  console.error(`\nUnknown language: ${unknown.join(', ')}. ` +
    `Add it to LANGUAGES in src/i18n.mjs first, with the registers it covers.\n`);
  process.exit(1);
}

console.log(`Reader-facing strings, by register:\n`);
const all = collect(data);
const byScope = {};
for (const e of all) byScope[e.scope] = (byScope[e.scope] || 0) + 1;
for (const [scope, n] of Object.entries(byScope)) console.log(`  ${scope.padEnd(9)} ${n}`);
console.log('');

for (const lang of langs) {
  const meta = LANGUAGES[lang];
  const entries = collect(data, meta.scopes);
  const before = readTable(ROOT, lang);
  const table = makeTable(lang, entries, before);
  writeTable(ROOT, lang, table);

  const cov = coverage(entries, table);
  const notes = [];
  if (cov.stale.length) notes.push(`${cov.stale.length} stale`);
  if (before) {
    const gone = Object.keys(before.strings || {}).filter(k => !table.strings[k]);
    if (gone.length) notes.push(`${gone.length} dropped`);
    const added = Object.keys(table.strings).filter(k => !(before.strings || {})[k]);
    if (added.length) notes.push(`${added.length} new`);
  } else {
    notes.push('created');
  }

  console.log(`  ${lang}  ${meta.name.padEnd(8)} ${cov.translated}/${cov.total} translated` +
    ` (${meta.scopes.join(', ')})${notes.length ? '  ' + notes.join(', ') : ''}`);
  for (const key of cov.stale.slice(0, 10)) console.log(`        stale: ${key}`);
  if (cov.stale.length > 10) console.log(`        and ${cov.stale.length - 10} more`);
}

console.log('\nThe build emits English only. A language is used only when it is complete,' +
  '\nand `node src/build.mjs --lang=xx` refuses until it is.');
