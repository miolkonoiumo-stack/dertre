// Same measurement as probe-zone-geometry, but inside the real browser game.
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
  const GRID = 12;
  const log = [];
  let round = -1;
  const t0 = performance.now();
  while (performance.now() - t0 < 25000) {
    const g = app.session?.game;
    if (!g) { await new Promise((r) => setTimeout(r, 60)); continue; }
    if (g.phase === 'play' && g.round !== round) {
      round = g.round;
      const zones = [];
      for (let i = 0; i < GRID * GRID; i++) if (g.safe[i]) zones.push({ x: i % GRID, z: (i / GRID) | 0 });
      log.push({ ev: 'start', round, zones: zones.map((z) => `(${z.x},${z.z})`), players: [...g.players.values()].map((p) => ({ id: String(p.id).slice(0, 6), x: +p.x.toFixed(1), z: +p.z.toFixed(1), alive: p.alive })) });
    }
    // Near the end of the round.
    if (g.phase === 'play' && g.roundEndsAt - g.now < 120) {
      log.push({ ev: 'end', round, players: [...g.players.values()].map((p) => ({ id: String(p.id).slice(0, 6), x: +p.x.toFixed(1), z: +p.z.toFixed(1), alive: p.alive })) });
      break;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return log;
});
await browser.close();
for (const e of out) {
  if (e.ev === 'start') {
    console.log(`\nround ${e.round} START zones: ${e.zones.join(' ')}`);
    for (const p of e.players) console.log(`   ${p.id} (${p.x},${p.z})`);
  } else {
    console.log(`round ${e.round} END:`);
    for (const p of e.players) console.log(`   ${p.id} (${p.x},${p.z}) ${p.alive ? 'ALIVE' : 'DEAD'}`);
  }
}
