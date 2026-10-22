// Watch one full round in the browser tick by tick: who dies, when, and why.
import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}

const out = await page.evaluate(async () => {
  const app = window.__game;
  app.startSolo();
  const log = [];
  let lastRound = -1;
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    const g = app.session?.game;
    if (!g) { await new Promise((r) => setTimeout(r, 60)); continue; }
    const alive = [...g.players.values()].filter((p) => p.alive);
    const dead = [...g.players.values()].filter((p) => !p.alive);
    if (g.round !== lastRound) {
      lastRound = g.round;
      log.push({ t: Math.round(performance.now() - t0), ev: 'round', round: g.round, phase: g.phase, alive: alive.length, dead: dead.map((p) => `${String(p.id).slice(0, 6)}${p.fellOff ? '(fell)' : ''}`) });
    }
    if (dead.length) {
      log.push({ t: Math.round(performance.now() - t0), ev: 'dead', round: g.round, phase: g.phase, alive: alive.length, dead: dead.map((p) => `${String(p.id).slice(0, 6)}${p.fellOff ? '(fell)' : '(lava)'}`) });
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return log;
});
await browser.close();
for (const l of out) console.log(`t=${l.t}ms ${l.ev} round=${l.round} phase=${l.phase} alive=${l.alive} dead=[${l.dead.join(',')}]`);
