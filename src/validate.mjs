/**
 * The gates.
 *
 * This file is the reason the repository exists. An earlier build of this site
 * was truncated mid-function inside an unterminated string literal. The browser
 * consumed the rest of the file as string content, raised nothing, and rendered
 * a page that looked completely normal while every event listener and the
 * initialisation call were silently absent. It was shipped, and nobody could
 * tell by looking.
 *
 * So a build either produces a correct site or it fails loudly. Every gate
 * reports the record it is complaining about and what is wrong with it, and all
 * failures are collected in one pass rather than stopping at the first.
 *
 * Gates 1 to 6 and 9 read the data and run before anything is rendered.
 * Gates 7, 8, 10 and 11 read the rendered HTML and run before anything is
 * written. Gates 8 and 12 then load every page in a real browser, which is the
 * only way to find the two classes of fault that reading the source cannot.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isDate, dayDiff, fmtDate } from './util.mjs';

/* Anything with a legal existence uses the first vocabulary; anything without
   one uses the second. They must never mix in a list and must not share a
   visual treatment, which is enforced here and in the stylesheet. */
export const EVIDENCE_CLASSES = ['instrument', 'trend'];
export const REGISTERS = ['plain', 'operator', 'policy'];
export const REFERRALS = ['financial_advisor', 'employment_standards', 'broker', 'lawyer'];

/** Language a step carrying a financial referral must not be using. */
const DIRECTIVE = [
  /\byou should\b/i, /\bwe recommend\b/i, /\bthe best\b/i,
  /\bbuy\b/i, /\bsell\b/i, /\bmove your\b/i
];

class Report {
  constructor() { this.failures = []; this.warnings = []; }
  fail(gate, id, message) { this.failures.push({ gate, id, message }); }
  warn(gate, id, message) { this.warnings.push({ gate, id, message }); }
  get ok() { return this.failures.length === 0; }
}

const isText = v => typeof v === 'string' && v.trim().length > 0;

/* ================================================================
   Gates 1 to 6 and 9: the data
================================================================ */

