import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.stack?.split('\n').slice(0, 4).join(' | ')));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

const probe = await page.evaluate(() => {
  const g = window.__game;
  const ui = g?.ui;
  const classes = {};
  for (const id of ['loader', 'menu', 'rooms', 'lobby', 'settings', 'howto', 'results', 'pause']) {
    const el = document.getElementById(id);
    classes[id] = el ? el.className : 'MISSING';
  }
  let showErr = null;
  try { ui.show('menu'); } catch (e) { showErr = e.message + ' @ ' + (e.stack || '').split('\n')[1]; }
  const menuAfter = document.getElementById('menu')?.className;
  return {
    uiCurrent: ui?.current ?? null,
    screensKnown: ui?.screens ?? null,
    classesBefore: classes,
    manualShowError: showErr,
    classesAfterShowMenu: { menu: menuAfter, loader: document.getElementById('loader')?.className },
    matchesCount: document.querySelectorAll('#menu').length,
  };
});

console.log(JSON.stringify(probe, null, 2));
console.log('\n--- LOGS ---');
console.log(logs.slice(-30).join('\n'));
await page.screenshot({ path: 'tools/shot-probe.png', fullPage: false });
await browser.close();
