/**
 * Browser smoke test using Puppeteer-free approach: we use Playwright if present,
 * otherwise report clearly that no headless browser is available.
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';

const main = async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const logs = [];
  const errors = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'missing';
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || el.hidden ? 'hidden' : 'visible';
    };
    const loader = document.getElementById('loader');
    return {
      screens: {
        loader: vis('#loader'),
        menu: vis('#screen-menu'),
        rooms: vis('#screen-rooms'),
        lobby: vis('#screen-lobby'),
        hud: vis('#hud'),
      },
      loaderText: loader ? loader.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : null,
      hasGame: !!window.__game,
      gameRunning: window.__game?.running ?? null,
      uiCurrent: window.__game?.ui?.current ?? null,
      netConnected: window.__game?.net?.connected ?? null,
      canvasSize: (() => {
        const c = document.getElementById('scene');
        return c ? [c.width, c.height] : null;
      })(),
    };
  });

  console.log('=== STATE ===');
  console.log(JSON.stringify(state, null, 2));
  console.log('\n=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('\n=== CONSOLE (last 25) ===');
  console.log(logs.slice(-25).join('\n') || '(none)');

  await page.screenshot({ path: 'tools/shot-loading.png' });
  await browser.close();

  const stuck = state.screens.loader === 'visible' && state.uiCurrent === 'loader';
  process.exit(stuck || errors.length ? 1 : 0);
};

main().catch((e) => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
