/**
 * The watcher's HTTP client.
 *
 * Everything in here exists to make this a polite reader of government
 * infrastructure and an honest reporter of its own failures. Two ideas carry
 * most of the weight:
 *
 *   - A request that could not be made is not the same as a page that did not
 *     change. Every function here returns which of the two happened, and the
 *     caller is never able to confuse them by accident, because there is no
 *     single "body or null" return to misread.
 *   - The fetch implementation is injected. The test suite passes a function
 *     that reads fixtures off disk, so no check in this project ever depends
 *     on a government site being up, or on this machine having a network.
 */

/** Named so a server operator can find out who we are and write to a person. */
export const USER_AGENT =
  'PlainTradeDeskWatcher/1.0 (+https://github.com/plaintradedesk/plaintradedesk.github.io; dasoftworks@gmail.com)';

/**
 * One result shape for every attempt, so that "unread" can never be silently
 * spelled the same way as "unchanged".
 *
 *   { kind: 'ok',        status, body, etag, lastModified }
 *   { kind: 'unchanged', status: 304 }              server said 304
 *   { kind: 'unread',    status, reason }           blocked, failed, or refused
 */
const ok = (status, body, etag, lastModified) =>
  ({ kind: 'ok', status, body, etag, lastModified });
const unchanged = () => ({ kind: 'unchanged', status: 304 });
const unread = (status, reason) => ({ kind: 'unread', status, reason });

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */

/**
 * Enough of the robots.txt grammar to obey it: the group for our own token if
 * one exists, otherwise the group for `*`, with longest-match Allow winning
 * over Disallow the way the de-facto standard says it should.
 *
 * A robots.txt that cannot be read is treated as permissive. That is the
 * conventional reading, and the alternative would mean one flaky request
 * silently switching the whole watcher off.
 */
export function parseRobots(text, token = 'plaintradeskwatcher') {
  const groups = new Map();
  let current = [];
  let lastWasAgent = false;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();

    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      if (!lastWasAgent) current = [];
      if (!groups.has(agent)) groups.set(agent, current);
      else current = groups.get(agent);
      groups.set(agent, current);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === 'allow' || field === 'disallow') current.push({ field, value });
  }

  const rules = groups.get(token.toLowerCase()) || groups.get('*') || [];
  return rules;
}

/** True when `rules` permit fetching `pathname`. */
export function robotsAllow(rules, pathname) {
  let best = null;
  for (const rule of rules) {
    // An empty Disallow means "nothing is disallowed" and carries no path.
    if (rule.value === '') continue;
    if (!pathname.startsWith(rule.value)) continue;
    if (!best || rule.value.length > best.value.length
        // Allow wins a tie, per the standard.
        || (rule.value.length === best.value.length && rule.field === 'allow')) {
      best = rule;
    }
  }
  return !best || best.field === 'allow';
}

/* ------------------------------------------------------------------ */

/**
 * A serial, conditional, robots-respecting client.
 *
 * Serial rather than parallel on purpose. Thirteen URLs twice a day is nothing
 * and it should stay nothing; a burst of parallel requests from a CI runner is
 * how a polite reader turns into something an operator blocks.
 */
export class Client {
  /**
   * @param {object} opts
   * @param {Function} opts.fetchImpl  fetch-compatible; injected in tests
   * @param {number}   opts.delayMs    pause between requests, 0 in tests
   * @param {Function} opts.sleep      injectable for tests
   * @param {boolean}  opts.checkRobots
   */
  constructor({ fetchImpl = globalThis.fetch, delayMs = 1000, sleep = null,
                checkRobots = true, timeoutMs = 20000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.delayMs = delayMs;
    this.checkRobots = checkRobots;
    this.timeoutMs = timeoutMs;
    this.sleep = sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.robots = new Map();   // origin -> rules array
    this.first = true;
  }

  async pace() {
    if (this.first) { this.first = false; return; }
    if (this.delayMs > 0) await this.sleep(this.delayMs);
  }

  async allowed(url) {
    if (!this.checkRobots) return true;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (!this.robots.has(u.origin)) {
      let rules = [];
      try {
        const r = await this.fetchImpl(u.origin + '/robots.txt', {
          headers: { 'user-agent': USER_AGENT }
        });
        // Anything other than a readable 2xx is treated as no rules at all.
        if (r && r.status >= 200 && r.status < 300) rules = parseRobots(await r.text());
      } catch { rules = []; }
      this.robots.set(u.origin, rules);
    }
    return robotsAllow(this.robots.get(u.origin), u.pathname);
  }

  /**
   * Fetch one URL. `cached` carries whatever the last run stored for it, so the
   * server gets the chance to answer 304 and send nothing.
   */
  async get(url, cached = {}) {
    if (!(await this.allowed(url))) {
      return unread(null, 'robots.txt disallows this path');
    }
    await this.pace();

    const headers = { 'user-agent': USER_AGENT, accept: '*/*' };
    if (cached.etag) headers['if-none-match'] = cached.etag;
    if (cached.lastModified) headers['if-modified-since'] = cached.lastModified;

    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), this.timeoutMs) : null;

    try {
      const r = await this.fetchImpl(url, { headers, signal: ac ? ac.signal : undefined });
      if (r.status === 304) return unchanged();
      if (r.status < 200 || r.status >= 300) {
        return unread(r.status, `HTTP ${r.status}`);
      }
      const body = await r.text();
      const h = r.headers && typeof r.headers.get === 'function' ? r.headers : null;
      return ok(r.status, body, h && h.get('etag'), h && h.get('last-modified'));
    } catch (e) {
      // A timeout, a DNS failure, a reset connection. All of them are "we do
      // not know what this page says", which is the thing that has to be said
      // out loud rather than rolled into silence.
      return unread(null, e && e.name === 'AbortError'
        ? `no response within ${Math.round(this.timeoutMs / 1000)}s`
        : `request failed: ${(e && e.message) || e}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
