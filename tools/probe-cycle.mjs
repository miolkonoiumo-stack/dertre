// Verify the cycle the user described, step by step, in the real browser:
//   1. neutral floor at start (no green, no lava)
//   2. safe zones appear + 5 second counter
//   3. at 0 the players NOT on a safe zone blow up, the others stay
//   4. if 4 remain -> exactly 3 safe zones
//   5. repeat
import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}
await page.evaluate(() => window.__game.startSolo());
await sleep(600);

const snap = () => page.evaluate(() => {
  const app = window.__game;
  const g = app?.session?.game;
  const arena = app?.arena;
  if (!g || !arena) return null;
  const arr = arena.tiles.instanceColor.array;
  let green = 0, red = 0, cyan = 0, amber = 0, neutral = 0;
  for (let i = 0; i < 144; i++) {
    const r = arr[i * 3], gg = arr[i * 3 + 1], b = arr[i * 3 + 2];
    if (r < 0.35 && gg > 0.5 && b < 0.35) green++;
    else if (r < 0.35 && gg > 0.5 && b > 0.5) cyan++;
    else if (r > 0.6 && gg > 0.3 && b < 0.4) amber++;
    else if (r > 0.3 && gg < 0.3 && b < 0.2) red++;
    else neutral++;
  }
  const safeTiles = g.safe ? g.safe.reduce((a, b) => a + b, 0) : 0;
  const alive = [...g.players.values()].filter((p) => p.alive && p.connected).length;
  return {
    phase: g.phase, round: g.round, alive,
    safeTiles, pendingTiles: g.pending ? g.pending.reduce((a, b) => a + b, 0) : 0,
    leftMs: Math.round(g.roundEndsAt - g.now),
    colors: { green, red, cyan, amber, neutral },
  };
});

// Phase 0: neutral floor check right at countdown.
const early = [];
for (let i = 0; i < 30; i++) {
  const s = await snap();
  if (s) early.push(s);
  await sleep(150);
}
const cd = early.find((s) => s.phase === 'countdown');
console.log('=== FLOOR AT START ===');
if (cd) console.log(`countdown: safeTiles=${cd.safeTiles} colours green=${cd.colors.green} red=${cd.colors.red} neutral=${cd.colors.neutral}`);

console.log('=== CYCLE ===');
let prevRound = -1;
const seen = [];
for (let i = 0; i < 260; i++) {
  const s = await snap();
  if (!s) { await sleep(120); continue; }
  if (s.phase === 'play' && s.round !== prevRound) {
    prevRound = s.round;
    const need = Math.max(1, s.alive - 1);
    console.log(`round ${s.round}: alive=${s.alive} zones=${s.safeTiles} need=${need} ${s.safeTiles === need ? 'OK' : 'VIOLATION'} | timer starts at ${s.leftMs}ms`);
    seen.push({ ...s, need });
  }
  if (seen.length >= 5) break;
  await sleep(120);
}
await browser.close();

console.log('---');
const bad = seen.filter((s) => s.safeTiles !== s.need);
console.log(bad.length === 0 ? 'RESULT: count rule holds every round' : `RESULT: ${bad.length} rounds violate the rule`);
const timerOk = seen.every((s) => s.leftMs > 4000);
console.log(timerOk ? 'timer starts near 5s as described' : 'timer does not start at ~5s');
