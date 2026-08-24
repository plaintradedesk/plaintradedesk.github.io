#!/usr/bin/env node
/**
 * Build entry point.
 *
 *   node src/build.mjs                 validate, render, gate, write dist/
 *   node src/build.mjs --validate-only  the data gates and nothing else
 *   node src/build.mjs --no-browser     skip the headless load in gate 8
 *
 * Validation runs first. If it fails, nothing is written and the process exits
 * non-zero having listed every failure rather than the first one. The rendered
 * pages are gated in a staging directory and only moved into dist/ once they
 * have passed, so a failed build never leaves a half-written site behind.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { today, dayDiff, fmtDate } from './util.mjs';
import { validateData, checkExternalReferences, checkStructure, checkInBrowser } from './validate.mjs';
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
  for (const [name, html] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), html);
  }
}

async function main() {
  const ctx = {
    today: today(),
    cadenceDays: CADENCE_DAYS,
    recheckAfter: RECHECK_AFTER,
    staleFail: STALE_FAIL
  };
  const data = loadData();

  console.log(`Plain Trade Desk build, as at ${ctx.today}`);
  console.log(`  ${data.shocks.length} records, ${data.actions.length} steps, ` +
    `${data.doors.length} doors, ${data.seasons.length} seasons, ` +
    `${data.corrections.length} corrections\n`);

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
  const { files, fresh, gaps } = render(data, ctx);

  /* ---------- gates 7 and 8 ---------- */
  const external = checkExternalReferences(files);
  const structure = checkStructure(files);
  const failures = [...external.failures, ...structure.failures];
  if (failures.length) {
    report(failures, []);
    process.exit(1);
  }
  console.log('  output gates passed (7 external reference, 8 structure)');

  writeInto(STAGE, files);

  if (flag('--no-browser')) {
    console.warn('  gate 8 headless load SKIPPED because --no-browser was passed');
  } else {
    const browser = await checkInBrowser(STAGE, Object.keys(files));
    if (!browser.ok) {
      report(browser.failures, []);
      rmSync(STAGE, { recursive: true, force: true });
      process.exit(1);
    }
    console.log('  gate 8 headless load passed, no page errors and no requests');
  }

  /* ---------- publish ---------- */
  rmSync(DIST, { recursive: true, force: true });
  renameSync(STAGE, DIST);

  const names = readdirSync(DIST).sort();
  console.log(`\nWrote ${names.length} files to dist/`);
  for (const n of names) console.log('  ' + n);
  console.log(`\nFreshness: ${fresh.label}. Known gaps: ${gaps.length}.`);
  console.log(stalenessReport(data, ctx));
}

main().catch(e => {
  console.error('\nBuild failed unexpectedly:\n' + (e && e.stack ? e.stack : e) + '\n');
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
});
