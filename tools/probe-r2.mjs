import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');

// Round 1: all safe -> deck colours, must NOT be saturated green.
await page.waitForFunction(() => window.__game?.session?.game?.phase === 'play', { timeout: 30000 });
const r1 = await page.evaluate(() => {
  const a = window.__game.arena;
  const c = a.tiles.instanceColor.array;
  const px = (i) => `rgb(${Math.round(c[i*3]*255)},${Math.round(c[i*3+1]*255)},${Math.round(c[i*3+2]*255)})`;
  let maxv = 0;
  for (let i = 0; i < c.length; i++) maxv = Math.max(maxv, c[i]);
  return { allSafe: a.allSafe, sample: px(0), sample2: px(50), maxChannel: +maxv.toFixed(3) };
});
console.log('ROUND 1 :', JSON.stringify(r1));

// Wait for round 2 (real lava present).
await page.waitForFunction(() => (window.__game?.session?.game?.round ?? 0) >= 2, { timeout: 60000 });
const r2 = await page.evaluate(() => {
  const a = window.__game.arena;
  const c = a.tiles.instanceColor.array;
  const px = (i) => `rgb(${Math.round(c[i*3]*255)},${Math.round(c[i*3+1]*255)},${Math.round(c[i*3+2]*255)})`;
  let safe = null, lava = null, safeN = 0;
  for (let i = 0; i < a.safeMask.length; i++) {
    if (a.safeMask[i]) { safeN++; safe = safe || px(i); }
    else lava = lava || px(i);
  }
  return { allSafe: a.allSafe, safeN, safe, lava };
});
console.log('ROUND 2 :', JSON.stringify(r2));

await browser.close();
