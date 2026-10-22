import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + (e.stack || e.message).split('\n').slice(0, 5).join(' | ')));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

// Sample the UI state over time to catch a later transition/failure.
const frames = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(700);
  frames.push(await page.evaluate(() => ({
    t: Math.round(performance.now()),
    current: window.__game?.ui?.current ?? 'no-game',
    loader: document.getElementById('loader')?.className ?? 'x',
    menu: document.getElementById('menu')?.className ?? 'x',
  })));
}

console.log('t(ms)  ui.current   loader            menu');
for (const f of frames) console.log(String(f.t).padEnd(6), String(f.current).padEnd(12), String(f.loader).padEnd(18), f.menu);

console.log('\n--- LOGS ---');
console.log(logs.slice(-20).join('\n'));
await browser.close();
