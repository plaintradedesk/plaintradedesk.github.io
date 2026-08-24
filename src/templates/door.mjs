/**
 * One door panel: lede, the controls that apply to it, the two lists, and the
 * explainer. Every card and every step is written into the markup, including the
 * ones the current season hides, so that the page is complete before any script
 * runs and stays readable if none ever does.
 *
 * The default season is applied here rather than in the browser, which is why
 * the People door reads correctly with JavaScript switched off.
 */
import { esc, escAttr } from '../util.mjs';
import { shockCard } from './shock.mjs';
import { actionRow } from './action.mjs';

const id = (ids, name) => (ids ? ` id="${name}"` : '');

function filters(door, sectors, site, ids) {
  if (!door.filters) return '';
  const selId = ids ? 'sectorSel' : 'sectorSel-' + door.id;
  const options = sectors
    .map(([key, label]) => `          <option value="${escAttr(key)}">${esc(label)}</option>`)
    .join('\n');
  return `
      <div class="filters">
        <label for="${escAttr(selId)}">${esc(site.filters.label)}</label>
        <select class="sector-select" id="${escAttr(selId)}">
          <option value="all">${esc(site.filters.all)}</option>
${options}
        </select>
      </div>
`;
}

function seasonControl(door, seasons, site, defaultSeason) {
  if (!door.seasons) return '';
  const f = site.seasons_form;
  const chips = seasons.map(s =>
    `            <label class="chip"><input type="radio" name="season" value="${escAttr(s.id)}"` +
    ` data-hint="${escAttr(s.hint)}"${s.id === defaultSeason ? ' checked' : ''}>` +
    `<span>${esc(s.label)}</span></label>`
  ).join('\n');
  const current = seasons.find(s => s.id === defaultSeason);
  return `
      <form class="seasons" id="seasons">
        <fieldset>
          <legend class="q">${esc(f.legend)}</legend>
          <p class="sub">${esc(f.sub)}</p>
          <div class="chips" id="seasonChips">
${chips}
          </div>
        </fieldset>
        <hr>
        <fieldset>
          <legend class="q">${esc(f.family_legend)}</legend>
          <div class="chips">
            <label class="chip"><input type="checkbox" id="familyLens"><span>${esc(f.family_label)}</span></label>
          </div>
        </fieldset>
        <p class="hint" id="seasonHint">${esc(current ? current.hint : '')}</p>
        <noscript><p class="noscript">${esc(f.noscript.replace('{season}', current ? current.label.toLowerCase() : ''))}</p></noscript>
      </form>
`;
}

function mechanism(site) {
  const regs = site.mechanism.registers.map(r => `          <div class="reg">
            <div class="eyebrow">${esc(r.eyebrow)}</div>
            <p>${esc(r.text)}</p>
          </div>`).join('\n');
  return `      <section class="mech">
        <h2>${esc(site.mechanism.title)}</h2>
        <p>${esc(site.mechanism.intro)}</p>
        <div class="regs">
${regs}
        </div>
      </section>`;
}

/**
 * `visible` decides the initial state of a step: on the People door that is the
 * default season with the household lens off, everywhere else it is everything.
 */
function initiallyVisible(door, a, defaultSeason) {
  if (!door.seasons) return true;
  if (a.family) return false;
  if (!a.seasons.length) return true;
  return a.seasons.includes(defaultSeason);
}

export function doorPanel({ door, shocks, actions, sectors, seasons, site, vocab, referrals, defaultSeason, totalShocks, ids, hidden, ctx }) {
  const cards = shocks.map(s => shockCard(s, door.register, vocab, site.labels, ctx)).join('\n');

  const rows = actions.map(a => {
    const row = actionRow(a, referrals);
    return initiallyVisible(door, a, defaultSeason)
      ? row
      : row.replace('<div class="action"', '<div class="action" hidden');
  }).join('\n');

  const shownSteps = actions.filter(a => initiallyVisible(door, a, defaultSeason)).length;
  const stepLabel = (shownSteps === 1 ? site.labels.step_one : site.labels.step_many)
    .replace('{shown}', shownSteps);
  const recordLabel = site.labels.records_shown
    .replace('{shown}', shocks.length).replace('{total}', totalShocks);

  // In the offline file the doors are real tabs over panels in one document, so
  // the panels say what they are and which tab names them.
  const tabAttrs = ids ? '' :
    ` id="panel-${escAttr(door.id)}" role="tabpanel" aria-labelledby="tab-${escAttr(door.id)}" tabindex="0"`;

  return `    <section class="doorpanel" data-door="${escAttr(door.id)}"${tabAttrs}${hidden ? ' hidden' : ''}>
      <div class="lede">
        <h2>${esc(door.title)}</h2>
        <p>${esc(door.lede)}</p>
      </div>
${filters(door, sectors, site, ids)}${seasonControl(door, seasons, site, defaultSeason)}
      <div class="section-head">
        <h2>${esc(site.sections.shocks)}</h2>
        <span class="count shock-count"${id(ids, 'shockCount')} data-template="${escAttr(site.labels.records_shown.replace('{total}', totalShocks))}">${esc(recordLabel)}</span>
      </div>
      <div class="cards"${id(ids, 'cards')}>
${cards}
      </div>

      <div class="section-head">
        <h2>${esc(site.sections.actions)}</h2>
        <span class="count action-count"${id(ids, 'actionCount')} data-one="${escAttr(site.labels.step_one)}" data-many="${escAttr(site.labels.step_many)}">${esc(stepLabel)}</span>
      </div>
      <div class="actions"${id(ids, 'actions')}>
${rows}
      </div>

${mechanism(site)}
    </section>`;
}
