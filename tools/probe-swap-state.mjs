// Wrap the client's tick loop and dump the FULL pre-resolution state from inside
// the browser, at the exact tick where resolveRound runs.
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
  const s = app.session;
  const g = s.game;
  const GRID = 12, T = 2.4, OFF = 5.5;
  const seen = { pre: null, eliminated: null };

  // Monkeypatch the game's _beginSwap to snapshot state the instant a round ends.
  const origSwap = g._beginSwap.bind(g);
  g._beginSwap = function (now) {
    if (!seen.pre) {
      seen.pre = {
        round: g.round,
        left: Math.round(g.roundEndsAt - g.now),
        zones: Array.from(g.safe).map((v, i) => (v ? `(${i % GRID},${(i / GRID) | 0})` : null)).filter(Boolean),
        players: [...g.players.values()].filter((p) => p.alive).map((p) => {
          const tx = p.x / T + OFF, tz = p.z / T + OFF;
          const ti = Math.round(tz) * GRID + Math.round(tx);
          return {
            id: String(p.id).slice(0, 6), isBot: p.isBot,
            tile: `(${Math.round(tx)},${Math.round(tz)})`,
            onSafe: ti >= 0 && ti < 144 && g.safe[ti] === 1,
            y: +p.y.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2),
            input: `${p.input?.x},${p.input?.z}`,
          };
        }),
      };
    }
    return origSwap(now);
  };

  const origEvent = s.onEvent?.bind(s);
  s.onEvent = (e) => {
    if (e?.t === 'eliminated' && !seen.eliminated) seen.eliminated = e.ids.map((i) => String(i).slice(0, 6));
    return origEvent ? origEvent(e) : undefined;
  };

  const t0 = performance.now();
  while (performance.now() - t0 < 20000 && !seen.eliminated) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return seen;
});
await browser.close();

if (!out.pre) console.log('no round-end snapshot captured');
else {
  console.log(`round ${out.pre.round} at swap (left=${out.pre.left}ms)`);
  console.log('zones: ' + out.pre.zones.join(' '));
  for (const p of out.pre.players) {
    console.log(`  ${p.id} ${p.isBot ? 'BOT  ' : 'HUMAN'} tile=${p.tile} onSafe=${p.onSafe} y=${p.y} in=${p.input}`);
  }
  console.log('eliminated: ' + JSON.stringify(out.eliminated));
  const wrongly = out.pre.players.filter((p) => p.onSafe && out.eliminated?.includes(p.id));
  console.log(`---\nplayers ON a safe tile but eliminated: ${wrongly.length} ${JSON.stringify(wrongly.map((p) => p.id))}`);
}
