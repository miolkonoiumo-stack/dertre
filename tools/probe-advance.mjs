import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');

for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const g = window.__game;
    const game = g?.session?.game;
    return {
      ui: g?.ui?.current,
      phase: game?.phase,
      round: game?.round,
      now: game?.now,
      roundEndsAt: game?.roundEndsAt,
      alive: game?.aliveCount?.(),
      allSafe: g?.arena?.allSafe,
      myAlive: g?.myAlive,
      matchOver: g?.matchOver,
    };
  });
  console.log(i + 's', JSON.stringify(s));
}
await browser.close();
