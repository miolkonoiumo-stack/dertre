import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(4500);

const out = await page.evaluate(async () => {
  const app = window.__game;
  const snaps = [];
  for (let k = 0; k < 4; k++) {
    const g = app.session?.game;
    if (!g) { snaps.push({ err: 'no game' }); break; }
    const bots = [...g.players.values()].filter((p) => p.isBot).map((p) => ({
      id: String(p.id).slice(4, 9), x: +p.x.toFixed(2), z: +p.z.toFixed(2), alive: p.alive,
    }));
    snaps.push({ phase: g.phase, round: g.round, now: Math.round(g.now), brains: app.session.brains?.size ?? -1, bots });
    await new Promise((r) => setTimeout(r, 700));
  }
  return snaps;
});
await browser.close();

for (const s of out) {
  if (s.err) { console.log('ERR', s.err); continue; }
  console.log(`phase=${s.phase} round=${s.round} now=${s.now} brains=${s.brains}`);
  console.log('   ' + s.bots.map((b) => `${b.id}(${b.x},${b.z})${b.alive ? '' : 'DEAD'}`).join(' '));
}
// Did any bot move between the first and last snapshot?
const first = out[0].bots, last = out[out.length - 1].bots;
const moved = first.filter((b, i) => Math.hypot(b.x - last[i].x, b.z - last[i].z) > 0.5).length;
console.log('---');
console.log(`bots that moved: ${moved}/${first.length}`);
console.log(moved > 0 ? 'RESULT: bots are moving in the browser' : 'RESULT: bots are FROZEN in the browser');
