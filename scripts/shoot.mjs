// Photograph a page of the app: node scripts/shoot.mjs <page> <out.png> [--width 1280] [--height 800] [--scale 1]
// [--full] [--eval "<js>"] [--wait <ms>]. Starts its own Vite dev server and headless Chromium.

import { createServer } from 'vite';
import { chromium } from 'playwright';

const opts = { width: 1280, height: 800, scale: 1, full: false, eval: '', wait: 0 };
const positional = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) positional.push(arg);
  else if (arg === '--full') opts.full = true;
  else {
    const key = arg.slice(2);
    if (!(key in opts) || i + 1 >= argv.length) throw new Error(`unknown or incomplete option ${arg}`);
    opts[key] = typeof opts[key] === 'number' ? Number(argv[++i]) : argv[++i];
  }
}
const [target, out] = positional;
if (!target || !out) {
  console.error('usage: node scripts/shoot.mjs <page> <out.png> [--width n] [--height n] [--scale n] [--full] [--eval js] [--wait ms]');
  process.exit(2);
}

const server = await createServer({ logLevel: 'error', clearScreen: false, server: { port: 0, host: '127.0.0.1' } });
await server.listen();
// Playwright hides scrollbars in headless mode; the retro scrollbars are part of the look.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
try {
  const { port } = server.httpServer.address();
  const page = await browser.newPage({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.scale,
  });
  page.on('pageerror', (err) => console.error('page error:', err.message));
  page.on('console', (msg) => msg.type() === 'error' && console.error('console:', msg.text()));
  await page.goto(`http://127.0.0.1:${port}/${target.replace(/^\//, '')}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (opts.eval) await page.evaluate(opts.eval);
  await page.waitForTimeout(opts.wait || 100);
  await page.screenshot({ path: out, fullPage: opts.full });
  console.log(out);
} finally {
  await browser.close();
  await server.close();
}