export function validateData(data, ctx) {
  const r = new Report();
  const { shocks, actions, doors, seasons, pages, corrections, sectors, statuses, referrals } = data;

  const doorIds = new Set(doors.map(d => d.id));
  const sectorKeys = new Set(Object.keys(sectors));
  const seasonIds = new Set(seasons.map(s => s.id));
  const shockIds = new Set();

  /* ---------- shocks ---------- */
  for (const [i, s] of shocks.entries()) {
    const id = s.id || `shocks[${i}]`;

    if (!isText(s.id)) r.fail('schema', id, 'has no id, and an id has to be stable to be worth anything');
    else if (shockIds.has(s.id)) r.fail('schema', id, 'duplicate shock id');
    else shockIds.add(s.id);

    if (!isText(s.title)) r.fail('schema', id, 'has no title');

    if (!EVIDENCE_CLASSES.includes(s.evidence_class)) {
      r.fail('schema', id, `evidence_class "${s.evidence_class}" is not one of ${EVIDENCE_CLASSES.join(', ')}`);
    } else {
      // Gate 5. Vocabulary mismatch.
      const allowed = Object.keys(statuses[s.evidence_class]);
      if (!allowed.includes(s.status)) {
        r.fail(5, id, `status "${s.status}" is not valid for evidence_class "${s.evidence_class}". ` +
          `Valid: ${allowed.join(', ')}. A forecast that renders like an in-force instrument ` +
          `borrows authority it does not have.`);
      }
    }

    // Gate 3. Missing register.
    for (const reg of REGISTERS) {
      if (!isText(s[reg])) r.fail(3, id, `the ${reg} register is missing or empty`);
    }

    // Gate 1. Unsourced record.
    if (!Array.isArray(s.sources) || s.sources.length === 0) {
      r.fail(1, id, 'has no sources. A record with nothing behind it does not go on the site.');
    } else {
      for (const src of s.sources) {
        if (!isText(src.label) || !isText(src.url)) r.fail(1, id, 'a source is missing its label or its url');
        else if (!/^https?:\/\//.test(src.url)) r.fail(1, id, `source url is not a link: "${src.url}"`);
      }
    }

    // Gate 2. Stale record.
    if (!isDate(s.verified)) {
      r.fail(2, id, `verified must be a YYYY-MM-DD date, got "${s.verified}"`);
    } else {
      const age = dayDiff(s.verified, ctx.today);
      if (age < 0) {
        r.fail(2, id, `verified date ${fmtDate(s.verified)} is in the future`);
      } else if (age > ctx.staleFail && !ctx.archived) {
        // An archived build is allowed to be stale. That is what archived means,
        // it says so on every page, and refusing here would leave the promise to
        // archive the site in place unkeepable the moment the data aged out.
        r.fail(2, id, `last checked ${fmtDate(s.verified)}, ${age} days ago. The limit is ${ctx.staleFail}. ` +
          `The fix is to check the record against its sources, not to raise the threshold.`);
      }
    }

    if (!Array.isArray(s.doors) || s.doors.length === 0) r.fail('schema', id, 'appears on no door');
    else for (const d of s.doors) if (!doorIds.has(d)) r.fail('schema', id, `unknown door "${d}"`);

    for (const k of s.sectors || []) if (!sectorKeys.has(k)) r.fail('schema', id, `unknown sector "${k}"`);

    for (const f of s.facts || []) {
      if (!isText(f.label) || !isText(f.value)) r.fail('schema', id, 'a fact is missing its label or its value');
    }
  }

  /* ---------- actions ---------- */
  const actionIds = new Set();
  for (const [i, a] of actions.entries()) {
    const id = a.id || `actions[${i}]`;

    if (!isText(a.id)) r.fail('schema', id, 'has no id');
    else if (actionIds.has(a.id)) r.fail('schema', id, 'duplicate action id');
    else actionIds.add(a.id);

    if (!isText(a.text)) r.fail('schema', id, 'has no text');
    if (!isText(a.by)) r.fail('schema', id, 'has no by phrase');

    // Gate 4. Orphaned action.
    if (!Array.isArray(a.doors) || a.doors.length === 0) {
      r.fail(4, id, 'is on no door, so nobody would ever see it');
    } else {
      for (const d of a.doors) if (!doorIds.has(d)) r.fail(4, id, `unknown door "${d}"`);
    }
    // An action tied to no shock is advice standing free of any evidence, which
    // is the specific thing this site exists not to publish. The brief only
    // required a valid door and valid shock ids; this is the stricter rule from
    // DATA-MODEL.md, adopted deliberately on review.
    if (!Array.isArray(a.shocks) || a.shocks.length === 0) {
      r.fail(4, id, 'responds to no shock, so it is advice with no evidence behind it');
    }
    for (const sid of a.shocks || []) {
      if (!shockIds.has(sid)) r.fail(4, id, `refers to shock "${sid}", which does not exist`);
    }

    for (const k of a.sectors || []) if (!sectorKeys.has(k)) r.fail('schema', id, `unknown sector "${k}"`);
    for (const s of a.seasons || []) if (!seasonIds.has(s)) r.fail('schema', id, `unknown season "${s}"`);

    if (a.refer !== null && a.refer !== undefined) {
      if (!REFERRALS.includes(a.refer)) r.fail('schema', id, `refer "${a.refer}" is not one of ${REFERRALS.join(', ')}`);
      else if (!isText(referrals[a.refer])) r.fail('schema', id, `no label on file for referral "${a.refer}"`);
    }

    // Gate 9. Referral discipline. A warning, because judgement is required and
    // a false positive must not block a build.
    if (a.refer === 'financial_advisor') {
      for (const field of ['text', 'note']) {
        const line = a[field] || '';
        for (const rx of DIRECTIVE) {
          const m = line.match(rx);
          if (m) r.warn(9, id, `carries a financial referral and uses directive language ("${m[0]}") in ${field}:\n           ${line}`);
        }
      }
    }
  }

  /* ---------- Gate 6. Season distinctness ---------- */
  // A selector whose options produce near-identical output reads as fake
  // personalisation and costs more trust than having no selector at all.
  const peopleDoors = doors.filter(d => d.seasons).map(d => d.id);
  for (const door of peopleDoors) {
    const setFor = season => new Set(actions
      .filter(a => a.doors.includes(door) && !a.family &&
        (!a.seasons.length || a.seasons.includes(season)))
      .map(a => a.id));
    const sets = seasons.map(s => [s.id, setFor(s.id)]);
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const [aId, A] = sets[i], [bId, B] = sets[j];
        let diff = 0;
        for (const x of A) if (!B.has(x)) diff++;
        for (const x of B) if (!A.has(x)) diff++;
        if (diff < 2) {
          r.fail(6, `${aId}/${bId}`, `these two seasons differ by ${diff} action${diff === 1 ? '' : 's'} ` +
            `on the ${door} door. Two is the minimum. Merge them deliberately rather than shipping both.`);
        }
      }
    }
    for (const [sid, set] of sets) {
      if (set.size === 0) r.fail(6, sid, `produces no steps at all on the ${door} door`);
    }
  }

  /* ---------- supporting files ---------- */
  for (const d of doors) {
    if (!REGISTERS.includes(d.register)) r.fail('schema', d.id, `register "${d.register}" is not one of ${REGISTERS.join(', ')}`);
    if (!isText(d.title) || !isText(d.lede)) r.fail('schema', d.id, 'door is missing its title or its lede');
  }
  for (const key of ['about', 'promise', 'corrections']) {
    if (!pages[key]) r.fail('schema', key, 'standing page is missing from pages.json');
    else if (!isText(pages[key].path)) r.fail('schema', key, 'standing page has no stable path');
  }
  for (const [i, c] of corrections.entries()) {
    if (!isText(c.date) || !isText(c.what)) r.fail('schema', `corrections[${i}]`, 'an entry is missing its date or its text');
  }

  return r;
}

