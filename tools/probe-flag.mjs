import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');
await page.waitForTimeout(1200);

const s = await page.evaluate(() => {
  const g = window.__game;
  const st = g.session.state;
  return {
    phase: st.phase,
    round: st.round,
    keys: Object.keys(st).slice(0, 30),
    hasRound1Flag: 'round1AllSafe' in st,
    flagValue: st.round1AllSafe,
    gameFlag: g.session.game.round1AllSafe,
    arenaAllSafe: g.arena.allSafe,
  };
});
console.log(JSON.stringify(s, null, 2));
await browser.close();
