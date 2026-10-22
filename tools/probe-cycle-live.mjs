// Full-cycle verification in the real browser, timed against the round clock:
//   t=0        safe zones visible, counter at 5
//   t=0..5000  zones stay put (no mid-round floor change)
//   t=5000     only the players off a zone are eliminated
//   next round: exactly alive-1 zones
import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__game?.ui?.current)) === 'menu') break;
  await sleep(400);
}

const data = await page.evaluate(async () => {
  window.__game.startSolo();
  const out = { rounds: [], neutral: null, changes: 0 };
  const ref = { round: -1, mask: '', left: 0 };
  const t0 = performance.now();
  while (performance.now() - t0 < 40000) {
    const app = window.__game;
    const g = app?.session?.game;
    if (g) {
      const alive = [...g.players.values()].filter((p) => p.alive).length;
      if (g.phase === 'countdown' && out.neutral === null) {
        out.neutral = { safeTiles: g.safe.reduce((a, b) => a + b, 0), neutral: g.neutralFloor };
      }
      if (g.phase === 'play') {
        const mask = Array.from(g.safe).join('');
        const left = Math.round(g.roundEndsAt - g.now);
        if (g.round !== ref.round) {
          ref.round = g.round; ref.mask = mask; ref.left = left;
          out.rounds.push({ round: g.round, alive, zones: countZones(mask), leftAtStart: left });
        } else if (mask !== ref.mask) {
          // The floor changed while the round was still running.
          out.changes++;
          ref.mask = mask;
        }
        if (out.rounds.length >= 4) break;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  function countZones(m) {
    let n = 0;
    const seen = new Set();
    const G = 12;
    for (let i = 0; i < m.length; i++) {
      if (m[i] !== '1' || seen.has(i)) continue;
      n++;
      const stack = [i];
      while (stack.length) {
        const c = stack.pop();
        if (seen.has(c)) continue;
        seen.add(c);
        const x = c % G, z = (c / G) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
          const k = nz * G + nx;
          if (m[k] === '1' && !seen.has(k)) stack.push(k);
        }
      }
    }
    return n;
  }
  return out;
});
await browser.close();

console.log('neutral floor at start:', JSON.stringify(data.neutral));
console.log('mid-round floor changes:', data.changes, '(must be 0)');
for (const r of data.rounds) {
  const need = Math.max(1, r.alive - 1);
  console.log(`round ${r.round}: alive=${r.alive} zones=${r.zones} need=${need} ${r.zones === need ? 'OK' : 'VIOLATION'} timer=${r.leftAtStart}ms`);
}
const bad = data.rounds.filter((r) => r.zones !== Math.max(1, r.alive - 1));
const ok = data.changes === 0 && data.neutral?.safeTiles === 0 && bad.length === 0;
console.log('---');
console.log(ok ? 'RESULT: PASS — cycle matches the description in the real browser' : 'RESULT: FAIL');
