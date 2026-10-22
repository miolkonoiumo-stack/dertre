import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');
await page.waitForFunction(() => window.__game?.session?.game?.phase === 'play', { timeout: 30000 });

const sample = () => page.evaluate(() => {
  const a = window.__game.arena;
  const c = a.tiles.instanceColor.array;
  const safe = [];
  const lava = [];
  for (let i = 0; i < a.safeMask.length; i++) {
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2];
    const px = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    (a.safeMask[i] ? safe : lava).push(px);
  }
  return { safe: safe[0] || null, lava: lava[0] || null, safeN: safe.length };
});

console.log('--- during PLAY (no warning) ---');
console.log(JSON.stringify(await sample()));

// Progress to the warning window.
await page.waitForFunction(() => window.__game.arena.pendingStrength > 0.5, { timeout: 30000 });
await page.waitForTimeout(300);
const w = await sample();
const preview = await page.evaluate(() => {
  const a = window.__game.arena;
  const c = a.tiles.instanceColor.array;
  const p = a.pendingMask;
  const out = { aboutToBeSafe: null, aboutToBurn: null };
  for (let i = 0; i < a.safeMask.length; i++) {
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2];
    const px = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    if (p && p[i] && !a.safeMask[i] && !out.aboutToBeSafe) out.aboutToBeSafe = px;
    if (p && !p[i] && a.safeMask[i] && !out.aboutToBurn) out.aboutToBurn = px;
  }
  return out;
});
console.log('--- during WARNING (preview active) ---');
console.log('safe now :', w.safe);
console.log('lava now :', w.lava);
console.log('preview  :', JSON.stringify(preview));

await browser.close();
