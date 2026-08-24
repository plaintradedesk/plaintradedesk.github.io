/**
 * Reading the fact base off disk, in one place, so that the build and the
 * translation tool are always looking at the same thing.
 *
 * No validation happens here. This only turns six files into one object.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadData(root) {
  const readJson = name => {
    const file = path.join(root, 'data', name);
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`cannot read data/${name}: ${e.message}`);
    }
  };

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
