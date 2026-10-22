import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}

// Record the exact first frame of each PLAY round.
await page.evaluate(() => {
  window.__cycle = [];
  const app = window.__game;
  const orig = app.arena.setSafe.bind(app.arena);
  app.arena.setSafe = (m) => {
    const g = app.session?.game;
    if (g && g.phase === 'play') {
      window.__cycle.push({ round: g.round, left: Math.round(g.roundEndsAt - g.now), alive: [...g.players.values()].filter((p) => p.alive).length });
    }
    return orig(m);
  };
});
await page.evaluate(() => window.__game.startSolo());
await sleep(30000);
const cycle = await page.evaluate(() => window.__cycle);
console.log('round starts recorded:');
for (const c of cycle) console.log(`  round ${c.round}: timer starts at ${c.left}ms, alive=${c.alive}`);
await browser.close();
const ok = cycle.length > 0 && cycle.every((c) => c.left >= 4800);
console.log('---');
console.log(ok ? 'RESULT: PASS — rounds start at ~5000ms' : 'RESULT: FAIL — timer does not start at 5s');
