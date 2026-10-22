// Reproduce el TypeError y captura el stack completo.
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 70; i++) {
  if (await page.evaluate(() => !document.getElementById('boot'))) break;
  await sleep(300);
}
await sleep(400);

await page.evaluate(() => window.__game.startSolo());
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => {
    const g = window.__game.session?.game;
    return g ? { phase: g.phase, round: g.round } : null;
  });
  if (st?.phase === 'play' && st.round >= 1) break;
  await sleep(400);
}

const base = errors.length;
console.log('errores antes de morir:', base);

await page.evaluate(() => window.__game._eliminate(window.__game._myId(), true));
await sleep(700);
console.log('=== tras morir ===');
console.log(errors.slice(base).join('\n---\n') || 'ninguno');

const base2 = errors.length;
await page.click('#btn-spectate');
await sleep(500);
console.log('=== tras SEGUIR MIRANDO ===');
console.log(errors.slice(base2).join('\n---\n') || 'ninguno');

await browser.close();
