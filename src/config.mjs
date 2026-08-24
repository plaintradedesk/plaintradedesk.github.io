/**
 * Where this site lives.
 *
 * A page on disk does not need to know its own address. A published page does:
 * the canonical link, the sitemap, the links on the 404 page and the CNAME file
 * all need the same absolute base, and the whole point of keeping it in one
 * place is that they cannot disagree with each other.
 *
 * Resolution order, most deliberate first:
 *
 *   1. site.baseUrl in site.config.json. Set this when a domain is registered.
 *   2. PTD_BASE_URL. The deploy workflow sets it to the GitHub Pages address,
 *      so the site publishes correctly before anybody has bought a domain.
 *   3. https://localhost. A local build is not a published site and says so.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const LOCAL_FALLBACK = 'https://localhost';

/** No trailing slash, ever, so that base + "/" + name has exactly one slash. */
const trim = u => String(u).trim().replace(/\/+$/, '');

export function loadConfig(root) {
  const file = path.join(root, 'site.config.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read site.config.json: ${e.message}`);
  }
  const configured = trim((raw.site && raw.site.baseUrl) || '');
  const fromEnv = trim(process.env.PTD_BASE_URL || '');
  const baseUrl = configured || fromEnv || LOCAL_FALLBACK;
  const source = configured ? 'site.config.json' : fromEnv ? 'PTD_BASE_URL' : 'default';

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`site.baseUrl is not a URL: "${baseUrl}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`site.baseUrl must be http or https, got "${baseUrl}"`);
  }

  return {
    baseUrl,
    source,
    host: url.hostname,
    published: baseUrl !== LOCAL_FALLBACK,
    /* A github.io address is given to us and is already correct. Any other host
       is a domain somebody registered, and GitHub Pages only answers on it if
       the published site carries a CNAME file naming it. */
    cname: /\.github\.io$/.test(url.hostname) || url.hostname === 'localhost'
      ? null : url.hostname
  };
}

/** The absolute address of one built page. */
export const pageUrl = (baseUrl, name) => `${baseUrl}/${name}`;
