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
  const GRID = 12;
  // Hook the session's event stream to catch eliminations exactly.
  const caught = [];
  let zonesAtEnd = null, roundAtCheck = -1, playersAtEnd = null;
  app.startSolo();
  const s = app.session;
  const origOnEvent = s.onEvent?.bind(s);
  s.onEvent = (e) => {
    if (e && (e.t === 'eliminated' || e.t === 'death' || e.t === 'out')) caught.push(JSON.parse(JSON.stringify(e)));
    return origOnEvent ? origOnEvent(e) : undefined;
  };
  const t0 = performance.now();
  while (performance.now() - t0 < 22000) {
    const g = app.session?.game;
    if (g && g.phase === 'play' && roundAtCheck !== g.round) {
      roundAtCheck = g.round;
      zonesAtEnd = g.safe.slice();
      // snapshot just before resolution
      if (g.roundEndsAt - g.now < 200) {
        playersAtEnd = [...g.players.values()].map((p) => {
          const tx = p.x / 2.4 + 5.5, tz = p.z / 2.4 + 5.5;
          const ti = Math.round(tz) * GRID + Math.round(tx);
          const onSafe = ti >= 0 && ti < 144 && g.safe[ti] === 1;
          return { id: String(p.id).slice(0, 6), isBot: p.isBot, tile: `(${Math.round(tx)},${Math.round(tz)})`, onSafe, alive: p.alive };
        });
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  return { playersAtEnd, caught, phase: app.session?.game?.phase };
});
await browser.close();
if (out.playersAtEnd) {
  console.log('just before resolution:');
  for (const p of out.playersAtEnd) console.log(`  ${p.id} ${p.isBot ? 'BOT  ' : 'HUMAN'} tile=${p.tile} onSafe=${p.onSafe}`);
}
console.log(`phase now: ${out.phase}, elimination events caught: ${out.caught.length}`);
