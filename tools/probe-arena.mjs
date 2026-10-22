import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu.active', { timeout: 20000 });
await page.click('#btn-campaign');
await page.waitForTimeout(1500);

// Wait until we are in PLAY and sample the arena colours.
await page.waitForFunction(() => window.__game?.session?.game?.phase === 'play', { timeout: 30000 });

const info = await page.evaluate(() => {
  const g = window.__game;
  const a = g.arena;
  const safe = [];
  const lava = [];
  for (let i = 0; i < a.safeMask.length; i++) {
    if (a.safeMask[i]) safe.push(i);
  }
  return {
    phase: g.session.game.phase,
    round: g.session.game.round,
    safeCount: safe.length,
    alive: g.session.game.aliveCount(),
    pending: !!g.session.game.pending,
    bloom: g.world.bloomPass?.strength ?? null,
  };
});
console.log('PLAY state:', JSON.stringify(info));
await page.screenshot({ path: 'tools/shot-play-color.png' });

// Jump to the warning window to capture the preview colours.
await page.waitForTimeout(3600);
const warn = await page.evaluate(() => {
  const g = window.__game;
  const a = g.arena;
  return {
    phase: g.session.game.phase,
    hasPending: !!g.session.game.pending,
    pendingStrength: +(a.pendingStrength ?? 0).toFixed(2),
    warningAt: g.session.game.warningAt,
    now: g.session.game.now,
  };
});
console.log('WARN state:', JSON.stringify(warn));
await page.screenshot({ path: 'tools/shot-warning.png' });

await browser.close();
