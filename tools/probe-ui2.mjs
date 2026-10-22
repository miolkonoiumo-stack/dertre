import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

const probe = await page.evaluate(() => {
  const g = window.__game;
  const ui = g.ui;
  return {
    uiExists: !!ui,
    uiType: typeof ui,
    current: ui ? ui.current : 'NO-UI',
    screens: ui ? ui.screens : null,
    loaderClass: document.getElementById('loader').className,
    menuClass: document.getElementById('menu').className,
    // Does calling show('menu') work right now?
    afterManualShow: (() => { try { ui.show('menu'); return document.getElementById('menu').className; } catch (e) { return 'ERR ' + e.message; } })(),
  };
});
console.log(JSON.stringify(probe, null, 2));
await page.screenshot({ path: 'tools/shot-boot.png' });
await browser.close();