/* ================================================================
   Gate 7: external reference
================================================================ */

/* The regression guard for the webfont defect in the changelog. The site
   promises readers that reading it discloses nothing about them to anybody, and
   a font request from Google discloses their address and user agent. A
   regression here silently makes the commitment page false, so this gate is the
   most important one and it does not get weakened.

   Source links in sources[] are <a href> and are the only permitted external
   URLs on the whole site. */

const FETCHING_ATTRS = ['src', 'srcset', 'poster', 'data', 'action', 'formaction', 'background'];

/* An href fetches on everything except <a>, and except one <link>. A canonical
   link declares an address; it causes no request, and a page that must carry
   its own published address cannot also be forbidden from naming it. This is
   not a hole: gate 11 requires every canonical to be under the configured
   site.baseUrl, so it cannot be turned into a way to name another host. Every
   other rel, stylesheet and icon and preload and manifest among them, still
   fetches and is still checked. */
const isCanonicalLink = (el, attrs) =>
  el === 'link' && /\brel\s*=\s*"canonical"/i.test(attrs);

/** Local means a relative path, a fragment, or a data: URI. Everything else is a host. */
function isExternal(url) {
  const u = url.trim();
  if (!u || u.startsWith('#')) return false;
  if (/^(?:data|mailto):/i.test(u)) return false;
  if (u.startsWith('//')) return true;                    // protocol-relative
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u);             // http:, https:, ws:, anything
}

