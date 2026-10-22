// Same as probe-cycle-live, but the human player is driven TO its safe zone so
// the match actually lasts several rounds and we can watch 6 -> 5 -> 4 -> 3.
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
  const app = window.__game;
  app.startSolo();
  const G = 12;
  const out = { rounds: [], changes: 0, neutral: null };
  let refMask = '', refRound = -1;

  function zonesOf(m) {
    const seen = new Set();
    const zones = [];
    for (let i = 0; i < m.length; i++) {
      if (!m[i] || seen.has(i)) continue;
      const cells = [];
      const stack = [i];
      while (stack.length) {
        const c = stack.pop();
        if (seen.has(c)) continue;
        seen.add(c);
        cells.push(c);
        const x = c % G, z = (c / G) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
          const k = nz * G + nx;
          if (m[k] && !seen.has(k)) stack.push(k);
        }
      }
      zones.push(cells);
    }
    return zones;
  }

  // Steer the human onto the nearest free safe zone every frame.
  const steer = setInterval(() => {
    const g = app.session?.game;
    const me = g?.players?.get(app.session.id);
    if (!g || !me || !me.alive || g.phase !== 'play') return;
    const zones = zonesOf(g.safe);
    if (!zones.length) return;
    let best = null, bestD = Infinity;
    for (const z of zones) {
      const cx = z.reduce((a, c) => a + (c % G), 0) / z.length;
      const cz = z.reduce((a, c) => a + ((c / G) | 0), 0) / z.length;
      const d = Math.hypot(cx - me.x, cz - me.z);
      if (d < bestD) { bestD = d; best = { cx, cz }; }
    }
    if (!best) return;
    const dx = best.cx - me.x, dz = best.cz - me.z;
    me.input = { x: Math.abs(dx) < 0.3 ? 0 : Math.sign(dx), z: Math.abs(dz) < 0.3 ? 0 : Math.sign(dz), jump: false, sprint: true, seq: me.input.seq + 1 };
  }, 60);

  const t0 = performance.now();
  while (performance.now() - t0 < 60000) {
    const g = app.session?.game;
    if (g) {
      if (g.phase === 'countdown' && out.neutral === null) {
        out.neutral = { safeTiles: g.safe.reduce((a, b) => a + b, 0), neutral: g.neutralFloor };
      }
      if (g.phase === 'play') {
        const mask = Array.from(g.safe).join('');
        const alive = [...g.players.values()].filter((p) => p.alive).length;
        if (g.round !== refRound) {
          refRound = g.round;
          refMask = mask;
          out.rounds.push({ round: g.round, alive, zones: zonesOf(g.safe).length, sizes: zonesOf(g.safe).map((z) => z.length), left: Math.round(g.roundEndsAt - g.now) });
        } else if (mask !== refMask) {
          out.changes++;
          refMask = mask;
        }
        if (out.rounds.length >= 5) break;
      }
      if (g.phase === 'result') break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  clearInterval(steer);
  return out;
});
await browser.close();

console.log('neutral floor at start:', JSON.stringify(data.neutral));
console.log('mid-round floor changes:', data.changes, '(must be 0)');
for (const r of data.rounds) {
  const need = Math.max(1, r.alive - 1);
  console.log(`round ${r.round}: alive=${r.alive} zones=${r.zones} need=${need} sizes=[${r.sizes}] ${r.zones === need ? 'OK' : 'VIOLATION'} timer=${r.left}ms`);
}
const bad = data.rounds.filter((r) => r.zones !== Math.max(1, r.alive - 1));
const single = data.rounds.every((r) => r.sizes.every((s) => s === 1));
const ok = data.changes === 0 && data.neutral?.safeTiles === 0 && bad.length === 0 && single && data.rounds.length >= 3;
console.log('all zones exactly one tile:', single);
console.log('---');
console.log(ok ? `RESULT: PASS — ${data.rounds.length} rounds match the described cycle` : 'RESULT: FAIL');
