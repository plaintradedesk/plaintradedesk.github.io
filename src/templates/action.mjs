/**
 * One step. The season and household tags are written into the markup as data
 * attributes so the client script can hide and unhide rows it did not create.
 *
 * The referral rule: where the honest answer needs a licensed professional, the
 * step names the question and names who answers it. A step carrying a referral
 * must not also carry a recommendation, which validate.mjs lints for.
 */
import { esc, escAttr } from '../util.mjs';

export function actionRow(a, referrals) {
  const refer = a.refer
    ? `\n          <span class="refer">${esc(referrals[a.refer])}</span>`
    : '';

  return `        <div class="action" data-id="${escAttr(a.id)}" data-sectors="${escAttr(a.sectors.join(' '))}" data-seasons="${escAttr(a.seasons.join(' '))}" data-family="${a.family ? 'true' : 'false'}">
          <div class="by${a.urgent ? ' urgent' : ''}">${esc(a.by)}</div>
          <div class="txt">
            <p>${esc(a.text)}</p>
            <small>${esc(a.note)}</small>${refer}
          </div>
        </div>`;
}