export function checkExternalReferences(files) {
  const r = new Report();

  for (const [name, html] of Object.entries(files)) {
    const tag = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    let m;
    while ((m = tag.exec(html))) {
      const el = m[1].toLowerCase();
      const attrs = m[2];
      const at = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = at.exec(attrs))) {
        const key = a[1].toLowerCase();
        const value = a[2];
        const fetching = FETCHING_ATTRS.includes(key) ||
          (key === 'href' && el !== 'a' && !isCanonicalLink(el, attrs));
        if (!fetching) continue;
        for (const url of value.split(',')) {
          const bare = url.trim().split(/\s+/)[0];
          if (isExternal(bare)) {
            r.fail(7, name, `<${el} ${key}> points at ${bare}. Nothing on a page may be fetched from another host.`);
          }
        }
      }
    }

    for (const block of html.match(/<style\b[^>]*>[^]*?<\/style>/gi) || []) {
      for (const im of block.match(/@import[^;]+;/gi) || []) {
        r.fail(7, name, `stylesheet uses ${im.trim()}`);
      }
      for (const u of block.match(/url\(\s*['"]?([^'")]+)/gi) || []) {
        const target = u.replace(/^url\(\s*['"]?/i, '');
        if (isExternal(target)) r.fail(7, name, `stylesheet fetches ${target}`);
      }
    }

    for (const block of html.match(/<script\b[^>]*>[^]*?<\/script>/gi) || []) {
      for (const [rx, what] of [[/\bfetch\s*\(/, 'fetch()'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
        [/\bnew\s+WebSocket\b/, 'WebSocket'], [/\bsendBeacon\b/, 'navigator.sendBeacon'],
        [/\bimportScripts\b/, 'importScripts'], [/\bEventSource\b/, 'EventSource']]) {
        if (rx.test(block)) r.fail(7, name, `script uses ${what}. The pages request nothing at runtime.`);
      }
    }
  }
  return r;
}

/* ================================================================
   Gate 8: truncation
================================================================ */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * The direct guard against the failure this repository exists to prevent. The
 * script bodies are compiled, so an unterminated string literal is a build
 * failure rather than a page that renders normally and does nothing.
 */
export function checkStructure(files) {
  const r = new Report();

  for (const [name, html] of Object.entries(files)) {
    if (!html.startsWith('<!doctype html>')) r.fail(8, name, 'does not start with a doctype');
    if (!html.trimEnd().endsWith('</body>\n</html>')) {
      r.fail(8, name, 'does not end with the expected closing tags, which is what truncation looks like');
    }

    for (const [rx, what] of [[/<script\b[^>]*>([^]*?)<\/script>/g, 'script'],
      [/<style\b[^>]*>([^]*?)<\/style>/g, 'style']]) {
      let m;
      while ((m = rx.exec(html))) {
        const body = m[1];
        if (what === 'script') {
          try { new vm.Script(body); }
          catch (e) { r.fail(8, name, `inline script does not parse: ${e.message}`); }
        } else {
          let depth = 0;
          for (const ch of body) { if (ch === '{') depth++; else if (ch === '}') depth--; }
          if (depth !== 0) r.fail(8, name, `inline stylesheet has ${depth > 0 ? 'unclosed' : 'unopened'} braces`);
        }
      }
    }

    // Tag balance, with script and style content skipped so their contents are
    // not read as markup.
    const stripped = html
      .replace(/<script\b[^>]*>[^]*?<\/script>/gi, '<script></script>')
      .replace(/<style\b[^>]*>[^]*?<\/style>/gi, '<style></style>')
      .replace(/<!--[^]*?-->/g, '')
      .replace(/<!doctype[^>]*>/gi, '');

    const stack = [];
    const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g;
    let t, broken = false;
    while ((t = tag.exec(stripped)) && !broken) {
      const [, closing, rawName, , selfClose] = t;
      const el = rawName.toLowerCase();
      if (VOID.has(el) || selfClose === '/') continue;
      if (!closing) { stack.push(el); continue; }
      if (!stack.length) { r.fail(8, name, `closing </${el}> with nothing open`); broken = true; }
      else if (stack[stack.length - 1] !== el) {
        r.fail(8, name, `</${el}> closes while <${stack[stack.length - 1]}> is still open`);
        broken = true;
      } else stack.pop();
    }
    if (!broken && stack.length) {
      r.fail(8, name, `${stack.length} unclosed element${stack.length === 1 ? '' : 's'}: <${stack.join('>, <')}>`);
    }
  }
  return r;
}

/* ================================================================
   Gate 12: accessibility
================================================================ */

/* WCAG 2.1 AA was required from the start and, until this gate, never
   mechanically enforced, which meant it was a hope. It is checked with axe-core
   in the browser that is already loading every page for gate 8.

   This is not box-ticking. These pages are meant to reach people under stress,
   reading on a phone, some of them older, some of them not reading English as a
   first language. Conformance is also a precondition if a provincial or federal
   body ever adopts this. It is cheap now and expensive to retrofit.

   axe-core is a dev dependency. It runs against the built page and is never
   part of it. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const AXE_FAIL_ON = new Set(['serious', 'critical']);

function loadAxe(r) {
  try {
    const require = createRequire(import.meta.url);
    return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    r.fail(12, 'build', 'axe-core is not installed, so the accessibility gate could not run. ' +
      'Run "npm install", or pass --no-browser if you accept building without gates 8 and 12.');
    return null;
  }
}

/**
 * The other half of gate 8, and the whole of gate 12: the pages have to load in
 * a real browser with no page errors, no console errors and no network
 * requests, and then survive an axe-core audit. A headless load belongs in the
 * build rather than only in the test suite, because this is the exact class of
 * fault that reading the source cannot find.
 */
export async function checkInBrowser(dir, names) {
  const r = new Report();
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    r.fail(8, 'build', 'playwright is not installed, so the headless load could not run. ' +
      'Run "npm install" and "npx playwright install chromium", or pass --no-browser ' +
      'if you accept building without this gate.');
    return r;
  }
  const axeSource = loadAxe(r);
  if (!axeSource) return r;

  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  );
  try {
    for (const name of names) {
      const page = await browser.newPage();
      const problems = [];
      page.on('pageerror', e => problems.push('page error: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
      page.on('request', req => {
        if (!req.url().startsWith('file:')) problems.push('network request: ' + req.url());
      });
      await page.goto('file://' + dir.replace(/\\/g, '/') + '/' + name);
      await page.waitForLoadState('load');
      // Give any deferred work a moment to throw before we call the page clean.
      await page.waitForTimeout(150);
      const empty = await page.evaluate(() => document.body.textContent.trim().length < 200);
      if (empty) problems.push('the body is effectively empty');
      for (const p of problems) r.fail(8, name, p);

      // Gate 12, on the same load. Injected as source rather than fetched, so
      // the page still makes no request of any kind.
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async tags => {
        const out = await window.axe.run(document, {
          runOnly: { type: 'tag', values: tags },
          resultTypes: ['violations']
        });
        return out.violations.map(v => ({
          id: v.id, impact: v.impact, help: v.help,
          nodes: v.nodes.slice(0, 3).map(n => n.target.join(' '))
        }));
      }, AXE_TAGS);
      for (const v of violations) {
        if (!AXE_FAIL_ON.has(v.impact)) continue;
        r.fail(12, name, `${v.impact}: ${v.help} (${v.id})\n           at ${v.nodes.join(', ')}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return r;
}

/* ================================================================
   Gate 10: broken internal link
================================================================ */

/* Impossible to get wrong with one page, and easy the moment there are nine. A
   dead link on the commitment page, in front of a municipality deciding whether
   to link here, is a small disaster for a site whose entire pitch is that it
   maintains itself honestly.

   Every internal href and every asset path has to resolve to a file this build
   actually wrote, and every fragment to an id that is actually on the page it
   points at. */

const LINK_ATTRS = ['href', 'src', 'srcset', 'poster', 'data', 'action', 'formaction'];

function idsIn(html) {
  const ids = new Set();
  const rx = /\sid="([^"]+)"/g;
  let m;
  while ((m = rx.exec(html))) ids.add(m[1]);
  return ids;
}

export function checkLinks(files, assets, ctx) {
  const r = new Report();
  const written = new Set([...Object.keys(files), ...Object.keys(assets)]);
  const ids = {};
  for (const [name, html] of Object.entries(files)) ids[name] = idsIn(html);

  // The 404 page and the canonical links carry absolute addresses. They are
  // this site's own addresses, so they are checked like any other internal link
  // rather than waved through for having a scheme on the front.
  const base = ctx.baseUrl + '/';
  const internalise = url => {
    if (url === ctx.baseUrl || url === base) return 'index.html';
    if (url.startsWith(base)) return url.slice(base.length) || 'index.html';
    return null;
  };

  for (const [name, html] of Object.entries(files)) {
    const tag = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    let m;
    while ((m = tag.exec(html))) {
      const el = m[1].toLowerCase();
      const at = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = at.exec(m[2]))) {
        const key = a[1].toLowerCase();
        if (!LINK_ATTRS.includes(key)) continue;
        const values = key === 'srcset'
          ? a[2].split(',').map(v => v.trim().split(/\s+/)[0])
          : [a[2].trim()];
        for (const value of values) checkOne(r, name, el, key, value);
      }
    }
  }

  function checkOne(r, name, el, key, value) {
    const where = `<${el} ${key}>`;
    if (!value) {
      r.fail(10, name, `${where} is empty`);
      return;
    }
    if (/^(?:data|mailto|tel):/i.test(value)) return;

    let target = internalise(value);
    if (target === null) {
      // Some other host, or a protocol-relative address. Gate 7 decides whether
      // it is allowed to be there at all; it is not this gate's business.
      if (value.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return;
      target = value;
    }

    const hash = target.indexOf('#');
    const file = hash === -1 ? target : target.slice(0, hash);
    const frag = hash === -1 ? '' : target.slice(hash + 1);
    const onPage = file === '' ? name : file;

    if (file !== '' && !written.has(file)) {
      r.fail(10, name, `${where} points at "${value}", and no file called "${file}" was built`);
      return;
    }
    if (frag && ids[onPage] && !ids[onPage].has(frag)) {
      r.fail(10, name, `${where} points at "${value}", and "${onPage}" has no element with id "${frag}"`);
    }
  }

  return r;
}

/* ================================================================
   Gate 11: page metadata
================================================================ */

/* A page on disk does not need to say where it lives. A published one does.
   The commitment page says in its own text that it has a stable address, which
   is only true if the page carries that address and no other page claims it. */

export function checkPageMeta(files, ctx) {
  const r = new Report();
  const titles = new Map();

  for (const [name, html] of Object.entries(files)) {
    const head = html.slice(0, html.indexOf('</head>'));
    const grab = rx => { const m = head.match(rx); return m ? m[1].trim() : ''; };

    const title = grab(/<title>([^]*?)<\/title>/);
    const description = grab(/<meta name="description" content="([^"]*)">/);
    const canonical = grab(/<link rel="canonical" href="([^"]*)">/);

    if (!title) r.fail(11, name, 'has no title');
    else if (titles.has(title)) {
      r.fail(11, name, `has the same title as ${titles.get(title)}: "${title}". ` +
        'Two pages with one title are two pages a reader cannot tell apart in a tab, ' +
        'a bookmark or a search result.');
    } else titles.set(title, name);

    if (!description) r.fail(11, name, 'has no meta description');
    if (!canonical) {
      r.fail(11, name, 'has no canonical URL');
    } else if (!canonical.startsWith(ctx.baseUrl + '/')) {
      r.fail(11, name, `canonical URL "${canonical}" is not under the configured ` +
        `site.baseUrl "${ctx.baseUrl}"`);
    }
  }
  return r;
}

export { Report };
