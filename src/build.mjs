#!/usr/bin/env node
/**
 * Build entry point.
 *
 *   node src/build.mjs                    validate, render, gate, write dist/
 *   node src/build.mjs --validate-only    the data gates and nothing else
 *   node src/build.mjs --no-browser       skip the browser, which is gates 8 and 12
 *   node src/build.mjs --archived=DATE    build the site as no longer maintained
 *
 * Validation runs first. If it fails, nothing is written and the process exits
 * non-zero having listed every failure rather than the first one. The rendered
 * pages are gated in a staging directory and only moved into dist/ once they
 * have passed, so a failed build never leaves a half-written site behind.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { today, dayDiff, fmtDate, isDate } from './util.mjs';
import { loadConfig } from './config.mjs';
import {
  validateData, checkExternalReferences, checkStructure, checkInBrowser,
  checkLinks, checkPageMeta
} from './validate.mjs';
import { render } from './render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(ROOT, '.dist-staging');

/* The three thresholds, in one place.

   The site shows a softer warning on a record at 21 days and the build refuses
   at 30. If the refusal fires it is doing its job, and the fix is to check the
   record against its sources rather than to raise the number. */
export const CADENCE_DAYS = 7;
export const RECHECK_AFTER = 21;
export const STALE_FAIL = 30;

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => {
  const hit = argv.find(a => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : null;
};

const readJson = name => {
  const file = path.join(DATA, name);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`\ncannot read data/${name}: ${e.message}\n`);
    process.exit(1);
  }
};

function loadData() {
  const shocks = readJson('shocks.json');
  const actions = readJson('actions.json');
  const doors = readJson('doors.json');
  const seasons = readJson('seasons.json');
  const pages = readJson('pages.json');
  const corrections = readJson('corrections.json');
  return {
    sectors: shocks.sectors,
    shocks: shocks.shocks,
    actions: actions.actions,
    doors: doors.doors,
    statuses: doors.statuses,
    referrals: doors.referrals,
    seasons: seasons.seasons,
    defaultSeason: seasons.default,
    site: pages.site,
    pages: pages.pages,
    corrections: corrections.corrections
  };
}

const GATE_NAMES = {
  1: 'unsourced record', 2: 'stale record', 3: 'missing register',
  4: 'orphaned action', 5: 'vocabulary mismatch', 6: 'season distinctness',
  7: 'external reference', 8: 'truncation', 9: 'referral discipline',
  10: 'broken internal link', 11: 'page metadata', 12: 'accessibility',
  schema: 'record shape'
};

function report(failures, warnings) {
  for (const w of warnings) {
    console.warn(`  warning  gate ${w.gate} (${GATE_NAMES[w.gate]})  ${w.id}\n           ${w.message}`);
  }
  if (warnings.length) console.warn('');
  if (!failures.length) return;
  console.error(`\nBuild refused. ${failures.length} failure${failures.length === 1 ? '' : 's'}:\n`);
  for (const f of failures) {
    console.error(`  gate ${f.gate} (${GATE_NAMES[f.gate] || 'unknown'})  ${f.id}`);
    console.error(`           ${f.message}`);
  }
  console.error('');
}

/**
 * Records approaching the staleness gate. The weekly check runs validation only
 * and opens an issue from this, which converts the maintainer's discipline from
 * a habit into a mechanism. Habits fail in December.
 */
function stalenessReport(data, ctx, warnWithin = 7) {
  if (ctx.archived) {
    return `This build is archived as at ${fmtDate(ctx.archived)}, so the staleness gate is off.`;
  }
  const rows = data.shocks
    .map(s => ({ id: s.id, title: s.title, age: dayDiff(s.verified, ctx.today), verified: s.verified }))
    .filter(s => STALE_FAIL - s.age <= warnWithin)
    .sort((a, b) => b.age - a.age);

  if (!rows.length) {
    return `No record is within ${warnWithin} days of the ${STALE_FAIL} day staleness gate.`;
  }
  return `Approaching the staleness gate (within ${warnWithin} days of ${STALE_FAIL}):\n` +
    rows.map(s => `  ${s.id}  last checked ${fmtDate(s.verified)}, ${s.age} days ago, ` +
      `${STALE_FAIL - s.age} day${STALE_FAIL - s.age === 1 ? '' : 's'} left\n    ${s.title}`).join('\n');
}

