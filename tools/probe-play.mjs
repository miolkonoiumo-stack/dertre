import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const step = async (label, fn) => {
  try { const r = await fn(); console.log(`PASS ${label}${r ? ' -> ' + r : ''}`); return true; }
  catch (e) { console.log(`FAIL ${label} -> ${e.message}`); return false; }
};

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
console.log('PASS menu visible after boot');

// Enter a name
await page.fill('#name-input', 'TesterBot').catch(() => {});
await page.screenshot({ path: 'tools/shot-menu.png' });

// Click JUGAR SOLO
await page.click('#btn-campaign');
await page.waitForTimeout(1200);

const afterStart = await page.evaluate(() => ({
  ui: window.__game?.ui?.current,
  mode: window.__game?.mode,
  phase: window.__game?.session?.game?.phase ?? null,
  round: window.__game?.session?.game?.round ?? null,
  hudHidden: document.getElementById('hud')?.hidden,
  players: window.__game?.session?.game?.players?.size ?? 0,
}));
console.log('state after solo start:', JSON.stringify(afterStart));

// Wait for countdown to finish and rounds to run
await page.waitForTimeout(9000);
const inPlay = await page.evaluate(() => ({
  phase: window.__game?.session?.game?.phase ?? null,
  round: window.__game?.session?.game?.round ?? null,
  alive: window.__game?.session?.game?.aliveCount?.() ?? null,
  fps: Math.round(window.__game?.fps ?? 0),
  avatars: window.__game?.avatars?.size ?? 0,
}));
console.log('state after 9s:', JSON.stringify(inPlay));

await page.screenshot({ path: 'tools/shot-game.png' });

console.log('\nerrors:', errors.length ? errors.join('\n  ') : '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
