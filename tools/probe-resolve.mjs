import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}

const out = await page.evaluate(async () => {
  const app = window.__game;
  const GRID = 12, T = 2.4, OFF = 5.5;
  app.startSolo();
  const s = app.session;
  const caught = [];
  const orig = s.onEvent?.bind(s);
  s.onEvent = (e) => { if (e?.t === 'eliminated') caught.push(JSON.parse(JSON.stringify(e))); return orig ? orig(e) : undefined; };

  // Snapshot every 40ms; keep the LAST frame of round 1 before resolution.
  let last = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 20000) {
    const g = s.game;
    if (g && g.phase === 'play' && g.round === 1) {
      last = {
        left: Math.round(g.roundEndsAt - g.now),
        zones: Array.from(g.safe).map((v, i) => (v ? `(${i % GRID},${(i / GRID) | 0})` : null)).filter(Boolean),
        players: [...g.players.values()].map((p) => {
          const tx = p.x / T + OFF, tz = p.z / T + OFF;
          const ti = Math.round(tz) * GRID + Math.round(tx);
          return { id: String(p.id).slice(0, 6), isBot: p.isBot, tile: `(${Math.round(tx)},${Math.round(tz)})`, onSafe: ti >= 0 && ti < 144 && g.safe[ti] === 1, alive: p.alive };
        }),
      };
    }
    if (caught.length) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  return { last, caught };
});
await browser.close();

if (out.last) {
  console.log(`last snapshot at +${out.last.left}ms of round 1`);
  console.log('zones: ' + out.last.zones.join(' '));
  for (const p of out.last.players) console.log(`  ${p.id} ${p.isBot ? 'BOT  ' : 'HUMAN'} tile=${p.tile} onSafe=${p.onSafe}`);
}
console.log('---');
for (const e of out.caught) console.log(`eliminated: ${JSON.stringify(e.ids)} round=${e.round}`);