function writeInto(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents);
  }
}

async function main() {
  /* The archive switch. The promise page commits, in writing, to a notice at
     the top of every page within thirty days of this site ceasing to be
     maintained. A promise that needs somebody to hand-edit nine pages during
     the week they have decided to stop is a promise that will not be kept, so
     it is a flag on the build instead. */
  const archived = option('--archived');
  if (archived !== null && !isDate(archived)) {
    console.error(`\n--archived needs the date of the last check, as YYYY-MM-DD. Got "${archived}".\n`);
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig(ROOT);
  } catch (e) {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }

  const ctx = {
    today: today(),
    cadenceDays: CADENCE_DAYS,
    recheckAfter: RECHECK_AFTER,
    staleFail: STALE_FAIL,
    baseUrl: config.baseUrl,
    cname: config.cname,
    archived
  };
  const data = loadData();

  console.log(`Plain Trade Desk build, as at ${ctx.today}`);
  console.log(`  ${data.shocks.length} records, ${data.actions.length} steps, ` +
    `${data.doors.length} doors, ${data.seasons.length} seasons, ` +
    `${data.corrections.length} corrections`);
  console.log(`  publishing to ${ctx.baseUrl} (from ${config.source})` +
    (config.published ? '' : ', which is not a published address'));
  if (archived) console.log(`  ARCHIVED build, last checked ${fmtDate(archived)}`);
  console.log('');

  /* ---------- gates 1 to 6 and 9 ---------- */
  const dataReport = validateData(data, ctx);
  if (!dataReport.ok) {
    report(dataReport.failures, dataReport.warnings);
    process.exit(1);
  }
  report([], dataReport.warnings);
  console.log('  data gates passed (1 unsourced, 2 stale, 3 register, 4 orphan, 5 vocabulary, 6 season distinctness)');

  if (flag('--validate-only')) {
    console.log('\n' + stalenessReport(data, ctx));
    console.log('\nValidation only. Nothing rendered, nothing written.');
    return;
  }

  /* ---------- render ---------- */
  const { files, assets, meta, fresh, gaps } = render(data, ctx);

  /* ---------- gates 7, 8, 10 and 11 ---------- */
  const failures = [
    ...checkExternalReferences(files).failures,
    ...checkStructure(files).failures,
    ...checkLinks(files, assets, ctx).failures,
    ...checkPageMeta(files, ctx).failures
  ];
  if (failures.length) {
    report(failures, []);
    process.exit(1);
  }
  console.log('  output gates passed (7 external reference, 8 structure, 10 internal links, 11 page metadata)');

  writeInto(STAGE, { ...files, ...assets });

  if (flag('--no-browser')) {
    console.warn('  gates 8 and 12 SKIPPED because --no-browser was passed');
  } else {
    const browser = await checkInBrowser(STAGE, Object.keys(files));
    if (!browser.ok) {
      report(browser.failures, []);
      rmSync(STAGE, { recursive: true, force: true });
      process.exit(1);
    }
    console.log('  gate 8 headless load passed, no page errors and no requests');
    console.log('  gate 12 accessibility passed, no serious or critical violations');
  }

  /* ---------- publish ---------- */
  rmSync(DIST, { recursive: true, force: true });
  renameSync(STAGE, DIST);

  const names = readdirSync(DIST).sort();
  console.log(`\nWrote ${names.length} files to dist/`);
  for (const n of names) {
    const m = meta[n];
    console.log('  ' + n + (m ? `  ${m.canonical}` : ''));
  }
  console.log(`\nFreshness: ${fresh.label}. Known gaps: ${gaps.length}.`);
  console.log(stalenessReport(data, ctx));
}

main().catch(e => {
  console.error('\nBuild failed unexpectedly:\n' + (e && e.stack ? e.stack : e) + '\n');
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
});
