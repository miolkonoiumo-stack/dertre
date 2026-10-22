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

// End of round 1: who survives, and where are they relative to a zone?
const out = await page.evaluate(async () => {
  const app = window.__game;
  app.startSolo();
  const GRID = 12;
  const t0 = performance.now();
  while (performance.now() - t0 < 25000) {
    const g = app.session?.game;
    if (g && g.phase === 'play' && g.roundEndsAt - g.now < 100) {
      const zones = [];
      for (let i = 0; i < GRID * GRID; i++) if (g.safe[i]) zones.push(i);
      const res = [...g.players.values()].map((p) => {
        const tx = p.x / 2.4 + 5.5, tz = p.z / 2.4 + 5.5;
        let best = Infinity;
        for (const c of zones) best = Math.min(best, Math.hypot((c % GRID) - tx, ((c / GRID) | 0) - tz));
        return { id: String(p.id).slice(0, 6), isBot: p.isBot, alive: p.alive, distTiles: +best.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1) };
      });
      return { round: g.round, zones: zones.map((c) => `(${c % GRID},${(c / GRID) | 0})`), res };
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
});
await browser.close();
if (!out) { console.log('no round end captured'); }
else {
  console.log(`round ${out.round} zones: ${out.zones.join(' ')}`);
  for (const r of out.res) {
    console.log(`  ${r.id} ${r.isBot ? 'BOT ' : 'HUMAN'} pos=(${r.x},${r.z}) distToZone=${r.distTiles}t ${r.alive ? 'ALIVE' : 'DEAD'}`);
  }
  const bots = out.res.filter((r) => r.isBot);
  const botsAlive = bots.filter((r) => r.alive).length;
  console.log(`---\nbots surviving: ${botsAlive}/${bots.length}`);
}
