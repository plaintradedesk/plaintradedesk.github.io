#!/usr/bin/env node
/**
 * A small static server for dist/, so the built site can be read the way a
 * reader reads it rather than through file:// URLs.
 *
 *   npm run serve            http://localhost:8000
 *   npm run serve -- 8080    somewhere else
 *
 * It behaves the way GitHub Pages behaves in the two ways that matter: a
 * directory serves index.html, and an address that does not exist serves
 * 404.html with a 404 status. That is what makes it worth running the live
 * check against this before trusting it against the real thing.
 *
 * Node built-ins only, like everything else in the build.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

if (!existsSync(DIST)) {
  console.error('\nThere is no dist/. Run "npm run build" first.\n');
  process.exit(1);
}

createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
  const inside = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();

  if (!inside) {
    const nf = path.join(DIST, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end(existsSync(nf) ? readFileSync(nf) : 'Not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => {
  console.log(`Serving dist/ at http://localhost:${port}`);
  console.log(`Check it the way a reader gets it: npm run verify:live -- http://localhost:${port}`);
});
