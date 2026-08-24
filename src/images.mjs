/**
 * SVG to PNG, through the browser the build already opens.
 *
 * No image library, no service, no network. The SVG is set as the whole
 * document and screenshotted, which is the cheapest correct way to get a real
 * PNG out of a build that already has a headless Chromium in it.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { WIDTH, HEIGHT } from './templates/share.mjs';

export async function writeShareCards(dir, cards) {
  const names = Object.keys(cards);
  if (!names.length) return [];

  const { chromium } = await import('playwright');
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  );
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1
    });
    for (const [name, svg] of Object.entries(cards)) {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>` +
        `html,body{margin:0;padding:0;background:#F1F5F5}</style></head><body>${svg}</body></html>`,
        { waitUntil: 'load' }
      );
      const png = await page.screenshot({ type: 'png' });
      writeFileSync(path.join(dir, name), png);
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return names;
}
