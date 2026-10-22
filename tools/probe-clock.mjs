import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message + '\n  ' + (e.stack || '').split('\n')[1]));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');
await page.waitForTimeout(800);

for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => {
    const g = window.__game;
    const sess = g?.session;
    return {
      ui: g?.ui?.current,
      mode: g?.mode,
      running: g?.running,
      frameCount: g?.__frames ?? 'n/a',
      gameNow: sess?.game?.now ?? null,
      phase: sess?.game?.phase ?? null,
      round: sess?.game?.round ?? null,
      matchOver: g?.matchOver,
      docHidden: document.hidden,
    };
  });
  console.log(i, JSON.stringify(s));
}
await browser.close();
